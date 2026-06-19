import { layout } from './layout.js';
import type { ActivityEntry, ServiceStats } from '../activity-store.js';
import type { WorkflowState } from '../../workflows/workflow-manager.js';

export function dashboardPage(
  stats: ServiceStats,
  recentActivities: ActivityEntry[],
  workflows: WorkflowState[] = []
): string {
  const runningCount = workflows.filter(w => w.status === 'running').length;
  const totalWorkflows = workflows.length;

  const uptime = getUptime(stats.startTime);
  const totalProcessed = stats.successCount + stats.errorCount + stats.failedCount;
  const successRate = totalProcessed > 0
    ? Math.round((stats.successCount / totalProcessed) * 100)
    : 100;

  const lastPoll = stats.lastPollTime
    ? formatTime(stats.lastPollTime)
    : 'Never';

  const activityRows = recentActivities.map(a => `
    <tr>
      <td style="font-size: 0.85rem; color: #8888a0;">${formatTime(a.timestamp)}</td>
      <td style="font-size: 0.85rem; color: #e0e0e0;">${escapeHtml(a.workflowName || 'Unknown')}</td>
      <td>#${a.rowNumber}</td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(a.caption.substring(0, 50))}</td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
    </tr>
  `).join('');

  const workflowCards = workflows.map(wf => {
    const statusColor = wf.status === 'running' ? 'green' : wf.status === 'error' ? 'red' : 'yellow';
    const statusLabel = wf.status.charAt(0).toUpperCase() + wf.status.slice(1);
    const wfLastPoll = wf.lastPollTime ? formatTime(wf.lastPollTime) : 'Never';
    return `
      <div class="card" style="min-width: 200px;">
        <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.5rem;">
          <span class="status-dot status-${statusColor}"></span>
          <strong style="color: #fff; font-size: 0.9rem;">${escapeHtml(wf.name)}</strong>
        </div>
        <div style="font-size: 0.8rem; color: #8888a0;">
          <div>${statusLabel} · ${wf.processedCount} rows · Last: ${wfLastPoll}</div>
        </div>
      </div>
    `;
  }).join('');

  return layout({
    title: 'Dashboard',
    activePage: 'dashboard',
    content: `
      <div class="container">
        <!-- Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.5rem; color: #fff;">Dashboard</h1>
            <p style="color: #8888a0; font-size: 0.9rem;">
              ${runningCount}/${totalWorkflows} workflows running
            </p>
          </div>
          <a href="/workflows" class="btn btn-primary" style="font-size: 0.85rem;">⚙️ Manage Workflows</a>
        </div>

        <!-- Stats Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card">
            <div class="card-title">Workflows</div>
            <div style="font-size: 1.3rem; color: #fff;">${runningCount} <span style="font-size: 0.8rem; color: #8888a0;">/ ${totalWorkflows}</span></div>
          </div>
          <div class="card">
            <div class="card-title">Last Poll</div>
            <div style="font-size: 1.3rem; color: #fff;">${lastPoll}</div>
          </div>
          <div class="card">
            <div class="card-title">Rows Today</div>
            <div style="font-size: 1.3rem; color: #fff;">${stats.rowsProcessedToday}</div>
          </div>
          <div class="card">
            <div class="card-title">Success Rate</div>
            <div style="font-size: 1.3rem; color: ${successRate >= 80 ? '#28a745' : successRate >= 50 ? '#ffc107' : '#dc3545'};">${successRate}%</div>
          </div>
          <div class="card">
            <div class="card-title">Uptime</div>
            <div style="font-size: 1.3rem; color: #fff;">${uptime}</div>
          </div>
        </div>

        <!-- Workflow Overview -->
        ${workflows.length > 0 ? `
        <div style="margin-bottom: 1.5rem;">
          <h2 style="font-size: 1rem; color: #8888a0; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Workflow Status</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.75rem;">
            ${workflowCards}
          </div>
        </div>
        ` : `
        <div class="card" style="margin-bottom: 1.5rem; text-align: center; padding: 2rem;">
          <p style="color: #8888a0;">No workflows configured. <a href="/workflows" style="color: #e94560;">Create one</a> to get started.</p>
        </div>
        `}

        <!-- Recent Activity -->
        <div class="card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
            <div class="card-title" style="margin-bottom: 0;">Recent Activity</div>
            <a href="/activity" class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">View All</a>
          </div>
          ${recentActivities.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Workflow</th>
                  <th>Row</th>
                  <th>Caption</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${activityRows}</tbody>
            </table>
          ` : `
            <p style="color: #8888a0; text-align: center; padding: 2rem;">No activity yet. Workflows will log entries here as they process rows.</p>
          `}
        </div>
      </div>
    `,
  });
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getUptime(startTime: string): string {
  const diff = Date.now() - new Date(startTime).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
