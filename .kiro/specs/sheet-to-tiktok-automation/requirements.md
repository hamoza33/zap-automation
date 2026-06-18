# Requirements Document

## Introduction

A web-based automation tool deployed on a VPS that monitors a Google Sheet for new rows and automatically schedules TikTok video posts via Buffer. The tool acts as a simplified, self-hosted Zapier alternative focused on a single workflow: detecting new spreadsheet entries containing video content details and triggering immediate post scheduling through Buffer's API.

## Glossary

- **Automation_Service**: The main application running on the VPS that orchestrates the polling, data extraction, and post scheduling workflow
- **Sheet_Poller**: The component responsible for periodically checking the Google Sheet for new rows
- **Google_Sheet**: The specific Google Sheets spreadsheet identified by a Sheet ID and worksheet name that serves as the data source
- **Row**: A single entry in the Google Sheet containing video post details (text caption and video URL)
- **Buffer_Publisher**: The component responsible for communicating with Buffer's API to schedule TikTok posts
- **Buffer**: The social media scheduling platform used as an intermediary to publish videos to TikTok
- **Video_URL**: A publicly accessible URL pointing to the video file to be posted
- **Caption_Text**: The text content accompanying the TikTok video post
- **Processed_Marker**: An indicator stored in the sheet or locally that tracks which rows have already been processed

## Requirements

### Requirement 1: Google Sheet Polling

**User Story:** As a content creator, I want the tool to automatically detect new rows in my Google Sheet, so that I don't have to manually trigger each post.

#### Acceptance Criteria

1. WHEN the Automation_Service starts, THE Sheet_Poller SHALL authenticate with Google Sheets API using provided service account credentials within 30 seconds
2. IF authentication with Google Sheets API fails at startup, THEN THE Sheet_Poller SHALL log the authentication error and terminate the Automation_Service with a non-zero exit code
3. WHILE the Automation_Service is running, THE Sheet_Poller SHALL poll the configured Google_Sheet at a configurable interval between 10 and 300 seconds (default: 60 seconds)
4. WHEN the Sheet_Poller detects one or more rows without a Processed_Marker, THE Sheet_Poller SHALL extract the Caption_Text and Video_URL from each such Row in top-to-bottom row order
5. WHEN the Caption_Text and Video_URL have been successfully read from a Row without an API error, THE Sheet_Poller SHALL mark the Row with a Processed_Marker to prevent duplicate processing; IF writing the Processed_Marker fails, THEN THE Sheet_Poller SHALL skip processing that Row's content even though extraction succeeded, so that the next polling cycle can re-attempt both extraction and marking
6. IF writing the Processed_Marker to a Row fails, THEN THE Sheet_Poller SHALL log the error with the row number and skip that Row without processing it, so that the next polling cycle can re-attempt it
7. THE Sheet_Poller SHALL only mark a Row as processed WHEN both data extraction and Processed_Marker writing succeed; IF the Google Sheets API becomes unavailable between reading data and writing the marker, THEN the Row SHALL NOT be marked as processed
8. IF the Google Sheets API is unreachable during a polling cycle, THEN THE Sheet_Poller SHALL log the error and retry on the next polling cycle without crashing

### Requirement 2: Row Validation

**User Story:** As a content creator, I want the tool to validate row data before posting, so that malformed entries don't cause failed posts or errors.

#### Acceptance Criteria

1. WHEN the Sheet_Poller extracts a Row, THE Automation_Service SHALL validate that the Caption_Text field contains at least one non-whitespace character and does not exceed 4000 characters in length
2. WHEN the Sheet_Poller extracts a Row, THE Automation_Service SHALL validate that the Video_URL field is non-empty and begins with "http://" or "https://" followed by a valid domain name
3. IF a Row fails validation, THEN THE Automation_Service SHALL log the validation error with the row number and the specific field that failed, and skip the Row without halting processing of subsequent rows; IF the logging system is unavailable when recording a validation failure, THEN THE Automation_Service SHALL halt all processing until logging is restored
4. IF a Row fails validation, THEN THE Automation_Service SHALL mark the Row with an error status in the Processed_Marker column
5. IF a Row contains multiple validation failures, THEN THE Automation_Service SHALL report all validation failures for that Row in a single log entry

### Requirement 3: Buffer Post Scheduling

**User Story:** As a content creator, I want new sheet entries to be immediately scheduled as TikTok posts via Buffer, so that my content goes live without manual intervention.

#### Acceptance Criteria

