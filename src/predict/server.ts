/**
 * Prediction HTTP Server
 *
 * Lightweight HTTP server that exposes the PredictionEngine over a REST API.
 * Node.js 18+ native http module — zero external dependencies.
 *
 * Routes:
 *   GET  /v1/health         — liveness check (no auth)
 *   GET  /v1/model/stats    — public social-proof stats (no auth)
 *   POST /v1/predict        — predict task success, tokens, risks
 *   POST /v1/outcome        — record session outcome
 *   POST /v1/keys           — admin: create a new API key
 */

import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PredictionEngine } from './engine.js';
import { ApiKeyStore, DEV_API_KEY } from './auth.js';
import { RateLimiter } from './rate-limiter.js';
import type { PredictionRequest, SessionOutcome } from './types.js';

export interface PredictServerOptions {
  /** Port to listen on. Default 3847. */
  port?: number;
  /** Host to bind to. Default '0.0.0.0'. */
  host?: string;
  /** Path to the .agentgram model file. */
  modelPath?: string;
  /** Path to the .agentgram directory (for API keys). Default '.agentgram'. */
  agentgramDir?: string;
  /** Allowed CORS origins. Default ['*']. */
  corsOrigins?: string[];
}

const SERVER_VERSION = '0.1.0';
const MAX_BODY_BYTES = 64 * 1024; // 64 KB
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCorsHeaders(
  res: ServerResponse,
  origin: string | undefined,
  corsOrigins: string[],
): void {
  const allow =
    corsOrigins.includes('*')
      ? '*'
      : origin && corsOrigins.includes(origin)
        ? origin
        : (corsOrigins[0] ?? '*');

  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;

    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function apiError(
  res: ServerResponse,
  status: number,
  message: string,
  code: string,
): void {
  json(res, status, { error: message, code });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function logRequest(method: string, path: string, status: number, startMs: number): void {
  const ms = Date.now() - startMs;
  process.stderr.write(`[${new Date().toISOString()}] ${method} ${path} ${status} ${ms}ms\n`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function createRequestHandler(
  engine: PredictionEngine,
  keyStore: ApiKeyStore,
  rateLimiter: RateLimiter,
  corsOrigins: string[],
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const startMs = Date.now();
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const url = rawUrl.split('?')[0] ?? '/';
    const origin = req.headers['origin'];

    // CORS on all responses
    setCorsHeaders(res, origin, corsOrigins);

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      logRequest(method, url, 204, startMs);
      return;
    }

    // ── GET /v1/health ────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/v1/health') {
      json(res, 200, { status: 'ok', version: SERVER_VERSION });
      logRequest(method, url, 200, startMs);
      return;
    }

    // ── GET /v1/model/stats ───────────────────────────────────────────────────
    if (method === 'GET' && url === '/v1/model/stats') {
      const s = engine.getStats();
      json(res, 200, s);
      logRequest(method, url, 200, startMs);
      return;
    }

    // ── POST /v1/predict ──────────────────────────────────────────────────────
    if (method === 'POST' && url === '/v1/predict') {
      // Read body first so we can also check apiKey field
      let body = '';
      try {
        body = await readBody(req);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'read_error';
        if (msg === 'BODY_TOO_LARGE') {
          apiError(res, 413, 'Request body exceeds 64 KB limit', 'BODY_TOO_LARGE');
          logRequest(method, url, 413, startMs);
        } else {
          apiError(res, 400, 'Failed to read request body', 'READ_ERROR');
          logRequest(method, url, 400, startMs);
        }
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        apiError(res, 400, 'Invalid JSON', 'INVALID_JSON');
        logRequest(method, url, 400, startMs);
        return;
      }

      // Auth: Bearer header or apiKey in body
      const rawKey =
        extractBearerToken(req) ??
        (typeof parsed['apiKey'] === 'string' ? (parsed['apiKey'] as string) : null);

      if (!rawKey) {
        apiError(res, 401, 'Missing API key. Use Authorization: Bearer <key> or apiKey in body.', 'MISSING_KEY');
        logRequest(method, url, 401, startMs);
        return;
      }

      const keyRecord = keyStore.validate(rawKey);
      if (!keyRecord) {
        apiError(res, 401, 'Invalid API key', 'INVALID_KEY');
        logRequest(method, url, 401, startMs);
        return;
      }

      if (!rateLimiter.check(rawKey, keyRecord.tier)) {
        const retryAfter = rateLimiter.retryAfter(rawKey);
        res.setHeader('Retry-After', String(retryAfter));
        apiError(res, 429, 'Rate limit exceeded', 'RATE_LIMITED');
        logRequest(method, url, 429, startMs);
        return;
      }

      if (typeof parsed['task'] !== 'string' || !(parsed['task'] as string).trim()) {
        apiError(res, 400, '"task" is required and must be a non-empty string', 'MISSING_TASK');
        logRequest(method, url, 400, startMs);
        return;
      }

      const predRequest: PredictionRequest = {
        task: parsed['task'] as string,
        stack: parsed['stack'] as PredictionRequest['stack'],
        agent: typeof parsed['agent'] === 'string' ? (parsed['agent'] as string) : undefined,
      };

      try {
        const result = engine.predict(predRequest);
        keyStore.recordUsage(keyRecord.keyHash);
        json(res, 200, result);
        logRequest(method, url, 200, startMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        apiError(res, 500, `Prediction failed: ${msg}`, 'ENGINE_ERROR');
        logRequest(method, url, 500, startMs);
      }
      return;
    }

    // ── POST /v1/outcome ──────────────────────────────────────────────────────
    if (method === 'POST' && url === '/v1/outcome') {
      const rawKey = extractBearerToken(req);
      if (!rawKey) {
        apiError(res, 401, 'Missing API key', 'MISSING_KEY');
        logRequest(method, url, 401, startMs);
        return;
      }

      const keyRecord = keyStore.validate(rawKey);
      if (!keyRecord) {
        apiError(res, 401, 'Invalid API key', 'INVALID_KEY');
        logRequest(method, url, 401, startMs);
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch {
        apiError(res, 400, 'Failed to read request body', 'READ_ERROR');
        logRequest(method, url, 400, startMs);
        return;
      }

      let parsed: SessionOutcome;
      try {
        parsed = JSON.parse(body) as SessionOutcome;
      } catch {
        apiError(res, 400, 'Invalid JSON', 'INVALID_JSON');
        logRequest(method, url, 400, startMs);
        return;
      }

      if (!parsed.task || typeof parsed.success !== 'boolean') {
        apiError(res, 400, '"task" and "success" fields are required', 'MISSING_FIELDS');
        logRequest(method, url, 400, startMs);
        return;
      }

      try {
        engine.recordOutcome(parsed);
        keyStore.recordUsage(keyRecord.keyHash);
        const stats = engine.getStats();
        json(res, 200, { recorded: true, modelVersion: stats.modelVersion });
        logRequest(method, url, 200, startMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        apiError(res, 500, `Failed to record outcome: ${msg}`, 'ENGINE_ERROR');
        logRequest(method, url, 500, startMs);
      }
      return;
    }

    // ── POST /v1/keys (admin) ─────────────────────────────────────────────────
    if (method === 'POST' && url === '/v1/keys') {
      const adminKey = process.env['AGENTGRAM_ADMIN_KEY'];
      const provided = extractBearerToken(req);

      if (!adminKey || provided !== adminKey) {
        apiError(res, 403, 'Admin key required', 'FORBIDDEN');
        logRequest(method, url, 403, startMs);
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch {
        apiError(res, 400, 'Failed to read request body', 'READ_ERROR');
        logRequest(method, url, 400, startMs);
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        apiError(res, 400, 'Invalid JSON', 'INVALID_JSON');
        logRequest(method, url, 400, startMs);
        return;
      }

      const name = parsed['name'];
      const tier = parsed['tier'];

      if (typeof name !== 'string' || !name.trim()) {
        apiError(res, 400, '"name" is required', 'MISSING_NAME');
        logRequest(method, url, 400, startMs);
        return;
      }

      if (tier !== 'free' && tier !== 'pro' && tier !== 'enterprise') {
        apiError(res, 400, '"tier" must be "free", "pro", or "enterprise"', 'INVALID_TIER');
        logRequest(method, url, 400, startMs);
        return;
      }

      const { key, record } = keyStore.createKey(name, tier);
      json(res, 201, { key, name: record.name, tier: record.tier });
      logRequest(method, url, 201, startMs);
      return;
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    apiError(res, 404, `Route not found: ${method} ${url}`, 'NOT_FOUND');
    logRequest(method, url, 404, startMs);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create (but do not start) the prediction HTTP server.
 */
export function createPredictServer(options: PredictServerOptions = {}): http.Server {
  const agentgramDir = options.agentgramDir ?? '.agentgram';
  const corsOrigins = options.corsOrigins ?? ['*'];
  const engine = new PredictionEngine(options.modelPath);
  const keyStore = new ApiKeyStore(agentgramDir);
  const rateLimiter = new RateLimiter();

  const handler = createRequestHandler(engine, keyStore, rateLimiter, corsOrigins);

  const server = http.createServer((req, res) => {
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      apiError(res, 408, 'Request timeout', 'REQUEST_TIMEOUT');
    });

    handler(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Internal error';
      try {
        apiError(res, 500, msg, 'INTERNAL_ERROR');
      } catch {
        // Response already sent
      }
    });
  });

  return server;
}

/**
 * Create and start the prediction HTTP server, returning the listening server.
 */
export function startPredictServer(options: PredictServerOptions = {}): Promise<http.Server> {
  const port = options.port ?? 3847;
  const host = options.host ?? '0.0.0.0';
  const server = createPredictServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      process.stderr.write(
        `[${new Date().toISOString()}] agentgram predict server listening on ${host}:${port}\n`,
      );
      resolve(server);
    });
  });
}

// Re-export for convenience
export { DEV_API_KEY };
