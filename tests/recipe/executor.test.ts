import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  RecipeExecutor,
  saveReport,
  loadReports,
  submitFeedback,
} from '../../src/recipe/executor.js';
import type { ExecutionReport } from '../../src/recipe/executor.js';
import type { Recipe, Operation } from '../../src/core/types.js';
import type { SharedRecipe } from '../../src/recipe/types.js';
import type { AgentraceSession } from '../../src/core/session.js';

// Mock AgentraceSession as EventEmitter with getOperations
function createMockSession(): AgentraceSession {
  const emitter = new EventEmitter();
  (emitter as unknown as { getOperations: () => Operation[] }).getOperations = () => [];
  return emitter as unknown as AgentraceSession;
}

function makeOp(id: string, type: string, target: string, timestamp?: number): Operation {
  return {
    id,
    type: type as Operation['type'],
    timestamp: timestamp ?? Date.now(),
    target,
    metadata: {},
    causedBy: [],
  };
}

const testRecipe: Recipe = {
  name: 'Add Authentication',
  description: 'Add JWT auth to Express app',
  sourceSessionId: 'test-session',
  steps: [
    { action: 'find', target: 'src/auth.ts', description: 'Read auth file' },
    { action: 'find', target: 'package.json', description: 'Check deps' },
    { action: 'modify_file', target: 'src/auth.ts', description: 'Fix token validation' },
    { action: 'create_file', target: 'tests/auth.test.ts', description: 'Add tests' },
    { action: 'run_command', target: 'npm test', description: 'Run tests' },
  ],
  parameters: {},
  tags: ['auth'],
  version: '1.0.0',
};

describe('RecipeExecutor', () => {
  let session: AgentraceSession;

  beforeEach(() => {
    session = createMockSession();
  });

  describe('initialization', () => {
    it('creates with all steps pending', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      const progress = executor.getProgress();
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(5);
    });

    it('provides guidance for current step', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      const guidance = executor.getGuidance();
      expect(guidance).toContain('Step 1/5');
      expect(guidance).toContain('find');
      expect(guidance).toContain('src/auth.ts');
    });
  });

  describe('step matching', () => {
    it('advances on matching operation', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      // Emit a read operation matching step 1
      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });

      const progress = executor.getProgress();
      expect(progress.completed).toBe(1);
      expect(progress.current).toContain('package.json');
    });

    it('tracks full recipe completion', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op2', 'read', 'package.json') });
      session.emit('operation', { operation: makeOp('op3', 'write', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op4', 'create', 'tests/auth.test.ts') });
      session.emit('operation', { operation: makeOp('op5', 'exec', 'npm test') });

      const progress = executor.getProgress();
      expect(progress.completed).toBe(5);
      expect(progress.current).toBe('done');
    });

    it('handles extra operations without breaking', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      // Extra read (exploration)
      session.emit('operation', { operation: makeOp('extra1', 'read', 'README.md') });
      // Now match step 1
      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });

      expect(executor.getProgress().completed).toBe(1);
    });

    it('detects step skipping (agent jumps ahead)', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      // Skip step 1&2 (reads), go straight to write
      session.emit('operation', { operation: makeOp('op1', 'write', 'src/auth.ts') });

      // Steps 1&2 should be deviated, step 3 completed
      const report = executor.finalize();
      expect(report.steps[0].status).toBe('deviated');
      expect(report.steps[1].status).toBe('deviated');
      expect(report.steps[2].status).toBe('completed');
    });

    it('handles parameterized targets', () => {
      const paramRecipe: Recipe = {
        ...testRecipe,
        steps: [{ action: 'find', target: '{src}/auth.ts', description: 'Read auth' }],
        parameters: { src: 'lib' },
      };

      const executor = new RecipeExecutor(paramRecipe, session, { src: 'lib' });
      executor.start();

      session.emit('operation', { operation: makeOp('op1', 'read', 'lib/auth.ts') });

      expect(executor.getProgress().completed).toBe(1);
    });
  });

  describe('finalize and report', () => {
    it('generates a complete execution report', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op2', 'read', 'package.json') });
      session.emit('operation', { operation: makeOp('op3', 'write', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op4', 'create', 'tests/auth.test.ts') });
      session.emit('operation', { operation: makeOp('op5', 'exec', 'npm test') });

      const report = executor.finalize();

      expect(report.success).toBe(true);
      expect(report.completionRate).toBe(1);
      expect(report.deviationRate).toBe(0);
      expect(report.score).toBeGreaterThan(0);
      expect(report.metrics.totalOperations).toBe(5);
      expect(report.metrics.onRecipeOperations).toBe(5);
      expect(report.metrics.extraOperations).toBe(0);
      expect(report.metrics.efficiency).toBe(1);
      expect(report.metrics.savingsPercent).toBeGreaterThan(0);
    });

    it('reports partial completion', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op2', 'read', 'package.json') });
      // Only 2 of 5 steps

      const report = executor.finalize();
      expect(report.completionRate).toBe(0.4);
      expect(report.steps.filter((s) => s.status === 'completed')).toHaveLength(2);
      expect(report.steps.filter((s) => s.status === 'skipped')).toHaveLength(3);
    });

    it('calculates efficiency with extra operations', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      // 3 extra ops + 5 recipe ops = 8 total, efficiency = 5/8
      session.emit('operation', { operation: makeOp('extra1', 'read', 'README.md') });
      session.emit('operation', { operation: makeOp('extra2', 'read', 'tsconfig.json') });
      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op2', 'read', 'package.json') });
      session.emit('operation', { operation: makeOp('op3', 'write', 'src/auth.ts') });
      session.emit('operation', { operation: makeOp('op4', 'create', 'tests/auth.test.ts') });
      session.emit('operation', { operation: makeOp('op5', 'exec', 'npm test') });
      session.emit('operation', { operation: makeOp('extra3', 'exec', 'npm run lint') });

      const report = executor.finalize();
      expect(report.metrics.totalOperations).toBe(8);
      expect(report.metrics.onRecipeOperations).toBe(5);
      expect(report.metrics.extraOperations).toBe(3);
      expect(report.metrics.efficiency).toBe(5 / 8);
    });

    it('throws if finalized twice', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();
      executor.finalize();
      expect(() => executor.finalize()).toThrow('already finalized');
    });

    it('emits execution_complete event', () => {
      const executor = new RecipeExecutor(testRecipe, session);
      executor.start();

      let emittedReport: ExecutionReport | null = null;
      executor.on('execution_complete', (r: ExecutionReport) => { emittedReport = r; });

      executor.finalize();
      expect(emittedReport).not.toBeNull();
      expect(emittedReport!.recipeName).toBe('Add Authentication');
    });
  });

  describe('guidance', () => {
    it('returns done message when all steps complete', () => {
      const simpleRecipe: Recipe = {
        ...testRecipe,
        steps: [{ action: 'find', target: 'src/auth.ts', description: 'Read' }],
      };
      const executor = new RecipeExecutor(simpleRecipe, session);
      executor.start();

      session.emit('operation', { operation: makeOp('op1', 'read', 'src/auth.ts') });

      expect(executor.getGuidance()).toContain('completed');
    });

    it('substitutes parameters in guidance', () => {
      const paramRecipe: Recipe = {
        ...testRecipe,
        steps: [{ action: 'find', target: '{root}/auth.ts', description: 'Read auth' }],
        parameters: { root: 'src' },
      };
      const executor = new RecipeExecutor(paramRecipe, session);
      expect(executor.getGuidance()).toContain('src/auth.ts');
    });
  });
});

