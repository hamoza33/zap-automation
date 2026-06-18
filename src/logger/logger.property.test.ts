// Feature: sheet-to-tiktok-automation, Property 7: Log format invariant
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Logger } from './logger.js';

/**
 * Property 7: Log format invariant
 *
 * For any log event emitted by the Automation_Service, the log entry SHALL contain
 * a valid ISO 8601 timestamp and a severity level that is one of INFO, WARN, ERROR, or CRITICAL.
 *
 * **Validates: Requirements 5.2**
 */
describe('Property 7: Log format invariant', () => {
  const VALID_LEVELS = ['INFO', 'WARN', 'ERROR', 'CRITICAL'] as const;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logger: Logger;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger = new Logger();
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  const levelArb = fc.constantFrom(...VALID_LEVELS);
  const contextArb = fc.option(fc.dictionary(fc.string(), fc.jsonValue()), { nil: undefined });

  it('every log output is valid JSON with ISO 8601 timestamp and valid severity level', () => {
    fc.assert(
      fc.property(
        levelArb,
        fc.string(),
        contextArb,
        (level, message, context) => {
          writeSpy.mockClear();

          // Call the appropriate logger method based on generated level
          switch (level) {
            case 'INFO':
              logger.info(message, context);
              break;
            case 'WARN':
              logger.warn(message, context);
              break;
            case 'ERROR':
              logger.error(message, context);
              break;
            case 'CRITICAL':
              logger.critical(message, context);
              break;
          }

          // Verify stdout.write was called
          expect(writeSpy).toHaveBeenCalledOnce();

          const output = writeSpy.mock.calls[0][0] as string;

          // 1. Output is valid JSON (strip trailing newline)
          const stripped = output.trimEnd();
          let parsed: unknown;
          expect(() => {
            parsed = JSON.parse(stripped);
          }).not.toThrow();

          const entry = parsed as Record<string, unknown>;

          // 2. Contains a valid ISO 8601 timestamp
          expect(entry).toHaveProperty('timestamp');
          expect(typeof entry.timestamp).toBe('string');
          const ts = entry.timestamp as string;
          // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
          const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
          expect(ts).toMatch(isoRegex);
          // Also verify it's a valid date
          const date = new Date(ts);
          expect(date.toISOString()).toBe(ts);

          // 3. Contains a level field that is one of the valid severity levels
          expect(entry).toHaveProperty('level');
          expect(VALID_LEVELS).toContain(entry.level);

          // 4. Contains a message field matching the input
          expect(entry).toHaveProperty('message');
          expect(entry.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });
});
