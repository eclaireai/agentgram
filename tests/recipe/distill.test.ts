import { describe, it, expect, beforeEach } from 'vitest';
import yaml from 'yaml';
import { RecipeDistiller } from '../../src/recipe/distill.js';
import type { Session, Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let opIdCounter = 0;
function makeOp(
  overrides: Partial<Operation> & Pick<Operation, 'type' | 'target'>,
): Operation {
  opIdCounter += 1;
  return {
    id: `op-${opIdCounter}`,
    type: overrides.type,
    target: overrides.target,
    timestamp: overrides.timestamp ?? opIdCounter * 1000,
    metadata: overrides.metadata ?? {},
    reason: overrides.reason,
    causedBy: overrides.causedBy ?? [],
  };
}

function makeSession(ops: Operation[], partial?: Partial<Session>): Session {
  return {
    id: 'session-1',
    name: 'Test session',
    state: 'stopped',
    startedAt: 1000,
    stoppedAt: 99000,
    operations: ops,
    branch: 'agentgram/session-1',
    baseCommit: 'abc123',
    cwd: '/project',
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipeDistiller', () => {
  let distiller: RecipeDistiller;

  beforeEach(() => {
    opIdCounter = 0;
    distiller = new RecipeDistiller();
  });

  // ── Basic distillation ────────────────────────────────────────────────────

  it('distill() converts a session with reads/writes into recipe steps', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/index.ts', reason: 'Understand entry point' }),
      makeOp({ type: 'write', target: '/project/src/index.ts', reason: 'Add export' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);

    expect(recipe.steps.length).toBeGreaterThan(0);
    const actions = recipe.steps.map((s) => s.action);
    expect(actions).toContain('find');
    expect(actions).toContain('modify_file');
  });

  it('recipe has correct metadata (name, description, sourceSessionId, version)', () => {
    const session = makeSession([], { id: 'ses-42', name: 'My session' });
    const recipe = distiller.distill(session);

    expect(recipe.sourceSessionId).toBe('ses-42');
    expect(typeof recipe.name).toBe('string');
    expect(recipe.name.length).toBeGreaterThan(0);
    expect(typeof recipe.description).toBe('string');
    expect(typeof recipe.version).toBe('string');
    expect(recipe.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('recipe with no operations produces empty steps', () => {
    const session = makeSession([]);
    const recipe = distiller.distill(session);

    expect(recipe.steps).toEqual([]);
  });

  // ── Read collapsing ───────────────────────────────────────────────────────

  it('consecutive reads of related files are collapsed into one "find" step', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/a.ts', reason: 'Survey codebase' }),
      makeOp({ type: 'read', target: '/project/src/b.ts', reason: 'Survey codebase' }),
      makeOp({ type: 'read', target: '/project/src/c.ts', reason: 'Survey codebase' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    const findSteps = recipe.steps.filter((s) => s.action === 'find');

    // All three reads should collapse into a single find step
    expect(findSteps.length).toBe(1);
    expect(recipe.steps.length).toBe(1);
  });

  it('non-consecutive reads are NOT collapsed across unrelated operations', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/a.ts' }),
      makeOp({ type: 'write', target: '/project/src/a.ts' }),
      makeOp({ type: 'read', target: '/project/src/b.ts' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    const findSteps = recipe.steps.filter((s) => s.action === 'find');
    // Each read block is separate (one before write, one after)
    expect(findSteps.length).toBe(2);
  });

  // ── Write collapsing ──────────────────────────────────────────────────────

  it('write operations become "modify_file" steps', () => {
    const ops: Operation[] = [
      makeOp({ type: 'write', target: '/project/src/foo.ts', reason: 'Fix bug' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    expect(recipe.steps.some((s) => s.action === 'modify_file')).toBe(true);
  });

  it('create operations become "create_file" steps', () => {
    const ops: Operation[] = [
      makeOp({ type: 'create', target: '/project/src/new.ts', reason: 'New feature file' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    expect(recipe.steps.some((s) => s.action === 'create_file')).toBe(true);
  });

  it('duplicate/redundant operations targeting same file are deduplicated', () => {
    const ops: Operation[] = [
      makeOp({ type: 'write', target: '/project/src/foo.ts', reason: 'First edit' }),
      makeOp({ type: 'write', target: '/project/src/foo.ts', reason: 'Second edit' }),
      makeOp({ type: 'write', target: '/project/src/foo.ts', reason: 'Third edit' }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    const modifySteps = recipe.steps.filter(
      (s) => s.action === 'modify_file' && s.target.includes('foo.ts'),
    );
    // Three writes to same file → one modify_file step
    expect(modifySteps.length).toBe(1);
  });

  // ── Exec operations ───────────────────────────────────────────────────────

  it('exec operations become "run_command" steps', () => {
    const ops: Operation[] = [
      makeOp({
        type: 'exec',
        target: 'npm test',
        metadata: { command: 'npm test', exitCode: 0 },
        reason: 'Run tests',
      }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    expect(recipe.steps.some((s) => s.action === 'run_command')).toBe(true);
  });

  // ── Step ordering ─────────────────────────────────────────────────────────

  it('recipe steps are in correct order', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/a.ts', timestamp: 1000 }),
      makeOp({ type: 'write', target: '/project/src/b.ts', timestamp: 2000 }),
      makeOp({ type: 'exec', target: 'npm run build', timestamp: 3000, metadata: { command: 'npm run build' } }),
    ];
    const session = makeSession(ops);

    const recipe = distiller.distill(session);
    const actions = recipe.steps.map((s) => s.action);

    // find must come before modify_file, which must come before run_command
    const findIdx = actions.indexOf('find');
    const modifyIdx = actions.indexOf('modify_file');
    const execIdx = actions.indexOf('run_command');

    expect(findIdx).toBeLessThan(modifyIdx);
    expect(modifyIdx).toBeLessThan(execIdx);
  });

  // ── YAML serialization ────────────────────────────────────────────────────

  it('toYAML() produces valid YAML output', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/index.ts' }),
      makeOp({ type: 'write', target: '/project/src/index.ts' }),
    ];
    const session = makeSession(ops);
    const recipe = distiller.distill(session);

    const yamlStr = distiller.toYAML(recipe);

    expect(typeof yamlStr).toBe('string');
    // Must parse without throwing
    const parsed = yaml.parse(yamlStr);
    expect(parsed).toBeTruthy();
    expect(parsed.name).toBe(recipe.name);
    expect(parsed.version).toBe(recipe.version);
  });

  it('fromYAML() deserializes back to Recipe object', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/index.ts', reason: 'Check exports' }),
      makeOp({ type: 'write', target: '/project/src/index.ts', reason: 'Add new export' }),
      makeOp({ type: 'exec', target: 'npm test', metadata: { command: 'npm test' }, reason: 'Verify' }),
    ];
    const session = makeSession(ops, { id: 'ses-roundtrip' });
    const original = distiller.distill(session);

    const yamlStr = distiller.toYAML(original);
    const restored = distiller.fromYAML(yamlStr);

    expect(restored.name).toBe(original.name);
    expect(restored.description).toBe(original.description);
    expect(restored.sourceSessionId).toBe(original.sourceSessionId);
    expect(restored.version).toBe(original.version);
    expect(restored.steps.length).toBe(original.steps.length);
    expect(restored.steps[0].action).toBe(original.steps[0].action);
  });

  // ── JSON serialization ────────────────────────────────────────────────────

  it('toJSON() / fromJSON() round-trip preserves recipe', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/config.json' }),
      makeOp({ type: 'write', target: '/project/src/app.ts' }),
    ];
    const session = makeSession(ops, { id: 'ses-json' });
    const original = distiller.distill(session);

    const jsonStr = distiller.toJSON(original);
    const restored = distiller.fromJSON(jsonStr);

    expect(JSON.parse(jsonStr)).toBeTruthy();
    expect(restored.sourceSessionId).toBe('ses-json');
    expect(restored.steps.length).toBe(original.steps.length);
  });

  // ── Parameterization ──────────────────────────────────────────────────────

  it('parameterize() replaces concrete file paths with pattern variables', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/index.ts' }),
      makeOp({ type: 'write', target: '/project/src/index.ts' }),
    ];
    const session = makeSession(ops, { cwd: '/project' });
    const recipe = distiller.distill(session);
    const parameterized = distiller.parameterize(recipe);

    // Steps should use variables instead of absolute paths
    const allTargets = parameterized.steps.map((s) => s.target).join(' ');
    // Parameters should be populated
    expect(Object.keys(parameterized.parameters).length).toBeGreaterThan(0);
    // At least one target should use a variable pattern ({...})
    expect(allTargets).toMatch(/\{[a-z_]+\}/);
  });

  it('parameterize() detects repeated path prefixes', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/a.ts' }),
      makeOp({ type: 'read', target: '/project/src/b.ts' }),
      makeOp({ type: 'write', target: '/project/src/a.ts' }),
      makeOp({ type: 'write', target: '/project/src/b.ts' }),
    ];
    const session = makeSession(ops, { cwd: '/project' });
    const recipe = distiller.distill(session);
    const parameterized = distiller.parameterize(recipe);

    // The repeated /project/src prefix should become a parameter
    const paramValues = Object.values(parameterized.parameters);
    expect(paramValues.some((v) => v.includes('/project'))).toBe(true);
  });

  // ── Markdown output ───────────────────────────────────────────────────────

  it('toMarkdown() produces human-readable markdown recipe', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/index.ts', reason: 'Understand structure' }),
      makeOp({ type: 'write', target: '/project/src/index.ts', reason: 'Refactor exports' }),
      makeOp({ type: 'exec', target: 'npm test', metadata: { command: 'npm test' }, reason: 'Verify changes' }),
    ];
    const session = makeSession(ops);
    const recipe = distiller.distill(session);

    const md = distiller.toMarkdown(recipe);

    expect(typeof md).toBe('string');
    // Should have a heading
    expect(md).toMatch(/^#\s+/m);
    // Should contain step content
    expect(md.length).toBeGreaterThan(50);
    // Should list each step somehow
    recipe.steps.forEach((step) => {
      expect(md).toContain(step.action);
    });
  });

  // ── merge() ───────────────────────────────────────────────────────────────

  it('merge() combines similar recipes into one', () => {
    const opsA: Operation[] = [
      makeOp({ type: 'read', target: '/proj/src/a.ts' }),
      makeOp({ type: 'write', target: '/proj/src/a.ts' }),
    ];
    const opsB: Operation[] = [
      makeOp({ type: 'read', target: '/proj/src/b.ts' }),
      makeOp({ type: 'write', target: '/proj/src/b.ts' }),
    ];

    const recipeA = distiller.distill(makeSession(opsA, { id: 'ses-a' }));
    const recipeB = distiller.distill(makeSession(opsB, { id: 'ses-b' }));

    const merged = RecipeDistiller.merge([recipeA, recipeB]);

    expect(merged.steps.length).toBeGreaterThanOrEqual(
      Math.max(recipeA.steps.length, recipeB.steps.length),
    );
    expect(typeof merged.name).toBe('string');
    expect(typeof merged.version).toBe('string');
  });

  it('merge() with empty array returns empty recipe', () => {
    const merged = RecipeDistiller.merge([]);
    expect(merged.steps).toEqual([]);
  });

  // ── Complex session ───────────────────────────────────────────────────────

  it('complex session with 15+ ops distills to ~5 meaningful steps', () => {
    const ops: Operation[] = [
      // Phase 1: survey
      makeOp({ type: 'read', target: '/project/package.json', reason: 'Check dependencies' }),
      makeOp({ type: 'read', target: '/project/tsconfig.json', reason: 'Check TS config' }),
      makeOp({ type: 'read', target: '/project/src/index.ts', reason: 'Understand entry' }),
      makeOp({ type: 'read', target: '/project/src/core/types.ts', reason: 'Understand types' }),
      makeOp({ type: 'read', target: '/project/src/utils/hash.ts', reason: 'Understand utils' }),
      // Phase 2: modify
      makeOp({ type: 'write', target: '/project/src/core/types.ts', reason: 'Add new type' }),
      makeOp({ type: 'write', target: '/project/src/core/types.ts', reason: 'Refine new type' }),
      makeOp({ type: 'create', target: '/project/src/feature/new.ts', reason: 'Implement feature' }),
      makeOp({ type: 'write', target: '/project/src/feature/new.ts', reason: 'Add export' }),
      makeOp({ type: 'write', target: '/project/src/index.ts', reason: 'Re-export feature' }),
      // Phase 3: test
      makeOp({ type: 'exec', target: 'npm test', metadata: { command: 'npm test', exitCode: 1 }, reason: 'Run tests' }),
      makeOp({ type: 'read', target: '/project/tests/feature.test.ts', reason: 'Diagnose failure' }),
      makeOp({ type: 'write', target: '/project/src/feature/new.ts', reason: 'Fix test failure' }),
      makeOp({ type: 'exec', target: 'npm test', metadata: { command: 'npm test', exitCode: 0 }, reason: 'Verify fix' }),
      makeOp({ type: 'exec', target: 'npm run build', metadata: { command: 'npm run build', exitCode: 0 }, reason: 'Build for release' }),
    ];

    const session = makeSession(ops, { id: 'complex-session', name: 'Feature implementation' });
    const recipe = distiller.distill(session);

    // Should be meaningfully compressed: 15 ops → roughly 3–7 steps
    expect(recipe.steps.length).toBeGreaterThanOrEqual(3);
    expect(recipe.steps.length).toBeLessThanOrEqual(8);

    // Should have all major action types represented
    const actions = recipe.steps.map((s) => s.action);
    expect(actions).toContain('find');
    // should have at least one write-type step
    expect(
      actions.some((a) => a === 'modify_file' || a === 'create_file'),
    ).toBe(true);
    expect(actions).toContain('run_command');
  });

  // ── Step descriptions ─────────────────────────────────────────────────────

  it('step descriptions are non-empty strings', () => {
    const ops: Operation[] = [
      makeOp({ type: 'read', target: '/project/src/a.ts', reason: 'Investigate structure' }),
      makeOp({ type: 'write', target: '/project/src/a.ts', reason: 'Apply fix' }),
    ];
    const session = makeSession(ops);
    const recipe = distiller.distill(session);

    recipe.steps.forEach((step) => {
      expect(typeof step.description).toBe('string');
      expect(step.description.length).toBeGreaterThan(0);
    });
  });

  it('step descriptions incorporate reason metadata when available', () => {
    const ops: Operation[] = [
      makeOp({ type: 'write', target: '/project/src/foo.ts', reason: 'Implement OAuth login' }),
    ];
    const session = makeSession(ops);
    const recipe = distiller.distill(session);

    const descriptions = recipe.steps.map((s) => s.description).join(' ');
    expect(descriptions).toContain('OAuth');
  });
});