describe('Report persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mockReport: ExecutionReport = {
    recipeId: 'test-recipe',
    recipeName: 'Test Recipe',
    sessionId: 'sess-1',
    steps: [],
    metrics: {
      totalOperations: 10,
      onRecipeOperations: 8,
      extraOperations: 2,
      estimatedTokensSaved: 40000,
      efficiency: 0.8,
      totalDurationMs: 30000,
      estimatedCostWithoutRecipe: 2.40,
      estimatedCostWithRecipe: 0.50,
      savingsPercent: 79,
    },
    success: true,
    completionRate: 1,
    deviationRate: 0,
    score: 4.5,
    executedAt: new Date().toISOString(),
    sourceAgent: 'claude-code',
  };

  it('saves and loads reports', async () => {
    await saveReport(tmpDir, mockReport);

    const reports = await loadReports(tmpDir);
    expect(reports).toHaveLength(1);
    expect(reports[0].recipeId).toBe('test-recipe');
    expect(reports[0].metrics.savingsPercent).toBe(79);
  });

  it('filters reports by recipe ID', async () => {
    await saveReport(tmpDir, mockReport);
    await saveReport(tmpDir, { ...mockReport, recipeId: 'other-recipe', recipeName: 'Other' });

    const filtered = await loadReports(tmpDir, 'test-recipe');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].recipeId).toBe('test-recipe');
  });

  it('returns empty when no reports exist', async () => {
    const reports = await loadReports(tmpDir);
    expect(reports).toHaveLength(0);
  });
});

describe('submitFeedback', () => {
  it('updates recipe rating', async () => {
    const recipe: SharedRecipe = {
      name: 'Test',
      description: 'test',
      sourceSessionId: 'sess',
      steps: [],
      parameters: {},
      tags: [],
      version: '1.0.0',
      metadata: {
        id: 'test-recipe',
        author: 'tester',
        createdAt: '',
        updatedAt: '',
        downloads: 10,
        rating: 4.0,
        ratingCount: 5,
        sourceAgent: 'claude-code',
        checksum: '',
      },
    };

    const store = {
      load: vi.fn().mockResolvedValue({ ...recipe }),
      save: vi.fn().mockResolvedValue(undefined),
    };

    const report: ExecutionReport = {
      recipeId: 'test-recipe',
      recipeName: 'Test',
      sessionId: '',
      steps: [],
      metrics: {} as ExecutionReport['metrics'],
      success: true,
      completionRate: 1,
      deviationRate: 0,
      score: 5.0,
      executedAt: '',
      sourceAgent: 'claude-code',
    };

    await submitFeedback(report, { publish: vi.fn() }, store);

    expect(store.save).toHaveBeenCalled();
    const saved = store.save.mock.calls[0][0];
    // Old: (4.0 * 5 + 5.0) / 6 = 25/6 ≈ 4.2
    expect(saved.metadata.rating).toBeCloseTo(4.2, 0);
    expect(saved.metadata.ratingCount).toBe(6);
  });
});
