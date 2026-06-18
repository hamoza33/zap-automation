import { Logger } from './logger/logger.js';
import { ConfigLoader, ConfigError } from './config/config-loader.js';
import { SheetPoller } from './poller/sheet-poller.js';
import { RowValidator } from './validator/row-validator.js';
import { BufferPublisher } from './publisher/buffer-publisher.js';
import { HealthCheckServer } from './health/health-check-server.js';
import { AutomationService } from './service/automation-service.js';

async function main(): Promise<void> {
  const logger = new Logger();

  // Load and validate configuration
  let config;
  try {
    const configLoader = new ConfigLoader();
    config = configLoader.load();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error('Failed to load configuration', { errors: error.errors });
    } else {
      logger.error('Unexpected error loading configuration', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    process.exit(1);
  }

  // Instantiate all dependencies
  const sheetPoller = new SheetPoller(config);
  const rowValidator = new RowValidator();
  const bufferPublisher = new BufferPublisher(config.bufferAccessToken, config.bufferTikTokProfileId);
  const healthCheckServer = new HealthCheckServer();

  // Create and start the automation service
  const service = new AutomationService({
    config,
    sheetPoller,
    rowValidator,
    bufferPublisher,
    healthCheckServer,
    logger,
  });

  try {
    await service.start();
  } catch (error) {
    logger.error('Failed to start automation service', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled fatal error:', err);
  process.exit(1);
});
