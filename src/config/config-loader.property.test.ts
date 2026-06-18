// Feature: sheet-to-tiktok-automation, Property 5: Configuration validation detects invalid values
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import fc from 'fast-check';
import { ConfigLoader, ConfigError } from './config-loader.js';

/**
 * Property 5: Configuration validation detects invalid values
 *
 * For any configuration state where one or more required values are missing or malformed
 * (non-numeric polling interval, polling interval outside 10-300 range, empty strings,
 * inaccessible file paths), the ConfigLoader SHALL reject the configuration and produce
 * an error message that names each invalid or missing key.
 *
 * **Validates: Requirements 4.6, 4.7, 4.8**
 */
describe('Property 5: Configuration validation detects invalid values', () => {
  let tempDir: string;
  let credentialsPath: string;
  let configFilePath: string;
  const originalEnv = { ...process.env };

  const REQUIRED_KEYS = [
    'SHEET_ID',
    'WORKSHEET_NAME',
    'GOOGLE_CREDENTIALS_PATH',
    'BUFFER_ACCESS_TOKEN',
    'BUFFER_TIKTOK_PROFILE_ID',
  ] as const;

  // Map env var names to the config key names used in error messages
  const ENV_TO_CONFIG_KEY: Record<string, string> = {
    SHEET_ID: 'googleSheetId',
    WORKSHEET_NAME: 'worksheetName',
    GOOGLE_CREDENTIALS_PATH: 'googleCredentialsPath',
    BUFFER_ACCESS_TOKEN: 'bufferAccessToken',
    BUFFER_TIKTOK_PROFILE_ID: 'bufferTikTokProfileId',
  };

  beforeEach(() => {
    tempDir = join(tmpdir(), `config-prop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    credentialsPath = join(tempDir, 'credentials.json');
    writeFileSync(credentialsPath, JSON.stringify({ type: 'service_account' }));

    // Use a non-existent config file path so the file doesn't interfere
    configFilePath = join(tempDir, 'nonexistent-config.json');

    // Clear all relevant env vars
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

  function setValidEnvVars() {
    process.env.SHEET_ID = 'valid-sheet-id';
    process.env.WORKSHEET_NAME = 'Sheet1';
    process.env.GOOGLE_CREDENTIALS_PATH = credentialsPath;
    process.env.BUFFER_ACCESS_TOKEN = 'valid-token';
    process.env.BUFFER_TIKTOK_PROFILE_ID = 'valid-profile';
  }

  // Generator: random non-empty subset of required keys to omit
  const omittedKeysArb = fc.subarray([...REQUIRED_KEYS], { minLength: 1 });

  // Generator: whitespace-only strings (treated as missing)
  const whitespaceArb = fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 }).map((chars) => chars.join(''));

  // Generator: non-numeric string for polling interval
  const nonNumericArb = fc.string({ minLength: 1 }).filter((s) => isNaN(Number(s)) || !Number.isFinite(Number(s)));

  // Generator: out-of-range polling interval (below 10 or above 300)
  const outOfRangePollingArb = fc.oneof(
    fc.integer({ min: -1000, max: 9 }),
    fc.integer({ min: 301, max: 10000 })
  );

  it('missing required keys are each named in the error', () => {
    fc.assert(
      fc.property(omittedKeysArb, (omittedKeys) => {
        // Set all valid env vars, then remove the omitted ones
        setValidEnvVars();
        for (const key of omittedKeys) {
          delete process.env[key];
        }

        const loader = new ConfigLoader(configFilePath);

        try {
          loader.load();
          // If credentials file doesn't exist error is the only error, that's still valid
          // but with missing keys we always expect ConfigError
          return false; // Should have thrown
        } catch (e) {
          expect(e).toBeInstanceOf(ConfigError);
          const configErr = e as ConfigError;

          // Each omitted key should be mentioned in at least one error message
          for (const key of omittedKeys) {
            const configKey = ENV_TO_CONFIG_KEY[key];
            const mentioned = configErr.errors.some(
              (msg) => msg.includes(configKey) || msg.includes(key)
            );
            expect(mentioned).toBe(true);
          }
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('whitespace-only strings for required fields are detected as invalid', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_KEYS),
        whitespaceArb,
        (key, whitespace) => {
          setValidEnvVars();
          process.env[key] = whitespace;

          const loader = new ConfigLoader(configFilePath);

          try {
            loader.load();
            // For GOOGLE_CREDENTIALS_PATH, whitespace-only is treated as missing
            return false; // Should have thrown
          } catch (e) {
            expect(e).toBeInstanceOf(ConfigError);
            const configErr = e as ConfigError;
            const configKey = ENV_TO_CONFIG_KEY[key];
            const mentioned = configErr.errors.some(
              (msg) => msg.includes(configKey) || msg.includes(key)
            );
            expect(mentioned).toBe(true);
            return true;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('non-numeric polling interval values produce an error naming pollingIntervalSeconds', () => {
    fc.assert(
      fc.property(nonNumericArb, (invalidValue) => {
        setValidEnvVars();
        process.env.POLLING_INTERVAL_SECONDS = invalidValue;

        const loader = new ConfigLoader(configFilePath);

        try {
          loader.load();
          return false; // Should have thrown
        } catch (e) {
          expect(e).toBeInstanceOf(ConfigError);
          const configErr = e as ConfigError;
          const mentioned = configErr.errors.some(
            (msg) => msg.includes('pollingIntervalSeconds') || msg.includes('POLLING_INTERVAL_SECONDS')
          );
          expect(mentioned).toBe(true);
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('out-of-range polling interval values produce an error naming pollingIntervalSeconds', () => {
    fc.assert(
      fc.property(outOfRangePollingArb, (invalidValue) => {
        setValidEnvVars();
        process.env.POLLING_INTERVAL_SECONDS = String(invalidValue);

        const loader = new ConfigLoader(configFilePath);

        try {
          loader.load();
          return false; // Should have thrown
        } catch (e) {
          expect(e).toBeInstanceOf(ConfigError);
          const configErr = e as ConfigError;
          const mentioned = configErr.errors.some(
            (msg) => msg.includes('pollingIntervalSeconds') || msg.includes('POLLING_INTERVAL_SECONDS')
          );
          expect(mentioned).toBe(true);
          return true;
        }
      }),
      { numRuns: 100 }
    );
  });

  it('multiple invalid config values produce errors naming each invalid key', () => {
    fc.assert(
      fc.property(
        omittedKeysArb,
        fc.boolean(),
        (omittedKeys, addBadPolling) => {
          setValidEnvVars();

          // Remove the omitted required keys
          for (const key of omittedKeys) {
            delete process.env[key];
          }

          // Optionally add a bad polling interval
          if (addBadPolling) {
            process.env.POLLING_INTERVAL_SECONDS = 'not-a-number';
          }

          const loader = new ConfigLoader(configFilePath);

          try {
            loader.load();
            return false; // Should have thrown
          } catch (e) {
            expect(e).toBeInstanceOf(ConfigError);
            const configErr = e as ConfigError;

            // Each omitted key should be mentioned
            for (const key of omittedKeys) {
              const configKey = ENV_TO_CONFIG_KEY[key];
              const mentioned = configErr.errors.some(
                (msg) => msg.includes(configKey) || msg.includes(key)
              );
              expect(mentioned).toBe(true);
            }

            // If bad polling was added, it should also be mentioned
            if (addBadPolling) {
              const pollingMentioned = configErr.errors.some(
                (msg) => msg.includes('pollingIntervalSeconds') || msg.includes('POLLING_INTERVAL_SECONDS')
              );
              expect(pollingMentioned).toBe(true);
            }

            return true;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
