import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SheetPoller } from '../poller/sheet-poller.js';
import { RowValidator } from '../validator/row-validator.js';
import { BufferPublisher } from '../publisher/buffer-publisher.js';
import { Logger } from '../logger/logger.js';
import { addActivity, updateLastPollTime } from '../dashboard/activity-store.js';
import type { AppConfig, ISheetPoller, IBufferPublisher } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowConfig {
  name: string;
  sheetId: string;
  worksheetName: string;
  googleCredentialsJson: string;
  bufferAccessToken: string;
  bufferChannelId: string;
  pollingIntervalSeconds: number;
  enabled: boolean;
}

export interface WorkflowState {
  id: string;
  name: string;
  sheetId: string;
  worksheetName: string;
  googleCredentialsPath: string;
  bufferAccessToken: string;
  bufferChannelId: string;
  pollingIntervalSeconds: number;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  lastPollTime: string | null;
  processedCount: number;
  errorMessage?: string;
}

interface PersistedWorkflow {
  id: string;
  name: string;
  sheetId: string;
  worksheetName: string;
  googleCredentialsPath: string;
  bufferAccessToken: string;
  bufferChannelId: string;
  pollingIntervalSeconds: number;
  enabled: boolean;
}

interface RunningWorkflow {
  id: string;
  config: PersistedWorkflow;
  poller: ISheetPoller;
  publisher: IBufferPublisher;
  validator: RowValidator;
  logger: Logger;
  timer: ReturnType<typeof setTimeout> | null;
  status: 'running' | 'stopped' | 'error';
  lastPollTime: string | null;
  processedRows: Set<number>;
  errorMessage?: string;
  authenticated: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const WORKFLOWS_FILE = resolve(process.cwd(), 'workflows.json');
const CREDENTIALS_DIR = resolve(process.cwd(), 'credentials');

// ─── WorkflowManager ────────────────────────────────────────────────────────────

export class WorkflowManager {
  private workflows: Map<string, RunningWorkflow> = new Map();
  private logger = new Logger();

  constructor() {
    // Ensure credentials directory exists
    if (!existsSync(CREDENTIALS_DIR)) {
      mkdirSync(CREDENTIALS_DIR, { recursive: true });
    }
  }

