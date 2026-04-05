/**
 * AgentgramClient SDK Tests
 *
 * Uses globalThis.fetch = mockFetch to intercept HTTP calls.
 * No external test utilities — only vitest and Node built-ins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentgramClient, predict, AgentgramApiError } from '../../src/predict/sdk.js';
import type { PredictionResult } from '../../src/predict/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_API_KEY = 'agk_test_1234567890abcdef';
const BASE_URL = 'https://api.agentgram.dev';

const MOCK_PREDICTION: PredictionResult = {
  successProbability: 0.82,
  estimatedTokens: 42000,
  estimatedMinutes: 21,
  tokenSavingsIfRecipeUsed: 8000,
  topRisks: [
    {
      pattern: 'Stripe webhook signature mismatch',
      probability: 0.72,
      severity: 'critical',
      fix: 'use raw body middleware before express.json()',
      seenCount: 14,
      domain: 'payments',
    },
  ],
  recommendedRecipe: 'stripe-subscriptions-nextjs',
  confidence: 0.75,
  basedOnSessions: 15,
  modelVersion: 'abc123de',
  generatedAt: '2026-04-04T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

type MockFetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function makeMockFetch(impl: MockFetchImpl): typeof globalThis.fetch {
  return impl as unknown as typeof globalThis.fetch;
}

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body?: unknown): Response {
  return new Response(JSON.stringify(body ?? { error: 'error' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function networkError(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed: network unreachable'));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentgramClient.predict()', () => {
  it('returns fallback result when API is unreachable (gracefulFallback default)', async () => {
    globalThis.fetch = makeMockFetch(() => networkError());

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const result = await client.predict('add stripe subscriptions');

    expect(result.confidence).toBe(0);
    expect(result.modelVersion).toBe('fallback');
    expect(result.topRisks).toEqual([]);
    expect(result.basedOnSessions).toBe(0);
    expect(result.successProbability).toBe(0.70);
    expect(result._cached).toBe(false);
  });

  it('throws when API unreachable and gracefulFallback is false', async () => {
    globalThis.fetch = makeMockFetch(() => networkError());

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY, gracefulFallback: false });
    await expect(client.predict('add stripe subscriptions')).rejects.toThrow();
  });

  it('caches identical requests and returns _cached: true within TTL', async () => {
    let callCount = 0;
    globalThis.fetch = makeMockFetch(() => {
      callCount++;
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const task = 'add stripe subscriptions to nextjs';

    const first = await client.predict(task);
    const second = await client.predict(task);

    // Only one real HTTP call should have been made
    expect(callCount).toBe(1);
    expect(first._cached).toBe(false);
    expect(second._cached).toBe(true);
    expect(second.successProbability).toBe(first.successProbability);
  });

  it('returns fresh result when called with a different stack (different cache key)', async () => {
    let callCount = 0;
    globalThis.fetch = makeMockFetch(() => {
      callCount++;
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const task = 'add stripe subscriptions';

    await client.predict(task, { framework: 'nextjs' });
    const second = await client.predict(task, { framework: 'express' });

    expect(callCount).toBe(2);
    expect(second._cached).toBe(false);
  });

  it('returns fresh result after cache TTL expires', async () => {
    let callCount = 0;
    globalThis.fetch = makeMockFetch(() => {
      callCount++;
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    // Use a real client but manually expire the cache entry by reaching into it
    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const task = 'add auth with clerk';

    await client.predict(task);
    expect(callCount).toBe(1);

    // Manually expire all cache entries
    const cache = (client as unknown as { cache: Map<string, { expiresAt: number }> }).cache;
    for (const [key, entry] of cache.entries()) {
      cache.set(key, { ...entry, expiresAt: Date.now() - 1 });
    }

    const third = await client.predict(task);
    expect(callCount).toBe(2);
    expect(third._cached).toBe(false);
  });

  it('sends correct Authorization header', async () => {
    let capturedAuth: string | null = null;
    globalThis.fetch = makeMockFetch((_, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      capturedAuth = headers?.['Authorization'] ?? null;
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    await client.predict('deploy to vercel');

    expect(capturedAuth).toBe(`Bearer ${FAKE_API_KEY}`);
  });

  it('sends task and stack in POST body', async () => {
    let capturedBody: unknown = null;
    globalThis.fetch = makeMockFetch((_, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const stack = { framework: 'nextjs', payments: 'stripe' };
    await client.predict('add stripe subscriptions', stack);

    expect(capturedBody).toEqual({ task: 'add stripe subscriptions', stack });
  });

  it('result has all required fields', async () => {
    globalThis.fetch = makeMockFetch(() => Promise.resolve(okResponse(MOCK_PREDICTION)));

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const result = await client.predict('some task');

    expect(typeof result.successProbability).toBe('number');
    expect(typeof result.estimatedTokens).toBe('number');
    expect(typeof result.estimatedMinutes).toBe('number');
    expect(typeof result.tokenSavingsIfRecipeUsed).toBe('number');
    expect(Array.isArray(result.topRisks)).toBe(true);
    expect(typeof result.confidence).toBe('number');
    expect(typeof result.basedOnSessions).toBe('number');
    expect(typeof result.modelVersion).toBe('string');
    expect(typeof result.generatedAt).toBe('string');
    expect(typeof result._cached).toBe('boolean');
    // recommendedRecipe may be null or string
    expect(result.recommendedRecipe === null || typeof result.recommendedRecipe === 'string').toBe(true);
  });

  it('retries once on network error before returning fallback', async () => {
    let callCount = 0;
    globalThis.fetch = makeMockFetch(() => {
      callCount++;
      return networkError();
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY, gracefulFallback: true });
    const result = await client.predict('deploy docker container');

    // Should have been called twice (original + 1 retry) before graceful fallback
    expect(callCount).toBe(2);
    expect(result.confidence).toBe(0);
  });

  it('does not retry on 4xx client errors', async () => {
    let callCount = 0;
    globalThis.fetch = makeMockFetch(() => {
      callCount++;
      return Promise.resolve(errorResponse(400, { error: 'bad request' }));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY, gracefulFallback: false });
    await expect(client.predict('some task')).rejects.toBeInstanceOf(AgentgramApiError);
    expect(callCount).toBe(1);
  });
});

describe('AgentgramClient.recordOutcome()', () => {
  it('sends POST to /v1/outcome', async () => {
    let capturedUrl: string | null = null;
    let capturedMethod: string | null = null;
    let capturedBody: unknown = null;

    globalThis.fetch = makeMockFetch((url, init) => {
      capturedUrl = url as string;
      capturedMethod = init?.method ?? null;
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    await client.recordOutcome({
      task: 'add stripe subscriptions',
      success: true,
      sessionId: 'sess-123',
      totalTokens: 35000,
      durationMinutes: 17,
      deadEndCount: 0,
      deadEndPatterns: [],
      stack: { framework: 'nextjs' },
      recordedAt: new Date().toISOString(),
    });

    expect(capturedUrl).toBe(`${BASE_URL}/v1/outcome`);
    expect(capturedMethod).toBe('POST');
    expect((capturedBody as { task: string }).task).toBe('add stripe subscriptions');
    expect((capturedBody as { success: boolean }).success).toBe(true);
  });

  it('does not throw when API unreachable', async () => {
    globalThis.fetch = makeMockFetch(() => networkError());

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    await expect(
      client.recordOutcome({ task: 'deploy to production', success: false })
    ).resolves.toBeUndefined();
  });
});

describe('AgentgramClient.ping()', () => {
  it('returns true when API reachable', async () => {
    globalThis.fetch = makeMockFetch(() =>
      Promise.resolve(okResponse({ ok: true }))
    );

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const result = await client.ping();
    expect(result).toBe(true);
  });

  it('returns false when API unreachable', async () => {
    globalThis.fetch = makeMockFetch(() => networkError());

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const result = await client.ping();
    expect(result).toBe(false);
  });

  it('returns false when API returns 5xx', async () => {
    globalThis.fetch = makeMockFetch(() =>
      Promise.resolve(errorResponse(503, { error: 'unavailable' }))
    );

    const client = new AgentgramClient({ apiKey: FAKE_API_KEY });
    const result = await client.ping();
    expect(result).toBe(false);
  });
});

describe('predict() convenience function', () => {
  it('creates a client and calls predict() with the given task and stack', async () => {
    let capturedBody: unknown = null;
    globalThis.fetch = makeMockFetch((_, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(okResponse(MOCK_PREDICTION));
    });

    const result = await predict('add nextauth to nextjs', {
      apiKey: FAKE_API_KEY,
      stack: { framework: 'nextjs', auth: 'nextauth' },
    });

    expect((capturedBody as { task: string }).task).toBe('add nextauth to nextjs');
    expect((capturedBody as { stack: { framework: string } }).stack.framework).toBe('nextjs');
    expect(result.successProbability).toBe(MOCK_PREDICTION.successProbability);
  });

  it('returns fallback result when API unreachable (default gracefulFallback)', async () => {
    globalThis.fetch = makeMockFetch(() => networkError());

    const result = await predict('build a fullstack app', { apiKey: FAKE_API_KEY });
    expect(result.confidence).toBe(0);
    expect(result.modelVersion).toBe('fallback');
  });
});
