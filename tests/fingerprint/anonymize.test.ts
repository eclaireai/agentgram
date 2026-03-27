import { describe, it, expect } from 'vitest';
import { anonymizeDeadEnd, anonymizeDeadEnds } from '../../src/fingerprint/anonymize.js';
import type { DeadEnd } from '../../src/cognitive/trace.js';
import type { Operation } from '../../src/core/types.js';

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    type: 'exec',
    timestamp: Date.now(),
    target: 'npm install',
    metadata: { command: 'npm install stripe' },
    causedBy: [],
    ...overrides,
  };
}

function makeDeadEnd(overrides: Partial<DeadEnd> = {}): DeadEnd {
  return {
    id: 'de-1',
    operation: makeOp(),
    undoneBy: makeOp({ id: 'op-2', metadata: { command: 'npm uninstall stripe' } }),
    reason: 'peer dependency conflict with react 18',
    estimatedTokensWasted: 500,
    ...overrides,
  };
}

describe('anonymizeDeadEnd', () => {
  it('returns a FingerprintRecord with all required fields', () => {
    const fp = anonymizeDeadEnd(makeDeadEnd());
    expect(fp.id).toBeTruthy();
    expect(fp.operationType).toBe('exec');
    expect(fp.errorPattern).toBeTruthy();
    expect(fp.reversalPattern).toBeTruthy();
    expect(fp.domain).toBeTruthy();
    expect(Array.isArray(fp.tags)).toBe(true);
    expect(fp.occurrences).toBe(1);
    expect(fp.warning).toBeTruthy();
  });

  it('strips absolute file paths from error pattern', () => {
    const de = makeDeadEnd({
      reason: 'Cannot find /Users/naresh/Code/myapp/src/auth.ts',
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.errorPattern).not.toContain('/Users/naresh');
    expect(fp.errorPattern).not.toContain('naresh');
  });

  it('strips absolute paths from commands', () => {
    const de = makeDeadEnd({
      operation: makeOp({
        metadata: { command: 'node /Users/naresh/Code/myapp/dist/server.js' },
      }),
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.errorPattern).not.toContain('naresh');
  });

  it('infers correct domain for payment-related dead ends', () => {
    const de = makeDeadEnd({
      operation: makeOp({ metadata: { command: 'npm install stripe' } }),
      reason: 'stripe webhook signature verification failed',
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.domain).toBe('payments');
  });

  it('infers correct domain for auth dead ends', () => {
    const de = makeDeadEnd({
      operation: makeOp({ metadata: { command: 'npm install @clerk/nextjs' } }),
      reason: 'clerk middleware configuration error',
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.domain).toBe('auth');
  });

  it('infers correct domain for database dead ends', () => {
    const de = makeDeadEnd({
      operation: makeOp({ metadata: { command: 'npx prisma migrate dev' } }),
      reason: 'prisma schema validation failed',
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.domain).toBe('database');
  });

  it('generates deterministic IDs for the same pattern', () => {
    const de1 = makeDeadEnd({ reason: 'peer dependency conflict' });
    const de2 = makeDeadEnd({ reason: 'peer dependency conflict', id: 'different-id' });
    const fp1 = anonymizeDeadEnd(de1);
    const fp2 = anonymizeDeadEnd(de2);
    expect(fp1.id).toBe(fp2.id);
  });

  it('generates different IDs for different patterns', () => {
    const de1 = makeDeadEnd({ reason: 'peer dependency conflict' });
    const de2 = makeDeadEnd({ reason: 'webpack build failed: module not found' });
    expect(anonymizeDeadEnd(de1).id).not.toBe(anonymizeDeadEnd(de2).id);
  });

  it('includes npm tag for npm commands', () => {
    const de = makeDeadEnd({
      operation: makeOp({ metadata: { command: 'npm install lodash' } }),
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.tags).toContain('npm-install');
  });

  it('includes exec operation type in tags', () => {
    const fp = anonymizeDeadEnd(makeDeadEnd());
    expect(fp.tags).toContain('exec');
  });

  it('generates a warning message', () => {
    const fp = anonymizeDeadEnd(makeDeadEnd());
    expect(fp.warning.length).toBeGreaterThan(10);
  });

  it('generates a fix when reversal command exists', () => {
    const fp = anonymizeDeadEnd(makeDeadEnd());
    expect(fp.fix).toBeTruthy();
  });

  it('handles create operation type', () => {
    const de = makeDeadEnd({
      operation: makeOp({ type: 'create', target: 'src/auth/middleware.ts', metadata: {} }),
      undoneBy: makeOp({ type: 'delete', target: 'src/auth/middleware.ts', metadata: {} }),
    });
    const fp = anonymizeDeadEnd(de);
    expect(fp.operationType).toBe('create');
  });

  it('caps error pattern length at 200 chars', () => {
    const de = makeDeadEnd({ reason: 'a'.repeat(500) });
    const fp = anonymizeDeadEnd(de);
    expect(fp.errorPattern.length).toBeLessThanOrEqual(200);
  });
});

describe('anonymizeDeadEnds', () => {
  it('returns empty array for empty input', () => {
    expect(anonymizeDeadEnds([])).toEqual([]);
  });

  it('deduplicates identical patterns', () => {
    const de1 = makeDeadEnd({ id: 'de-1', reason: 'same error' });
    const de2 = makeDeadEnd({ id: 'de-2', reason: 'same error' });
    const fps = anonymizeDeadEnds([de1, de2]);
    expect(fps).toHaveLength(1);
  });

  it('keeps distinct patterns', () => {
    const de1 = makeDeadEnd({ reason: 'error A' });
    const de2 = makeDeadEnd({ reason: 'webpack completely different failure' });
    const fps = anonymizeDeadEnds([de1, de2]);
    expect(fps).toHaveLength(2);
  });
});
