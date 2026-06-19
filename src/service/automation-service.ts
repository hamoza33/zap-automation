import type {
  AppConfig,
  ISheetPoller,
  IRowValidator,
  IBufferPublisher,
  ILogger,
} from '../types.js';
import type { HealthCheckServer } from '../health/health-check-server.js';
import { addActivity, updateLastPollTime } from '../dashboard/activity-store.js';

/**
 * Dependencies injected into the AutomationService for testability.
 */
export interface AutomationServiceDeps {
  config: AppConfig;
  sheetPoller: ISheetPoller;
  rowValidator: IRowValidator;
  bufferPublisher: IBufferPublisher;
  healthCheckServer: HealthCheckServer;
  logger: ILogger;
}

/**
 * Main orchestrator that wires all components together and runs the polling loop.
 *
 * Uses recursive setTimeout (not setInterval) so each cycle completes before
 * the next one starts.
 */
export class AutomationService {
  private readonly config: AppConfig;
  private readonly sheetPoller: ISheetPoller;
  private readonly rowValidator: IRowValidator;
  private readonly bufferPublisher: IBufferPublisher;
  private readonly healthCheckServer: HealthCheckServer;
  private readonly logger: ILogger;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private signalHandler: (() => Promise<void>) | null = null;

  /** Timestamps of unhandled exceptions for circuit breaker sliding window (60s). */
  private errorTimestamps: number[] = [];
  /** Whether the circuit breaker has tripped (5 errors in 60s). */
  private circuitBroken = false;

  constructor(deps: AutomationServiceDeps) {
    this.config = deps.config;
    this.sheetPoller = deps.sheetPoller;
    this.rowValidator = deps.rowValidator;
    this.bufferPublisher = deps.bufferPublisher;
    this.healthCheckServer = deps.healthCheckServer;
    this.logger = deps.logger;
  }

  /**
   * Starts the automation service:
   * 1. Authenticates with Google Sheets
   * 2. Starts the health check server
   * 3. Begins the polling loop
   */
  async start(): Promise<void> {
    this.logger.info('Starting health check server', { port: this.config.healthCheckPort });
    this.healthCheckServer.start(this.config.healthCheckPort);

    this.logger.info('Authenticating with Google Sheets API');
    await this.sheetPoller.authenticate();

    this.running = true;
    this.setupSignalHandlers();
    this.scheduleNextPoll();

    this.logger.info('Automation service started', {
      pollingInterval: this.config.pollingIntervalSeconds,
    });
  }

