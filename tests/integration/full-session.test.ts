/**
 * Integration tests for the full agentgram session lifecycle.
 *
 * Each test creates a real temporary git repository, performs real file
 * operations, and validates the complete pipeline across ShadowWorktree,
 * ProvenanceTracker, and RecipeDistiller.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ShadowWorktree } from '../../src/worktree/shadow.js';
import { ProvenanceTracker } from '../../src/provenance/graph.js';
import { RecipeDistiller } from '../../src/recipe/distill.js';
import type { Session, Operation } from '../../src/core/types.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared git/fs helpers
// ---------------------------------------------------------------------------

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgram-integration-'));

  await runGit(dir, ['init', '--initial-branch=main']);
  await runGit(dir, ['config', 'user.email', 'test@agentgram.local']);
  await runGit(dir, ['config', 'user.name', 'agentgram-test']);

  // Seed repository with an initial commit so HEAD resolves
  await fs.writeFile(path.join(dir, 'README.md'), '# test repo\n');
  await runGit(dir, ['add', '.']);
  await runGit(dir, ['commit', '-m', 'initial commit']);

  return dir;
}

async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function getCommitCount(cwd: string): Promise<number> {
  const out = await runGit(cwd, ['rev-list', '--count', 'HEAD']);
  return parseInt(out, 10);
}

async function getCurrentBranch(cwd: string): Promise<string> {
  return runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

async function getAllCommitMessages(cwd: string): Promise<string[]> {
  const out = await runGit(cwd, ['log', '--pretty=%s']);
  return out.split('\n').filter(Boolean);
}

async function getBranchCommitMessages(cwd: string, branch: string): Promise<string[]> {
  const out = await runGit(cwd, ['log', branch, '--pretty=%s']);
  return out.split('\n').filter(Boolean);
}

/**
 * Build a minimal in-memory Session object from a ShadowWorktree summary for
 * use with ProvenanceTracker / RecipeDistiller.
 */
function buildSession(
  name: string,
  id: string,
  cwd: string,
  ops: Operation[],
  branch: string,
  baseCommit: string,
): Session {
  return {
    id,
    name,
    state: 'stopped',
    startedAt: ops[0]?.timestamp ?? Date.now(),
    stoppedAt: ops[ops.length - 1]?.timestamp ?? Date.now(),
    operations: ops,
    branch,
    baseCommit,
    cwd,
  };
}

// ---------------------------------------------------------------------------
// Test 1 – Full session lifecycle
// ---------------------------------------------------------------------------

