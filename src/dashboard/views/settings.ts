import { layout } from './layout.js';

/**
 * Buffer API Tester page - allows users to test a Buffer access token
 * and view account details (username and connected channels).
 */
export function settingsPage(): string {
  return layout({
    title: 'Settings',
    activePage: 'settings',
    content: `
      <div class="container">
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; color: #fff;">Settings</h1>
          <p style="color: #8888a0; font-size: 0.85rem;">Test and verify your Buffer API connection</p>
        </div>

        <div class="card" style="margin-bottom: 1.5rem;">
          <div class="card-title" style="margin-bottom: 1rem;">Buffer API Tester</div>
          <p style="color: #a0a0b0; font-size: 0.85rem; margin-bottom: 1.25rem;">
            Enter your Buffer access token below to verify it works and see connected accounts.
          </p>

          <div class="form-group">
            <label for="bufferToken">Buffer Access Token</label>
            <input type="password" id="bufferToken" placeholder="Enter your Buffer access token" autocomplete="off">
          </div>

          <button id="testBtn" class="btn btn-primary" onclick="testBufferConnection()">Test Connection</button>
        </div>

        <div id="results" style="display: none;">
          <div class="card">
            <div class="card-title" style="margin-bottom: 1rem;">Test Results</div>
            <div id="results-content"></div>
          </div>
        </div>
      </div>

      <script>
        async function testBufferConnection() {
          const token = document.getElementById('bufferToken').value.trim();
          if (!token) {
            showResults(false, 'Please enter a Buffer access token.');
            return;
          }

          const btn = document.getElementById('testBtn');
          btn.disabled = true;
          btn.textContent = 'Testing...';

          try {
            const res = await fetch('/api/buffer-test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: token }),
            });
            const data = await res.json();

            if (data.success) {
              let html = '<div style="margin-bottom: 1rem;">';
              html += '<span class="badge badge-success" style="margin-bottom: 0.5rem; display: inline-block;">Connected</span>';
              html += '<p style="color: #e0e0e0; margin-top: 0.5rem;"><strong>Username:</strong> ' + escapeHtml(data.username || 'Unknown') + '</p>';
              html += '</div>';

              if (data.channels && data.channels.length > 0) {
                html += '<div style="margin-top: 1rem;">';
                html += '<p style="color: #a0a0b0; font-size: 0.85rem; margin-bottom: 0.5rem;">Connected Channels:</p>';
                html += '<table><thead><tr><th>Service</th><th>Username</th><th>Channel ID</th></tr></thead><tbody>';
                for (const ch of data.channels) {
                  html += '<tr>';
                  html += '<td style="color: #e0e0e0;">' + escapeHtml(ch.service) + '</td>';
                  html += '<td style="color: #e0e0e0;">' + escapeHtml(ch.formatted_username) + '</td>';
                  html += '<td style="color: #8888a0; font-size: 0.8rem;">' + escapeHtml(ch.id) + '</td>';
                  html += '</tr>';
                }
                html += '</tbody></table>';
                html += '</div>';
              } else {
                html += '<p style="color: #8888a0; font-size: 0.85rem;">No channels connected.</p>';
              }

              showResults(true, html);
            } else {
              showResults(false, '<span class="badge badge-failed" style="display: inline-block; margin-bottom: 0.5rem;">Failed</span><p style="color: #dc3545; margin-top: 0.5rem;">' + escapeHtml(data.error || 'Unknown error') + '</p>');
            }
          } catch (err) {
            showResults(false, '<span class="badge badge-failed" style="display: inline-block; margin-bottom: 0.5rem;">Error</span><p style="color: #dc3545; margin-top: 0.5rem;">Network error: could not reach the server.</p>');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Test Connection';
          }
        }

        function showResults(success, html) {
          const container = document.getElementById('results');
          const content = document.getElementById('results-content');
          container.style.display = 'block';
          content.innerHTML = html;
        }

        function escapeHtml(str) {
          const div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }
      </script>
    `,
  });
}
