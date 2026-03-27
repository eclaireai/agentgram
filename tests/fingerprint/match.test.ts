import { describe, it, expect } from 'vitest';
import { matchFingerprints, preflight, formatPreflightResult } from '../../src/fingerprint/match.js';
import type { FingerprintRecord } from '../../src/fingerprint/types.js';
import { LocalFingerprintStore } from '../../src/fingerprint/local-store.js';
import { vi } from 'vitest';

function makeFingerprint(overrides: Partial<FingerprintRecord> = {}): FingerprintRecord {
  return {
    id: 'fp-stripe-webhook',
    operationType: 'exec',
    errorPattern: 'stripe webhook signature verification failed raw body parsed',
    reversalPattern: 'npm uninstall stripe, reinstall with raw body middleware',
    domain: 'payments',
    tags: ['exec', 'webhook', 'stripe', 'npm-install'],
    estimatedTokensWasted: 1200,
    occurrences: 847,
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-03-27T00:00:00Z',
    warning: 'Stripe webhook verification fails if body is parsed before verification',
    fix: 'Use express.raw() middleware before stripe.webhooks.constructEvent()',
    ...overrides,
  };
}

describe('matchFingerprints', () => {
  it('returns empty array when no fingerprints', () => {
    expect(matchFingerprints('add stripe payments', [])).toEqual([]);
  });

  it('matches by domain keyword', () => {
    const fps = [makeFingerprint()];
    const results = matchFingerprints('add stripe subscriptions with webhooks', fps);
    expect(results).toHaveLength(1);
    expect(results[0]!.fingerprint.id).toBe('fp-stripe-webhook');
  });

  it('scores domain matches higher than random matches', () => {
    const stripeFingerprint = makeFingerprint({ domain: 'payments' });
    const authFingerprint = makeFingerprint({
      id: 'fp-auth',
      domain: 'auth',
      tags: ['exec', 'clerk'],
      errorPattern: 'clerk middleware configuration failed',
    });
    const results = matchFingerprints('add stripe checkout', [stripeFingerprint, authFingerprint]);
    expect(results[0]!.fingerprint.id).toBe('fp-stripe-webhook');
  });

  it('respects limit option', () => {
    const fps = [
      makeFingerprint({ id: 'fp-1' }),
      makeFingerprint({ id: 'fp-2', domain: 'payments' }),
      makeFingerprint({ id: 'fp-3', domain: 'payments' }),
    ];
    const results = matchFingerprints('stripe payment webhook', fps, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('filters by domain when specified', () => {
    const fps = [
      makeFingerprint({ id: 'fp-payment', domain: 'payments' }),
      makeFingerprint({ id: 'fp-auth', domain: 'auth', tags: ['auth'] }),
    ];
    const results = matchFingerprints('setup auth middleware', fps, { domain: 'auth' });
    const domains = results.map((r) => r.fingerprint.domain);
    expect(domains.every((d) => d === 'auth')).toBe(true);
  });

  it('returns scores between 0 and 1', () => {
    const fps = [makeFingerprint()];
    const results = matchFingerprints('stripe webhooks', fps);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns matchReason for each match', () => {
    const fps = [makeFingerprint()];
    const results = matchFingerprints('stripe payments', fps);
    expect(results[0]?.matchReason).toBeTruthy();
  });

  it('does not match unrelated tasks', () => {
    const fps = [makeFingerprint({ domain: 'payments' })];
    const results = matchFingerprints('setup kubernetes ingress controller', fps, { threshold: 0.3 });
    expect(results).toHaveLength(0);
  });

  it('boosts high-occurrence fingerprints', () => {
    const common = makeFingerprint({ id: 'common', occurrences: 5000 });
    const rare = makeFingerprint({ id: 'rare', occurrences: 1 });
    const results = matchFingerprints('stripe webhook payments', [rare, common]);
    const commonResult = results.find((r) => r.fingerprint.id === 'common');
    const rareResult = results.find((r) => r.fingerprint.id === 'rare');
    if (commonResult && rareResult) {
      expect(commonResult.score).toBeGreaterThan(rareResult.score);
    }
  });

  it('matches auth tasks to auth fingerprints', () => {
    const fps = [
      makeFingerprint({ id: 'auth-fp', domain: 'auth', tags: ['clerk', 'auth', 'exec'], errorPattern: 'clerk auth middleware failed' }),
    ];
    const results = matchFingerprints('add clerk authentication to nextjs', fps);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('preflight', () => {
  it('returns preflight result with task and matches', () => {
    const store = {
      getAll: () => [makeFingerprint()],
      size: () => 1,
    } as unknown as LocalFingerprintStore;

    const result = preflight('add stripe webhooks', store);
    expect(result.task).toBe('add stripe webhooks');
    expect(result.totalFingerprints).toBe(1);
    expect(Array.isArray(result.matches)).toBe(true);
  });

  it('returns cloudSynced: false by default', () => {
    const store = {
      getAll: () => [],
      size: () => 0,
    } as unknown as LocalFingerprintStore;

    const result = preflight('anything', store);
    expect(result.cloudSynced).toBe(false);
  });
});

describe('formatPreflightResult', () => {
  it('shows no-warnings message when no matches', () => {
    const result = formatPreflightResult({
      task: 'add authentication',
      matches: [],
      totalFingerprints: 100,
      cloudSynced: false,
    });
    expect(result).toContain('No known dead ends');
  });

  it('shows warning count when matches exist', () => {
    const result = formatPreflightResult({
      task: 'add stripe webhooks',
      matches: [
        {
          fingerprint: makeFingerprint(),
          score: 0.8,
          matchReason: 'domain:payments',
        },
      ],
      totalFingerprints: 50,
      cloudSynced: true,
    });
    expect(result).toContain('1 relevant warning');
    expect(result).toContain('stripe webhook');
  });

  it('shows fix when available', () => {
    const result = formatPreflightResult({
      task: 'stripe',
      matches: [{ fingerprint: makeFingerprint(), score: 0.9, matchReason: 'domain' }],
      totalFingerprints: 1,
      cloudSynced: false,
    });
    expect(result).toContain('express.raw()');
  });

  it('includes checked count', () => {
    const result = formatPreflightResult({
      task: 'test',
      matches: [],
      totalFingerprints: 42,
      cloudSynced: false,
    });
    expect(result).toContain('42');
  });
});
