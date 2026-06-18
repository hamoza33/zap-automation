# Implementation Plan: Sheet-to-TikTok Automation

## Overview

This plan implements a Node.js/TypeScript automation service deployed on a VPS that monitors a Google Sheet for new rows and schedules TikTok video posts via Buffer's GraphQL API. The architecture is modular: ConfigLoader → SheetPoller → RowValidator → BufferPublisher → HealthCheckServer, orchestrated by an AutomationService class with a polling loop, error recovery, and health monitoring.

## Tasks

- [x] 1. Set up project structure, dependencies, and core types
  - [x] 1.1 Initialize Node.js project with TypeScript configuration
    - Create `package.json` with project metadata, scripts (`build`, `start`, `test`, `dev`)
    - Install runtime dependencies: `google-spreadsheet`, `google-auth-library`, `graphql-request`, `express`
    - Install dev dependencies: `typescript`, `vitest`, `fast-check`, `@types/express`, `@types/node`, `tsx`
    - Create `tsconfig.json` with strict mode, ES2020 target, NodeNext module resolution, `dist/` output directory
    - Create directory structure: `src/config/`, `src/poller/`, `src/validator/`, `src/publisher/`, `src/health/`, `src/logger/`, `src/service/`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.5_

  - [x] 1.2 Define core interfaces and type definitions
    - Create `src/types.ts` with all shared interfaces: `AppConfig`, `SheetRow`, `ValidationError`, `ValidationResult`, `PublishResult`, `HealthStatus`, `LogLevel`
    - Define component interfaces: `IConfigLoader`, `ISheetPoller`, `IRowValidator`, `IBufferPublisher`, `IHealthCheckServer`, `ILogger`
    - _Requirements: 1.4, 2.1, 2.2, 3.1, 4.1, 5.1_

- [x] 2. Implement Logger module
  - [x] 2.1 Create structured JSON logger
    - Implement `src/logger/logger.ts` with `info`, `warn`, `error`, `critical` methods
    - Each log entry outputs structured JSON to stdout: `{ timestamp, level, message, context? }`
    - Timestamps must be valid ISO 8601 format
    - Severity levels: INFO, WARN, ERROR, CRITICAL
    - Context objects include optional metadata (row numbers, error details, attempt counts)
    - _Requirements: 5.2_

  - [x] 2.2 Write property test for log format invariant
    - **Property 7: Log format invariant**
    - Generate random log events with random messages and context objects; verify every output contains a valid ISO 8601 timestamp and severity in {INFO, WARN, ERROR, CRITICAL}
    - **Validates: Requirements 5.2**

- [x] 3. Implement ConfigLoader module
  - [x] 3.1 Create configuration loader with env var and config file support
    - Implement `src/config/config-loader.ts`
    - Read from environment variables: `SHEET_ID`, `WORKSHEET_NAME`, `GOOGLE_CREDENTIALS_PATH`, `BUFFER_ACCESS_TOKEN`, `BUFFER_TIKTOK_PROFILE_ID`, `POLLING_INTERVAL_SECONDS`, `HEALTH_CHECK_PORT`
    - Fall back to `config.json` file when env vars are not set
    - Environment variables always override config file values when both exist
    - Validate all required fields are present and non-empty strings
    - Validate `pollingIntervalSeconds` is numeric and within 10-300 range (default 60)
    - Validate `healthCheckPort` is numeric (default 3000)
    - Validate credentials file path exists on disk
    - Exit with non-zero code and descriptive error naming each invalid/missing key on failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 3.2 Write property test for configuration validation
    - **Property 5: Configuration validation detects invalid values**
    - Generate random config objects with missing keys, non-numeric polling intervals, out-of-range values, empty strings; verify error messages name each invalid/missing key
    - **Validates: Requirements 4.6, 4.7, 4.8**

  - [x] 3.3 Write property test for environment variable precedence
    - **Property 6: Environment variable precedence**
    - Generate random key-value pairs for both env var and config file sources; verify env var value always wins when both are set
    - **Validates: Requirements 4.9**

