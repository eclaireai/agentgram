#!/usr/bin/env npx tsx
/**
 * Efficacy Proof — Demonstrates that recipe-guided agents use fewer
 * operations and cost less than unguided agents.
 *
 * Simulates two scenarios:
 *   1. Unguided: Agent figures out "Setup Vitest" from scratch (12 ops, retries)
 *   2. Guided:   Agent follows the recipe (6 ops, no retries)
 *
 * Measures via RecipeExecutor and prints the cost comparison.
 */

import { EventEmitter } from 'node:events';
import { RecipeExecutor } from '../src/recipe/executor.js';
import type { Recipe, Operation } from '../src/core/types.js';
import type { AgentraceSession } from '../src/core/session.js';

// The recipe we're testing against
const vitestRecipe: Recipe = {
  name: 'Setup Vitest Testing',
  description: 'Set up Vitest with TypeScript and coverage',
  sourceSessionId: 'proof',
  steps: [
    { action: 'find', target: 'package.json', description: 'Check existing test framework' },
    { action: 'find', target: 'tsconfig.json', description: 'Check TypeScript config' },
    { action: 'run_command', target: 'npm install -D vitest @vitest/coverage-v8', description: 'Install vitest' },
    { action: 'create_file', target: 'vitest.config.ts', description: 'Create vitest config' },
    { action: 'modify_file', target: 'package.json', description: 'Add test scripts' },
    { action: 'run_command', target: 'npm test', description: 'Verify tests pass' },
  ],
  parameters: {},
  tags: ['testing', 'vitest'],
  version: '1.0.0',
};

function mockSession(): AgentraceSession {
  return new EventEmitter() as unknown as AgentraceSession;
}

function op(id: string, type: string, target: string): Operation {
  return { id, type: type as Operation['type'], timestamp: Date.now(), target, metadata: {}, causedBy: [] };
}

