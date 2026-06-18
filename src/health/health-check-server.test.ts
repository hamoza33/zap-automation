import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthCheckServer } from './health-check-server.js';

describe('HealthCheckServer', () => {
  let server: HealthCheckServer;
  const TEST_PORT = 0; // Use port 0 for random available port

  function getServerAddress(srv: HealthCheckServer): string {
    // Access the underlying HTTP server to get the assigned port
    const httpServer = (srv as any).server;
    const address = httpServer.address();
    return `http://127.0.0.1:${address.port}`;
  }

  beforeEach(() => {
    server = new HealthCheckServer();
    server.start(TEST_PORT);
  });

  afterEach(() => {
    server.stop();
  });

  it('returns healthy state with lastSuccessfulPoll=null and consecutiveErrors=0 for a fresh server', async () => {
    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.lastSuccessfulPoll).toBeNull();
    expect(body.consecutiveErrors).toBe(0);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns ISO 8601 timestamp in lastSuccessfulPoll after updateLastPoll is called', async () => {
    const pollTime = new Date('2024-06-15T10:30:00.000Z');
    server.updateLastPoll(pollTime);

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.lastSuccessfulPoll).toBe('2024-06-15T10:30:00.000Z');
    // Verify it's a valid ISO 8601 string
    expect(new Date(body.lastSuccessfulPoll).toISOString()).toBe(body.lastSuccessfulPoll);
  });

  it('returns degraded status after 1 consecutive error', async () => {
    server.recordError();

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.status).toBe('degraded');
    expect(body.consecutiveErrors).toBe(1);
  });

  it('returns degraded status after 4 consecutive errors within 60 seconds', async () => {
    server.recordError();
    server.recordError();
    server.recordError();
    server.recordError();

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.status).toBe('degraded');
    expect(body.consecutiveErrors).toBe(4);
  });

  it('returns unhealthy status after 5 consecutive errors within 60 seconds', async () => {
    server.recordError();
    server.recordError();
    server.recordError();
    server.recordError();
    server.recordError();

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.status).toBe('unhealthy');
    expect(body.consecutiveErrors).toBe(5);
  });

  it('returns unhealthy status after more than 5 consecutive errors within 60 seconds', async () => {
    for (let i = 0; i < 7; i++) {
      server.recordError();
    }

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.status).toBe('unhealthy');
    expect(body.consecutiveErrors).toBe(7);
  });

  it('returns healthy status after resetErrors is called', async () => {
    // First bring it to degraded
    server.recordError();
    server.recordError();
    server.recordError();

    // Then reset
    server.resetErrors();

    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    expect(body.status).toBe('healthy');
    expect(body.consecutiveErrors).toBe(0);
  });

  it('response JSON includes all required fields with correct types', async () => {
    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    // Verify all required fields are present
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('lastSuccessfulPoll');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('consecutiveErrors');

    // Verify types
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body.lastSuccessfulPoll === null || typeof body.lastSuccessfulPoll === 'string').toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.consecutiveErrors).toBe('number');
  });

  it('returns Content-Type application/json', async () => {
    const baseUrl = getServerAddress(server);
    const response = await fetch(`${baseUrl}/health`);

    expect(response.headers.get('content-type')).toMatch(/application\/json/);
  });
});
