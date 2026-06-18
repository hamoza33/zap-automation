# Sheet-to-TikTok Automation

A self-hosted automation service that monitors a Google Sheet for new rows and schedules TikTok video posts via Buffer. Runs as a long-lived Node.js process (containerized via Docker) on your VPS — a single-purpose Zapier alternative for the workflow: **Google Sheet → Validation → Buffer → TikTok**.

## Prerequisites

- **Node.js 20+** (for local development)
- **Docker & Docker Compose** (for deployment)
- **Google Cloud service account** with Sheets API enabled
- **Buffer account** with a connected TikTok profile

## Google Sheet Setup

Create a Google Sheet with the following column structure:

| Column A | Column B | Column C |
|----------|----------|----------|
| Caption Text | Video URL | Status |

- **Column A (Caption Text)** — The text caption for the TikTok post (max 4000 characters)
- **Column B (Video URL)** — A publicly accessible URL to the video file
- **Column C (Status)** — Left empty for new rows. The service writes processing status here: `success`, `error:<reason>`, or `failed:<reason>`

Leave Column C empty for rows you want processed. The service will fill it in automatically.

## Google Service Account Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Sheets API**:
   - Navigate to APIs & Services → Library
   - Search for "Google Sheets API" and click Enable
4. Create a service account:
   - Navigate to APIs & Services → Credentials
   - Click "Create Credentials" → "Service Account"
   - Give it a name and click through the wizard
5. Create a JSON key for the service account:
   - Click on the service account in the credentials list
   - Go to the "Keys" tab
   - Click "Add Key" → "Create new key" → JSON
   - Save the downloaded JSON file to `./credentials/service-account.json`
6. Share your Google Sheet with the service account:
   - Copy the service account email (looks like `name@project.iam.gserviceaccount.com`)
   - Open your Google Sheet → Share → paste the email → give Editor access

## Buffer API Setup

1. Log in to your [Buffer](https://buffer.com/) account
2. Get your access token:
   - Go to [Buffer Developer Portal](https://buffer.com/developers/api)
   - Create or retrieve your API access token
3. Find your TikTok profile ID:
   - Use the Buffer API to list your profiles: `GET https://api.buffer.com/profiles`
   - Find the profile entry for your TikTok channel
   - Copy the `id` field — this is your `BUFFER_TIKTOK_PROFILE_ID`

## Configuration

The service reads configuration from environment variables and/or a `config.json` file. **Environment variables take precedence** over config file values.

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SHEET_ID` | Google Sheet ID (from the sheet URL) | Yes | — |
| `WORKSHEET_NAME` | Name of the worksheet tab to monitor | Yes | — |
| `GOOGLE_CREDENTIALS_PATH` | Path to service account JSON key file | Yes | — |
| `BUFFER_ACCESS_TOKEN` | Buffer API access token | Yes | — |
| `BUFFER_TIKTOK_PROFILE_ID` | Buffer TikTok channel/profile ID | Yes | — |
| `POLLING_INTERVAL_SECONDS` | How often to check for new rows (10–300) | No | `60` |
| `HEALTH_CHECK_PORT` | Port for the health check HTTP endpoint | No | `3000` |

### Config File

Alternatively, create a `config.json` in the project root (see `config.example.json`):

```json
{
  "sheetId": "your-google-sheet-id-here",
  "worksheetName": "Sheet1",
  "googleCredentialsPath": "./credentials/service-account.json",
  "bufferAccessToken": "your-buffer-access-token",
  "bufferTikTokProfileId": "your-buffer-tiktok-profile-id",
  "pollingIntervalSeconds": 60,
  "healthCheckPort": 3000
}
```

### Precedence

If a value is defined in both the environment variable and the config file, the environment variable wins. If a value is only in the config file, that value is used. If a required value is missing from both, the service exits with an error message naming the missing key.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy the example configuration:

```bash
cp config.example.json config.json
cp .env.example .env
```

3. Edit `config.json` or `.env` with your actual credentials and sheet ID.

4. Place your Google service account JSON key at the path specified in `GOOGLE_CREDENTIALS_PATH` (default: `./credentials/service-account.json`).

5. Run in development mode:

```bash
npm run dev
```

6. Run tests:

```bash
npm test
```

7. Build for production:

```bash
npm run build
npm start
```

## Docker Deployment

1. Copy and configure environment:

```bash
cp .env.example .env
# Edit .env with your actual values
```

2. Place your Google service account credentials at `./credentials/service-account.json`.

3. Start the service:

```bash
docker-compose up -d
```

4. Check logs:

```bash
docker-compose logs -f
```

5. Stop the service:

```bash
docker-compose down
```

The Docker setup mounts the `./credentials` directory as a volume so the container can access your service account key file.

## Health Check Endpoint

The service exposes an HTTP health check at:

```
GET http://localhost:<HEALTH_CHECK_PORT>/health
```

Response format:

```json
{
  "status": "healthy",
  "lastSuccessfulPoll": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "consecutiveErrors": 0
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `healthy` | Last poll succeeded, no consecutive errors |
| `degraded` | 1–4 consecutive errors within 60 seconds |
| `unhealthy` | 5+ consecutive errors within 60 seconds (polling has ceased) |

When the status is `unhealthy`, the service has stopped polling and requires a manual restart or external orchestrator intervention.

## Project Structure

```
.
├── src/
│   ├── config/             # Configuration loading and validation
│   │   └── config-loader.ts
│   ├── health/             # HTTP health check server
│   │   └── health-check-server.ts
│   ├── logger/             # Structured JSON logger
│   │   └── logger.ts
│   ├── poller/             # Google Sheets polling and marker writing
│   │   └── sheet-poller.ts
│   ├── publisher/          # Buffer GraphQL API client
│   │   └── buffer-publisher.ts
│   ├── service/            # Main orchestrator with polling loop
│   │   └── automation-service.ts
│   ├── validator/          # Row data validation
│   │   └── row-validator.ts
│   ├── index.ts            # Application entry point
│   └── types.ts            # Shared interfaces and type definitions
├── credentials/            # Service account key (not committed)
├── config.json             # Local configuration (not committed)
├── config.example.json     # Example configuration template
├── .env.example            # Example environment variables
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # Docker Compose deployment config
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Test runner configuration
└── package.json            # Project metadata and dependencies
```

## License

MIT
