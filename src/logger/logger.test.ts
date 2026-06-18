import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './logger.js';

describe('Logger', () => {
  let logger: Logger;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function getLastLogEntry(): Record<string, unknown> {
    const call = stdoutSpy.mock.calls[0][0] as string;
    return JSON.parse(call.trim());
  }

  it('outputs INFO level log entry with valid ISO 8601 timestamp', () => {
    logger.info('test message');

    const entry = getLastLogEntry();
    expect(entry.level).toBe('INFO');
    expect(entry.message).toBe('test message');
    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp as string).toISOString()).toBe(entry.timestamp);
  });

  it('outputs WARN level log entry', () => {
    logger.warn('warning message');

    const entry = getLastLogEntry();
    expect(entry.level).toBe('WARN');
    expect(entry.message).toBe('warning message');
  });

  it('outputs ERROR level log entry', () => {
    logger.error('error message');

    const entry = getLastLogEntry();
    expect(entry.level).toBe('ERROR');
    expect(entry.message).toBe('error message');
  });

  it('outputs CRITICAL level log entry', () => {
    logger.critical('critical message');

    const entry = getLastLogEntry();
    expect(entry.level).toBe('CRITICAL');
    expect(entry.message).toBe('critical message');
  });

  it('includes context metadata when provided', () => {
    logger.info('processing row', { rowNumber: 5, attempt: 2 });

    const entry = getLastLogEntry();
    expect(entry.context).toEqual({ rowNumber: 5, attempt: 2 });
  });

  it('omits context field when not provided', () => {
    logger.info('no context');

    const entry = getLastLogEntry();
    expect(entry).not.toHaveProperty('context');
  });

  it('outputs valid JSON terminated with newline', () => {
    logger.info('test');

    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(output.trim())).not.toThrow();
  });

  it('handles complex context objects', () => {
    const context = {
      rowNumber: 10,
      error: 'Connection timeout',
      attempts: 3,
      details: { statusCode: 503, retryAfter: 5 },
    };
    logger.error('Buffer API failed', context);

    const entry = getLastLogEntry();
    expect(entry.context).toEqual(context);
  });
});
