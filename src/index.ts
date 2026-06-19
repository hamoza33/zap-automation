import { Logger } from './logger/logger.js';
import { HealthCheckServer } from './health/health-check-server.js';
import { WorkflowManager } from './workflows/workflow-manager.js';

async function main(): Promise<void> {
  const logger = new Logger();
  const port = parseInt(process.env['HEALTH_CHECK_PORT'] || '3000') || 3000;

  logger.info('Starting Sheet-to-TikTok Multi-Workflow Service');

  // Create the workflow manager
  const workflowManager = new WorkflowManager();

  // Create and start the health/dashboard server
  const healthCheckServer = new HealthCheckServer(workflowManager);
  healthCheckServer.start(port);
  logger.info('Dashboard and health server started', { port });

  // Initialize workflows (loads from disk, migrates legacy env, starts enabled ones)
  try {
    await workflowManager.initialize();
    const workflows = workflowManager.getWorkflows();
    logger.info('Workflows initialized', {
      total: workflows.length,
      running: workflows.filter(w => w.status === 'running').length,
    });
  } catch (error) {
    logger.error('Failed to initialize workflows', {
      error: error instanceof Error ? error.message : String(error),
    });
    healthCheckServer.updateStatus('degraded');
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Received shutdown signal, stopping gracefully...');
    const workflows = workflowManager.getWorkflows();
    for (const wf of workflows) {
      if (wf.status === 'running') {
        workflowManager.stopWorkflow(wf.id);
      }
    }
    healthCheckServer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Unhandled fatal error:', err);
  process.exit(1);
});
