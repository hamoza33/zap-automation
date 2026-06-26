import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A single activity log entry for the dashboard.
 */
export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO 8601
  rowNumber: number;
  caption: string;
  videoUrl: string;
  status: 'success' | 'error' | 'failed' | 'processing';
  details: string;
  workflowId: string;
  workflowName: string;
  tiktokVideoLink?: string | null;
  bufferUsername?: string | null;
}

/**
 * Service stats tracked in memory.
 */
export interface ServiceStats {
  lastPollTime: string | null;
  rowsProcessedToday: number;
  successCount: number;
  errorCount: number;
  failedCount: number;
  serviceState: 'running' | 'stopped' | 'paused';
  startTime: string;
}

const DATA_FILE = resolve(process.cwd(), 'dashboard-activity.json');

let activities: ActivityEntry[] = [];
let stats: ServiceStats = {
  lastPollTime: null,
  rowsProcessedToday: 0,
  successCount: 0,
  errorCount: 0,
  failedCount: 0,
  serviceState: 'running',
  startTime: new Date().toISOString(),
};

/**
 * Load activity data from disk on startup.
 */
export function loadActivities(): void {
  try {
    if (existsSync(DATA_FILE)) {
      const raw = readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      activities = Array.isArray(data.activities) ? data.activities : [];
      if (data.stats) {
        stats = { ...stats, ...data.stats, startTime: stats.startTime };
      }
    }
  } catch {
    // If file is corrupt, start fresh
    activities = [];
  }
}

/**
 * Persist current activity data to disk.
 */
function persist(): void {
  try {
    writeFileSync(DATA_FILE, JSON.stringify({ activities, stats }, null, 2), 'utf-8');
  } catch {
    // Non-fatal — dashboard still works from memory
  }
}

/**
 * Add an activity entry.
 */
export function addActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  const newEntry: ActivityEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  activities.unshift(newEntry);

  // Keep max 1000 entries
  if (activities.length > 1000) {
    activities = activities.slice(0, 1000);
  }

  // Update stats
  stats.lastPollTime = new Date().toISOString();
  stats.rowsProcessedToday++;
  if (entry.status === 'success') stats.successCount++;
  else if (entry.status === 'error') stats.errorCount++;
  else if (entry.status === 'failed') stats.failedCount++;

  persist();
}

/**
 * Get paginated activity entries with optional status and workflow filter.
 */
export function getActivities(
  page: number = 1,
  perPage: number = 25,
  statusFilter: string = 'all',
  workflowFilter: string = 'all'
): { entries: ActivityEntry[]; total: number; page: number; totalPages: number } {
  let filtered = activities;
  if (statusFilter && statusFilter !== 'all') {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  if (workflowFilter && workflowFilter !== 'all') {
    filtered = filtered.filter(a => a.workflowId === workflowFilter);
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * perPage;
  const entries = filtered.slice(start, start + perPage);

  return { entries, total, page: safePage, totalPages };
}

/**
 * Get the last N activity entries.
 */
export function getRecentActivities(count: number = 5): ActivityEntry[] {
  return activities.slice(0, count);
}

/**
 * Get current service stats.
 */
export function getStats(): ServiceStats {
  return { ...stats };
}

/**
 * Update the service state.
 */
export function setServiceState(state: ServiceStats['serviceState']): void {
  stats.serviceState = state;
  persist();
}

/**
 * Update last poll time.
 */
export function updateLastPollTime(): void {
  stats.lastPollTime = new Date().toISOString();
  persist();
}

/**
 * Reset daily stats (call at midnight or on demand).
 */
export function resetDailyStats(): void {
  stats.rowsProcessedToday = 0;
  stats.successCount = 0;
  stats.errorCount = 0;
  stats.failedCount = 0;
  persist();
}
