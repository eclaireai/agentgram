/**
 * Prediction API Server Tests
 *
 * Integration tests that spin up a real HTTP server on an ephemeral port
 * and exercise all routes using Node.js built-in http.request.
 * Zero external dependencies.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPredictServer } from '../../src/predict/server.js';
import { DEV_API_KEY } from '../../src/predict/auth.js';
import { ensureSeeded } from '../../src/fingerprint/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json<T = unknown>(): T;
}

function request(
  port: number,
  method: string,
  urlPath: string,
  opts: {
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    };

    const req = http.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          json<T>(): T {
            return JSON.parse(body) as T;
          },
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (opts.body) {
      req.write(opts.body);
    }

    req.end();
  });
}

function get(port: number, urlPath: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return request(port, 'GET', urlPath, { headers });
}

function post(
  port: number,
  urlPath: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<HttpResponse> {
  return request(port, 'POST', urlPath, {
    body: JSON.stringify(body),
    headers,
  });
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

/** Reserve an ephemeral port by binding then immediately closing */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Could not get address'));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-server-test-'));
  // Seed the fingerprint store so preflight/risk tests work
  ensureSeeded(tmpDir);
  port = await getFreePort();

  server = createPredictServer({
    agentgramDir: tmpDir,
    // Use a specific model path so the engine doesn't create files in cwd
    modelPath: path.join(tmpDir, 'predict', 'model.json'),
  } as Parameters<typeof createPredictServer>[0] & { modelPath?: string });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /v1/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await get(port, '/v1/health');
    expect(res.status).toBe(200);
    const body = res.json<{ status: string; version: string }>();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
  });
});

