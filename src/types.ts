/**
 * Core type definitions and interfaces for the Sheet-to-TikTok Automation Service.
 */

// ─── Data Models ────────────────────────────────────────────────────────────────

/**
 * Application configuration loaded from environment variables or config file.
 */
export interface AppConfig {
  googleSheetId: string;
  worksheetName: string;
  googleCredentialsPath: string;
  bufferAccessToken: string;
  bufferTikTokProfileId: string;
  pollingIntervalSeconds: number; // 10-300, default 60
  healthCheckPort: number;        // default 3000
}

/**
 * Represents a single row extracted from the Google Sheet.
 */
export interface SheetRow {
  rowNumber: number;
  captionText: string;
  videoUrl: string;
  processedMarker: string | null;
}

/**
 * Describes a validation failure for a specific field in a row.
 */
export interface ValidationError {
  field: 'captionText' | 'videoUrl';
  message: string;
}

/**
 * Result of validating a SheetRow.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Result of attempting to publish a post via Buffer.
 */
export interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  attempts: number;
  tiktokVideoLink?: string;
  bufferUsername?: string;
}

/**
 * Current health status of the automation service.
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastSuccessfulPoll: string | null; // ISO 8601
  uptime: number;
  consecutiveErrors: number;
}

/**
 * Log severity levels.
 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

// ─── Component Interfaces ───────────────────────────────────────────────────────

/**
 * Loads and validates application configuration from environment variables
 * and/or a config file.
 */
export interface IConfigLoader {
  load(): AppConfig; // throws ConfigError if invalid/missing
}

/**
 * Handles authentication and interaction with the Google Sheets API.
 */
export interface ISheetPoller {
  authenticate(): Promise<void>;
  fetchUnprocessedRows(): Promise<SheetRow[]>;
  fetchAllRowNumbers(): Promise<number[]>;
  markRowProcessing(rowNumber: number): Promise<void>;
  markRowProcessed(rowNumber: number, status: 'success' | 'error' | 'failed', detail?: string): Promise<void>;
}

/**
 * Validates extracted row data before publishing.
 */
export interface IRowValidator {
  validate(row: SheetRow): ValidationResult;
}

/**
 * Communicates with Buffer's GraphQL API to schedule TikTok posts.
 */
export interface IBufferPublisher {
  schedulePost(captionText: string, videoUrl: string): Promise<PublishResult>;
}

/**
 * Exposes an HTTP health check endpoint for monitoring.
 */
export interface IHealthCheckServer {
  start(port: number): void;
  updateLastPoll(timestamp: Date): void;
  updateStatus(status: 'healthy' | 'degraded' | 'unhealthy'): void;
}

/**
 * Structured logger with severity levels.
 */
export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  critical(message: string, context?: Record<string, unknown>): void;
}
