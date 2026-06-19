import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig, ISheetPoller, SheetRow } from '../types.js';

/**
 * File path for tracking processed rows locally (avoids needing a Status column in the sheet).
 */
const PROCESSED_ROWS_FILE = resolve(process.cwd(), 'processed-rows.json');

/**
 * Load processed row numbers from disk.
 */
function loadProcessedRows(): Set<number> {
  try {
    if (existsSync(PROCESSED_ROWS_FILE)) {
      const data = JSON.parse(readFileSync(PROCESSED_ROWS_FILE, 'utf-8'));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch {
    // Start fresh if corrupt
  }
  return new Set();
}

/**
 * Save processed row numbers to disk.
 */
function saveProcessedRows(rows: Set<number>): void {
  try {
    writeFileSync(PROCESSED_ROWS_FILE, JSON.stringify([...rows]), 'utf-8');
  } catch {
    // Non-fatal
  }
}

/** In-memory set of processed rows */
let processedRowNumbers = loadProcessedRows();

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

    // Column mapping for user's sheet:
    // A = Video URL, B = Title, C = Caption, D = Tags
    // We track processed rows locally (no Status column needed in sheet).
    for (const row of rows) {
      // Skip rows we've already processed
      if (processedRowNumbers.has(row.rowNumber)) {
        continue;
      }

      // Try to read by various possible header names, fall back to raw cell index
      const rawData = (row as any)._rawData || [];
      const videoUrl = row.get('Videos') ?? row.get('Video') ?? row.get('Video URL') ?? row.get('video') ?? rawData[0] ?? '';
      const title = row.get('Titles') ?? row.get('Title') ?? row.get('title') ?? rawData[1] ?? '';
      const caption = row.get('Caption') ?? row.get('caption') ?? row.get('Captions') ?? rawData[2] ?? '';
      const tags = row.get('Tags') ?? row.get('tags') ?? row.get('Hashtags') ?? rawData[3] ?? '';

      // Combine title + caption + tags as the full caption text for Buffer
      const parts = [title, caption, tags].filter(p => p && p.trim() !== '');
      const captionText = parts.join('\n');

      // Only include rows with a video URL present
      if (videoUrl && videoUrl.trim() !== '') {
        unprocessedRows.push({
          rowNumber: row.rowNumber,
          captionText,
          videoUrl: videoUrl.trim(),
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
   * Marks a row as "processing" locally. No longer writes to the sheet.
   */
  async markRowProcessing(rowNumber: number): Promise<void> {
    // Just a no-op marker — we track completion in markRowProcessed
  }

  /**
   * Marks a row as processed locally by adding its row number to the tracked set.
   */
  async markRowProcessed(
    rowNumber: number,
    status: 'success' | 'error' | 'failed',
    _detail?: string
  ): Promise<void> {
    processedRowNumbers.add(rowNumber);
    saveProcessedRows(processedRowNumbers);
  }

}