  /**
   * Load workflows from disk and auto-start enabled ones.
   * If no workflows.json exists but env vars are set, migrate the legacy config.
   */
  async initialize(): Promise<void> {
    const persisted = this.loadWorkflows();

    if (persisted.length === 0 && this.hasLegacyEnvVars()) {
      this.logger.info('No workflows.json found. Migrating from env vars...');
      const legacyConfig = this.buildLegacyConfig();
      if (legacyConfig) {
        await this.addWorkflow(legacyConfig);
      }
    } else {
      for (const wf of persisted) {
        this.registerWorkflow(wf);
      }
      // Start all enabled workflows
      for (const [id, rw] of this.workflows) {
        if (rw.config.enabled) {
          await this.startWorkflow(id);
        }
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async addWorkflow(config: WorkflowConfig): Promise<WorkflowState> {
    const id = randomUUID();
    const credPath = this.saveCredentials(id, config.googleCredentialsJson);

    const persisted: PersistedWorkflow = {
      id,
      name: config.name,
      sheetId: config.sheetId,
      worksheetName: config.worksheetName,
      googleCredentialsPath: credPath,
      bufferAccessToken: config.bufferAccessToken,
      bufferChannelId: config.bufferChannelId,
      pollingIntervalSeconds: Math.max(10, Math.min(300, config.pollingIntervalSeconds)),
      enabled: config.enabled,
    };

    this.registerWorkflow(persisted);
    this.saveWorkflowsToDisk();

    // Mark existing rows as processed so only new rows get published
    const rw = this.workflows.get(id)!;
    try {
      await rw.poller.authenticate();
      rw.authenticated = true;
      const existingRowNumbers = await rw.poller.fetchAllRowNumbers();
      for (const rowNum of existingRowNumbers) {
        rw.processedRows.add(rowNum);
      }
      this.saveProcessedRows(id, rw.processedRows);
    } catch (error) {
      this.logger.warn(`Could not pre-mark existing rows for workflow "${config.name}"`, {
        workflowId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (config.enabled) {
      await this.startWorkflow(id);
    }

    return this.getWorkflow(id)!;
  }

  async updateWorkflow(id: string, config: Partial<WorkflowConfig>): Promise<WorkflowState | null> {
    const rw = this.workflows.get(id);
    if (!rw) return null;

    const wasRunning = rw.status === 'running';
    const previousSheetId = rw.config.sheetId;

    // Stop if running
    if (wasRunning) {
      this.stopWorkflowInternal(rw);
    }

    // Update config
    if (config.name !== undefined) rw.config.name = config.name;
    if (config.sheetId !== undefined) rw.config.sheetId = config.sheetId;
    if (config.worksheetName !== undefined) rw.config.worksheetName = config.worksheetName;
    if (config.bufferAccessToken !== undefined) rw.config.bufferAccessToken = config.bufferAccessToken;
    if (config.bufferChannelId !== undefined) rw.config.bufferChannelId = config.bufferChannelId;
    if (config.pollingIntervalSeconds !== undefined) {
      rw.config.pollingIntervalSeconds = Math.max(10, Math.min(300, config.pollingIntervalSeconds));
    }
    if (config.enabled !== undefined) rw.config.enabled = config.enabled;

    // Update credentials if provided
    if (config.googleCredentialsJson !== undefined && config.googleCredentialsJson.trim()) {
      rw.config.googleCredentialsPath = this.saveCredentials(id, config.googleCredentialsJson);
    }

    // Rebuild poller/publisher with new config
    rw.authenticated = false;
    const appConfig = this.toAppConfig(rw.config);
    rw.poller = new SheetPoller(appConfig);
    rw.publisher = new BufferPublisher(rw.config.bufferAccessToken, rw.config.bufferChannelId);

    // If sheetId changed, reset processed rows with all current rows from new sheet
    if (config.sheetId !== undefined && config.sheetId !== previousSheetId) {
      try {
        await rw.poller.authenticate();
        rw.authenticated = true;
        const existingRowNumbers = await rw.poller.fetchAllRowNumbers();
        rw.processedRows = new Set(existingRowNumbers);
        this.saveProcessedRows(id, rw.processedRows);
      } catch (error) {
        this.logger.warn(`Could not pre-mark existing rows after sheetId change for workflow "${rw.config.name}"`, {
          workflowId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.saveWorkflowsToDisk();

    // Restart if was running and still enabled
    if (config.enabled ?? rw.config.enabled) {
      await this.startWorkflow(id);
    }

    return this.getWorkflow(id)!;
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const rw = this.workflows.get(id);
    if (!rw) return false;

    this.stopWorkflowInternal(rw);
    this.workflows.delete(id);
    this.saveWorkflowsToDisk();

    return true;
  }

  async startWorkflow(id: string): Promise<boolean> {
    const rw = this.workflows.get(id);
    if (!rw) return false;

    if (rw.status === 'running') return true;

    try {
      // Authenticate if needed
      if (!rw.authenticated) {
        await rw.poller.authenticate();
        rw.authenticated = true;
      }

      rw.status = 'running';
      rw.errorMessage = undefined;
      this.scheduleNextPoll(rw);
      this.logger.info(`Workflow "${rw.config.name}" started`, { workflowId: id });
      return true;
    } catch (error) {
      rw.status = 'error';
      rw.errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start workflow "${rw.config.name}"`, {
        workflowId: id,
        error: rw.errorMessage,
      });
      return false;
    }
  }

  stopWorkflow(id: string): boolean {
    const rw = this.workflows.get(id);
    if (!rw) return false;

    this.stopWorkflowInternal(rw);
    this.logger.info(`Workflow "${rw.config.name}" stopped`, { workflowId: id });
    return true;
  }

  async pollNow(id: string): Promise<boolean> {
    const rw = this.workflows.get(id);
    if (!rw) return false;

    if (rw.status !== 'running') {
      // Start it for this poll
      const started = await this.startWorkflow(id);
      if (!started) return false;
    }

    // Cancel scheduled poll and run immediately
    if (rw.timer) {
      clearTimeout(rw.timer);
      rw.timer = null;
    }

    await this.executePollCycle(rw);
    this.scheduleNextPoll(rw);
    return true;
  }

  getWorkflows(): WorkflowState[] {
    const result: WorkflowState[] = [];
    for (const rw of this.workflows.values()) {
      result.push(this.toWorkflowState(rw));
    }
    return result;
  }

  getWorkflow(id: string): WorkflowState | null {
    const rw = this.workflows.get(id);
    if (!rw) return null;
    return this.toWorkflowState(rw);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private registerWorkflow(persisted: PersistedWorkflow): void {
    const appConfig = this.toAppConfig(persisted);
    const processedRows = this.loadProcessedRows(persisted.id);

    const rw: RunningWorkflow = {
      id: persisted.id,
      config: persisted,
      poller: new SheetPoller(appConfig),
      publisher: new BufferPublisher(persisted.bufferAccessToken, persisted.bufferChannelId),
      validator: new RowValidator(),
      logger: new Logger(),
      timer: null,
      status: 'stopped',
      lastPollTime: null,
      processedRows,
      authenticated: false,
    };

    this.workflows.set(persisted.id, rw);
  }

  private stopWorkflowInternal(rw: RunningWorkflow): void {
    if (rw.timer) {
      clearTimeout(rw.timer);
      rw.timer = null;
    }
    rw.status = 'stopped';
  }

  private scheduleNextPoll(rw: RunningWorkflow): void {
    if (rw.status !== 'running') return;

    const delay = rw.config.pollingIntervalSeconds * 1000;
    rw.timer = setTimeout(async () => {
      if (rw.status !== 'running') return;

      try {
        await this.executePollCycle(rw);
      } catch (error) {
        rw.logger.error(`Poll cycle error for workflow "${rw.config.name}"`, {
          workflowId: rw.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.scheduleNextPoll(rw);
    }, delay);
  }

  private async executePollCycle(rw: RunningWorkflow): Promise<void> {
    try {
      if (!rw.authenticated) {
        await rw.poller.authenticate();
        rw.authenticated = true;
      }

      const rows = await rw.poller.fetchUnprocessedRows();

      for (const row of rows) {
        // Skip already processed
        if (rw.processedRows.has(row.rowNumber)) continue;

        // Validate
        const validationResult = rw.validator.validate(row);

        if (!validationResult.valid) {
          const errorDetail = validationResult.errors
            .map(e => `${e.field}: ${e.message}`)
            .join('; ');

          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'error',
            details: errorDetail,
            workflowId: rw.id,
            workflowName: rw.config.name,
          });

          try {
            await rw.poller.markRowProcessed(row.rowNumber, 'error', errorDetail);
          } catch { /* non-fatal */ }

          rw.processedRows.add(row.rowNumber);
          this.saveProcessedRows(rw.id, rw.processedRows);
          continue;
        }

        // Mark processing
        try {
          await rw.poller.markRowProcessing(row.rowNumber);
        } catch {
          continue;
        }

        // Publish
        const publishResult = await rw.publisher.schedulePost(row.captionText, row.videoUrl);

        if (publishResult.success) {
          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'success',
            details: `Post scheduled (ID: ${publishResult.postId || 'N/A'})`,
            workflowId: rw.id,
            workflowName: rw.config.name,
          });

          try {
            await rw.poller.markRowProcessed(row.rowNumber, 'success');
          } catch { /* non-fatal */ }
        } else {
          addActivity({
            rowNumber: row.rowNumber,
            caption: row.captionText,
            videoUrl: row.videoUrl,
            status: 'failed',
            details: publishResult.error ?? 'Unknown publish error',
            workflowId: rw.id,
            workflowName: rw.config.name,
          });

          try {
            await rw.poller.markRowProcessed(row.rowNumber, 'failed', publishResult.error);
          } catch { /* non-fatal */ }
        }

        rw.processedRows.add(row.rowNumber);
        this.saveProcessedRows(rw.id, rw.processedRows);
      }

      rw.lastPollTime = new Date().toISOString();
      rw.status = 'running';
      rw.errorMessage = undefined;
      updateLastPollTime();

    } catch (error) {
      rw.status = 'error';
      rw.errorMessage = error instanceof Error ? error.message : String(error);
      rw.logger.error(`Poll cycle failed for "${rw.config.name}"`, {
        workflowId: rw.id,
        error: rw.errorMessage,
      });
    }
  }

  private toWorkflowState(rw: RunningWorkflow): WorkflowState {
    return {
      id: rw.id,
      name: rw.config.name,
      sheetId: rw.config.sheetId,
      worksheetName: rw.config.worksheetName,
      googleCredentialsPath: rw.config.googleCredentialsPath,
      bufferAccessToken: rw.config.bufferAccessToken,
      bufferChannelId: rw.config.bufferChannelId,
      pollingIntervalSeconds: rw.config.pollingIntervalSeconds,
      enabled: rw.config.enabled,
      status: rw.status,
      lastPollTime: rw.lastPollTime,
      processedCount: rw.processedRows.size,
      errorMessage: rw.errorMessage,
    };
  }

  private toAppConfig(persisted: PersistedWorkflow): AppConfig {
    return {
      googleSheetId: persisted.sheetId,
      worksheetName: persisted.worksheetName,
      googleCredentialsPath: persisted.googleCredentialsPath,
      bufferAccessToken: persisted.bufferAccessToken,
      bufferTikTokProfileId: persisted.bufferChannelId,
      pollingIntervalSeconds: persisted.pollingIntervalSeconds,
      healthCheckPort: 3000,
    };
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private loadWorkflows(): PersistedWorkflow[] {
    try {
      if (existsSync(WORKFLOWS_FILE)) {
        const raw = readFileSync(WORKFLOWS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      }
    } catch {
      // Start fresh
    }
    return [];
  }

  private saveWorkflowsToDisk(): void {
    const data: PersistedWorkflow[] = [];
    for (const rw of this.workflows.values()) {
      data.push(rw.config);
    }
    try {
      writeFileSync(WORKFLOWS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error('Failed to save workflows.json', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private saveCredentials(id: string, json: string): string {
    const filePath = resolve(CREDENTIALS_DIR, `workflow-${id}.json`);
    writeFileSync(filePath, json, 'utf-8');
    return filePath;
  }

  private loadProcessedRows(workflowId: string): Set<number> {
    const filePath = resolve(process.cwd(), `processed-rows-${workflowId}.json`);
    try {
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        return new Set(Array.isArray(data) ? data : []);
      }
    } catch { /* start fresh */ }
    return new Set();
  }

  private saveProcessedRows(workflowId: string, rows: Set<number>): void {
    const filePath = resolve(process.cwd(), `processed-rows-${workflowId}.json`);
    try {
      writeFileSync(filePath, JSON.stringify([...rows]), 'utf-8');
    } catch { /* non-fatal */ }
  }

  // ─── Legacy Migration ───────────────────────────────────────────────────────

  private hasLegacyEnvVars(): boolean {
    return !!(process.env['SHEET_ID'] || process.env['GOOGLE_SHEET_ID']);
  }

  private buildLegacyConfig(): WorkflowConfig | null {
    const sheetId = process.env['SHEET_ID'] || process.env['GOOGLE_SHEET_ID'] || '';
    const worksheetName = process.env['WORKSHEET_NAME'] || 'TikTok';
    const bufferAccessToken = process.env['BUFFER_ACCESS_TOKEN'] || '';
    const bufferChannelId = process.env['BUFFER_TIKTOK_PROFILE_ID'] || '';
    const pollingInterval = parseInt(process.env['POLLING_INTERVAL_SECONDS'] || '60') || 60;
    const credPath = process.env['GOOGLE_CREDENTIALS_PATH'] || '';

    if (!sheetId || !bufferAccessToken) return null;

    let credJson = '';
    if (credPath) {
      try {
        const resolved = resolve(credPath);
        if (existsSync(resolved)) {
          credJson = readFileSync(resolved, 'utf-8');
        }
      } catch { /* skip */ }
    }

    return {
      name: 'Legacy Workflow (migrated)',
      sheetId,
      worksheetName,
      googleCredentialsJson: credJson,
      bufferAccessToken,
      bufferChannelId,
      pollingIntervalSeconds: pollingInterval,
      enabled: true,
    };
  }
}