function main() {
  console.log('\n\x1b[1m\x1b[36m');
  console.log('  ╔════════════════════════════════════════════════════╗');
  console.log('  ║   agentgram Efficacy Proof                        ║');
  console.log('  ║   Recipe-guided vs. Unguided Agent Comparison     ║');
  console.log('  ╚════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // ── Scenario 1: UNGUIDED agent ──────────────────────────────────

  console.log('\x1b[1m▸ Scenario 1: UNGUIDED agent (no recipe)\x1b[0m');
  console.log('  Agent tries to set up Vitest from scratch...\n');

  const unguidedSession = mockSession();
  const unguidedExecutor = new RecipeExecutor(vitestRecipe, unguidedSession);
  unguidedExecutor.start();

  // Simulate an unguided agent: exploration, wrong turns, retries
  const unguidedOps = [
    op('u1', 'read', 'README.md'),                      // reads README first (unnecessary)
    op('u2', 'read', 'package.json'),                    // ✓ matches step 1
    op('u3', 'read', 'src/index.ts'),                    // reads source (unnecessary)
    op('u4', 'read', 'tsconfig.json'),                   // ✓ matches step 2
    op('u5', 'read', '.gitignore'),                      // reads gitignore (unnecessary)
    op('u6', 'exec', 'npm install -D jest'),             // wrong framework!
    op('u7', 'read', 'package.json'),                    // re-reads to check
    op('u8', 'exec', 'npm uninstall jest'),              // undo mistake
    op('u9', 'exec', 'npm install -D vitest @vitest/coverage-v8'), // ✓ matches step 3
    op('u10', 'create', 'vitest.config.ts'),             // ✓ matches step 4
    op('u11', 'write', 'package.json'),                  // ✓ matches step 5
    op('u12', 'exec', 'npm test'),                       // fails first time
    op('u13', 'write', 'vitest.config.ts'),              // fix config
    op('u14', 'exec', 'npm test'),                       // ✓ matches step 6 (pass)
  ];

  for (const o of unguidedOps) {
    unguidedSession.emit('operation', { operation: o });
  }

  const unguidedReport = unguidedExecutor.finalize();

  console.log(`  Operations: \x1b[31m${unguidedReport.metrics.totalOperations}\x1b[0m`);
  console.log(`  On-recipe:  ${unguidedReport.metrics.onRecipeOperations}`);
  console.log(`  Wasted:     \x1b[31m${unguidedReport.metrics.extraOperations}\x1b[0m (exploration + retries)`);
  console.log(`  Efficiency: \x1b[31m${Math.round(unguidedReport.metrics.efficiency * 100)}%\x1b[0m`);
  console.log(`  Est. cost:  \x1b[31m$${unguidedReport.metrics.estimatedCostWithRecipe}\x1b[0m`);
  console.log(`  Score:      ${unguidedReport.score}/5`);
  console.log();

  // ── Scenario 2: GUIDED agent (following recipe) ─────────────────

  console.log('\x1b[1m▸ Scenario 2: GUIDED agent (following recipe)\x1b[0m');
  console.log('  Agent follows the proven recipe step-by-step...\n');

  const guidedSession = mockSession();
  const guidedExecutor = new RecipeExecutor(vitestRecipe, guidedSession);
  guidedExecutor.start();

  // Simulate a guided agent: follows recipe exactly
  const guidedOps = [
    op('g1', 'read', 'package.json'),                    // ✓ step 1
    op('g2', 'read', 'tsconfig.json'),                   // ✓ step 2
    op('g3', 'exec', 'npm install -D vitest @vitest/coverage-v8'), // ✓ step 3
    op('g4', 'create', 'vitest.config.ts'),              // ✓ step 4
    op('g5', 'write', 'package.json'),                   // ✓ step 5
    op('g6', 'exec', 'npm test'),                        // ✓ step 6
  ];

  for (const o of guidedOps) {
    guidedSession.emit('operation', { operation: o });
  }

  const guidedReport = guidedExecutor.finalize();

  console.log(`  Operations: \x1b[32m${guidedReport.metrics.totalOperations}\x1b[0m`);
  console.log(`  On-recipe:  ${guidedReport.metrics.onRecipeOperations}`);
  console.log(`  Wasted:     \x1b[32m${guidedReport.metrics.extraOperations}\x1b[0m`);
  console.log(`  Efficiency: \x1b[32m${Math.round(guidedReport.metrics.efficiency * 100)}%\x1b[0m`);
  console.log(`  Est. cost:  \x1b[32m$${guidedReport.metrics.estimatedCostWithRecipe}\x1b[0m`);
  console.log(`  Score:      ${guidedReport.score}/5`);
  console.log();

  // ── Comparison ──────────────────────────────────────────────────

  const opsReduction = Math.round((1 - guidedReport.metrics.totalOperations / unguidedReport.metrics.totalOperations) * 100);
  const costReduction = Math.round((1 - guidedReport.metrics.estimatedCostWithRecipe / unguidedReport.metrics.estimatedCostWithRecipe) * 100);
  const tokensSaved = (unguidedReport.metrics.totalOperations - guidedReport.metrics.totalOperations) * 2000;

  console.log('\x1b[1m▸ COMPARISON\x1b[0m');
  console.log('  ┌──────────────────┬────────────┬────────────┐');
  console.log('  │ Metric           │ Unguided   │ Guided     │');
  console.log('  ├──────────────────┼────────────┼────────────┤');
  console.log(`  │ Operations       │ \x1b[31m${String(unguidedReport.metrics.totalOperations).padEnd(10)}\x1b[0m │ \x1b[32m${String(guidedReport.metrics.totalOperations).padEnd(10)}\x1b[0m │`);
  console.log(`  │ Wasted ops       │ \x1b[31m${String(unguidedReport.metrics.extraOperations).padEnd(10)}\x1b[0m │ \x1b[32m${String(guidedReport.metrics.extraOperations).padEnd(10)}\x1b[0m │`);
  console.log(`  │ Efficiency       │ \x1b[31m${(Math.round(unguidedReport.metrics.efficiency * 100) + '%').padEnd(10)}\x1b[0m │ \x1b[32m${(Math.round(guidedReport.metrics.efficiency * 100) + '%').padEnd(10)}\x1b[0m │`);
  console.log(`  │ Est. cost        │ \x1b[31m${'$' + unguidedReport.metrics.estimatedCostWithRecipe}${' '.repeat(Math.max(0, 9 - String(unguidedReport.metrics.estimatedCostWithRecipe).length))}\x1b[0m │ \x1b[32m${'$' + guidedReport.metrics.estimatedCostWithRecipe}${' '.repeat(Math.max(0, 9 - String(guidedReport.metrics.estimatedCostWithRecipe).length))}\x1b[0m │`);
  console.log(`  │ Score            │ ${String(unguidedReport.score + '/5').padEnd(10)} │ ${String(guidedReport.score + '/5').padEnd(10)} │`);
  console.log('  └──────────────────┴────────────┴────────────┘');
  console.log();
  console.log(`  \x1b[1m\x1b[32m↓ ${opsReduction}% fewer operations\x1b[0m`);
  console.log(`  \x1b[1m\x1b[32m↓ ${costReduction}% cost reduction\x1b[0m`);
  console.log(`  \x1b[1m\x1b[32m↓ ${tokensSaved.toLocaleString()} tokens saved\x1b[0m`);
  console.log();
  console.log('  Recipe-guided agents are faster, cheaper, and more reliable.');
  console.log('  This is why recipes are the future of agentic coding.\n');
}

main();
