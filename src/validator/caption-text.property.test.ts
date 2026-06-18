// Feature: sheet-to-tiktok-automation, Property 2: Caption text validation

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RowValidator } from './row-validator.js';
import { SheetRow } from '../types.js';

/**
 * **Validates: Requirements 2.1**
 *
 * Property 2: Caption text validation
 * For any string value, the Row Validator SHALL accept it as a valid Caption_Text
 * if and only if it contains at least one non-whitespace character AND its length
 * does not exceed 4000 characters. All-whitespace strings and strings exceeding
 * 4000 characters SHALL be rejected.
 */
describe('Property 2: Caption text validation', () => {
  const validator = new RowValidator();

  /** Helper to create a SheetRow with a valid videoUrl and a given captionText */
  function makeRow(captionText: string): SheetRow {
    return {
      rowNumber: 1,
      captionText,
      videoUrl: 'https://example.com/video.mp4',
      processedMarker: null,
    };
  }

  /** Reference oracle: determines if a captionText should be valid */
  function isValidCaption(text: string): boolean {
    return /\S/.test(text) && text.length <= 4000;
  }

  it('should accept strings with at least one non-whitespace char and length ≤ 4000, and reject all others', () => {
    fc.assert(
      fc.property(fc.string(), (captionText) => {
        const row = makeRow(captionText);
        const result = validator.validate(row);

        const expectedValid = isValidCaption(captionText);

        // Check that captionText-related errors are present/absent as expected
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');
        const hasCaptionError = captionErrors.length > 0;

        expect(hasCaptionError).toBe(!expectedValid);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject empty strings', () => {
    fc.assert(
      fc.property(fc.constant(''), (captionText) => {
        const row = makeRow(captionText);
        const result = validator.validate(row);
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');

        expect(captionErrors.length).toBeGreaterThan(0);
        expect(captionErrors.some((e) => e.message.includes('non-whitespace'))).toBe(true);
      }),
      { numRuns: 1 },
    );
  });

  it('should reject all-whitespace strings (spaces, tabs, newlines)', () => {
    const whitespaceChar = fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v');
    const whitespaceStrings = fc.array(whitespaceChar, { minLength: 1, maxLength: 100 }).map(
      (chars) => chars.join(''),
    );

    fc.assert(
      fc.property(whitespaceStrings, (captionText) => {
        const row = makeRow(captionText);
        const result = validator.validate(row);
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');

        expect(captionErrors.length).toBeGreaterThan(0);
        expect(captionErrors.some((e) => e.message.includes('non-whitespace'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept valid short strings with at least one non-whitespace character', () => {
    const validShortStrings = fc.string({ minLength: 1, maxLength: 4000 }).filter(
      (s) => /\S/.test(s),
    );

    fc.assert(
      fc.property(validShortStrings, (captionText) => {
        const row = makeRow(captionText);
        const result = validator.validate(row);
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');

        expect(captionErrors.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should accept strings of exactly 4000 characters with non-whitespace content', () => {
    const exactly4000 = fc.string({ minLength: 4000, maxLength: 4000 }).filter(
      (s) => /\S/.test(s),
    );

    fc.assert(
      fc.property(exactly4000, (captionText) => {
        expect(captionText.length).toBe(4000);
        const row = makeRow(captionText);
        const result = validator.validate(row);
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');

        expect(captionErrors.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should reject strings exceeding 4000 characters even with valid content', () => {
    const over4000 = fc.string({ minLength: 4001, maxLength: 5000 }).filter(
      (s) => /\S/.test(s),
    );

    fc.assert(
      fc.property(over4000, (captionText) => {
        expect(captionText.length).toBeGreaterThan(4000);
        const row = makeRow(captionText);
        const result = validator.validate(row);
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');

        expect(captionErrors.length).toBeGreaterThan(0);
        expect(captionErrors.some((e) => e.message.includes('4000'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
