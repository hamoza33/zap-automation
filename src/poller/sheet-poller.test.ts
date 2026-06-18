import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AppConfig } from '../types.js';

// Shared mock state that tests can manipulate
let mockSheetsByTitle: Record<string, any> = {};

vi.mock('google-spreadsheet', () => {
  class MockGoogleSpreadsheet {
    get sheetsByTitle() {
      return mockSheetsByTitle;
    }
    constructor(_id: string, _auth: any) {}
    async loadInfo() {}
  }
  return { GoogleSpreadsheet: MockGoogleSpreadsheet };
});

vi.mock('google-auth-library', () => {
  class MockJWT {
    constructor(_opts: any) {}
  }
  return { JWT: MockJWT };
});

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  })),
}));

import { SheetPoller } from './sheet-poller.js';

function createMockConfig(): AppConfig {
  return {
    googleSheetId: 'test-sheet-id',
    worksheetName: 'Sheet1',
    googleCredentialsPath: '/path/to/credentials.json',
    bufferAccessToken: 'test-token',
    bufferTikTokProfileId: 'test-profile',
    pollingIntervalSeconds: 60,
    healthCheckPort: 3000,
  };
}

function createMockRow(rowNumber: number, status: string = '') {
  const data: Record<string, string> = { Status: status };
  return {
    rowNumber,
    get: (key: string) => data[key] ?? '',
    set: vi.fn((key: string, value: string) => { data[key] = value; }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSheet(rows: ReturnType<typeof createMockRow>[]) {
  return {
    getRows: vi.fn().mockResolvedValue(rows),
  };
}

describe('SheetPoller - markRowProcessed', () => {
  let poller: SheetPoller;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockSheetsByTitle = {};
    poller = new SheetPoller(createMockConfig());
    await poller.authenticate();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw if not authenticated', async () => {
    const freshPoller = new SheetPoller(createMockConfig());
    await expect(freshPoller.markRowProcessed(2, 'success'))
      .rejects.toThrow('SheetPoller not authenticated');
  });

  it('should throw if worksheet not found', async () => {
    mockSheetsByTitle = {};
    await expect(poller.markRowProcessed(2, 'success'))
      .rejects.toThrow('Worksheet "Sheet1" not found');
  });

  it('should write "success" to the Status column', async () => {
    const mockRow = createMockRow(2, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessed(2, 'success');

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'success');
    expect(mockRow.save).toHaveBeenCalledTimes(1);
  });

  it('should write "error:<detail>" to the Status column', async () => {
    const mockRow = createMockRow(3, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessed(3, 'error', 'invalid caption');

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'error:invalid caption');
    expect(mockRow.save).toHaveBeenCalledTimes(1);
  });

  it('should write "failed:<detail>" to the Status column', async () => {
    const mockRow = createMockRow(4, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessed(4, 'failed', 'Buffer API timeout');

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'failed:Buffer API timeout');
    expect(mockRow.save).toHaveBeenCalledTimes(1);
  });

  it('should write "error:unknown" when no detail is provided for error status', async () => {
    const mockRow = createMockRow(5, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessed(5, 'error');

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'error:unknown');
  });

  it('should write "failed:unknown" when no detail is provided for failed status', async () => {
    const mockRow = createMockRow(5, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessed(5, 'failed');

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'failed:unknown');
  });

  it('should throw if row is not found in worksheet', async () => {
    const mockRow = createMockRow(2, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await expect(poller.markRowProcessed(99, 'success'))
      .rejects.toThrow('Row 99 not found in worksheet "Sheet1"');
  });

  describe('retry logic', () => {
    it('should retry up to 3 times on save failure and then throw', async () => {
      const mockRow = createMockRow(2, '');
      mockRow.save = vi.fn().mockRejectedValue(new Error('Google API error'));
      const mockSheet = createMockSheet([mockRow]);
      mockSheetsByTitle = { Sheet1: mockSheet };

      const promise = poller.markRowProcessed(2, 'success');

      // Catch the promise early to prevent unhandled rejection warnings
      let caughtError: Error | null = null;
      const handled = promise.catch((err) => { caughtError = err; });

      // Advance past retry delays (1s each between attempts)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      await handled;

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toContain(
        'Failed to write status "success" to row 2 after 3 attempts: Google API error'
      );
      // getRows is called 3 times (once per attempt)
      expect(mockSheet.getRows).toHaveBeenCalledTimes(3);
    });

    it('should succeed on second attempt after initial failure', async () => {
      const mockRow = createMockRow(2, '');
      mockRow.save = vi.fn()
        .mockRejectedValueOnce(new Error('Temporary network error'))
        .mockResolvedValueOnce(undefined);
      const mockSheet = createMockSheet([mockRow]);
      mockSheetsByTitle = { Sheet1: mockSheet };

      const promise = poller.markRowProcessed(2, 'success');

      // Advance past the retry delay
      await vi.advanceTimersByTimeAsync(1000);

      await expect(promise).resolves.toBeUndefined();
      expect(mockSheet.getRows).toHaveBeenCalledTimes(2);
    });

    it('should not retry on "row not found" errors', async () => {
      const mockSheet = createMockSheet([]); // No rows at all
      mockSheetsByTitle = { Sheet1: mockSheet };

      await expect(poller.markRowProcessed(5, 'success'))
        .rejects.toThrow('Row 5 not found in worksheet "Sheet1"');

      // Should only call getRows once — no retry for missing rows
      expect(mockSheet.getRows).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SheetPoller - markRowProcessing', () => {
  let poller: SheetPoller;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockSheetsByTitle = {};
    poller = new SheetPoller(createMockConfig());
    await poller.authenticate();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throw if not authenticated', async () => {
    const freshPoller = new SheetPoller(createMockConfig());
    await expect(freshPoller.markRowProcessing(2))
      .rejects.toThrow('SheetPoller not authenticated');
  });

  it('should write "processing" to the Status column as optimistic lock', async () => {
    const mockRow = createMockRow(2, '');
    mockSheetsByTitle = { Sheet1: createMockSheet([mockRow]) };

    await poller.markRowProcessing(2);

    expect(mockRow.set).toHaveBeenCalledWith('Status', 'processing');
    expect(mockRow.save).toHaveBeenCalledTimes(1);
  });

  it('should retry up to 3 times on failure', async () => {
    const mockRow = createMockRow(3, '');
    mockRow.save = vi.fn().mockRejectedValue(new Error('API unavailable'));
    const mockSheet = createMockSheet([mockRow]);
    mockSheetsByTitle = { Sheet1: mockSheet };

    const promise = poller.markRowProcessing(3);

    // Catch the promise early to prevent unhandled rejection warnings
    let caughtError: Error | null = null;
    const handled = promise.catch((err) => { caughtError = err; });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await handled;

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toContain(
      'Failed to write status "processing" to row 3 after 3 attempts'
    );
    expect(mockSheet.getRows).toHaveBeenCalledTimes(3);
  });

  it('should succeed on retry after initial failure', async () => {
    const mockRow = createMockRow(4, '');
    mockRow.save = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce(undefined);
    const mockSheet = createMockSheet([mockRow]);
    mockSheetsByTitle = { Sheet1: mockSheet };

    const promise = poller.markRowProcessing(4);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBeUndefined();
    expect(mockRow.set).toHaveBeenCalledWith('Status', 'processing');
  });
});
