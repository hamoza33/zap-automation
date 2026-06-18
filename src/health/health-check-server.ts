import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'http';
import type { HealthStatus, IHealthCheckServer } from '../types.js';

/**
 * HTTP health check server that exposes a GET /health endpoint.
 * Tracks service health based on consecutive errors within a 60-second window.
 */
export class HealthCheckServer implements IHealthCheckServer {
  private app: Express;
  private server: Server | null = null;
  private startTime: number = Date.now();
  private lastSuccessfulPoll: Date | null = null;
  private currentStatus: HealthStatus['status'] = 'healthy';
  private consecutiveErrors: number = 0;
  private errorTimestamps: number[] = [];

  constructor() {
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/health', (_req: Request, res: Response) => {
      const response: HealthStatus = {
        status: this.currentStatus,
        lastSuccessfulPoll: this.lastSuccessfulPoll
          ? this.lastSuccessfulPoll.toISOString()
          : null,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        consecutiveErrors: this.consecutiveErrors,
      };
      res.json(response);
    });
  }

  /**
   * Start the HTTP server on the given port.
   */
  start(port: number): void {
    this.startTime = Date.now();
    this.server = this.app.listen(port);
  }

  /**
   * Stop the HTTP server gracefully.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Update the timestamp of the last successful poll.
   */
  updateLastPoll(timestamp: Date): void {
    this.lastSuccessfulPoll = timestamp;
  }

  /**
   * Directly set the health status.
   */
  updateStatus(status: HealthStatus['status']): void {
    this.currentStatus = status;
  }

  /**
   * Record an error occurrence. Increments consecutive error count and
   * recalculates status based on the 60-second error window.
   */
  recordError(): void {
    const now = Date.now();
    this.consecutiveErrors++;
    this.errorTimestamps.push(now);

    // Prune error timestamps older than 60 seconds
    const windowStart = now - 60_000;
    this.errorTimestamps = this.errorTimestamps.filter(t => t >= windowStart);

    // Status logic based on consecutive errors within the 60-second window
    const errorsInWindow = this.errorTimestamps.length;

    if (errorsInWindow >= 5) {
      this.currentStatus = 'unhealthy';
    } else if (errorsInWindow >= 1) {
      this.currentStatus = 'degraded';
    }
  }

  /**
   * Reset the consecutive error count and restore healthy status.
   */
  resetErrors(): void {
    this.consecutiveErrors = 0;
    this.errorTimestamps = [];
    this.currentStatus = 'healthy';
  }
}