describe('CORS headers', () => {
  it('all responses include Access-Control-Allow-Origin header', async () => {
    const res = await get(port, '/v1/health');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('OPTIONS preflight returns 204', async () => {
    const res = await request(port, 'OPTIONS', '/v1/predict', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
  });

  it('CORS headers present on 404 response too', async () => {
    const res = await get(port, '/unknown-route');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});

describe('POST /v1/predict — auth', () => {
  it('returns 401 when no Authorization header and no apiKey in body', async () => {
    const res = await post(port, '/v1/predict', { task: 'add feature' });
    expect(res.status).toBe(401);
    const body = res.json<{ error: string; code: string }>();
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('MISSING_KEY');
  });

  it('returns 401 for an invalid API key', async () => {
    const res = await post(port, '/v1/predict', { task: 'add feature' }, authHeader('agk_invalid_key_xyz'));
    expect(res.status).toBe(401);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('INVALID_KEY');
  });

  it('accepts dev key in Authorization header', async () => {
    const res = await post(port, '/v1/predict', { task: 'add feature' }, authHeader(DEV_API_KEY));
    expect(res.status).toBe(200);
  });

  it('accepts dev key in request body as apiKey field', async () => {
    const res = await post(port, '/v1/predict', {
      task: 'add feature',
      apiKey: DEV_API_KEY,
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /v1/predict — request validation', () => {
  it('returns 400 for invalid JSON body', async () => {
    const res = await request(port, 'POST', '/v1/predict', {
      body: '{ not valid json }',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEV_API_KEY}`,
      },
    });
    expect(res.status).toBe(400);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('INVALID_JSON');
  });

  it('returns 400 when task is missing', async () => {
    const res = await post(port, '/v1/predict', { notTask: 'foo' }, authHeader(DEV_API_KEY));
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/predict — PredictionResult shape', () => {
  it('returns all required fields', async () => {
    const res = await post(
      port,
      '/v1/predict',
      { task: 'add clerk authentication to nextjs app' },
      authHeader(DEV_API_KEY),
    );
    expect(res.status).toBe(200);

    const body = res.json<Record<string, unknown>>();
    expect(typeof body['successProbability']).toBe('number');
    expect(typeof body['estimatedTokens']).toBe('number');
    expect(typeof body['estimatedMinutes']).toBe('number');
    expect(Array.isArray(body['topRisks'])).toBe(true);
    expect(typeof body['confidence']).toBe('number');
    expect(typeof body['basedOnSessions']).toBe('number');
    expect(typeof body['modelVersion']).toBe('string');
    expect(typeof body['generatedAt']).toBe('string');
  });

  it('successProbability is between 0 and 1', async () => {
    const res = await post(
      port,
      '/v1/predict',
      { task: 'refactor database queries' },
      authHeader(DEV_API_KEY),
    );
    const body = res.json<{ successProbability: number }>();
    expect(body.successProbability).toBeGreaterThanOrEqual(0);
    expect(body.successProbability).toBeLessThanOrEqual(1);
  });

  it('returns payments-domain risks for stripe webhook task', async () => {
    const res = await post(
      port,
      '/v1/predict',
      { task: 'add stripe webhooks for subscription billing and payment events' },
      authHeader(DEV_API_KEY),
    );
    expect(res.status).toBe(200);

    const body = res.json<{ topRisks: Array<{ domain: string }> }>();
    const domains = body.topRisks.map((r) => r.domain);
    // At least some risk should be in the payments domain
    expect(domains.some((d) => d === 'payments')).toBe(true);
  });
});

describe('POST /v1/outcome', () => {
  it('with dev key returns { recorded: true }', async () => {
    const res = await post(
      port,
      '/v1/outcome',
      {
        sessionId: 'test-session-1',
        task: 'add stripe subscription',
        stack: { payments: 'stripe' },
        success: true,
        totalTokens: 28000,
        durationMinutes: 14,
        deadEndCount: 0,
        deadEndPatterns: [],
        recordedAt: new Date().toISOString(),
      },
      authHeader(DEV_API_KEY),
    );
    expect(res.status).toBe(200);
    const body = res.json<{ recorded: boolean; modelVersion: string }>();
    expect(body.recorded).toBe(true);
    expect(typeof body.modelVersion).toBe('string');
  });

  it('returns 401 without auth', async () => {
    const res = await post(port, '/v1/outcome', {
      task: 'test',
      success: true,
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/model/stats', () => {
  it('returns sessionCount and modelVersion without auth', async () => {
    const res = await get(port, '/v1/model/stats');
    expect(res.status).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(typeof body['sessionCount']).toBe('number');
    expect(typeof body['modelVersion']).toBe('string');
  });

  it('returns domainCount and topDomains', async () => {
    const res = await get(port, '/v1/model/stats');
    const body = res.json<{ domainCount: number; topDomains: unknown[] }>();
    expect(typeof body.domainCount).toBe('number');
    expect(Array.isArray(body.topDomains)).toBe(true);
  });
});

describe('404 handling', () => {
  it('unknown route returns 404 with error/code shape', async () => {
    const res = await post(port, '/v1/unknown-endpoint', {}, authHeader(DEV_API_KEY));
    expect(res.status).toBe(404);
    const body = res.json<{ error: string; code: string }>();
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('GET to POST-only route returns 404', async () => {
    const res = await get(port, '/v1/predict');
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/keys — admin', () => {
  it('returns 403 when AGENTGRAM_ADMIN_KEY is not configured', async () => {
    // In tests, AGENTGRAM_ADMIN_KEY is not set, so this should return 403
    const res = await post(
      port,
      '/v1/keys',
      { name: 'Test key', tier: 'free' },
      authHeader('some-admin-key'),
    );
    expect(res.status).toBe(403);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('FORBIDDEN');
  });
});

describe('Rate limiting', () => {
  it('61st request returns 429 for free tier', async () => {
    // Create a fresh server on a different port so rate limiter state is isolated
    const rlTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-rl-test-'));
    const rlPort = await getFreePort();
    const rlServer = createPredictServer({
      agentgramDir: rlTmpDir,
      modelPath: path.join(rlTmpDir, 'predict', 'model.json'),
    } as Parameters<typeof createPredictServer>[0] & { modelPath?: string });

    await new Promise<void>((resolve, reject) => {
      rlServer.once('error', reject);
      rlServer.listen(rlPort, '127.0.0.1', resolve);
    });

    try {
      // Fire 60 requests (should all succeed on free tier)
      const promises: Promise<HttpResponse>[] = [];
      for (let i = 0; i < 60; i++) {
        promises.push(
          post(rlPort, '/v1/predict', { task: `task ${i}` }, authHeader(DEV_API_KEY)),
        );
      }
      const results = await Promise.all(promises);
      const allOk = results.every((r) => r.status === 200);
      expect(allOk).toBe(true);

      // 61st request should be rate limited
      const last = await post(rlPort, '/v1/predict', { task: 'over limit' }, authHeader(DEV_API_KEY));
      expect(last.status).toBe(429);
      const body = last.json<{ code: string }>();
      expect(body.code).toBe('RATE_LIMITED');
    } finally {
      await new Promise<void>((resolve) => rlServer.close(() => resolve()));
      fs.rmSync(rlTmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
