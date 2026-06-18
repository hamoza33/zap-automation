// Feature: sheet-to-tiktok-automation, Property 6: Environment variable precedence
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigLoader } from './config-loader.js';

/**
 * Property 6: Environment variable precedence
 *
 * For any configuration key and any two distinct values A and B, if value A is set
 * in the environment variable and value B is set in the config file, the ConfigLoader
 * SHALL use value A.
 *
 * **Validates: Requirements 4.9**
 */
describe('Property 6: Environment variable precedence', () => {
  let tempDir: string;
  let credentialsPath: string;
  let configFilePath: string;
  const originalEnv = { ...process.env };

  // Env var name → config file key → AppConfig property
  const STRING_FIELDS = [
    { envKey: 'SHEET_ID', fileKey: 'sheetId', configProp: 'googleSheetId' },
    { envKey: 'WORKSHEET_NAME', fileKey: 'worksheetName', configProp: 'worksheetName' },
    { envKey: 'BUFFER_ACCESS_TOKEN', fileKey: 'bufferAccessToken', configProp: 'bufferAccessToken' },
    { envKey: 'BUFFER_TIKTOK_PROFILE_ID', fileKey: 'bufferTikTokProfileId', configProp: 'bufferTikTokProfileId' },
  ] as const;

  beforeEach(() => {
    tempDir = join(tmpdir(), `config-precedence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    // Create a dummy credentials file so validation passes
    credentialsPath = join(tempDir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({ type: 'service_account' }));

    configFilePath = join(tempDir, 'config.json');

    // Clean all config env vars
    delete process.env.SHEET_ID;
    delete process.env.WORKSHEET_NAME;
    delete process.env.GOOGLE_CREDENTIALS_PATH;
    delete process.env.BUFFER_ACCESS_TOKEN;
    delete process.env.BUFFER_TIKTOK_PROFILE_ID;
    delete process.env.POLLING_INTERVAL_SECONDS;
    delete process.env.HEALTH_CHECK_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // Generator for non-empty strings without whitespace-only values
  const nonEmptyStringArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  it('env var value always wins over config file value for string fields', () => {
    fc.assert(
      fc.property(
        // Generate two distinct non-empty strings for each string field
        fc.record({
          sheetIdEnv: nonEmptyStringArb,
          sheetIdFile: nonEmptyStringArb,
          worksheetNameEnv: nonEmptyStringArb,
          worksheetNameFile: nonEmptyStringArb,
          bufferAccessTokenEnv: nonEmptyStringArb,
          bufferAccessTokenFile: nonEmptyStringArb,
          bufferTikTokProfileIdEnv: nonEmptyStringArb,
          bufferTikTokProfileIdFile: nonEmptyStringArb,
        }),
        (values) => {
          // Set env vars with one set of values
          process.env.SHEET_ID = values.sheetIdEnv;
          process.env.WORKSHEET_NAME = values.worksheetNameEnv;
          process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
          process.env.BUFFER_ACCESS_TOKEN = values.bufferAccessTokenEnv;
          process.env.BUFFER_TIKTOK_PROFILE_ID = values.bufferTikTokProfileIdEnv;

          // Write config file with different set of values
          const configFileContent = {
            sheetId: values.sheetIdFile,
            worksheetName: values.worksheetNameFile,
            googleCredentialsPath: '/some/other/path.json',
            bufferAccessToken: values.bufferAccessTokenFile,
            bufferTikTokProfileId: values.bufferTikTokProfileIdFile,
            pollingIntervalSeconds: 60,
            healthCheckPort: 3000,
          };
          writeFileSync(configFilePath, JSON.stringify(configFileContent));

          const loader = new ConfigLoader(configFilePath);
          const config = loader.load();

          // Verify env var values always win
          expect(config.googleSheetId).toBe(values.sheetIdEnv);
          expect(config.worksheetName).toBe(values.worksheetNameEnv);
          expect(config.bufferAccessToken).toBe(values.bufferAccessTokenEnv);
          expect(config.bufferTikTokProfileId).toBe(values.bufferTikTokProfileIdEnv);
          // Credentials path from env should also win
          expect(config.googleCredentialsPath).toBe(credentialsPath);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('env var value wins over config file value for numeric fields (pollingIntervalSeconds)', () => {
    // Valid polling interval range: 10-300
    const pollingIntervalArb = fc.integer({ min: 10, max: 300 });

    fc.assert(
      fc.property(
        pollingIntervalArb,
        pollingIntervalArb,
        (envValue, fileValue) => {
          // Set all required env vars
          process.env.SHEET_ID = 'test-sheet';
          process.env.WORKSHEET_NAME = 'Sheet1';
          process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
          process.env.BUFFER_ACCESS_TOKEN = 'token';
          process.env.BUFFER_TIKTOK_PROFILE_ID = 'profile';
          process.env.POLLING_INTERVAL_SECONDS = String(envValue);

          // Write config file with different polling interval
          const configFileContent = {
            sheetId: 'file-sheet',
            worksheetName: 'FileSheet',
            googleCredentialsPath: '/other/path.json',
            bufferAccessToken: 'file-token',
            bufferTikTokProfileId: 'file-profile',
            pollingIntervalSeconds: fileValue,
            healthCheckPort: 3000,
          };
          writeFileSync(configFilePath, JSON.stringify(configFileContent));

          const loader = new ConfigLoader(configFilePath);
          const config = loader.load();

          // Env var value should win
          expect(config.pollingIntervalSeconds).toBe(envValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('env var value wins over config file value for healthCheckPort', () => {
    const portArb = fc.integer({ min: 1, max: 65535 });

    fc.assert(
      fc.property(
        portArb,
        portArb,
        (envPort, filePort) => {
          // Set all required env vars
          process.env.SHEET_ID = 'test-sheet';
          process.env.WORKSHEET_NAME = 'Sheet1';
          process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
          process.env.BUFFER_ACCESS_TOKEN = 'token';
          process.env.BUFFER_TIKTOK_PROFILE_ID = 'profile';
          process.env.HEALTH_CHECK_PORT = String(envPort);

          // Write config file with different port
          const configFileContent = {
            sheetId: 'file-sheet',
            worksheetName: 'FileSheet',
            googleCredentialsPath: '/other/path.json',
            bufferAccessToken: 'file-token',
            bufferTikTokProfileId: 'file-profile',
            pollingIntervalSeconds: 60,
            healthCheckPort: filePort,
          };
          writeFileSync(configFilePath, JSON.stringify(configFileContent));

          const loader = new ConfigLoader(configFilePath);
          const config = loader.load();

          // Env var value should win
          expect(config.healthCheckPort).toBe(envPort);
        }
      ),
      { numRuns: 100 }
    );
  });
});
