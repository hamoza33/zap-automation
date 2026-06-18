// Feature: sheet-to-tiktok-automation, Property 3: Video URL validation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RowValidator } from './row-validator.js';
import { SheetRow } from '../types.js';

/**
 * Property 3: Video URL validation
 *
 * For any string value, the Row Validator SHALL accept it as a valid Video_URL if and only if
 * it is non-empty AND begins with "http://" or "https://" followed by a valid domain name
 * (containing at least one dot, no spaces). All other strings SHALL be rejected.
 *
 * **Validates: Requirements 2.2**
 */
describe('Property 3: Video URL validation', () => {
  const validator = new RowValidator();

  // Helper: create a SheetRow with a valid captionText and the given videoUrl
  function makeRow(videoUrl: string): SheetRow {
    return {
      rowNumber: 1,
      captionText: 'Valid caption text',
      videoUrl,
      processedMarker: null,
    };
  }

  // Helper: determine if a videoUrl should be valid according to the rules
  function isValidVideoUrl(url: string): boolean {
    if (!url || url.trim().length === 0) return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    const protocolEnd = url.startsWith('https://') ? 8 : 7;
    const domainAndPath = url.slice(protocolEnd);
    const domain = domainAndPath.split('/')[0];

    if (domain.includes(' ')) return false;
    if (!domain.includes('.')) return false;

    return true;
  }

  // Generator: domain segment (alphanumeric, 1-20 chars)
  const domainSegmentArb = fc.stringMatching(/^[a-z0-9]{1,20}$/);

  // Generator: valid domain with at least one dot and no spaces
  const validDomainArb = fc.tuple(domainSegmentArb, domainSegmentArb).map(
    ([label, tld]) => `${label}.${tld}`,
  );

  // Generator: optional path segment
  const pathArb = fc.option(
    fc.stringMatching(/^[a-z0-9_\-]{1,50}$/),
    { nil: undefined },
  );

  // Generator: valid URL (http:// or https:// + valid domain + optional path)
  const validUrlArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    validDomainArb,
    pathArb,
  ).map(([protocol, domain, path]) =>
    path ? `${protocol}${domain}/${path}` : `${protocol}${domain}`,
  );

  // Generator: empty string or whitespace
  const emptyStringArb = fc.constantFrom('', '   ', '\t', '\n');

  // Generator: string without http/https prefix
  const noProtocolArb = fc.tuple(
    fc.constantFrom('ftp://', 'mailto:', 'htp://', 'htps://', ''),
    validDomainArb,
  ).map(([prefix, domain]) => `${prefix}${domain}`);

  // Generator: URL where domain has no dot (just a single segment after protocol)
  const noDotDomainArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    domainSegmentArb,
  ).map(([protocol, domain]) => `${protocol}${domain}`);

  // Generator: URL with spaces in domain
  const spacesInDomainArb = fc.tuple(
    fc.constantFrom('http://', 'https://'),
    domainSegmentArb,
    domainSegmentArb,
  ).map(([protocol, part1, part2]) => `${protocol}${part1} ${part2}.com`);

  // Generator: mix of valid and invalid URLs
  const mixedUrlArb = fc.oneof(
    validUrlArb,
    emptyStringArb,
    noProtocolArb,
    noDotDomainArb,
    spacesInDomainArb,
    fc.string(), // fully random strings
  );

  it('accepts valid URLs and rejects invalid URLs based on the validation rule', () => {
    fc.assert(
      fc.property(mixedUrlArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const expected = isValidVideoUrl(videoUrl);
        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');

        // If the URL should be valid, there should be no videoUrl errors
        // If the URL should be invalid, there should be at least one videoUrl error
        expect(hasVideoUrlError).toBe(!expected);
      }),
      { numRuns: 100 },
    );
  });

  it('always accepts URLs starting with http:// or https:// with a dotted domain and no spaces', () => {
    fc.assert(
      fc.property(validUrlArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');
        expect(hasVideoUrlError).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects empty or whitespace-only strings', () => {
    fc.assert(
      fc.property(emptyStringArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');
        expect(hasVideoUrlError).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects URLs without http:// or https:// protocol', () => {
    fc.assert(
      fc.property(noProtocolArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');
        expect(hasVideoUrlError).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects URLs where domain has no dot', () => {
    fc.assert(
      fc.property(noDotDomainArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');
        expect(hasVideoUrlError).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('always rejects URLs with spaces in the domain', () => {
    fc.assert(
      fc.property(spacesInDomainArb, (videoUrl) => {
        const row = makeRow(videoUrl);
        const result = validator.validate(row);

        const hasVideoUrlError = result.errors.some((e) => e.field === 'videoUrl');
        expect(hasVideoUrlError).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
