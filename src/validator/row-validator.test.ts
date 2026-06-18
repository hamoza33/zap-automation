import { describe, it, expect } from 'vitest';
import { RowValidator } from './row-validator.js';
import { SheetRow } from '../types.js';

function makeRow(overrides: Partial<SheetRow> = {}): SheetRow {
  return {
    rowNumber: 1,
    captionText: 'Valid caption',
    videoUrl: 'https://example.com/video.mp4',
    processedMarker: null,
    ...overrides,
  };
}

describe('RowValidator', () => {
  const validator = new RowValidator();

  describe('valid rows', () => {
    it('accepts a row with valid caption and URL', () => {
      const result = validator.validate(makeRow());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a caption with exactly 4000 characters', () => {
      const result = validator.validate(makeRow({ captionText: 'a'.repeat(4000) }));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts http:// URLs', () => {
      const result = validator.validate(makeRow({ videoUrl: 'http://example.com/video.mp4' }));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('captionText validation', () => {
    it('rejects empty caption', () => {
      const result = validator.validate(makeRow({ captionText: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'captionText' })
      );
    });

    it('rejects whitespace-only caption', () => {
      const result = validator.validate(makeRow({ captionText: '   \t\n  ' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'captionText' })
      );
    });

    it('rejects caption exceeding 4000 characters', () => {
      const result = validator.validate(makeRow({ captionText: 'a'.repeat(4001) }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'captionText', message: expect.stringContaining('4000') })
      );
    });
  });

  describe('videoUrl validation', () => {
    it('rejects empty video URL', () => {
      const result = validator.validate(makeRow({ videoUrl: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'videoUrl' })
      );
    });

    it('rejects URL without http/https protocol', () => {
      const result = validator.validate(makeRow({ videoUrl: 'ftp://example.com/video.mp4' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'videoUrl', message: expect.stringContaining('http') })
      );
    });

    it('rejects URL with no dot in domain', () => {
      const result = validator.validate(makeRow({ videoUrl: 'https://localhost/video.mp4' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'videoUrl', message: expect.stringContaining('dot') })
      );
    });

    it('rejects URL with spaces in domain', () => {
      const result = validator.validate(makeRow({ videoUrl: 'https://exam ple.com/video.mp4' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: 'videoUrl', message: expect.stringContaining('spaces') })
      );
    });
  });

  describe('error aggregation', () => {
    it('reports both captionText and videoUrl errors in a single result', () => {
      const result = validator.validate(makeRow({
        captionText: '',
        videoUrl: 'not-a-url',
      }));
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);

      const fields = result.errors.map(e => e.field);
      expect(fields).toContain('captionText');
      expect(fields).toContain('videoUrl');
    });

    it('does not short-circuit on first error', () => {
      // Caption: whitespace-only AND too long (over 4000 whitespace chars)
      const result = validator.validate(makeRow({
        captionText: ' '.repeat(4001),
        videoUrl: 'https://example.com/video.mp4',
      }));
      expect(result.valid).toBe(false);
      // Should have both: no non-whitespace AND exceeds 4000
      const captionErrors = result.errors.filter(e => e.field === 'captionText');
      expect(captionErrors.length).toBe(2);
    });
  });
});
