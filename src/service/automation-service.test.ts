import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationService, AutomationServiceDeps } from './automation-service.js';
import type {
  AppConfig,
  ISheetPoller,
  IRowValidator,
  IBufferPublisher,
  ILogger,
  SheetRow,
  ValidationResult,
  PublishResult,
} from '../types.js';
import type { HealthCheckServer } from '../health/health-check-server.js';

function createMockConfig(): AppConfig {
  return {
    googleSheetId: 'test-sheet-id',
    worksheetName: 'Sheet1',
    googleCredentialsPath: '/path/to/creds.json',
    bufferAccessToken: 'test-token',
    bufferTikTokProfileId: 'test-profile-id',
    pollingIntervalSeconds: 10,
    healthCheckPort: 3000,
  };
}

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  };
}

function createMockSheetPoller(): ISheetPoller {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    fetchUnprocessedRows: vi.fn().mockResolvedValue([]),
    markRowProcessing: vi.fn().mockResolvedValue(undefined),
    markRowProcessed: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockRowValidator(): IRowValidator {
  return {
    validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  };
}

function createMockBufferPublisher(): IBufferPublisher {
  return {
    schedulePost: vi.fn().mockResolvedValue({ success: true, postId: 'post-123', attempts: 1 }),
  };
}

function createMockHealthCheckServer(): HealthCheckServer {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    updateLastPoll: vi.fn(),
    updateStatus: vi.fn(),
    recordError: vi.fn(),
    resetErrors: vi.fn(),
  } as unknown as HealthCheckServer;
}

function createDeps(overrides: Partial<AutomationServiceDeps> = {}): AutomationServiceDeps {
  return {
    config: createMockConfig(),
    sheetPoller: createMockSheetPoller(),
    rowValidator: createMockRowValidator(),
    bufferPublisher: createMockBufferPublisher(),
    healthCheckServer: createMockHealthCheckServer(),
    logger: createMockLogger(),
    ...overrides,
  };
}

