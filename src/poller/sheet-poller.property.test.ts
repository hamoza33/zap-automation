// Feature: sheet-to-tiktok-automation, Property 1: Unprocessed row filtering and ordering

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterUnprocessedRows } from './sheet-poller.js';
import type { SheetRow } from '../types.js';

/**
 * **Validates: Requirements 1.4, 6.1, 6.2, 6.3, 6.5**
 *
 * Property 1: Unprocessed row filtering and ordering
 * For any Google Sheet state containing rows with various Processed_Marker values
 * (empty, "success", "error:...", "failed:..."), the Sheet_Poller SHALL return only
 * rows where the Processed_Marker column is empty, and those rows SHALL be returned
 * in ascending row number order.
 */
describe('Property 1: Unprocessed row filtering and ordering', () => {
  /**
   * Generator for a random processedMarker value.
   * Produces one of: null, empty string, "success", "error:<reason>", "failed:<reason>"
   */
  const markerArb = fc.oneof(
    fc.constant(null),
    fc.constant(''),
    fc.constant('success'),
    fc.string({ minLength: 1, maxLength: 50 }).map((reason) => `error:${reason}`),
    fc.string({ minLength: 1, maxLength: 50 }).map((reason) => `failed:${reason}`),
  );

  /**
   * Generator for a single SheetRow with a specific rowNumber and random marker.
   */
  function sheetRowArb(rowNumber: number): fc.Arbitrary<SheetRow> {
    return fc.record({
      rowNumber: fc.constant(rowNumber),
      captionText: fc.string({ minLength: 1, maxLength: 200 }),
      videoUrl: fc.constant('https://example.com/video.mp4'),
      processedMarker: markerArb,
    });
  }

  /**
   * Generator for a random sheet state with 10-100 rows.
   * Row numbers are sequential starting at 2 (to simulate a header row at 1),
   * but the array is shuffled to test ordering.
   */
  const sheetStateArb = fc
    .integer({ min: 10, max: 100 })
    .chain((numRows) => {
      const rowArbs = Array.from({ length: numRows }, (_, i) => sheetRowArb(i + 2));
      return fc.tuple(...rowArbs).map((rows) => rows as SheetRow[]);
    })
    .chain((rows) => fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }));

  /** Reference oracle: determines if a row is unprocessed */
  function isUnprocessed(row: SheetRow): boolean {
    return row.processedMarker === null || row.processedMarker.trim() === '';
  }

  it('should return only rows with null or empty processedMarker', () => {
    fc.assert(
      fc.property(sheetStateArb, (rows) => {
        const result = filterUnprocessedRows(rows);

        // Every row in the result must have an empty/null processedMarker
        for (const row of result) {
          expect(isUnprocessed(row)).toBe(true);
        }

        // No rows with non-empty markers should appear in the result
        const resultRowNumbers = new Set(result.map((r) => r.rowNumber));
        for (const row of rows) {
          if (!isUnprocessed(row)) {
            expect(resultRowNumbers.has(row.rowNumber)).toBe(false);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should include ALL unprocessed rows (no unprocessed rows are dropped)', () => {
    fc.assert(
      fc.property(sheetStateArb, (rows) => {
        const result = filterUnprocessedRows(rows);
        const expectedCount = rows.filter(isUnprocessed).length;

        expect(result.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });

  it('should return rows in ascending rowNumber order', () => {
    fc.assert(
      fc.property(sheetStateArb, (rows) => {
        const result = filterUnprocessedRows(rows);

        for (let i = 1; i < result.length; i++) {
          expect(result[i].rowNumber).toBeGreaterThan(result[i - 1].rowNumber);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should return an empty array when all rows have non-empty markers', () => {
    const allProcessedArb = fc
      .integer({ min: 10, max: 50 })
      .chain((numRows) => {
        const nonEmptyMarker = fc.oneof(
          fc.constant('success'),
          fc.string({ minLength: 1, maxLength: 50 }).map((r) => `error:${r}`),
          fc.string({ minLength: 1, maxLength: 50 }).map((r) => `failed:${r}`),
        );
        const rowArbs = Array.from({ length: numRows }, (_, i) =>
          fc.record({
            rowNumber: fc.constant(i + 2),
            captionText: fc.string({ minLength: 1, maxLength: 100 }),
            videoUrl: fc.constant('https://example.com/video.mp4'),
            processedMarker: nonEmptyMarker,
          }),
        );
        return fc.tuple(...rowArbs).map((rows) => rows as SheetRow[]);
      });

    fc.assert(
      fc.property(allProcessedArb, (rows) => {
        const result = filterUnprocessedRows(rows);
        expect(result.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
