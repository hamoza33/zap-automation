import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigLoader, ConfigError } from './config-loader.js';

describe('ConfigLoader', () => {
  let tempDir: string;
  let credentialsPath: string;
  let configFilePath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Create a temp directory for test files
    tempDir = join(tmpdir(), `config-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    // Create a dummy credentials file
    credentialsPath = join(tempDir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({ type: 'service_account' }));

    configFilePath = join(tempDir, 'config.json');

    // Clean env vars
    delete process.env.SHEET_ID;
    delete process.env.WORKSHEET_NAME;
    delete process.env.GOOGLE_CREDENTIALS_PATH;
    delete process.env.BUFFER_ACCESS_TOKEN;
    delete process.env.BUFFER_TIKTOK_PROFILE_ID;
    delete process.env.POLLING_INTERVAL_SECONDS;
    delete process.env.HEALTH_CHECK_PORT;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
    // Cleanup temp dir
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  function writeConfigFile(config: Record<string, unknown>) {
    writeFileSync(configFilePath, JSON.stringify(config));
  }

  function setAllEnvVars() {
    process.env.SHEET_ID = 'test-sheet-id';
    process.env.WORKSHEET_NAME = 'Sheet1';
    process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
    process.env.BUFFER_ACCESS_TOKEN = 'buf-token-123';
    process.env.BUFFER_TIKTOK_PROFILE_ID = 'profile-456';
  }

  function validConfigFile() {
    return {
      sheetId: 'file-sheet-id',
      worksheetName: 'FileSheet',
      googleCredentialsPath: credentialsPath,
      bufferAccessToken: 'file-token',
      bufferTikTokProfileId: 'file-profile',
      pollingIntervalSeconds: 60,
      healthCheckPort: 3000,
    };
  }

  describe('loading from environment variables', () => {
    it('should load all config from environment variables', () => {
      setAllEnvVars();
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();

      expect(config.googleSheetId).toBe('test-sheet-id');
      expect(config.worksheetName).toBe('Sheet1');
      expect(config.googleCredentialsPath).toBe(credentialsPath);
      expect(config.bufferAccessToken).toBe('buf-token-123');
      expect(config.bufferTikTokProfileId).toBe('profile-456');
      expect(config.pollingIntervalSeconds).toBe(60);
      expect(config.healthCheckPort).toBe(3000);
    });

    it('should parse POLLING_INTERVAL_SECONDS from env', () => {
      setAllEnvVars();
      process.env.POLLING_INTERVAL_SECONDS = '120';
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();
      expect(config.pollingIntervalSeconds).toBe(120);
    });

    it('should parse HEALTH_CHECK_PORT from env', () => {
      setAllEnvVars();
      process.env.HEALTH_CHECK_PORT = '8080';
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();
      expect(config.healthCheckPort).toBe(8080);
    });
  });

  describe('loading from config file', () => {
    it('should load all config from config file when no env vars set', () => {
      writeConfigFile(validConfigFile());
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();

      expect(config.googleSheetId).toBe('file-sheet-id');
      expect(config.worksheetName).toBe('FileSheet');
      expect(config.googleCredentialsPath).toBe(credentialsPath);
      expect(config.bufferAccessToken).toBe('file-token');
      expect(config.bufferTikTokProfileId).toBe('file-profile');
      expect(config.pollingIntervalSeconds).toBe(60);
      expect(config.healthCheckPort).toBe(3000);
    });
  });

  describe('environment variable precedence', () => {
    it('should override config file values with env vars', () => {
      writeConfigFile(validConfigFile());
      process.env.SHEET_ID = 'env-sheet-id';
      process.env.WORKSHEET_NAME = 'EnvSheet';
      process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
      process.env.BUFFER_ACCESS_TOKEN = 'env-token';
      process.env.BUFFER_TIKTOK_PROFILE_ID = 'env-profile';
      process.env.POLLING_INTERVAL_SECONDS = '30';
      process.env.HEALTH_CHECK_PORT = '9090';

      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();

      expect(config.googleSheetId).toBe('env-sheet-id');
      expect(config.worksheetName).toBe('EnvSheet');
      expect(config.bufferAccessToken).toBe('env-token');
      expect(config.bufferTikTokProfileId).toBe('env-profile');
      expect(config.pollingIntervalSeconds).toBe(30);
      expect(config.healthCheckPort).toBe(9090);
    });

    it('should use config file value when env var is not set', () => {
      writeConfigFile(validConfigFile());
      // Only set some env vars
      process.env.SHEET_ID = 'env-override';
      process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
      process.env.BUFFER_ACCESS_TOKEN = 'env-token';
      process.env.BUFFER_TIKTOK_PROFILE_ID = 'env-profile';

      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();

      expect(config.googleSheetId).toBe('env-override');
      expect(config.worksheetName).toBe('FileSheet'); // from file
    });
  });

  describe('validation errors', () => {
    it('should throw ConfigError when required fields are missing', () => {
      // No env vars, no config file
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors).toContain('googleSheetId (SHEET_ID) is required and must be a non-empty string');
        expect(err.errors).toContain('worksheetName (WORKSHEET_NAME) is required and must be a non-empty string');
        expect(err.errors).toContain('googleCredentialsPath (GOOGLE_CREDENTIALS_PATH) is required and must be a non-empty string');
        expect(err.errors).toContain('bufferAccessToken (BUFFER_ACCESS_TOKEN) is required and must be a non-empty string');
        expect(err.errors).toContain('bufferTikTokProfileId (BUFFER_TIKTOK_PROFILE_ID) is required and must be a non-empty string');
      }
    });

    it('should report all errors at once, not just the first one', () => {
      const loader = new ConfigLoader(configFilePath);
      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors.length).toBeGreaterThan(1);
      }
    });

    it('should reject non-numeric polling interval', () => {
      setAllEnvVars();
      process.env.POLLING_INTERVAL_SECONDS = 'not-a-number';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors).toContain('pollingIntervalSeconds (POLLING_INTERVAL_SECONDS) must be a valid number');
      }
    });

    it('should reject polling interval below 10', () => {
      setAllEnvVars();
      process.env.POLLING_INTERVAL_SECONDS = '5';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors).toContain('pollingIntervalSeconds (POLLING_INTERVAL_SECONDS) must be between 10 and 300');
      }
    });

    it('should reject polling interval above 300', () => {
      setAllEnvVars();
      process.env.POLLING_INTERVAL_SECONDS = '500';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors).toContain('pollingIntervalSeconds (POLLING_INTERVAL_SECONDS) must be between 10 and 300');
      }
    });

    it('should reject non-numeric health check port', () => {
      setAllEnvVars();
      process.env.HEALTH_CHECK_PORT = 'abc';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors).toContain('healthCheckPort (HEALTH_CHECK_PORT) must be a valid number');
      }
    });

    it('should reject credentials file path that does not exist', () => {
      setAllEnvVars();
      process.env.GOOGLE_CREDENTIALS_PATH = '/nonexistent/path/credentials.json';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);

      try {
        loader.load();
      } catch (e) {
        const err = e as ConfigError;
        expect(err.errors.some((msg) => msg.includes('file does not exist'))).toBe(true);
      }
    });

    it('should treat empty string env vars as missing', () => {
      process.env.SHEET_ID = '';
      process.env.WORKSHEET_NAME = '   ';
      process.env.GOOGLE_CREDENTIALS_PATH = '';
      process.env.BUFFER_ACCESS_TOKEN = '';
      process.env.BUFFER_TIKTOK_PROFILE_ID = '';
      const loader = new ConfigLoader(configFilePath);
      expect(() => loader.load()).toThrow(ConfigError);
    });
  });

  describe('defaults', () => {
    it('should default pollingIntervalSeconds to 60 when not provided', () => {
      setAllEnvVars();
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();
      expect(config.pollingIntervalSeconds).toBe(60);
    });

    it('should default healthCheckPort to 3000 when not provided', () => {
      setAllEnvVars();
      const loader = new ConfigLoader(configFilePath);
      const config = loader.load();
      expect(config.healthCheckPort).toBe(3000);
    });
  });

  describe('ConfigError', () => {
    it('should contain all error messages', () => {
      const errors = ['error 1', 'error 2', 'error 3'];
      const err = new ConfigError(errors);
      expect(err.errors).toEqual(errors);
      expect(err.name).toBe('ConfigError');
      expect(err.message).toContain('error 1');
      expect(err.message).toContain('error 2');
      expect(err.message).toContain('error 3');
    });

    it('should be an instance of Error', () => {
      const err = new ConfigError(['test']);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