describe('AutomationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('should authenticate with Google Sheets, start health server, and begin polling', async () => {
      const deps = createDeps();
      const service = new AutomationService(deps);

      await service.start();

      expect(deps.sheetPoller.authenticate).toHaveBeenCalledOnce();
      expect(deps.healthCheckServer.start).toHaveBeenCalledWith(3000);
      expect(deps.logger.info).toHaveBeenCalledWith(
        'Authenticating with Google Sheets API'
      );

      await service.stop();
    });
  });

  describe('signal handling', () => {
    it('should register SIGTERM and SIGINT handlers on start', async () => {
      const deps = createDeps();
      const service = new AutomationService(deps);

      const sigTermListeners = process.listenerCount('SIGTERM');
      const sigIntListeners = process.listenerCount('SIGINT');

      await service.start();

      expect(process.listenerCount('SIGTERM')).toBe(sigTermListeners + 1);
      expect(process.listenerCount('SIGINT')).toBe(sigIntListeners + 1);

      await service.stop();
    });

    it('should remove signal handlers on stop', async () => {
      const deps = createDeps();
      const service = new AutomationService(deps);

      const sigTermListeners = process.listenerCount('SIGTERM');
      const sigIntListeners = process.listenerCount('SIGINT');

      await service.start();
      await service.stop();

      expect(process.listenerCount('SIGTERM')).toBe(sigTermListeners);
      expect(process.listenerCount('SIGINT')).toBe(sigIntListeners);
    });
  });

  describe('stop()', () => {
    it('should stop health check server and cancel the polling timer', async () => {
      const deps = createDeps();
      const service = new AutomationService(deps);

      await service.start();
      await service.stop();

      expect(deps.healthCheckServer.stop).toHaveBeenCalledOnce();
      expect(deps.logger.info).toHaveBeenCalledWith('Automation service stopped');
    });
  });

  describe('pollCycle()', () => {
    it('should fetch unprocessed rows and process valid rows successfully', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 2, captionText: 'Hello TikTok', videoUrl: 'https://example.com/video.mp4', processedMarker: null },
      ];

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const service = new AutomationService(deps);
      await service.start();

      // Advance timer to trigger the poll cycle
      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalled();
      expect(deps.rowValidator.validate).toHaveBeenCalledWith(rows[0]);
      expect(deps.sheetPoller.markRowProcessing).toHaveBeenCalledWith(2);
      expect(deps.bufferPublisher.schedulePost).toHaveBeenCalledWith('Hello TikTok', 'https://example.com/video.mp4');
      expect(deps.sheetPoller.markRowProcessed).toHaveBeenCalledWith(2, 'success');
      expect(deps.healthCheckServer.updateLastPoll).toHaveBeenCalled();

      await service.stop();
    });

    it('should log validation errors and mark row as error when validation fails', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 3, captionText: '', videoUrl: 'not-a-url', processedMarker: null },
      ];

      const validationResult: ValidationResult = {
        valid: false,
        errors: [
          { field: 'captionText', message: 'Caption text must contain at least one non-whitespace character' },
          { field: 'videoUrl', message: 'Video URL must start with "http://" or "https://"' },
        ],
      };

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      (deps.rowValidator.validate as ReturnType<typeof vi.fn>).mockReturnValue(validationResult);

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.logger.warn).toHaveBeenCalledWith('Row validation failed', {
        rowNumber: 3,
        errors: validationResult.errors,
      });
      expect(deps.sheetPoller.markRowProcessed).toHaveBeenCalledWith(
        3,
        'error',
        expect.stringContaining('captionText')
      );
      // Should NOT attempt to publish
      expect(deps.bufferPublisher.schedulePost).not.toHaveBeenCalled();

      await service.stop();
    });

    it('should skip row when processing marker write fails', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 4, captionText: 'Valid caption', videoUrl: 'https://example.com/v.mp4', processedMarker: null },
      ];

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      (deps.sheetPoller.markRowProcessing as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Sheet API unavailable')
      );

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.logger.error).toHaveBeenCalledWith('Failed to write processing marker', {
        rowNumber: 4,
        error: 'Sheet API unavailable',
      });
      // Should NOT attempt to publish
      expect(deps.bufferPublisher.schedulePost).not.toHaveBeenCalled();

      await service.stop();
    });

    it('should mark row as failed when Buffer publish fails', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 5, captionText: 'Test caption', videoUrl: 'https://example.com/v.mp4', processedMarker: null },
      ];

      const publishResult: PublishResult = {
        success: false,
        error: 'Buffer API timeout',
        attempts: 3,
      };

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      (deps.bufferPublisher.schedulePost as ReturnType<typeof vi.fn>).mockResolvedValue(publishResult);

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.sheetPoller.markRowProcessed).toHaveBeenCalledWith(5, 'failed', 'Buffer API timeout');
      expect(deps.logger.error).toHaveBeenCalledWith('Failed to schedule post', {
        rowNumber: 5,
        error: 'Buffer API timeout',
        attempts: 3,
      });

      await service.stop();
    });

    it('should log manual review when final marker write fails after successful publish', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 6, captionText: 'Caption', videoUrl: 'https://example.com/v.mp4', processedMarker: null },
      ];

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      (deps.sheetPoller.markRowProcessed as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Failed after 3 retries')
      );

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.logger.error).toHaveBeenCalledWith('Row requires manual review', expect.objectContaining({
        rowNumber: 6,
        reason: 'Post scheduled successfully but failed to write success marker',
      }));

      await service.stop();
    });

    it('should handle Google Sheets API unreachable during poll cycle', async () => {
      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Google Sheets API unreachable')
      );

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(deps.logger.error).toHaveBeenCalledWith('Poll cycle failed', {
        error: 'Google Sheets API unreachable',
      });
      expect(deps.healthCheckServer.recordError).toHaveBeenCalled();

      await service.stop();
    });

    it('should process multiple rows in order', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 2, captionText: 'First', videoUrl: 'https://a.com/1.mp4', processedMarker: null },
        { rowNumber: 3, captionText: 'Second', videoUrl: 'https://b.com/2.mp4', processedMarker: null },
        { rowNumber: 4, captionText: 'Third', videoUrl: 'https://c.com/3.mp4', processedMarker: null },
      ];

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);

      const publishOrder: string[] = [];
      (deps.bufferPublisher.schedulePost as ReturnType<typeof vi.fn>).mockImplementation(
        (caption: string) => {
          publishOrder.push(caption);
          return Promise.resolve({ success: true, postId: `id-${caption}`, attempts: 1 });
        }
      );

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(publishOrder).toEqual(['First', 'Second', 'Third']);
      expect(deps.logger.info).toHaveBeenCalledWith('Poll cycle complete', { processedRows: 3 });

      await service.stop();
    });

    it('should continue processing subsequent rows when one row fails validation', async () => {
      const rows: SheetRow[] = [
        { rowNumber: 2, captionText: '', videoUrl: 'invalid', processedMarker: null },
        { rowNumber: 3, captionText: 'Valid caption', videoUrl: 'https://example.com/v.mp4', processedMarker: null },
      ];

      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
      (deps.rowValidator.validate as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce({ valid: false, errors: [{ field: 'captionText', message: 'empty' }] })
        .mockReturnValueOnce({ valid: true, errors: [] });

      const service = new AutomationService(deps);
      await service.start();

      await vi.advanceTimersByTimeAsync(10_000);

      // Second row should still be published
      expect(deps.bufferPublisher.schedulePost).toHaveBeenCalledWith('Valid caption', 'https://example.com/v.mp4');

      await service.stop();
    });

    it('should use recursive setTimeout and not overlap polling cycles', async () => {
      const deps = createDeps();
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const service = new AutomationService(deps);
      await service.start();

      // First cycle
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(1);

      // Second cycle
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(2);

      await service.stop();
    });
  });

  describe('circuit breaker', () => {
    /**
     * Helper: sets up mocks so pollCycle() throws an unhandled exception.
     * fetchUnprocessedRows rejects, and recordError also throws,
     * causing the inner catch in pollCycle to propagate to the outer catch.
     */
    function setupUnhandledException(deps: AutomationServiceDeps): void {
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Sheets API failure')
      );
      (deps.healthCheckServer.recordError as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('recordError also failed');
      });
    }

    it('should wait 5 seconds then resume polling after a single unhandled exception', async () => {
      const deps = createDeps();

      // First call: throw unhandled exception. Subsequent calls: succeed normally.
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Sheets API failure'))
        .mockResolvedValue([]);
      (deps.healthCheckServer.recordError as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(() => { throw new Error('recordError failed'); })
        .mockImplementation(() => {});

      const service = new AutomationService(deps);
      await service.start();

      // Trigger first poll cycle (10s interval)
      await vi.advanceTimersByTimeAsync(10_000);

      // Error should be logged
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Unhandled exception in polling loop',
        expect.objectContaining({ error: expect.any(String) })
      );

      // After the error, it schedules next poll with 5-second delay
      // Advance 4 seconds — poll should NOT have fired again yet
      await vi.advanceTimersByTimeAsync(4_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(1);

      // Advance 1 more second (total 5s after error) — poll should fire
      await vi.advanceTimersByTimeAsync(1_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(2);

      // Normal polling resumes with standard interval after successful cycle
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(3);

      await service.stop();
    });

    it('should trigger circuit breaker after 5 consecutive unhandled exceptions within 60 seconds', async () => {
      const deps = createDeps();
      setupUnhandledException(deps);

      const service = new AutomationService(deps);
      await service.start();

      // Trigger first poll (at 10s)
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(1);

      // Each subsequent retry is after 5s delay
      // Error 2 (at 10s + 5s = 15s)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(2);

      // Error 3 (at 20s)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(3);

      // Error 4 (at 25s)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(4);

      // Error 5 (at 30s) — circuit breaker should trip
      await vi.advanceTimersByTimeAsync(5_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(5);

      // Circuit breaker should have been triggered
      expect(deps.logger.critical).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker triggered'),
        expect.objectContaining({ errorsInWindow: 5 })
      );

      // Polling should have ceased — no more calls even after waiting
      await vi.advanceTimersByTimeAsync(60_000);
      expect(deps.sheetPoller.fetchUnprocessedRows).toHaveBeenCalledTimes(5);

      await service.stop();
    });

    it('should transition health status to "unhealthy" when circuit breaker activates', async () => {
      const deps = createDeps();
      setupUnhandledException(deps);

      const service = new AutomationService(deps);
      await service.start();

      // Trigger 5 consecutive exceptions: first at 10s, then 4 more at 5s intervals
      await vi.advanceTimersByTimeAsync(10_000); // Error 1
      await vi.advanceTimersByTimeAsync(5_000);  // Error 2
      await vi.advanceTimersByTimeAsync(5_000);  // Error 3
      await vi.advanceTimersByTimeAsync(5_000);  // Error 4
      await vi.advanceTimersByTimeAsync(5_000);  // Error 5 — circuit breaks

      expect(deps.healthCheckServer.updateStatus).toHaveBeenCalledWith('unhealthy');

      await service.stop();
    });

    it('should not trigger circuit breaker when exceptions are spaced more than 60 seconds apart', async () => {
      const deps = createDeps();

      // Use a flag to control when errors happen
      let shouldThrow = false;
      (deps.sheetPoller.fetchUnprocessedRows as ReturnType<typeof vi.fn>).mockImplementation(() => {
        if (shouldThrow) {
          shouldThrow = false; // only throw once per trigger
          return Promise.reject(new Error('Sheets API failure'));
        }
        return Promise.resolve([]);
      });
      // recordError always throws — this propagates the error to the outer catch
      // when fetchUnprocessedRows rejects (inner catch calls recordError which throws)
      (deps.healthCheckServer.recordError as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('recordError failed');
      });
      // resetErrors must NOT throw for successful cycles
      (deps.healthCheckServer.resetErrors as ReturnType<typeof vi.fn>).mockImplementation(() => {});

      const service = new AutomationService(deps);
      await service.start();

      // Error 1: trigger at first poll (t=10s)
      shouldThrow = true;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(deps.logger.error).toHaveBeenCalledWith(
        'Unhandled exception in polling loop',
        expect.anything()
      );
      expect(deps.logger.critical).not.toHaveBeenCalled();

      // After error, retry fires in 5s (shouldThrow is false, so it succeeds).
      // Then normal 10s interval continues.
      // Advance enough time so error 1 timestamp falls outside the 60s window.
      await vi.advanceTimersByTimeAsync(65_000);

      // Error 2: trigger another error (>60s after error 1)
      shouldThrow = true;
      await vi.advanceTimersByTimeAsync(10_000);

      // Should NOT have triggered circuit breaker since >60s between errors
      // The sliding window prunes error 1 (it's older than 60s), leaving only 1 error
      expect(deps.logger.critical).not.toHaveBeenCalled();
      expect(deps.healthCheckServer.updateStatus).not.toHaveBeenCalledWith('unhealthy');

      await service.stop();
    });
  });
});