- [x] 4. Implement RowValidator module
  - [x] 4.1 Create row validation logic
    - Implement `src/validator/row-validator.ts`
    - Validate `captionText`: must contain at least one non-whitespace character, must not exceed 4000 characters
    - Validate `videoUrl`: must be non-empty, must start with `http://` or `https://`, must be followed by a valid domain (contains at least one dot, no spaces)
    - Return all validation errors for a row in a single `ValidationResult` object (aggregated, not short-circuiting)
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 4.2 Write property test for caption text validation
    - **Property 2: Caption text validation**
    - Generate random strings (empty, all-whitespace, valid short, exactly 4000 chars, 4001+ chars); verify accept/reject matches the rule: at least one non-whitespace AND length ≤ 4000
    - **Validates: Requirements 2.1**

  - [x] 4.3 Write property test for video URL validation
    - **Property 3: Video URL validation**
    - Generate random strings, valid URLs with http/https and dots in domain, malformed URLs without protocol or dots, URLs with spaces; verify accept/reject matches the rule
    - **Validates: Requirements 2.2**

  - [x] 4.4 Write property test for validation error aggregation
    - **Property 4: Validation errors are fully reported**
    - Generate rows with 0, 1, or 2 invalid fields; verify all errors are collected in a single result and the validator does not halt on the first error
    - **Validates: Requirements 2.3, 2.5**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement SheetPoller module
  - [x] 6.1 Create Google Sheets authentication and row fetching
    - Implement `src/poller/sheet-poller.ts`
    - Authenticate using Google service account credentials via `google-auth-library`
    - Use `google-spreadsheet` package to access the configured worksheet by sheet ID and worksheet name
    - Read all rows and extract Column A (Caption Text), Column B (Video URL), Column C (Status)
    - Filter rows to only those with an empty Processed_Marker column (Column C)
    - Return filtered rows in ascending row number order as `SheetRow[]`
    - _Requirements: 1.1, 1.3, 1.4, 6.1, 6.2, 6.3_

  - [x] 6.2 Implement Processed_Marker writing logic
    - Add `markRowProcessed` method to write status values to Column C: `success`, `error:<reason>`, `failed:<reason>`
    - Write a "processing" marker before handing off to Buffer (optimistic lock)
    - If marker write fails before publishing, skip the row and log the error
    - After Buffer response, update marker to final status (success or failed)
    - Implement retry logic (up to 3 attempts) for post-Buffer marker writes that fail
    - Log row number as requiring manual review if all marker write retries are exhausted
    - _Requirements: 1.5, 1.6, 1.7, 2.4, 3.3, 3.6, 6.4_

  - [x] 6.3 Write property test for unprocessed row filtering and ordering
    - **Property 1: Unprocessed row filtering and ordering**
    - Generate random sheet states (10-100 rows) with random marker values (empty, "success", "error:...", "failed:..."); verify filter returns only empty-marker rows in ascending row order
    - **Validates: Requirements 1.4, 6.1, 6.2, 6.3, 6.5**

- [x] 7. Implement BufferPublisher module
  - [x] 7.1 Create Buffer GraphQL API client
    - Implement `src/publisher/buffer-publisher.ts`
    - Send `createPost` GraphQL mutation to `https://api.buffer.com` with Bearer token authentication
    - Set `channelId` to the configured TikTok profile ID
    - Set `mode: addToQueue` with `schedulingType: automatic` for immediate publishing
    - Pass the video URL in assets array as `[{ video: { url } }]`
    - Pass Caption_Text as the `text` field
    - Enforce 30-second request timeout using AbortController
    - Implement retry logic: up to 3 retries with 5-second delay on failure or timeout
    - Return `PublishResult` with success flag, post ID, error message, and attempt count
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 7.2 Write unit tests for Buffer retry logic
    - Test successful post on first attempt returns success with postId and attempts=1
    - Test retry after timeout (verify 3 retries with 5s delay between each)
    - Test all retries exhausted returns failure result with attempts=3 and last error message
    - Test 30-second timeout triggers failure treatment
    - _Requirements: 3.2, 3.4, 3.5_