describe('Full session lifecycle', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('tracks read → create → write → exec and produces correct git history, provenance, and recipe', async () => {
    // ---- seed a config file that will be read ----
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2),
    );
    await runGit(tmpDir, ['add', '.']);
    await runGit(tmpDir, ['commit', '-m', 'add package.json']);

    // ---- start session ----
    const sw = await ShadowWorktree.create(tmpDir, 'full-lifecycle');

    // 1. Read config (twice — the second is redundant, so distiller collapses both into one step)
    const readOp = await sw.trackRead('package.json', {
      reason: 'read project config to determine structure',
    });
    await sw.trackRead('package.json', { reason: 're-read config to double-check' });

    // 2. Create new source file
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/index.ts'), 'export const main = () => {};\n');
    const createOp = await sw.trackCreate('src/index.ts', {
      reason: 'scaffold main entry point',
      causedBy: [readOp.id],
    });

    // 3. Modify existing file
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.1', main: 'src/index.ts' }, null, 2),
    );
    const writeOp = await sw.trackWrite('package.json', {
      reason: 'bump version and set main',
      causedBy: [readOp.id],
    });

    // 4. Execute test command (simulated)
    const _execOp = await sw.trackExec(
      'npm test',
      { exitCode: 0, output: 'Tests passed' },
      { reason: 'verify changes', causedBy: [createOp.id, writeOp.id] },
    );

    // ---- stop session ----
    const summary = await sw.stop();

    // ---- assert: session state ----
    expect(summary.session.state).toBe('stopped');
    expect(summary.operations).toHaveLength(5);
    expect(summary.branchName).toMatch(/^agentgram\/full-lifecycle-/);

    // ---- assert: shadow branch has correct micro-commits ----
    const shadowMessages = await getBranchCommitMessages(tmpDir, summary.branchName);
    // 3 commits that produce a git change: create, write, exec  (read does not commit)
    const agentgramMessages = shadowMessages.filter((m) => m.includes('[agentgram]'));
    expect(agentgramMessages.length).toBeGreaterThanOrEqual(3);
    expect(agentgramMessages.some((m) => m.includes('create') && m.includes('src/index.ts'))).toBe(true);
    expect(agentgramMessages.some((m) => m.includes('write') && m.includes('package.json'))).toBe(true);
    expect(agentgramMessages.some((m) => m.includes('exec') && m.includes('npm test'))).toBe(true);

    // ---- assert: original branch is clean, no agentgram commits ----
    const mainMessages = await getBranchCommitMessages(tmpDir, 'main');
    const mainAgentrace = mainMessages.filter((m) => m.includes('[agentgram]'));
    expect(mainAgentrace).toHaveLength(0);

    // ---- build provenance graph ----
    const tracker = new ProvenanceTracker(summary.session.id);
    const ops = summary.operations;

    for (const op of ops) {
      if (op.type === 'read') tracker.addRead(op);
      else if (op.type === 'exec') tracker.addExec(op);
      else tracker.addWrite(op);
    }

    const graph = tracker.getProvenance();

    // All 5 operations should be nodes (2 reads + create + write + exec)
    expect(graph.nodes).toHaveLength(5);

    // create op was caused by read → should have an "informed" edge
    const createNode = graph.nodes.find((n) => n.operationId === createOp.id);
    expect(createNode).toBeDefined();
    const edgesToCreate = graph.edges.filter((e) => e.to === createOp.id);
    expect(edgesToCreate.length).toBeGreaterThanOrEqual(1);
    const createEdgeRelations = edgesToCreate.map((e) => e.relation);
    expect(createEdgeRelations).toContain('informed');

    // write op was caused by read (config file) → should have a "depends_on" edge
    const writeDepsEdges = graph.edges.filter(
      (e) => e.to === writeOp.id && e.from === readOp.id,
    );
    expect(writeDepsEdges.length).toBeGreaterThanOrEqual(1);
    expect(writeDepsEdges[0].relation).toBe('informed');

    // ---- distill recipe ----
    const session = buildSession(
      'full-lifecycle',
      summary.session.id,
      tmpDir,
      ops,
      summary.branchName,
      summary.baseCommit,
    );

    const distiller = new RecipeDistiller();
    const recipe = distiller.distill(session);

    // Recipe should be meaningfully compressed: 5 raw ops (2 reads collapse to 1 find step)
    // → fewer steps than raw operations
    expect(recipe.steps.length).toBeLessThan(ops.length);
    expect(recipe.steps.length).toBeGreaterThan(0);

    // Should contain a run_command step for npm test
    const runStep = recipe.steps.find((s) => s.action === 'run_command');
    expect(runStep).toBeDefined();
    expect(runStep?.target).toBe('npm test');

    // Should have a create_file or find step
    const fileSteps = recipe.steps.filter(
      (s) => s.action === 'create_file' || s.action === 'find' || s.action === 'modify_file',
    );
    expect(fileSteps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 – Session persistence and reload
// ---------------------------------------------------------------------------

describe('Session persistence and reload', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('serialises session JSON to disk and reloads it with all data preserved', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'persist-session');

    await sw.trackRead('README.md', { reason: 'inspect readme' });

    await fs.writeFile(path.join(tmpDir, 'output.txt'), 'result data\n');
    await sw.trackWrite('output.txt', { reason: 'write results' });

    await sw.trackExec('echo done', { exitCode: 0, output: 'done' }, { reason: 'confirm' });

    const summary = await sw.stop();

    // Build the full session object
    const session = buildSession(
      'persist-session',
      summary.session.id,
      tmpDir,
      summary.operations,
      summary.branchName,
      summary.baseCommit,
    );

    // Also persist the provenance tracker
    const tracker = new ProvenanceTracker(session.id);
    for (const op of session.operations) {
      if (op.type === 'read') tracker.addRead(op);
      else if (op.type === 'exec') tracker.addExec(op);
      else tracker.addWrite(op);
    }

    // ---- serialise to disk ----
    const sessionPath = path.join(tmpDir, 'session.json');
    const trackerPath = path.join(tmpDir, 'tracker.json');

    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
    await fs.writeFile(trackerPath, JSON.stringify(tracker.toJSON(), null, 2));

    // ---- reload ----
    const sessionRaw = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as Session;
    const trackerRaw = JSON.parse(await fs.readFile(trackerPath, 'utf8'));
    const reloadedTracker = ProvenanceTracker.fromJSON(trackerRaw);

    // ---- verify session data preserved ----
    expect(sessionRaw.id).toBe(session.id);
    expect(sessionRaw.name).toBe('persist-session');
    expect(sessionRaw.state).toBe('stopped');
    expect(sessionRaw.operations).toHaveLength(3);
    expect(sessionRaw.branch).toBe(summary.branchName);
    expect(sessionRaw.baseCommit).toBe(summary.baseCommit);
    expect(sessionRaw.cwd).toBe(tmpDir);

    // ---- verify operations preserved ----
    const ops = sessionRaw.operations;
    expect(ops[0].type).toBe('read');
    expect(ops[0].target).toBe('README.md');
    expect(ops[0].reason).toBe('inspect readme');
    expect(ops[1].type).toBe('write');
    expect(ops[1].target).toBe('output.txt');
    expect(ops[1].reason).toBe('write results');
    expect(ops[2].type).toBe('exec');
    expect(ops[2].metadata.exitCode).toBe(0);
    expect(ops[2].metadata.output).toBe('done');

    // ---- verify provenance graph preserved ----
    const reloadedGraph = reloadedTracker.getProvenance();
    expect(reloadedGraph.sessionId).toBe(session.id);
    expect(reloadedGraph.nodes).toHaveLength(3);

    // Node types match original operations
    const nodeTypes = reloadedGraph.nodes.map((n) => n.type).sort();
    expect(nodeTypes).toEqual(['exec', 'read', 'write']);
  });
});

