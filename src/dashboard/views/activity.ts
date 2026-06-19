import { layout } from './layout.js';
import type { ActivityEntry } from '../activity-store.js';
import type { WorkflowState } from '../../workflows/workflow-manager.js';

interface ActivityPageData {
  entries: ActivityEntry[];
  total: number;
  page: number;
  totalPages: number;
  statusFilter: string;
  workflowFilter: string;
  workflows: WorkflowState[];
}

export function activityPage(data: ActivityPageData): string {
  const { entries, total, page, totalPages, statusFilter, workflowFilter, workflows } = data;

  const rows = entries.map(a => `
    <tr>
      <td style="font-size: 0.85rem; color: #8888a0; white-space: nowrap;">${formatTimeFull(a.timestamp)}</td>
      <td style="font-size: 0.85rem; color: #e0e0e0;">${escapeHtml(a.workflowName || 'Unknown')}</td>
      <td>#${a.rowNumber}</td>
      <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(a.caption)}">${escapeHtml(a.caption.substring(0, 60))}</td>
      <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <a href="${escapeHtml(a.videoUrl)}" target="_blank" rel="noopener" style="color: #e94560; text-decoration: none;">${escapeHtml(a.videoUrl.substring(0, 40))}${a.videoUrl.length > 40 ? '...' : ''}</a>
      </td>
      <td><span class="badge badge-${a.status}">${a.status}</span></td>
      <td style="font-size: 0.8rem; color: #8888a0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(a.details)}">${escapeHtml(a.details.substring(0, 50))}</td>
    </tr>
  `).join('');

  const filterOptions = ['all', 'success', 'error', 'failed', 'processing'].map(s => {
    const selected = s === statusFilter ? 'selected' : '';
    return `<option value="${s}" ${selected}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`;
  }).join('');

  const workflowOptions = [
    `<option value="all" ${workflowFilter === 'all' ? 'selected' : ''}>All Workflows</option>`,
    ...workflows.map(wf => {
      const selected = wf.id === workflowFilter ? 'selected' : '';
      return `<option value="${wf.id}" ${selected}>${escapeHtml(wf.name)}</option>`;
    }),
  ].join('');

  const paginationHtml = buildPagination(page, totalPages, statusFilter, workflowFilter);

  return layout({
    title: 'Activity Log',
    activePage: 'activity',
    content: `
      <div class="container">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.5rem; color: #fff;">Activity Log</h1>
            <p style="color: #8888a0; font-size: 0.85rem;">${total} total entries</p>
          </div>
          <form method="GET" action="/activity" style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <label style="margin-bottom: 0; white-space: nowrap;">Status:</label>
            <select name="status" onchange="this.form.submit()" style="width: auto; min-width: 120px;">
              ${filterOptions}
            </select>
            <label style="margin-bottom: 0; white-space: nowrap;">Workflow:</label>
            <select name="workflow" onchange="this.form.submit()" style="width: auto; min-width: 150px;">
              ${workflowOptions}
            </select>
            <noscript><button type="submit" class="btn btn-secondary" style="padding: 0.4rem 0.8rem;">Go</button></noscript>
          </form>
        </div>

        <div class="card" style="overflow-x: auto;">
          ${entries.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Workflow</th>
                  <th>Row #</th>
                  <th>Caption</th>
                  <th>Video URL</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          ` : `
            <p style="color: #8888a0; text-align: center; padding: 2rem;">No activity entries${statusFilter !== 'all' ? ` matching "${statusFilter}"` : ''}.</p>
          `}
        </div>

        ${paginationHtml}
      </div>
    `,
  });
}

function buildPagination(page: number, totalPages: number, statusFilter: string, workflowFilter: string): string {
  if (totalPages <= 1) return '';

  const links: string[] = [];
  const baseUrl = `/activity?status=${statusFilter}&workflow=${workflowFilter}`;

  if (page > 1) {
    links.push(`<a href="${baseUrl}&page=${page - 1}">← Prev</a>`);
  }

  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  for (let i = start; i <= end; i++) {
    if (i === page) {
      links.push(`<span class="current">${i}</span>`);
    } else {
      links.push(`<a href="${baseUrl}&page=${i}">${i}</a>`);
    }
  }

  if (page < totalPages) {
    links.push(`<a href="${baseUrl}&page=${page + 1}">Next →</a>`);
  }

  return `<div class="pagination">${links.join('')}</div>`;
}

function formatTimeFull(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