  /**
   * Stops the automation service:
   * - Stops the polling loop
   * - Stops the health check server
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.signalHandler) {
      process.removeListener('SIGTERM', this.signalHandler);
      process.removeListener('SIGINT', this.signalHandler);
      this.signalHandler = null;
    }

    this.healthCheckServer.stop();
    this.logger.info('Automation service stopped');
  }

  /**
   * Registers process signal handlers for graceful shutdown.
   */
  private setupSignalHandlers(): void {
    const shutdown = async () => {
      this.logger.info('Received shutdown signal, stopping gracefully...');
      await this.stop();
      process.exit(0);
    };

    this.signalHandler = shutdown;
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  /**
   * Schedules the next poll cycle using recursive setTimeout.
   * Wraps the poll cycle with error recovery and circuit breaker logic.
   */
  private scheduleNextPoll(delayMs?: number): void {
    if (!this.running) return;

    const delay = delayMs ?? this.config.pollingIntervalSeconds * 1000;

    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollCycle();
        this.scheduleNextPoll();
      } catch (error) {
        // Unhandled exception in the polling loop
        this.logger.error('Unhandled exception in polling loop', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Track error timestamp for circuit breaker sliding window
        const now = Date.now();
        this.errorTimestamps.push(now);

        // Prune entries older than 60 seconds
        const windowStart = now - 60_000;
        this.errorTimestamps = this.errorTimestamps.filter(t => t >= windowStart);

        // Check circuit breaker: 5 consecutive errors within 60s
        if (this.errorTimestamps.length >= 5) {
          this.circuitBroken = true;
          this.running = false;
          this.logger.critical('Circuit breaker triggered: 5 consecutive unhandled exceptions within 60 seconds. Ceasing polling.', {
            errorsInWindow: this.errorTimestamps.length,
          });
          this.healthCheckServer.updateStatus('unhealthy');
          return;
        }

        // Wait 5 seconds before restarting the polling loop
        this.scheduleNextPoll(5000);
      }
    }, delay);
  }

  /**
   * Executes a single polling cycle:
   * 1. Fetch unprocessed rows
   * 2. For each row (in order): validate → mark processing → publish → mark final status
   * 3. Update health check timestamp on success
   */
  private async pollCycle(): Promise<void> {
    this.logger.info('Starting poll cycle');

    let processedCount = 0;

    try {
      const rows = await this.sheetPoller.fetchUnprocessedRows();

      for (const row of rows) {
        // Step a: Validate the row
        const validationResult = this.rowValidator.validate(row);

        if (!validationResult.valid) {
          // Step b: Log validation errors and mark row as error
          const errorDetail = validationResult.errors
            .map(e => `${e.field}: ${e.message}`)
            .join('; ');

          this.logger.warn('Row validation failed', {
            rowNumber: row.rowNumber,
            errors: validationResult.errors,
          });

          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'error',
            details: errorDetail,
            workflowId: 'legacy',
            workflowName: 'Legacy Service',
          });

          try {
            await this.sheetPoller.markRowProcessed(row.rowNumber, 'error', errorDetail);
          } catch (markError) {
            this.logger.error('Failed to write error marker for invalid row', {
              rowNumber: row.rowNumber,
              error: markError instanceof Error ? markError.message : String(markError),
            });
          }

          continue;
        }

        // Step c: Write processing marker (optimistic lock)
        try {
          await this.sheetPoller.markRowProcessing(row.rowNumber);
        } catch (markerError) {
          // Step d: If processing marker fails, skip the row
          this.logger.error('Failed to write processing marker', {
            rowNumber: row.rowNumber,
            error: markerError instanceof Error ? markerError.message : String(markerError),
          });
          continue;
        }

        // Step e: Publish to Buffer
        const publishResult = await this.bufferPublisher.schedulePost(
          row.captionText,
          row.videoUrl
        );

        if (publishResult.success) {
          // Step f: Mark row as success
          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'success',
            details: `Post scheduled (ID: ${publishResult.postId || 'N/A'})`,
            workflowId: 'legacy',
            workflowName: 'Legacy Service',
          });

          try {
            await this.sheetPoller.markRowProcessed(row.rowNumber, 'success');
            this.logger.info('Successfully scheduled post', {
              rowNumber: row.rowNumber,
              postId: publishResult.postId,
              attempts: publishResult.attempts,
            });
          } catch (markError) {
            // Final marker write failed after internal retries
            this.logger.error('Row requires manual review', {
              rowNumber: row.rowNumber,
              reason: 'Post scheduled successfully but failed to write success marker',
              error: markError instanceof Error ? markError.message : String(markError),
            });
          }
        } else {
          // Step g: Publish failed, mark row as failed
          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'failed',
            details: publishResult.error ?? 'Unknown publish error',
            workflowId: 'legacy',
            workflowName: 'Legacy Service',
          });

          try {
            await this.sheetPoller.markRowProcessed(
              row.rowNumber,
              'failed',
              publishResult.error ?? 'Unknown publish error'
            );
            this.logger.error('Failed to schedule post', {
              rowNumber: row.rowNumber,
              error: publishResult.error,
              attempts: publishResult.attempts,
            });
          } catch (markError) {
            // Final marker write failed after internal retries
            this.logger.error('Row requires manual review', {
              rowNumber: row.rowNumber,
              reason: 'Post failed and also failed to write failure marker',
              error: markError instanceof Error ? markError.message : String(markError),
            });
          }
        }

        processedCount++;
      }

      // Step 4: Update health check with last successful poll timestamp
      this.healthCheckServer.updateLastPoll(new Date());
      this.healthCheckServer.resetErrors();
      updateLastPollTime();

    } catch (cycleError) {
      // Google Sheets API unreachable or other top-level error
      this.logger.error('Poll cycle failed', {
        error: cycleError instanceof Error ? cycleError.message : String(cycleError),
      });
      this.healthCheckServer.recordError();
      return;
    }

    // Step 5: Log cycle completion
    this.logger.info('Poll cycle complete', { processedRows: processedCount });
  }
}
