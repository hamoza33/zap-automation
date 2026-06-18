import { ILogger, LogLevel } from '../types.js';

/**
 * Structured log entry output format.
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Structured JSON logger that outputs log entries to stdout.
 * Each entry includes an ISO 8601 timestamp, severity level, message,
 * and optional context metadata.
 */
export class Logger implements ILogger {
  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context !== undefined) {
      entry.context = context;
    }

    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('ERROR', message, context);
  }

  critical(message: string, context?: Record<string, unknown>): void {
    this.write('CRITICAL', message, context);
  }
}
