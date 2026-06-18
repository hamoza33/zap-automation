import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { readFileSync } from 'node:fs';
import type { AppConfig, ISheetPoller, SheetRow } from '../types.js';

/**
 * Filters an array of SheetRow objects to include only those with an empty or null
 * processedMarker, and returns them sorted in ascending rowNumber order.
 *
 * This is the pure filtering/ordering logic used by SheetPoller.fetchUnprocessedRows(),
 * extracted as a testable utility function.
 */
export function filterUnprocessedRows(rows: SheetRow[]): SheetRow[] {
  return rows
    .filter((row) => !row.processedMarker || row.processedMarker.trim() === '')
    .sort((a, b) => a.rowNumber - b.rowNumber);
}

/**
 * SheetPoller handles authentication and interaction with the Google Sheets API.
 * It reads rows from the configured worksheet and filters for unprocessed entries.
 */
export class SheetPoller implements ISheetPoller {
  private config: AppConfig;
  private doc: GoogleSpreadsheet | null = null;
  private jwt: JWT | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Authenticates with Google Sheets API using service account credentials.
   * Must be called before any other sheet operations.
   */
  async authenticate(): Promise<void> {
    const credentialsJson = readFileSync(this.config.googleCredentialsPath, 'utf-8');
    const credentials = JSON.parse(credentialsJson);

    this.jwt = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.doc = new GoogleSpreadsheet(this.config.googleSheetId, this.jwt);
    await this.doc.loadInfo();
  }

  /**
   * Fetches all rows from the configured worksheet and returns only those
   * with an empty Processed_Marker column (Column C), in ascending row number order.
   */
  async fetchUnprocessedRows(): Promise<SheetRow[]> {
    if (!this.doc) {
      throw new Error('SheetPoller not authenticated. Call authenticate() first.');
    }

    const sheet = this.doc.sheetsByTitle[this.config.worksheetName];
    if (!sheet) {
      throw new Error(`Worksheet "${this.config.worksheetName}" not found in spreadsheet.`);
    }

    const rows = await sheet.getRows();

    const unprocessedRows: SheetRow[] = [];

    for (const row of rows) {
      const captionText = row.get('Caption Text') ?? '';
      const videoUrl = row.get('Video URL') ?? '';
      const status = row.get('Status') ?? '';

      // Only include rows with an empty Processed_Marker (Column C)
      if (!status || status.trim() === '') {
        unprocessedRows.push({
          rowNumber: row.rowNumber,
          captionText,
          videoUrl,
          processedMarker: null,
        });
      }
    }

    // Return in ascending row number order (rows from getRows() are already ordered,
    // but we sort explicitly to guarantee the contract)
    unprocessedRows.sort((a, b) => a.rowNumber - b.rowNumber);

    return unprocessedRows;
  }

  /**
   * Writes "processing" to Column C for the given row as an optimistic lock
   * before handing off to Buffer. This prevents duplicate processing if another
   * instance picks up the same row.
   *
   * Retries up to 3 times on failure. Throws if all retries are exhausted.
   */
  async markRowProcessing(rowNumber: number): Promise<void> {
    await this.writeStatusToRow(rowNumber, 'processing');
  }

  /**
   * Marks a row as processed by writing a status value to Column C (Status).
   * Format: "success", "error:<detail>", or "failed:<detail>"
   *
   * Retries up to 3 times on failure. Throws if all retries are exhausted
   * (caller is responsible for logging row as requiring manual review).
   */
  async markRowProcessed(
    rowNumber: number,
    status: 'success' | 'error' | 'failed',
    detail?: string
  ): Promise<void> {
    if (!this.doc) {
      throw new Error('SheetPoller not authenticated. Call authenticate() first.');
    }

    const sheet = this.doc.sheetsByTitle[this.config.worksheetName];
    if (!sheet) {
      throw new Error(`Worksheet "${this.config.worksheetName}" not found in spreadsheet.`);
    }

    let statusValue: string;
    if (status === 'success') {
      statusValue = 'success';
    } else if (status === 'error') {
      statusValue = detail ? `error:${detail}` : 'error:unknown';
    } else {
      statusValue = detail ? `failed:${detail}` : 'failed:unknown';
    }

    await this.writeStatusToRow(rowNumber, statusValue);
  }

  /**
   * Internal helper that writes a value to the Status column for a given row number.
   * Implements retry logic: up to 3 attempts before throwing.
   */
  private async writeStatusToRow(rowNumber: number, value: string): Promise<void> {
    if (!this.doc) {
      throw new Error('SheetPoller not authenticated. Call authenticate() first.');
    }

    const sheet = this.doc.sheetsByTitle[this.config.worksheetName];
    if (!sheet) {
      throw new Error(`Worksheet "${this.config.worksheetName}" not found in spreadsheet.`);
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const rows = await sheet.getRows();
        const targetRow = rows.find(row => row.rowNumber === rowNumber);

        if (!targetRow) {
          throw new Error(`Row ${rowNumber} not found in worksheet "${this.config.worksheetName}".`);
        }

        targetRow.set('Status', value);
        await targetRow.save();
        return; // Success — exit retry loop
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // If it's a "row not found" error, don't retry — it won't resolve itself
        if (lastError.message.includes('not found in worksheet')) {
          throw lastError;
        }

        // If we haven't exhausted retries, wait briefly before retrying
        if (attempt < maxRetries) {
          await this.delay(1000);
        }
      }
    }

    // All retries exhausted
    throw new Error(
      `Failed to write status "${value}" to row ${rowNumber} after ${maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Utility delay function for retry backoff.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
