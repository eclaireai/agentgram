import { describe, it, expect } from 'vitest';
import {
  enrichRecipeWithProvenance,
} from '../../src/recipe/enriched.js';
import type { Session, ProvenanceGraph, Recipe } from '../../src/core/types.js';

const mockSession: Session = {
  id: 'sess-1',
  name: 'fix-auth',
  state: 'stopped',
  startedAt: 1000,
  stoppedAt: 9000,
  operations: [
    { id: 'op1', type: 'read', timestamp: 1000, target: 'src/auth.ts', metadata: {}, reason: 'check JWT logic', causedBy: [] },
    { id: 'op2', type: 'read', timestamp: 2000, target: 'package.json', metadata: {}, reason: 'check deps', causedBy: [] },
    { id: 'op3', type: 'write', timestamp: 3000, target: 'src/auth.ts', metadata: {}, reason: 'fix token verify', causedBy: ['op1'] },
    { id: 'op4', type: 'exec', timestamp: 4000, target: 'npm test', metadata: { command: 'npm test', exitCode: 0 }, reason: 'verify', causedBy: [] },
  ],
  branch: '',
  baseCommit: '',
  cwd: '/tmp',
};

const mockProvenance: ProvenanceGraph = {
  sessionId: 'sess-1',
  nodes: [
    { operationId: 'op1', target: 'src/auth.ts', type: 'read', timestamp: 1000 },
    { operationId: 'op2', target: 'package.json', type: 'read', timestamp: 2000 },
    { operationId: 'op3', target: 'src/auth.ts', type: 'write', timestamp: 3000 },
    { operationId: 'op4', target: 'npm test', type: 'exec', timestamp: 4000 },
  ],
  edges: [
    { from: 'op1', to: 'op3', relation: 'informed' },
    { from: 'op2', to: 'op3', relation: 'depends_on' },
    { from: 'op3', to: 'op4', relation: 'triggered' },
  ],
};

const mockRecipe: Recipe = {
  name: 'fix-auth',
  description: 'Fix auth',
  sourceSessionId: 'sess-1',
  steps: [
    { action: 'find', target: 'src/auth.ts', description: 'Read auth' },
    { action: 'modify_file', target: 'src/auth.ts', description: 'Fix token verify' },
    { action: 'run_command', target: 'npm test', description: 'Run tests' },
  ],
  parameters: {},
  tags: [],
  version: '1.0.0',
};

describe('Enriched Recipes (provenance-attached)', () => {
  it('attaches provenance graph to recipe', () => {
    const enriched = enrichRecipeWithProvenance(mockRecipe, mockProvenance, mockSession);
    expect(enriched.provenance).toBeDefined();
    expect(enriched.provenance.nodes).toHaveLength(4);
    expect(enriched.provenance.edges).toHaveLength(3);
  });

  it('attaches step-level causal explanations', () => {
    const enriched = enrichRecipeWithProvenance(mockRecipe, mockProvenance, mockSession);

    // The "modify_file src/auth.ts" step should explain WHY
    const writeStep = enriched.steps.find((s) => s.action === 'modify_file');
    expect(writeStep).toBeDefined();
    expect(writeStep!.why).toBeDefined();
    expect(writeStep!.why!.length).toBeGreaterThan(0);
    // Should mention it was informed by reading auth.ts
    expect(writeStep!.why!.some((w) => w.includes('auth.ts'))).toBe(true);
  });

  it('attaches preconditions to steps', () => {
    const enriched = enrichRecipeWithProvenance(mockRecipe, mockProvenance, mockSession);

    // The "run_command npm test" step should have "modify src/auth.ts" as precondition
    const execStep = enriched.steps.find((s) => s.action === 'run_command');
    expect(execStep).toBeDefined();
    expect(execStep!.preconditions).toBeDefined();
    expect(execStep!.preconditions!.length).toBeGreaterThan(0);
  });

  it('preserves all original recipe fields', () => {
    const enriched = enrichRecipeWithProvenance(mockRecipe, mockProvenance, mockSession);
    expect(enriched.name).toBe('fix-auth');
    expect(enriched.description).toBe('Fix auth');
    expect(enriched.steps.length).toBe(mockRecipe.steps.length);
    expect(enriched.parameters).toEqual({});
  });

  it('includes intent from operation reasons', () => {
    const enriched = enrichRecipeWithProvenance(mockRecipe, mockProvenance, mockSession);

    const readStep = enriched.steps.find((s) => s.action === 'find');
    expect(readStep!.intent).toBeDefined();
    // Should capture the "check JWT logic" reason
    expect(readStep!.intent).toContain('JWT');
  });
});
