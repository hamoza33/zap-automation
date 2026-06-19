/**
 * Shared HTML layout wrapper for all dashboard pages.
 */

export interface LayoutOptions {
  title: string;
  activePage?: 'dashboard' | 'activity' | 'settings' | 'workflows' | 'login';
  showNav?: boolean;
  content: string;
}

export function layout(options: LayoutOptions): string {
  const { title, activePage = 'dashboard', showNav = true, content } = options;

  const navItem = (href: string, label: string, page: string) => {
    const active = activePage === page ? 'class="nav-active"' : '';
    return `<a href="${href}" ${active}>${label}</a>`;
  };

  const nav = showNav
    ? `<nav class="top-nav">
        <div class="nav-brand">
          <span class="brand-icon">⚡</span>
          <span class="brand-text">Sheet → TikTok</span>
        </div>
        <div class="nav-links">
          ${navItem('/', 'Dashboard', 'dashboard')}
          ${navItem('/activity', 'Activity', 'activity')}
          ${navItem('/workflows', 'Workflows', 'workflows')}
          <a href="/logout">Logout</a>
        </div>
      </nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Sheet to TikTok</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
      line-height: 1.6;
    }

    .top-nav {
      background: #16213e;
      padding: 0.75rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #0f3460;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
    }

    .brand-icon { font-size: 1.3rem; }

    .nav-links {
      display: flex;
      gap: 0.25rem;
    }

    .nav-links a {
      color: #a0a0b0;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.9rem;
      transition: background 0.2s, color 0.2s;
    }

    .nav-links a:hover {
      background: #0f3460;
      color: #fff;
    }

    .nav-links a.nav-active {
      background: #0f3460;
      color: #e94560;
      font-weight: 500;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 1.5rem;
      border: 1px solid #0f3460;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .card-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8888a0;
      margin-bottom: 0.5rem;
    }

    .btn {
      padding: 0.6rem 1.2rem;
      border: none;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      text-decoration: none;
      display: inline-block;
    }

    .btn:hover { opacity: 0.9; }
    .btn:active { transform: scale(0.97); }

    .btn-primary {
      background: #e94560;
      color: #fff;
    }

    .btn-success {
      background: #28a745;
      color: #fff;
    }

    .btn-warning {
      background: #ffc107;
      color: #000;
    }

    .btn-danger {
      background: #dc3545;
      color: #fff;
    }

    .btn-secondary {
      background: #0f3460;
      color: #e0e0e0;
    }

    input, textarea, select {
      background: #1a1a2e;
      border: 1px solid #0f3460;
      color: #e0e0e0;
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      font-size: 0.9rem;
      width: 100%;
      font-family: inherit;
    }

    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: #e94560;
    }

    label {
      display: block;
      font-size: 0.85rem;
      color: #a0a0b0;
      margin-bottom: 0.3rem;
      font-weight: 500;
    }

    .form-group {
      margin-bottom: 1.25rem;
    }

    .toast {
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.9rem;
      z-index: 9999;
      animation: slideIn 0.3s ease;
    }

    .toast-success { background: #28a745; color: #fff; }
    .toast-error { background: #dc3545; color: #fff; }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }

    .status-green { background: #28a745; box-shadow: 0 0 6px #28a745; }
    .status-yellow { background: #ffc107; box-shadow: 0 0 6px #ffc107; }
    .status-red { background: #dc3545; box-shadow: 0 0 6px #dc3545; }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid #0f3460;
    }

    th {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #8888a0;
      font-weight: 600;
    }

    tr:hover td {
      background: rgba(15, 52, 96, 0.3);
    }

    .badge {
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-success { background: rgba(40, 167, 69, 0.2); color: #28a745; }
    .badge-error { background: rgba(255, 193, 7, 0.2); color: #ffc107; }
    .badge-failed { background: rgba(220, 53, 69, 0.2); color: #dc3545; }
    .badge-processing { background: rgba(0, 123, 255, 0.2); color: #007bff; }

    .pagination {
      display: flex;
      gap: 0.5rem;
      justify-content: center;
      margin-top: 1.5rem;
    }

    .pagination a, .pagination span {
      padding: 0.5rem 0.8rem;
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.85rem;
    }

    .pagination a {
      background: #0f3460;
      color: #e0e0e0;
    }

    .pagination a:hover {
      background: #e94560;
      color: #fff;
    }

    .pagination .current {
      background: #e94560;
      color: #fff;
    }

    @media (max-width: 768px) {
      .container { padding: 1rem; }
      .top-nav { padding: 0.75rem 1rem; flex-wrap: wrap; gap: 0.5rem; }
      .nav-links { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  ${nav}
  ${content}
  <script>
    // Auto-dismiss toasts
    document.querySelectorAll('.toast').forEach(t => {
      setTimeout(() => t.remove(), 4000);
    });
  </script>
</body>
</html>`;
}
