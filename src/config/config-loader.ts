import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig, IConfigLoader } from '../types.js';

/**
 * Custom error class for configuration validation failures.
 * Contains an array of descriptive messages for each invalid/missing key.
 */
export class ConfigError extends Error {
  public readonly errors: string[];

  constructor(errors: string[]) {
    const message = `Configuration invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
    super(message);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

/**
 * Shape of the config.json file.
 */
interface ConfigFile {
  sheetId?: string;
  worksheetName?: string;
  googleCredentialsPath?: string;
  bufferAccessToken?: string;
  bufferTikTokProfileId?: string;
  pollingIntervalSeconds?: number | string;
  healthCheckPort?: number | string;
}

/**
 * Loads application configuration from environment variables with fallback
 * to a config.json file. Environment variables always override config file values.
 */
export class ConfigLoader implements IConfigLoader {
  private configFilePath: string;

  constructor(configFilePath?: string) {
    this.configFilePath = configFilePath ?? resolve(process.cwd(), 'config.json');
  }

  load(): AppConfig {
    const fileConfig = this.loadConfigFile();
    const errors: string[] = [];

    // Read raw values: env vars override config file
    const googleSheetId = this.resolve('SHEET_ID', fileConfig?.sheetId);
    const worksheetName = this.resolve('WORKSHEET_NAME', fileConfig?.worksheetName);
    const googleCredentialsPath = this.resolve('GOOGLE_CREDENTIALS_PATH', fileConfig?.googleCredentialsPath);
    const bufferAccessToken = this.resolve('BUFFER_ACCESS_TOKEN', fileConfig?.bufferAccessToken);
    const bufferTikTokProfileId = this.resolve('BUFFER_TIKTOK_PROFILE_ID', fileConfig?.bufferTikTokProfileId);
    const rawPollingInterval = this.resolve('POLLING_INTERVAL_SECONDS', fileConfig?.pollingIntervalSeconds);
    const rawHealthCheckPort = this.resolve('HEALTH_CHECK_PORT', fileConfig?.healthCheckPort);

    // Validate required string fields
    if (!googleSheetId || googleSheetId.trim() === '') {
      errors.push('googleSheetId (SHEET_ID) is required and must be a non-empty string');
    }
    if (!worksheetName || worksheetName.trim() === '') {
      errors.push('worksheetName (WORKSHEET_NAME) is required and must be a non-empty string');
    }
    if (!googleCredentialsPath || googleCredentialsPath.trim() === '') {
      errors.push('googleCredentialsPath (GOOGLE_CREDENTIALS_PATH) is required and must be a non-empty string');
    }
    if (!bufferAccessToken || bufferAccessToken.trim() === '') {
      errors.push('bufferAccessToken (BUFFER_ACCESS_TOKEN) is required and must be a non-empty string');
    }
    if (!bufferTikTokProfileId || bufferTikTokProfileId.trim() === '') {
      errors.push('bufferTikTokProfileId (BUFFER_TIKTOK_PROFILE_ID) is required and must be a non-empty string');
    }

    // Validate polling interval (numeric, 10-300, default 60)
    let pollingIntervalSeconds = 60;
    if (rawPollingInterval !== undefined && rawPollingInterval !== null && rawPollingInterval !== '') {
      const parsed = Number(rawPollingInterval);
      if (isNaN(parsed) || !Number.isFinite(parsed)) {
        errors.push('pollingIntervalSeconds (POLLING_INTERVAL_SECONDS) must be a valid number');
      } else if (parsed < 10 || parsed > 300) {
        errors.push('pollingIntervalSeconds (POLLING_INTERVAL_SECONDS) must be between 10 and 300');
      } else {
        pollingIntervalSeconds = parsed;
      }
    }

    // Validate health check port (numeric, default 3000)
    let healthCheckPort = 3000;
    if (rawHealthCheckPort !== undefined && rawHealthCheckPort !== null && rawHealthCheckPort !== '') {
      const parsed = Number(rawHealthCheckPort);
      if (isNaN(parsed) || !Number.isFinite(parsed)) {
        errors.push('healthCheckPort (HEALTH_CHECK_PORT) must be a valid number');
      } else {
        healthCheckPort = parsed;
      }
    }

    // Validate credentials file exists on disk (only if path was provided and non-empty)
    if (googleCredentialsPath && googleCredentialsPath.trim() !== '') {
      const resolvedPath = resolve(googleCredentialsPath);
      if (!existsSync(resolvedPath)) {
        errors.push(`googleCredentialsPath (GOOGLE_CREDENTIALS_PATH) file does not exist: ${googleCredentialsPath}`);
      }
    }

    if (errors.length > 0) {
      throw new ConfigError(errors);
    }

    return {
      googleSheetId: googleSheetId!,
      worksheetName: worksheetName!,
      googleCredentialsPath: googleCredentialsPath!,
      bufferAccessToken: bufferAccessToken!,
      bufferTikTokProfileId: bufferTikTokProfileId!,
      pollingIntervalSeconds,
      healthCheckPort,
    };
  }

  /**
   * Resolves a configuration value: env var takes priority over config file value.
   */
  private resolve(envKey: string, fileValue: string | number | undefined): string | undefined {
    const envValue = process.env[envKey];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (fileValue !== undefined && fileValue !== null) {
      return String(fileValue);
    }
    return undefined;
  }

  /**
   * Attempts to load and parse the config.json file.
   * Returns null if the file doesn't exist (not an error — env vars may provide all values).
   */
  private loadConfigFile(): ConfigFile | null {
    try {
      if (!existsSync(this.configFilePath)) {
        return null;
      }
      const content = readFileSync(this.configFilePath, 'utf-8');
      return JSON.parse(content) as ConfigFile;
    } catch {
      return null;
    }
  }
}