- [x] 8. Implement HealthCheckServer module
  - [x] 8.1 Create HTTP health check endpoint
    - Implement `src/health/health-check-server.ts` using Express
    - Expose `GET /health` endpoint on configurable port (default 3000)
    - Return JSON response: `{ status, lastSuccessfulPoll, uptime, consecutiveErrors }`
    - Status logic: `healthy` (no consecutive errors), `degraded` (1-4 consecutive errors in 60s), `unhealthy` (5+ consecutive errors in 60s)
    - Provide methods: `updateLastPoll(timestamp)`, `updateStatus(status)`, `start(port)`, `stop()`
    - _Requirements: 5.1_

  - [x] 8.2 Write unit tests for health status transitions
    - Test healthy state returns correct JSON when no errors recorded
    - Test degraded state with 1-4 consecutive errors within 60 seconds
    - Test unhealthy state with 5+ consecutive errors within 60 seconds
    - Verify JSON response format includes status, lastSuccessfulPoll (ISO 8601 or null), uptime, consecutiveErrors
    - _Requirements: 5.1_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement AutomationService orchestrator
  - [x] 10.1 Create main orchestration class with polling loop
    - Implement `src/service/automation-service.ts`
    - Wire all components together: ConfigLoader, SheetPoller, RowValidator, BufferPublisher, HealthCheckServer, Logger
    - Implement polling loop using `setInterval` or recursive setTimeout at the configured interval
    - For each polling cycle: fetch unprocessed rows → for each row in order: validate → if invalid, mark error and log → if valid, write processing marker → if marker fails, skip → publish to Buffer → write final marker (success/failed)
    - Update health check with last successful poll timestamp after each successful cycle
    - Log all polling attempts, successful posts, and errors with appropriate severity
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.3, 2.4, 2.5, 3.1, 5.2_

  - [x] 10.2 Implement error recovery and circuit breaker
    - Catch unhandled exceptions in the polling loop: log error, wait 5 seconds, restart loop
    - Track consecutive errors within a 60-second sliding window
    - After 5 consecutive unhandled exceptions within 60 seconds, log CRITICAL and cease polling
    - Set health status to "unhealthy" when circuit breaker triggers
    - Require manual restart or external orchestrator intervention to resume
    - _Requirements: 5.3, 5.4_

  - [x] 10.3 Implement graceful shutdown handling
    - Register handlers for SIGTERM and SIGINT signals
    - On signal: stop polling loop, close health check server, allow in-flight requests to complete, then exit cleanly
    - _Requirements: 5.1_

  - [x] 10.4 Write unit tests for circuit breaker behavior
    - Test single unhandled exception triggers 5-second wait then polling resumes
    - Test 5 consecutive exceptions in 60 seconds triggers polling cessation
    - Test health status transitions to "unhealthy" when circuit breaker activates
    - Test exceptions spaced more than 60 seconds apart do not trigger circuit breaker
    - _Requirements: 5.3, 5.4_

- [x] 11. Create application entry point and Docker configuration
  - [x] 11.1 Create application entry point
    - Implement `src/index.ts` as the main entry point
    - Instantiate ConfigLoader, load config, then instantiate and start AutomationService
    - Handle top-level startup errors: log descriptive message and exit with non-zero code
    - _Requirements: 4.7, 4.8_

  - [x] 11.2 Create Dockerfile and docker-compose configuration
    - Create `Dockerfile` with multi-stage build: build stage (install deps, compile TS) + runtime stage (copy dist, run node)
    - Use Node.js 20 LTS base image
    - Create `docker-compose.yml` exposing health check port, mounting credentials volume, passing env vars
    - Create `.dockerignore` excluding node_modules, .git, tests, and source maps
    - _Requirements: 5.5_

  - [x] 11.3 Create example configuration and documentation
    - Create `config.example.json` with placeholder values for all configuration keys
    - Create `.env.example` with all environment variable keys and descriptions
    - Create `README.md` with setup instructions, configuration reference, Google service account setup guide, and deployment steps
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at reasonable intervals
- Property tests validate universal correctness properties defined in the design document using fast-check
- Unit tests validate specific examples, edge cases, and integration behavior
- The implementation uses TypeScript throughout as specified in the design
- Docker deployment is addressed last since it wraps the completed application
- The test runner is vitest with fast-check for property-based testing (100 iterations per property)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["6.1", "7.1", "8.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.2", "8.2"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["10.2", "10.3"] },
    { "id": 8, "tasks": ["10.4", "11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3"] }
  ]
}
```
