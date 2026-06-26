import { Router, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import {
  requireAuth,
  getDashboardPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  destroySession,
} from './auth.js';
import {
  getActivities,
  getRecentActivities,
  getStats,
  loadActivities,
} from './activity-store.js';
import { loginPage } from './views/login.js';
import { dashboardPage } from './views/dashboard.js';
import { activityPage } from './views/activity.js';
import { workflowsPage } from './views/workflows.js';
import { settingsPage } from './views/settings.js';
import type { WorkflowManager } from '../workflows/workflow-manager.js';
import { BufferPublisher } from '../publisher/buffer-publisher.js';

// Initialize the activity store from disk
loadActivities();

/**
 * Creates the dashboard Express Router with all routes.
 * Accepts a WorkflowManager instance for multi-workflow support.
 */
export function createDashboardRouter(workflowManager: WorkflowManager): Router {
  const router = Router();

  // ─── Public Routes ────────────────────────────────────────────────────────────

  router.get('/login', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(loginPage());
  });

  router.post('/login', (req: Request, res: Response) => {
    const body = req.body as Record<string, string> | undefined;
    const password = body?.password || '';

    if (password === getDashboardPassword()) {
      const token = createSession();
      setSessionCookie(res, token);
      res.redirect('/');
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.status(401).send(loginPage('Invalid password. Please try again.'));
    }
  });

  router.get('/logout', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['dashboard_session'];
    if (token) {
      destroySession(token);
    }
    clearSessionCookie(res);
    res.redirect('/login');
  });

  // ─── Protected Routes ─────────────────────────────────────────────────────────

  // Dashboard home
  router.get('/', requireAuth, (_req: Request, res: Response) => {
    const stats = getStats();
    const recent = getRecentActivities(5);
    const workflows = workflowManager.getWorkflows();
    res.setHeader('Content-Type', 'text/html');
    res.send(dashboardPage(stats, recent, workflows));
  });

  // Activity log page
  router.get('/activity', requireAuth, (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const status = (req.query.status as string) || 'all';
    const workflow = (req.query.workflow as string) || 'all';
    const data = getActivities(page, 25, status, workflow);
    const workflows = workflowManager.getWorkflows();
    res.setHeader('Content-Type', 'text/html');
    res.send(activityPage({ ...data, statusFilter: status, workflowFilter: workflow, workflows }));
  });

  // Workflows management page (replaces settings)
  router.get('/workflows', requireAuth, (req: Request, res: Response) => {
    const workflows = workflowManager.getWorkflows();
    const msg = req.query.saved === '1'
      ? { type: 'success' as const, text: 'Workflow saved successfully!' }
      : req.query.error
        ? { type: 'error' as const, text: String(req.query.error) }
        : undefined;
    res.setHeader('Content-Type', 'text/html');
    res.send(workflowsPage(workflows, msg));
  });

  // Settings page (Buffer API Tester)
  router.get('/settings', requireAuth, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(settingsPage());
  });

  // ─── Workflow API Endpoints ───────────────────────────────────────────────────

  // GET /api/workflows — list all workflows
  router.get('/api/workflows', requireAuth, (_req: Request, res: Response) => {
    res.json(workflowManager.getWorkflows());
  });

  // POST /api/workflows — create new workflow
  router.post('/api/workflows', requireAuth, async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || !body.name || !body.sheetId) {
      res.status(400).json({ success: false, message: 'Missing required fields (name, sheetId)' });
      return;
    }

    try {
      const workflow = await workflowManager.addWorkflow({
        name: String(body.name),
        sheetId: String(body.sheetId),
        worksheetName: String(body.worksheetName || 'TikTok'),
        googleCredentialsJson: String(body.googleCredentialsJson || ''),
        bufferAccessToken: String(body.bufferAccessToken || ''),
        bufferChannelId: String(body.bufferChannelId || ''),
        pollingIntervalSeconds: Number(body.pollingIntervalSeconds) || 60,
        enabled: body.enabled !== false,
      });
      res.status(201).json(workflow);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create workflow',
      });
    }
  });

  // GET /api/workflows/:id — get single workflow
  router.get('/api/workflows/:id', requireAuth, (req: Request, res: Response) => {
    const id = req.params.id as string;
    const workflow = workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({ success: false, message: 'Workflow not found' });
      return;
    }
    res.json(workflow);
  });

  // GET /api/workflows/:id/credentials — get workflow credentials JSON
  router.get('/api/workflows/:id/credentials', requireAuth, (req: Request, res: Response) => {
    const id = req.params.id as string;
    const workflow = workflowManager.getWorkflow(id);
    if (!workflow) {
      res.status(404).json({ success: false, message: 'Workflow not found' });
      return;
    }

    const credPath = workflow.googleCredentialsPath;
    if (!credPath || !existsSync(credPath)) {
      res.status(404).json({ success: false, message: 'Credentials file not found' });
      return;
    }

    try {
      const credentials = readFileSync(credPath, 'utf-8');
      res.json({ credentials });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to read credentials file' });
    }
  });

  // PUT /api/workflows/:id — update workflow
  router.put('/api/workflows/:id', requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ success: false, message: 'No body provided' });
      return;
    }

    try {
      const updated = await workflowManager.updateWorkflow(id, {
        name: body.name !== undefined ? String(body.name) : undefined,
        sheetId: body.sheetId !== undefined ? String(body.sheetId) : undefined,
        worksheetName: body.worksheetName !== undefined ? String(body.worksheetName) : undefined,
        googleCredentialsJson: body.googleCredentialsJson !== undefined ? String(body.googleCredentialsJson) : undefined,
        bufferAccessToken: body.bufferAccessToken !== undefined ? String(body.bufferAccessToken) : undefined,
        bufferChannelId: body.bufferChannelId !== undefined ? String(body.bufferChannelId) : undefined,
        pollingIntervalSeconds: body.pollingIntervalSeconds !== undefined ? Number(body.pollingIntervalSeconds) : undefined,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      });

      if (!updated) {
        res.status(404).json({ success: false, message: 'Workflow not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update workflow',
      });
    }
  });

  // DELETE /api/workflows/:id — delete workflow
  router.delete('/api/workflows/:id', requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const deleted = await workflowManager.deleteWorkflow(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: 'Workflow not found' });
      return;
    }
    res.json({ success: true, message: 'Workflow deleted' });
  });

  // POST /api/workflows/:id/start — start workflow
  router.post('/api/workflows/:id/start', requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const started = await workflowManager.startWorkflow(id);
    if (!started) {
      const wf = workflowManager.getWorkflow(id);
      if (!wf) {
        res.status(404).json({ success: false, message: 'Workflow not found' });
      } else {
        res.status(500).json({ success: false, message: wf.errorMessage || 'Failed to start workflow' });
      }
      return;
    }
    res.json({ success: true, message: 'Workflow started' });
  });

  // POST /api/workflows/:id/stop — stop workflow
  router.post('/api/workflows/:id/stop', requireAuth, (req: Request, res: Response) => {
    const id = req.params.id as string;
    const stopped = workflowManager.stopWorkflow(id);
    if (!stopped) {
      res.status(404).json({ success: false, message: 'Workflow not found' });
      return;
    }
    res.json({ success: true, message: 'Workflow stopped' });
  });

  // POST /api/workflows/:id/poll — trigger immediate poll
  router.post('/api/workflows/:id/poll', requireAuth, async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const polled = await workflowManager.pollNow(id);
    if (!polled) {
      res.status(404).json({ success: false, message: 'Workflow not found or failed to poll' });
      return;
    }
    res.json({ success: true, message: 'Poll triggered' });
  });

  // ─── Legacy API Endpoints (backward compat) ──────────────────────────────────

  // POST /api/buffer-test — test a Buffer access token
  router.post('/api/buffer-test', requireAuth, async (req: Request, res: Response) => {
    const body = req.body as Record<string, string> | undefined;
    const accessToken = body?.accessToken || '';

    if (!accessToken) {
      res.status(400).json({ success: false, error: 'Missing accessToken in request body' });
      return;
    }

    const result = await BufferPublisher.testConnection(accessToken);
    res.json(result);
  });

  // GET /api/status
  router.get('/api/status', requireAuth, (_req: Request, res: Response) => {
    const stats = getStats();
    const workflows = workflowManager.getWorkflows();
    const uptime = Math.floor((Date.now() - new Date(stats.startTime).getTime()) / 1000);
    res.json({
      status: workflows.some(w => w.status === 'running') ? 'running' : 'stopped',
      uptime,
      lastPollTime: stats.lastPollTime,
      rowsProcessedToday: stats.rowsProcessedToday,
      successCount: stats.successCount,
      errorCount: stats.errorCount,
      failedCount: stats.failedCount,
      workflowCount: workflows.length,
      runningWorkflows: workflows.filter(w => w.status === 'running').length,
      successRate: (stats.successCount + stats.errorCount + stats.failedCount) > 0
        ? Math.round((stats.successCount / (stats.successCount + stats.errorCount + stats.failedCount)) * 100)
        : 100,
    });
  });

  // GET /api/activity
  router.get('/api/activity', requireAuth, (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const status = (req.query.status as string) || 'all';
    const workflow = (req.query.workflow as string) || 'all';
    const data = getActivities(page, 25, status, workflow);
    res.json(data);
  });

  return router;
}