// ---------------------------------------------------------------------------
// Test 3 – Provenance graph visualization
// ---------------------------------------------------------------------------

describe('Provenance graph visualization', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('generates valid DOT output with expected nodes and edges', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'viz-dot-session');

    const readOp = await sw.trackRead('package.json', { reason: 'read config' });

    await fs.writeFile(path.join(tmpDir, 'lib.ts'), 'export {};');
    const createOp = await sw.trackCreate('lib.ts', {
      reason: 'create library',
      causedBy: [readOp.id],
    });

    const execOp = await sw.trackExec(
      'tsc --build',
      { exitCode: 0, output: 'built' },
      { causedBy: [createOp.id] },
    );

    const summary = await sw.stop();

    // Build tracker
    const tracker = new ProvenanceTracker(summary.session.id);
    for (const op of [readOp, createOp, execOp]) {
      if (op.type === 'read') tracker.addRead(op);
      else if (op.type === 'exec') tracker.addExec(op);
      else tracker.addWrite(op);
    }

    const dot = tracker.toDot();

    // DOT structure checks
    expect(dot).toContain('digraph provenance {');
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain(readOp.id);
    expect(dot).toContain(createOp.id);
    expect(dot).toContain(execOp.id);

    // Node labels contain type and target
    expect(dot).toContain('read');
    expect(dot).toContain('package.json');
    expect(dot).toContain('create');
    expect(dot).toContain('lib.ts');
    expect(dot).toContain('exec');
    expect(dot).toContain('tsc --build');

    // Edges present
    const graph = tracker.getProvenance();
    for (const edge of graph.edges) {
      expect(dot).toContain(edge.from);
      expect(dot).toContain(edge.to);
      expect(dot).toContain(edge.relation);
    }

    // Each edge has a style attribute
    expect(dot).toMatch(/style=(solid|dashed|dotted|bold)/);
  });

  it('generates valid Mermaid output with expected nodes and edges', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'viz-mermaid-session');

    const readOp = await sw.trackRead('tsconfig.json', { reason: 'read ts config' });

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const app = {};');
    const writeOp = await sw.trackWrite('app.ts', {
      reason: 'create app module',
      causedBy: [readOp.id],
    });

    const summary = await sw.stop();

    const tracker = new ProvenanceTracker(summary.session.id);
    tracker.addRead(readOp);
    tracker.addWrite(writeOp);

    const mermaid = tracker.toMermaid();

    // Mermaid structure checks
    expect(mermaid).toContain('graph LR');

    // Nodes present (mermaid ids are prefixed with _ and special chars replaced)
    const safeReadId = '_' + readOp.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const safeWriteId = '_' + writeOp.id.replace(/[^a-zA-Z0-9_]/g, '_');
    expect(mermaid).toContain(safeReadId);
    expect(mermaid).toContain(safeWriteId);

    // Node labels contain type and target
    expect(mermaid).toContain('read: tsconfig.json');
    expect(mermaid).toContain('write: app.ts');

    // Edge present with relation label
    const graph = tracker.getProvenance();
    for (const edge of graph.edges) {
      const fromId = '_' + edge.from.replace(/[^a-zA-Z0-9_]/g, '_');
      const toId = '_' + edge.to.replace(/[^a-zA-Z0-9_]/g, '_');
      expect(mermaid).toContain(`${fromId} -->|"${edge.relation}"| ${toId}`);
    }
  });

  it('getAncestors() and getDescendants() traverse causal chains correctly', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'viz-traversal-session');

    const r1 = await sw.trackRead('package.json', { reason: 'read pkg' });
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'a');
    const c1 = await sw.trackCreate('a.ts', { causedBy: [r1.id] });
    await fs.writeFile(path.join(tmpDir, 'b.ts'), 'b');
    const c2 = await sw.trackCreate('b.ts', { causedBy: [c1.id] });

    await sw.stop();

    const tracker = new ProvenanceTracker('traversal-test');
    tracker.addRead(r1);
    tracker.addWrite(c1);
    tracker.addWrite(c2);

    // Ancestors of c2 should include c1 and r1
    const ancestors = tracker.getAncestors(c2.id);
    const ancestorIds = ancestors.map((n) => n.operationId);
    expect(ancestorIds).toContain(c1.id);
    expect(ancestorIds).toContain(r1.id);

    // Descendants of r1 should include c1 and c2
    const descendants = tracker.getDescendants(r1.id);
    const descendantIds = descendants.map((n) => n.operationId);
    expect(descendantIds).toContain(c1.id);
    expect(descendantIds).toContain(c2.id);
  });
});

