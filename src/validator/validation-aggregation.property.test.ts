// Feature: sheet-to-tiktok-automation, Property 4: Validation errors are fully reported

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RowValidator } from './row-validator.js';
import { SheetRow } from '../types.js';

/**
 * **Validates: Requirements 2.3, 2.5**
 *
 * Property 4: Validation errors are fully reported
 * For any row containing one or more invalid fields, the Automation_Service SHALL collect
 * all validation failures and report them in a single result. The validator does not halt
 * on the first error — when both fields are invalid, errors for BOTH fields are returned.
 */
describe('Property 4: Validation errors are fully reported', () => {
  const validator = new RowValidator();

  // ─── Generators ──────────────────────────────────────────────────────────────

  // Valid caption: non-whitespace string ≤ 4000 chars
  const validCaptionArb = fc.string({ minLength: 1, maxLength: 4000 }).filter(
    (s) => /\S/.test(s),
  );

  // Invalid caption generators
  const emptyCaptionArb = fc.constant('');
  const whitespaceOnlyCaptionArb = fc.array(
    fc.constantFrom(' ', '\t', '\n', '\r'),
    { minLength: 1, maxLength: 50 },
  ).map((chars) => chars.join(''));
  const overLengthCaptionArb = fc.string({ minLength: 4001, maxLength: 5000 }).filter(
    (s) => /\S/.test(s),
  );
  const invalidCaptionArb = fc.oneof(
    emptyCaptionArb,
    whitespaceOnlyCaptionArb,
    overLengthCaptionArb,
  );

  // Domain segment for URL generation
  const domainSegmentArb = fc.stringMatching(/^[a-z0-9]{1,20}$/);

  // Valid URL: http/https + domain.tld + optional path
  const validUrlArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    domainSegmentArb,
    domainSegmentArb,
    fc.option(fc.stringMatching(/^[a-z0-9_\-]{1,30}$/), { nil: undefined }),
  ).map(([protocol, label, tld, path]) =>
    path ? `${protocol}${label}.${tld}/${path}` : `${protocol}${label}.${tld}`,
  );

  // Invalid URL generators
  const emptyUrlArb = fc.constantFrom('', '   ', '\t');
  const noProtocolUrlArb = fc.tuple(
    fc.constantFrom('ftp://', 'mailto:', ''),
    domainSegmentArb,
    domainSegmentArb,
  ).map(([prefix, label, tld]) => `${prefix}${label}.${tld}`);
  const noDotUrlArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    domainSegmentArb,
  ).map(([protocol, domain]) => `${protocol}${domain}`);
  const spacesInUrlArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    domainSegmentArb,
    domainSegmentArb,
  ).map(([protocol, part1, part2]) => `${protocol}${part1} ${part2}.com`);
  const invalidUrlArb = fc.oneof(
    emptyUrlArb,
    noProtocolUrlArb,
    noDotUrlArb,
    spacesInUrlArb,
  );

  // ─── Helper ──────────────────────────────────────────────────────────────────

  function makeRow(captionText: string, videoUrl: string): SheetRow {
    return {
      rowNumber: 1,
      captionText,
      videoUrl,
      processedMarker: null,
    };
  }

  // ─── Tests ───────────────────────────────────────────────────────────────────

  it('returns no errors when both fields are valid (0 invalid fields)', () => {
    fc.assert(
      fc.property(validCaptionArb, validUrlArb, (captionText, videoUrl) => {
        const row = makeRow(captionText, videoUrl);
        const result = validator.validate(row);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('returns only captionText errors when only captionText is invalid (1 invalid field)', () => {
    fc.assert(
      fc.property(invalidCaptionArb, validUrlArb, (captionText, videoUrl) => {
        const row = makeRow(captionText, videoUrl);
        const result = validator.validate(row);

        expect(result.valid).toBe(false);

        // Should have captionText errors
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');
        expect(captionErrors.length).toBeGreaterThan(0);

        // Should NOT have videoUrl errors
        const videoErrors = result.errors.filter((e) => e.field === 'videoUrl');
        expect(videoErrors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('returns only videoUrl errors when only videoUrl is invalid (1 invalid field)', () => {
    fc.assert(
      fc.property(validCaptionArb, invalidUrlArb, (captionText, videoUrl) => {
        const row = makeRow(captionText, videoUrl);
        const result = validator.validate(row);

        expect(result.valid).toBe(false);

        // Should have videoUrl errors
        const videoErrors = result.errors.filter((e) => e.field === 'videoUrl');
        expect(videoErrors.length).toBeGreaterThan(0);

        // Should NOT have captionText errors
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');
        expect(captionErrors).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it('returns errors for BOTH fields when both are invalid (2 invalid fields - proves no short-circuiting)', () => {
    fc.assert(
      fc.property(invalidCaptionArb, invalidUrlArb, (captionText, videoUrl) => {
        const row = makeRow(captionText, videoUrl);
        const result = validator.validate(row);

        expect(result.valid).toBe(false);

        // Must contain captionText error(s)
        const captionErrors = result.errors.filter((e) => e.field === 'captionText');
        expect(captionErrors.length).toBeGreaterThan(0);

        // Must also contain videoUrl error(s) — proves validator did not short-circuit
        const videoErrors = result.errors.filter((e) => e.field === 'videoUrl');
        expect(videoErrors.length).toBeGreaterThan(0);

        // All errors are collected in a single result object
        expect(result.errors.length).toBe(captionErrors.length + videoErrors.length);
      }),
      { numRuns: 100 },
    );
  });

  it('collects all errors in a single ValidationResult regardless of invalid field count', () => {
    // Generate rows with 0, 1, or 2 invalid fields randomly
    const captionArb = fc.oneof(validCaptionArb, invalidCaptionArb);
    const urlArb = fc.oneof(validUrlArb, invalidUrlArb);

    fc.assert(
      fc.property(captionArb, urlArb, (captionText, videoUrl) => {
        const row = makeRow(captionText, videoUrl);
        const result = validator.validate(row);

        // The result is always a single object with valid flag and errors array
        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('errors');
        expect(Array.isArray(result.errors)).toBe(true);

        // valid flag is consistent with the errors array
        expect(result.valid).toBe(result.errors.length === 0);

        // Every error has a valid field name and a non-empty message
        for (const error of result.errors) {
          expect(['captionText', 'videoUrl']).toContain(error.field);
          expect(error.message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
