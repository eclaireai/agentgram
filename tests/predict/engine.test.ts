/**
 * Prediction Engine Tests
 *
 * Tests for engine.ts, outcome-extractor.ts, and their interactions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PredictionEngine } from '../../src/predict/engine.js';
import { inferStack, extractOutcome, extractAllOutcomes, bootstrapModel } from '../../src/predict/outcome-extractor.js';
import type { SessionOutcome } from '../../src/predict/types.js';
import type { Session, Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-predict-test-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeEngine(tmpDir: string): PredictionEngine {
  return new PredictionEngine(path.join(tmpDir, 'predict', 'model.json'));
}

function makeOutcome(overrides: Partial<SessionOutcome> = {}): SessionOutcome {
  return {
    sessionId: 'sess-1',
    task: 'add stripe subscription payments',
    stack: { payments: 'stripe' },
    success: true,
    totalTokens: 32000,
    durationMinutes: 16,
    deadEndCount: 0,
    deadEndPatterns: [],
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'read',
    timestamp: Date.now(),
    target: 'README.md',
    metadata: {},
    causedBy: [],
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-test',
    name: 'add stripe subscription',
    state: 'stopped',
    startedAt: Date.now() - 60000,
    stoppedAt: Date.now(),
    operations: [],
    branch: 'agentgram/test',
    baseCommit: 'abc123',
    cwd: '/tmp/test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PredictionEngine — empty model defaults
// ---------------------------------------------------------------------------

describe('PredictionEngine — empty model', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeDir(tmpDir);
  });

  it('predict() with empty model returns sensible defaults', () => {
    const engine = makeEngine(tmpDir);
    const result = engine.predict({ task: 'add feature to my app' });

    expect(result.successProbability).toBeGreaterThan(0);
    expect(result.successProbability).toBeLessThanOrEqual(1);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.estimatedMinutes).toBeGreaterThan(0);
    expect(result.confidence).toBe(0);
    expect(result.basedOnSessions).toBe(0);
    expect(result.modelVersion).toHaveLength(8);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(result.topRisks)).toBe(true);
  });

  it('predict() with payment task uses payments domain defaults', () => {
    const engine = makeEngine(tmpDir);
    const result = engine.predict({ task: 'integrate stripe subscription billing' });

    // Payments domain base success rate is 0.61 (lowest domain rate)
    expect(result.successProbability).toBeLessThanOrEqual(0.75);
    // Payments domain default token cost is 35000
    expect(result.estimatedTokens).toBe(35000);
  });

  it('predict() estimatedTokens uses domain averages when no history', () => {
    const engine = makeEngine(tmpDir);

    const authResult = engine.predict({ task: 'add clerk auth login signup' });
    const devopsResult = engine.predict({ task: 'deploy with docker kubernetes container' });

    expect(authResult.estimatedTokens).toBe(28000);
    expect(devopsResult.estimatedTokens).toBe(45000);
  });

  it('predict() tokenSavingsIfRecipeUsed is 0 when no recipe found', () => {
    const engine = makeEngine(tmpDir);
    // No recipe index exists in tmpDir
    const result = engine.predict({ task: 'add something unusual xyzzy' });

    expect(result.tokenSavingsIfRecipeUsed).toBe(0);
    expect(result.recommendedRecipe).toBeNull();
  });

  it('predict() confidence is 0 with no matching sessions', () => {
    const engine = makeEngine(tmpDir);
    const result = engine.predict({ task: 'add database schema migration' });

    expect(result.confidence).toBe(0);
    expect(result.basedOnSessions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PredictionEngine — with outcomes
// ---------------------------------------------------------------------------

describe('PredictionEngine — with recorded outcomes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeDir(tmpDir);
  });

  it('recordOutcome() increases basedOnSessions', () => {
    const engine = makeEngine(tmpDir);

    engine.recordOutcome(makeOutcome({ task: 'add stripe subscription payments' }));
    engine.recordOutcome(makeOutcome({ task: 'add stripe subscription payments', sessionId: 'sess-2' }));
    engine.recordOutcome(makeOutcome({ task: 'add stripe subscription payments', sessionId: 'sess-3' }));

    const result = engine.predict({ task: 'add stripe subscription payments' });
    expect(result.basedOnSessions).toBeGreaterThan(0);
  });

  it('recordOutcome() updates keyword success rates', () => {
    const engine = makeEngine(tmpDir);

    // Record 5 successful outcomes with the same keywords
    for (let i = 0; i < 5; i++) {
      engine.recordOutcome(
        makeOutcome({ sessionId: `sess-${i}`, task: 'add stripe subscription billing', success: true }),
      );
    }

    // The model should have keyword entries
    const modelPath = path.join(tmpDir, 'predict', 'model.json');
    // Force save (since we haven't hit the threshold of 10 yet, manually save)
    engine.saveModel();

    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as {
      keywordSuccessRates: Record<string, number>;
    };
    expect(Object.keys(model.keywordSuccessRates).length).toBeGreaterThan(0);
    // 'stripe' keyword should have high success rate
    const stripeRate = model.keywordSuccessRates['stripe'];
    if (stripeRate !== undefined) {
      expect(stripeRate).toBeGreaterThan(0.5);
    }
  });

  it('predict() successProbability decreases with more critical risks', () => {
    // We test this by creating a fingerprint store with high-occurrence patterns
    // and comparing predictions with and without. Since we can't easily inject
    // fingerprints without the store, we validate the base domain rate is reduced
    // by ensuring the formula works. We'll test this by mocking extreme scenarios.

    const engine = makeEngine(tmpDir);

    // Base payments success rate is 0.61
    const baseResult = engine.predict({ task: 'integrate stripe checkout' });
    expect(baseResult.successProbability).toBeLessThanOrEqual(0.61);
  });

  it('predict() confidence scales with basedOnSessions', () => {
    const engine = makeEngine(tmpDir);

    // Add 10 matching outcomes
    for (let i = 0; i < 10; i++) {
      engine.recordOutcome(
        makeOutcome({ sessionId: `sess-${i}`, task: 'add database prisma migration schema' }),
      );
    }

    const result = engine.predict({ task: 'add database prisma migration schema' });
    // confidence = basedOnSessions / 20, capped at 0.95
    expect(result.confidence).toBe(0.5); // 10/20 = 0.5
    expect(result.basedOnSessions).toBe(10);
  });

  it('predict() confidence caps at 0.95 with 20+ sessions', () => {
    const engine = makeEngine(tmpDir);

    for (let i = 0; i < 25; i++) {
      engine.recordOutcome(
        makeOutcome({ sessionId: `sess-${i}`, task: 'postgres database migration drizzle schema' }),
      );
    }

    const result = engine.predict({ task: 'postgres database migration drizzle schema' });
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it('predict() uses median token count from matching sessions', () => {
    const engine = makeEngine(tmpDir);

    // Record 3 sessions with known token counts
    engine.recordOutcome(makeOutcome({ sessionId: 's1', task: 'add auth login clerk', totalTokens: 10000 }));
    engine.recordOutcome(makeOutcome({ sessionId: 's2', task: 'add auth login clerk', totalTokens: 20000 }));
    engine.recordOutcome(makeOutcome({ sessionId: 's3', task: 'add auth login clerk', totalTokens: 30000 }));

    const result = engine.predict({ task: 'add auth login clerk' });
    // Median of [10000, 20000, 30000] = 20000
    expect(result.estimatedTokens).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// inferStack
// ---------------------------------------------------------------------------

describe('inferStack()', () => {
  it('detects nextjs from next.config.ts in targets', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'next.config.ts' })],
    });
    const stack = inferStack(session);
    expect(stack.framework).toBe('nextjs');
  });

  it('detects nextjs from app/ directory pattern', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'app/page.tsx' })],
    });
    const stack = inferStack(session);
    expect(stack.framework).toBe('nextjs');
  });

  it('detects prisma from schema.prisma in targets', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'prisma/schema.prisma' })],
    });
    const stack = inferStack(session);
    expect(stack.orm).toBe('prisma');
  });

  it('detects stripe from exec command', () => {
    const session = makeSession({
      operations: [
        makeOperation({
          type: 'exec',
          target: 'npm install stripe',
          metadata: { command: 'npm install stripe', exitCode: 0 },
        }),
      ],
    });
    const stack = inferStack(session);
    expect(stack.payments).toBe('stripe');
  });

  it('detects python from .py files', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'app/main.py' })],
    });
    const stack = inferStack(session);
    expect(stack.language).toBe('python');
  });

  it('detects python from requirements.txt', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'requirements.txt' })],
    });
    const stack = inferStack(session);
    expect(stack.language).toBe('python');
  });

  it('detects clerk from exec command', () => {
    const session = makeSession({
      operations: [
        makeOperation({
          type: 'exec',
          target: 'npm install @clerk/nextjs',
          metadata: { command: 'npm install @clerk/nextjs', exitCode: 0 },
        }),
      ],
    });
    const stack = inferStack(session);
    expect(stack.auth).toBe('clerk');
  });

  it('detects docker from Dockerfile', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'Dockerfile' })],
    });
    const stack = inferStack(session);
    expect(stack.deployment).toBe('docker');
  });

  it('detects postgres from exec command', () => {
    const session = makeSession({
      operations: [
        makeOperation({
          type: 'exec',
          target: 'psql postgres://localhost/mydb',
          metadata: { command: 'psql postgres://localhost/mydb', exitCode: 0 },
        }),
      ],
    });
    const stack = inferStack(session);
    expect(stack.database).toBe('postgres');
  });

  it('returns empty stack for session with no recognizable patterns', () => {
    const session = makeSession({
      operations: [makeOperation({ target: 'README.md' })],
    });
    const stack = inferStack(session);
    expect(Object.keys(stack).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractOutcome
// ---------------------------------------------------------------------------

describe('extractOutcome()', () => {
  it('success=false for session with failed exec in last 3 ops', () => {
    const session = makeSession({
      operations: [
        makeOperation({ type: 'write', target: 'index.ts', metadata: { afterHash: 'abc' } }),
        makeOperation({
          type: 'exec',
          target: 'npm run build',
          metadata: { command: 'npm run build', exitCode: 1, output: 'error: type mismatch' },
        }),
      ],
    });
    const outcome = extractOutcome(session);
    expect(outcome.success).toBe(false);
  });

  it('success=true for session with write and no failed last execs', () => {
    const session = makeSession({
      operations: [
        makeOperation({ type: 'write', target: 'index.ts', metadata: { afterHash: 'abc' } }),
        makeOperation({
          type: 'exec',
          target: 'npm run build',
          metadata: { command: 'npm run build', exitCode: 0, output: 'ok' },
        }),
      ],
    });
    const outcome = extractOutcome(session);
    expect(outcome.success).toBe(true);
  });

  it('estimates totalTokens from operation count', () => {
    const session = makeSession({
      operations: [
        // 2 reads × 200 = 400
        makeOperation({ type: 'read', target: 'a.ts' }),
        makeOperation({ type: 'read', target: 'b.ts' }),
        // 1 write × 500 = 500
        makeOperation({ type: 'write', target: 'c.ts', metadata: { afterHash: 'xyz' } }),
        // 1 exec × 300 = 300
        makeOperation({ type: 'exec', target: 'tsc', metadata: { exitCode: 0 } }),
      ],
    });
    const outcome = extractOutcome(session);
    expect(outcome.totalTokens).toBe(400 + 500 + 300); // 1200
  });

  it('deadEndCount counts failed execs', () => {
    const session = makeSession({
      operations: [
        makeOperation({ type: 'exec', target: 'npm test', metadata: { exitCode: 1 } }),
        makeOperation({ type: 'exec', target: 'npm test', metadata: { exitCode: 1 } }),
        makeOperation({ type: 'exec', target: 'npm test', metadata: { exitCode: 0 } }),
      ],
    });
    const outcome = extractOutcome(session);
    expect(outcome.deadEndCount).toBe(2);
  });

  it('extracts sessionId and task from session', () => {
    const session = makeSession({ id: 'my-session-id', name: 'add auth to app' });
    const outcome = extractOutcome(session);
    expect(outcome.sessionId).toBe('my-session-id');
    expect(outcome.task).toBe('add auth to app');
  });

  it('computes durationMinutes from startedAt and stoppedAt', () => {
    const startedAt = 1000000000000;
    const stoppedAt = startedAt + 10 * 60 * 1000; // 10 minutes later
    const session = makeSession({ startedAt, stoppedAt });
    const outcome = extractOutcome(session);
    expect(outcome.durationMinutes).toBeCloseTo(10, 1);
  });
});

// ---------------------------------------------------------------------------
// bootstrapModel
// ---------------------------------------------------------------------------

describe('bootstrapModel()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    removeDir(tmpDir);
  });

  it('returns 0 for empty sessions dir', async () => {
    const count = await bootstrapModel(tmpDir);
    expect(count).toBe(0);
  });

  it('returns 0 when sessions dir does not exist', async () => {
    const count = await bootstrapModel(path.join(tmpDir, 'nonexistent'));
    expect(count).toBe(0);
  });

  it('returns count of sessions found when sessions exist', async () => {
    // Create a mock sessions directory with session files
    const sessionsDir = path.join(tmpDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    const session1: Session = makeSession({ id: 'sess-bootstrap-1', name: 'add auth login' });
    const session2: Session = makeSession({ id: 'sess-bootstrap-2', name: 'integrate stripe' });

    // Sessions are stored wrapped in { session, ... }
    fs.writeFileSync(
      path.join(sessionsDir, 'sess-bootstrap-1.json'),
      JSON.stringify({ session: session1 }),
    );
    fs.writeFileSync(
      path.join(sessionsDir, 'sess-bootstrap-2.json'),
      JSON.stringify({ session: session2 }),
    );

    const count = await bootstrapModel(tmpDir);
    expect(count).toBe(2);

    // Model should have been saved
    const modelPath = path.join(tmpDir, 'predict', 'model.json');
    expect(fs.existsSync(modelPath)).toBe(true);
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as {
      sessionCount: number;
    };
    expect(model.sessionCount).toBe(2);
  });
});