// ---------------------------------------------------------------------------
// Test 4 – Recipe distillation quality
// ---------------------------------------------------------------------------

describe('Recipe distillation quality', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('significantly compresses redundant operations', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'distill-quality-session');

    // 5 reads of the same config file (redundant)
    for (let i = 0; i < 5; i++) {
      await sw.trackRead('package.json', { reason: 'checking config' });
    }

    // 3 redundant writes to the same file
    for (let i = 0; i < 3; i++) {
      await fs.writeFile(path.join(tmpDir, 'output.ts'), `export const v = ${i};`);
      await sw.trackWrite('output.ts', { reason: `update output iteration ${i}` });
    }

    // Same exec command repeated twice
    await sw.trackExec('npm test', { exitCode: 1, output: 'fail' }, { reason: 'first run' });
    await sw.trackExec('npm test', { exitCode: 0, output: 'pass' }, { reason: 'second run' });

    const summary = await sw.stop();
    const totalRawOps = summary.operations.length;
    expect(totalRawOps).toBe(10); // 5 reads + 3 writes + 2 execs

    const session = buildSession(
      'distill-quality-session',
      summary.session.id,
      tmpDir,
      summary.operations,
      summary.branchName,
      summary.baseCommit,
    );

    const distiller = new RecipeDistiller();
    const recipe = distiller.distill(session);

    // Recipe should be meaningfully shorter than raw operations
    expect(recipe.steps.length).toBeLessThan(totalRawOps);

    // The compressed steps should still cover the essential actions
    const actions = recipe.steps.map((s) => s.action);
    expect(actions).toContain('run_command'); // exec is preserved
    // file operations are present
    const fileActions = actions.filter(
      (a) => a === 'modify_file' || a === 'create_file' || a === 'find',
    );
    expect(fileActions.length).toBeGreaterThan(0);
  });

  it('parameterize() replaces concrete paths with variables', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'parameterize-session');

    await sw.trackRead('src/config.ts', { reason: 'read config' });
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/utils.ts'), 'export {};');
    await sw.trackCreate('src/utils.ts', { reason: 'create utils' });
    await fs.writeFile(path.join(tmpDir, 'src/main.ts'), 'export {};');
    await sw.trackCreate('src/main.ts', { reason: 'create main' });

    const summary = await sw.stop();

    const session = buildSession(
      'parameterize-session',
      summary.session.id,
      tmpDir,
      summary.operations,
      summary.branchName,
      summary.baseCommit,
    );

    const distiller = new RecipeDistiller();
    const recipe = distiller.distill(session);
    const paramRecipe = distiller.parameterize(recipe);

    // Parameters object should be populated
    expect(Object.keys(paramRecipe.parameters).length).toBeGreaterThan(0);

    // At least one step target should contain a parameter variable
    const hasParam = paramRecipe.steps.some((s) => s.target.includes('{'));
    expect(hasParam).toBe(true);

    // Parameters should contain the src directory
    const paramValues = Object.values(paramRecipe.parameters);
    expect(paramValues.some((v) => v.includes('src'))).toBe(true);
  });

  it('YAML round-trip preserves all recipe data', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'yaml-roundtrip-session');

    await sw.trackRead('README.md', { reason: 'read docs' });
    await fs.writeFile(path.join(tmpDir, 'feature.ts'), 'export const f = 1;');
    await sw.trackCreate('feature.ts', { reason: 'add feature' });
    await sw.trackExec('npm run build', { exitCode: 0, output: 'built' }, { reason: 'build' });

    const summary = await sw.stop();

    const session = buildSession(
      'yaml-roundtrip-session',
      summary.session.id,
      tmpDir,
      summary.operations,
      summary.branchName,
      summary.baseCommit,
    );

    const distiller = new RecipeDistiller();
    const original = distiller.distill(session);

    const yamlStr = distiller.toYAML(original);
    expect(typeof yamlStr).toBe('string');
    expect(yamlStr.length).toBeGreaterThan(0);

    const restored = distiller.fromYAML(yamlStr);

    // All top-level fields preserved
    expect(restored.name).toBe(original.name);
    expect(restored.description).toBe(original.description);
    expect(restored.sourceSessionId).toBe(original.sourceSessionId);
    expect(restored.version).toBe(original.version);
    expect(restored.steps).toHaveLength(original.steps.length);
    expect(restored.tags).toEqual(original.tags);

    // Each step preserved
    for (let i = 0; i < original.steps.length; i++) {
      expect(restored.steps[i].action).toBe(original.steps[i].action);
      expect(restored.steps[i].target).toBe(original.steps[i].target);
      expect(restored.steps[i].description).toBe(original.steps[i].description);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5 – Multi-file change tracking
// ---------------------------------------------------------------------------

describe('Multi-file change tracking', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('captures causal relationships across 3 reads, 2 creates, 4 writes, and 1 exec', async () => {
    // Seed files that will be modified
    await fs.writeFile(path.join(tmpDir, 'fileA.ts'), 'const a = 1;');
    await fs.writeFile(path.join(tmpDir, 'fileB.ts'), 'const b = 2;');
    await fs.writeFile(path.join(tmpDir, 'fileC.ts'), 'const c = 3;');
    await fs.writeFile(path.join(tmpDir, 'fileD.ts'), 'const d = 4;');
    await runGit(tmpDir, ['add', '.']);
    await runGit(tmpDir, ['commit', '-m', 'seed files']);

    const sw = await ShadowWorktree.create(tmpDir, 'multi-file-session');

    // Read 3 config-like files
    const r1 = await sw.trackRead('package.json', { reason: 'read pkg config' });
    const r2 = await sw.trackRead('fileA.ts', { reason: 'read fileA for reference' });
    const r3 = await sw.trackRead('fileB.ts', { reason: 'read fileB for reference' });

    // Create 2 new files (caused by config reads)
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'src/newX.ts'), 'export const x = 0;');
    const c1 = await sw.trackCreate('src/newX.ts', {
      reason: 'create newX',
      causedBy: [r1.id, r2.id],
    });

    await fs.writeFile(path.join(tmpDir, 'src/newY.ts'), 'export const y = 0;');
    const c2 = await sw.trackCreate('src/newY.ts', {
      reason: 'create newY',
      causedBy: [r1.id, r3.id],
    });

    // Modify 4 existing files
    await fs.writeFile(path.join(tmpDir, 'fileA.ts'), 'const a = 10;');
    const w1 = await sw.trackWrite('fileA.ts', {
      reason: 'update fileA',
      causedBy: [r2.id],
    });

    await fs.writeFile(path.join(tmpDir, 'fileB.ts'), 'const b = 20;');
    const w2 = await sw.trackWrite('fileB.ts', {
      reason: 'update fileB',
      causedBy: [r3.id],
    });

    await fs.writeFile(path.join(tmpDir, 'fileC.ts'), 'const c = 30;');
    const w3 = await sw.trackWrite('fileC.ts', {
      reason: 'update fileC',
      causedBy: [r1.id],
    });

    await fs.writeFile(path.join(tmpDir, 'fileD.ts'), 'const d = 40;');
    const w4 = await sw.trackWrite('fileD.ts', {
      reason: 'update fileD',
      causedBy: [c1.id, c2.id],
    });

    // Run test command (caused by all writes)
    const execOp = await sw.trackExec(
      'npm test',
      { exitCode: 0, output: 'All 10 tests passed' },
      { reason: 'validate all changes', causedBy: [w1.id, w2.id, w3.id, w4.id] },
    );

    const summary = await sw.stop();

    // ---- provenance graph ----
    const tracker = new ProvenanceTracker(summary.session.id);
    for (const op of summary.operations) {
      if (op.type === 'read') tracker.addRead(op);
      else if (op.type === 'exec') tracker.addExec(op);
      else tracker.addWrite(op);
    }

    const graph = tracker.getProvenance();

    // All 10 operations (3 reads + 2 creates + 4 writes + 1 exec) become nodes
    expect(graph.nodes).toHaveLength(10);

    // Edges should encode the explicit causedBy links
    const edgesTo = (opId: string) => graph.edges.filter((e) => e.to === opId);

    // c1 caused by r1, r2
    const edgesToC1 = edgesTo(c1.id);
    expect(edgesToC1.length).toBeGreaterThanOrEqual(2);
    expect(edgesToC1.map((e) => e.from)).toContain(r1.id);
    expect(edgesToC1.map((e) => e.from)).toContain(r2.id);

    // c2 caused by r1, r3
    const edgesToC2 = edgesTo(c2.id);
    expect(edgesToC2.length).toBeGreaterThanOrEqual(2);
    expect(edgesToC2.map((e) => e.from)).toContain(r1.id);
    expect(edgesToC2.map((e) => e.from)).toContain(r3.id);

    // exec caused by w1, w2, w3, w4
    const edgesToExec = edgesTo(execOp.id);
    expect(edgesToExec.length).toBeGreaterThanOrEqual(4);
    const execFromIds = edgesToExec.map((e) => e.from);
    expect(execFromIds).toContain(w1.id);
    expect(execFromIds).toContain(w2.id);
    expect(execFromIds).toContain(w3.id);
    expect(execFromIds).toContain(w4.id);

    // ---- recipe captures logical flow ----
    const session = buildSession(
      'multi-file-session',
      summary.session.id,
      tmpDir,
      summary.operations,
      summary.branchName,
      summary.baseCommit,
    );

    const distiller = new RecipeDistiller();
    const recipe = distiller.distill(session);

    expect(recipe.steps.length).toBeGreaterThan(0);
    expect(recipe.steps.length).toBeLessThan(summary.operations.length);

    const actions = recipe.steps.map((s) => s.action);
    expect(actions).toContain('run_command');
    const writeActions = actions.filter((a) => a === 'create_file' || a === 'modify_file');
    expect(writeActions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6 – Shadow worktree isolation
// ---------------------------------------------------------------------------

describe('Shadow worktree isolation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('keeps original branch clean while agent changes exist on shadow branch', async () => {
    const initialMainCommitCount = await getCommitCount(tmpDir);

    const sw = await ShadowWorktree.create(tmpDir, 'isolation-test');
    const _shadowBranch = (sw as unknown as { session: Session }).session.branch;

    // Make changes on the shadow branch
    await fs.writeFile(path.join(tmpDir, 'agent-file.ts'), 'export const agent = true;');
    await sw.trackWrite('agent-file.ts', { reason: 'agent-created file' });

    await sw.trackExec(
      'npm install some-pkg',
      { exitCode: 0, output: 'added 1 package' },
      { reason: 'install dependency' },
    );

    await fs.writeFile(path.join(tmpDir, 'another.ts'), 'export const x = 42;');
    await sw.trackCreate('another.ts', { reason: 'create another module' });

    // Commits exist on the shadow branch before stopping
    const shadowCommitCountBefore = await getCommitCount(tmpDir);
    expect(shadowCommitCountBefore).toBeGreaterThan(initialMainCommitCount);

    // Stop: should switch back to main
    const summary = await sw.stop();

    // ---- assert: back on original branch ----
    const currentBranch = await getCurrentBranch(tmpDir);
    expect(currentBranch).toBe('main');

    // ---- assert: main branch has NO agentgram commits ----
    const mainMessages = await getAllCommitMessages(tmpDir);
    const agentgramOnMain = mainMessages.filter((m) => m.includes('[agentgram]'));
    expect(agentgramOnMain).toHaveLength(0);

    // Main commit count unchanged from before session
    const mainCommitCountAfter = await getCommitCount(tmpDir);
    expect(mainCommitCountAfter).toBe(initialMainCommitCount);

    // ---- assert: agent changes exist on shadow branch ----
    const shadowMessages = await getBranchCommitMessages(tmpDir, summary.branchName);
    const agentgramOnShadow = shadowMessages.filter((m) => m.includes('[agentgram]'));
    expect(agentgramOnShadow.length).toBeGreaterThanOrEqual(3);
    expect(agentgramOnShadow.some((m) => m.includes('agent-file.ts'))).toBe(true);
    expect(agentgramOnShadow.some((m) => m.includes('npm install'))).toBe(true);
    expect(agentgramOnShadow.some((m) => m.includes('another.ts'))).toBe(true);

    // ---- assert: agent-file.ts does NOT exist on main ----
    const agentFileOnMain = await fs
      .access(path.join(tmpDir, 'agent-file.ts'))
      .then(() => true)
      .catch(() => false);
    expect(agentFileOnMain).toBe(false);

    // ---- assert: shadow branch summary has correct operation count ----
    expect(summary.operations).toHaveLength(3);
    expect(summary.totalCommits).toBeGreaterThanOrEqual(3);
  });

  it('session operations carry correct causedBy chains after isolation', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'causal-isolation-test');

    const readOp = await sw.trackRead('README.md', { reason: 'read for context' });

    await fs.writeFile(path.join(tmpDir, 'derived.ts'), 'export const d = 1;');
    const writeOp = await sw.trackWrite('derived.ts', {
      reason: 'write derived file',
      causedBy: [readOp.id],
    });

    const summary = await sw.stop();

    // Verify we're back on main
    expect(await getCurrentBranch(tmpDir)).toBe('main');

    // Verify the causal chain is intact in the returned operations
    const ops = summary.operations;
    expect(ops).toHaveLength(2);

    const returnedWrite = ops.find((o) => o.id === writeOp.id);
    expect(returnedWrite).toBeDefined();
    expect(returnedWrite!.causedBy).toContain(readOp.id);

    // Verify provenance graph built from returned operations preserves causality
    const tracker = new ProvenanceTracker(summary.session.id);
    for (const op of ops) {
      if (op.type === 'read') tracker.addRead(op);
      else tracker.addWrite(op);
    }

    const graph = tracker.getProvenance();
    const edgesToWrite = graph.edges.filter((e) => e.to === writeOp.id);
    expect(edgesToWrite.length).toBeGreaterThanOrEqual(1);
    expect(edgesToWrite.map((e) => e.from)).toContain(readOp.id);
  });
});