1. WHEN a validated Row is ready for publishing, THE Buffer_Publisher SHALL send the Caption_Text and Video_URL to Buffer's API targeting the configured TikTok profile with the "publish now" scheduling option (no future date)
2. WHEN sending a request to Buffer's API, THE Buffer_Publisher SHALL enforce a response timeout of 30 seconds, after which the request SHALL be treated as a failed attempt
3. WHEN Buffer's API confirms successful scheduling, THE Buffer_Publisher SHALL update the Processed_Marker for the Row with a success status
4. IF Buffer's API returns an error or the request times out, THEN THE Buffer_Publisher SHALL retry the request up to 3 times with a 5-second delay between attempts before marking the Row as failed
5. IF all retry attempts for a Row are exhausted, THEN THE Buffer_Publisher SHALL log the error details including the row number, the number of attempts made, and Buffer's last error response
6. IF all retry attempts for a Row are exhausted, THEN THE Buffer_Publisher SHALL mark the Row with a failure status in the Processed_Marker column

### Requirement 4: Configuration Management

**User Story:** As a user deploying this tool on my VPS, I want to configure credentials and sheet details through environment variables or a config file, so that I can set up the tool without modifying code.

#### Acceptance Criteria

1. THE Automation_Service SHALL read the Google Sheet ID from environment variables or a config file at startup
2. THE Automation_Service SHALL read the worksheet name from environment variables or a config file at startup
3. THE Automation_Service SHALL read Google service account credentials as a file path reference from environment variables or a config file at startup
4. THE Automation_Service SHALL read the Buffer API access token from environment variables or a config file at startup
5. THE Automation_Service SHALL read the Buffer TikTok profile ID from environment variables or a config file at startup
6. THE Automation_Service SHALL read the polling interval (in seconds, minimum 10, default 60) from environment variables or a config file at startup
7. IF any required configuration value is missing, THEN THE Automation_Service SHALL exit with a non-zero exit code and an error message indicating which configuration value is absent; THE system SHALL always produce both the error exit code and the error message together
8. IF a configuration value is present but malformed (e.g., non-numeric polling interval, inaccessible credentials file path, empty string), THEN THE Automation_Service SHALL exit with a non-zero exit code and an error message indicating which configuration value is invalid and why
9. IF a configuration value is specified in both an environment variable and the config file, THEN THE Automation_Service SHALL use the environment variable value as the override; IF a configuration value exists only in the config file and not in environment variables, THEN THE Automation_Service SHALL use the config file value

### Requirement 5: Deployment and Operation

**User Story:** As a user running this on a VPS, I want the tool to run reliably as a background service, so that it continues operating without manual supervision.

#### Acceptance Criteria

1. THE Automation_Service SHALL provide an HTTP health check endpoint on a configurable port that returns the current service state (one of: "healthy", "degraded", "unhealthy") and the ISO 8601 timestamp of the last successful poll
2. WHILE the Automation_Service is running, THE Automation_Service SHALL log all polling attempts, successful posts, and errors with ISO 8601 timestamps and a severity level (INFO, WARN, ERROR)
3. IF an unhandled exception occurs, THEN THE Automation_Service SHALL log the error, wait 5 seconds, and restart the polling loop without terminating the process
4. IF 5 consecutive unhandled exceptions occur within 60 seconds, THEN THE Automation_Service SHALL log a critical error and cease polling until the next health check request or manual restart
5. THE Automation_Service SHALL be deployable via Docker with a provided Dockerfile and docker-compose configuration that exposes the health check port

### Requirement 6: Duplicate Prevention

**User Story:** As a content creator, I want the tool to never post the same row twice, so that I don't get duplicate TikTok posts.

#### Acceptance Criteria

1. THE Automation_Service SHALL maintain a record of processed row identifiers to prevent reprocessing across service restarts, using the Processed_Marker column in the Google_Sheet as the authoritative source of processing state
2. WHEN the Sheet_Poller encounters a Row that already has a success Processed_Marker, THE Sheet_Poller SHALL skip that Row without reprocessing
3. IF the Automation_Service restarts, THEN THE Sheet_Poller SHALL resume processing only rows whose Processed_Marker column is empty, treating all rows with a success status as already completed
4. IF the Buffer_Publisher successfully schedules a post but the subsequent Processed_Marker write to the Google_Sheet fails, THEN THE Automation_Service SHALL retry writing the Processed_Marker up to 3 attempts before logging the row number as requiring manual review
5. WHEN the Sheet_Poller encounters a Row with a failure Processed_Marker, THE Sheet_Poller SHALL skip that Row and not attempt reprocessing automatically
