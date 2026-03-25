import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentraceSession, Agentrace } from '../../src/core/session.js';
import type { SessionResult } from '../../src/core/session.js';
import type { Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile('git', args, { cwd }, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgram-session-test-'));

  await runGit(dir, ['init', '--initial-branch=main']);
  await runGit(dir, ['config', 'user.email', 'test@agentgram.local']);
  await runGit(dir, ['config', 'user.name', 'agentgram-test']);

  // Initial commit so HEAD exists
  await fs.writeFile(path.join(dir, 'README.md'), '# test repo\n');
  await runGit(dir, ['add', '.']);
  await runGit(dir, ['commit', '-m', 'initial commit']);

  return dir;
}

async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

function getCurrentBranch(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd },
      (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agentrace / AgentraceSession', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  // ── start ────────────────────────────────────────────────────────────────

  it('Agentrace.start() creates a session in recording state', async () => {
    const session = await Agentrace.start(tmpDir, 'test-session');

    // Should be an AgentraceSession (EventEmitter subclass)
    expect(session).toBeInstanceOf(AgentraceSession);

    // Should have switched to an agentgram branch
    const branch = await getCurrentBranch(tmpDir);
    expect(branch).toMatch(/^agentgram\/test-session-/);

    // Stop cleanly so the temp repo is in a usable state for afterEach
    await session.stop();
  });

  // ── read ─────────────────────────────────────────────────────────────────

  it('session.read() tracks reads through ShadowWorktree and ProvenanceTracker', async () => {
    const session = await Agentrace.start(tmpDir, 'read-session');

    const op = await session.read('README.md', { reason: 'inspecting readme' });

    expect(op.type).toBe('read');
    expect(op.target).toBe('README.md');
    expect(op.reason).toBe('inspecting readme');
    expect(op.metadata.contentHash).toBeDefined();

    // ProvenanceTracker should have a node for this operation
    const graph = session.getProvenance();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].operationId).toBe(op.id);
    expect(graph.nodes[0].type).toBe('read');

    // getOperations() should return it
    expect(session.getOperations()).toHaveLength(1);

    await session.stop();
  });

  // ── write ────────────────────────────────────────────────────────────────

  it('session.write() tracks writes through both modules', async () => {
    const session = await Agentrace.start(tmpDir, 'write-session');

    const filePath = path.join(tmpDir, 'output.txt');
    await fs.writeFile(filePath, 'hello agentgram\n');

    const op = await session.write('output.txt', { reason: 'writing output' });

    expect(op.type).toBe('write');
    expect(op.target).toBe('output.txt');
    expect(op.metadata.afterHash).toBeDefined();

    const graph = session.getProvenance();
    const node = graph.nodes.find((n) => n.operationId === op.id);
    expect(node).toBeDefined();
    expect(node!.type).toBe('write');

    expect(session.getOperations()).toHaveLength(1);

    await session.stop();
  });

  // ── exec ─────────────────────────────────────────────────────────────────

  it('session.exec() tracks execs through both modules', async () => {
    const session = await Agentrace.start(tmpDir, 'exec-session');

    const op = await session.exec(
      'npm test',
      { exitCode: 0, output: 'all pass' },
      { reason: 'running tests' },
    );

    expect(op.type).toBe('exec');
    expect(op.target).toBe('npm test');
    expect(op.metadata.command).toBe('npm test');
    expect(op.metadata.exitCode).toBe(0);
    expect(op.metadata.output).toBe('all pass');

    const graph = session.getProvenance();
    const node = graph.nodes.find((n) => n.operationId === op.id);
    expect(node).toBeDefined();
    expect(node!.type).toBe('exec');

    expect(session.getOperations()).toHaveLength(1);

    await session.stop();
  });

  // ── stop ─────────────────────────────────────────────────────────────────

  it('session.stop() returns SessionResult with provenance graph, operations, branch name', async () => {
    const session = await Agentrace.start(tmpDir, 'stop-session');

    await session.read('README.md');

    const filePath = path.join(tmpDir, 'new-file.txt');
    await fs.writeFile(filePath, 'content');
    await session.write('new-file.txt', { reason: 'adding file' });

    await session.exec('echo hi', { exitCode: 0, output: 'hi' });

    const result: SessionResult = await session.stop();

    // Core shape
    expect(result.session).toBeDefined();
    expect(result.session.state).toBe('stopped');
    expect(result.session.stoppedAt).toBeDefined();

    // Operations
    expect(result.operations).toHaveLength(3);
    expect(result.operations.map((o) => o.type)).toEqual(['read', 'write', 'exec']);

    // Provenance graph
    expect(result.provenance).toBeDefined();
    expect(result.provenance.nodes.length).toBeGreaterThanOrEqual(1);

    // Branch + commit info
    expect(result.branch).toMatch(/^agentgram\/stop-session-/);
    expect(result.baseCommit).toBeTruthy();
    expect(result.totalCommits).toBeGreaterThanOrEqual(1);

    // Recipe present
    expect(result.recipe).toBeDefined();
    expect(result.recipe.sourceSessionId).toBe(result.session.id);

    // Back on main
    const branch = await getCurrentBranch(tmpDir);
    expect(branch).toBe('main');
  });

  // ── distill ───────────────────────────────────────────────────────────────

  it('session.distill() produces a recipe from the recorded session', async () => {
    const session = await Agentrace.start(tmpDir, 'distill-session');

    await session.read('README.md', { reason: 'read docs' });

    const filePath = path.join(tmpDir, 'impl.ts');
    await fs.writeFile(filePath, 'export const x = 1;\n');
    await session.write('impl.ts', { reason: 'implement feature' });

    await session.exec('npm run build', { exitCode: 0 }, { reason: 'build project' });

    const recipe = session.distill();

    expect(recipe).toBeDefined();
    expect(recipe.steps.length).toBeGreaterThan(0);
    expect(recipe.version).toBe('1.0.0');

    // Steps should include representations of write and exec
    const actions = recipe.steps.map((s) => s.action);
    expect(actions).toContain('run_command');

    await session.stop();
  });

  // ── persist + load ────────────────────────────────────────────────────────

  it('session persists to disk and can be loaded with Agentrace.load()', async () => {
    const session = await Agentrace.start(tmpDir, 'persist-session');

    await session.read('README.md');

    const result = await session.stop();
    const savedId = result.session.id;

    // File should exist on disk
    const sessionFile = path.join(tmpDir, '.agentgram', 'sessions', `${savedId}.json`);
    const raw = await fs.readFile(sessionFile, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.session.id).toBe(savedId);

    // Load via API
    const loaded = await Agentrace.load(tmpDir, savedId);
    expect(loaded.id).toBe(savedId);
    expect(loaded.name).toBe('persist-session');
    expect(loaded.state).toBe('stopped');
    expect(loaded.operations.length).toBeGreaterThanOrEqual(1);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it('Agentrace.list() returns all stored sessions', async () => {
    // Initially empty
    const empty = await Agentrace.list(tmpDir);
    expect(empty).toHaveLength(0);

    const s1 = await Agentrace.start(tmpDir, 'list-session-1');
    const r1 = await s1.stop();

    const s2 = await Agentrace.start(tmpDir, 'list-session-2');
    const r2 = await s2.stop();

    const sessions = await Agentrace.list(tmpDir);
    expect(sessions).toHaveLength(2);

    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(r1.session.id);
    expect(ids).toContain(r2.session.id);

    // Sorted by startedAt
    expect(sessions[0].startedAt).toBeLessThanOrEqual(sessions[1].startedAt);
  });

  // ── full lifecycle ────────────────────────────────────────────────────────

  it('full lifecycle: start → multiple ops → stop → distill → recipe is valid', async () => {
    const session = await Agentrace.start(tmpDir, 'full-lifecycle');

    // Read existing file
    await session.read('README.md', { reason: 'understand project' });

    // Create a new file
    const srcFile = path.join(tmpDir, 'src.ts');
    await fs.writeFile(srcFile, 'export function greet() { return "hello"; }\n');
    await session.create('src.ts', { reason: 'scaffold source file' });

    // Exec command
    await session.exec('tsc --noEmit', { exitCode: 0, output: '' }, { reason: 'typecheck' });

    // Write another file
    const testFile = path.join(tmpDir, 'src.test.ts');
    await fs.writeFile(testFile, 'import { greet } from "./src.js";\n');
    await session.write('src.test.ts', { reason: 'add tests' });

    // Exec tests
    await session.exec(
      'vitest run',
      { exitCode: 0, output: '2 passed' },
      { reason: 'run tests' },
    );

    const result = await session.stop();

    // Session is valid
    expect(result.session.state).toBe('stopped');
    expect(result.operations).toHaveLength(5);

    // Provenance graph has all operations
    expect(result.provenance.nodes).toHaveLength(5);

    // Recipe
    const recipe = result.recipe;
    expect(recipe.steps.length).toBeGreaterThan(0);
    expect(recipe.sourceSessionId).toBe(result.session.id);
    expect(recipe.version).toBe('1.0.0');

    // Recipe steps should cover exec operations
    const runCommandSteps = recipe.steps.filter((s) => s.action === 'run_command');
    expect(runCommandSteps.length).toBeGreaterThan(0);

    // Can also distill separately after stop (uses persisted session data)
    const loaded = await Agentrace.load(tmpDir, result.session.id);
    expect(loaded.operations).toHaveLength(5);
  });

  // ── event emitter ─────────────────────────────────────────────────────────

  it('event emitter fires events for each operation', async () => {
    const session = await Agentrace.start(tmpDir, 'event-session');

    const emittedOps: Operation[] = [];
    const emittedEvents: string[] = [];

    session.on('operation', (event: { type: string; operation: Operation }) => {
      emittedOps.push(event.operation);
    });

    session.on('session_stop', (event: { type: string; sessionId: string }) => {
      emittedEvents.push(event.type);
    });

    session.on('session_start', (event: { type: string; sessionId: string }) => {
      emittedEvents.push(event.type);
    });

    await session.read('README.md');

    const newFile = path.join(tmpDir, 'event-test.txt');
    await fs.writeFile(newFile, 'event test content\n');
    await session.write('event-test.txt');

    await session.exec('pwd', { exitCode: 0, output: tmpDir });

    // 3 operation events
    expect(emittedOps).toHaveLength(3);
    expect(emittedOps[0].type).toBe('read');
    expect(emittedOps[1].type).toBe('write');
    expect(emittedOps[2].type).toBe('exec');

    await session.stop();

    // session_stop event fired
    expect(emittedEvents).toContain('session_stop');
  });

  // ── create + delete ────────────────────────────────────────────────────────

  it('session.create() and session.delete() track through both modules', async () => {
    // Pre-commit a file so it can be deleted
    const doomedPath = path.join(tmpDir, 'doomed.txt');
    await fs.writeFile(doomedPath, 'to be deleted\n');
    await runGit(tmpDir, ['add', '.']);
    await runGit(tmpDir, ['commit', '-m', 'add doomed file']);

    const session = await Agentrace.start(tmpDir, 'create-delete-session');

    // Create
    const newFile = path.join(tmpDir, 'created.ts');
    await fs.writeFile(newFile, 'export const y = 2;\n');
    const createOp = await session.create('created.ts', { reason: 'new module' });

    expect(createOp.type).toBe('create');
    expect(createOp.metadata.afterHash).toBeDefined();

    // Delete
    await fs.unlink(doomedPath);
    const deleteOp = await session.delete('doomed.txt', { reason: 'cleanup' });

    expect(deleteOp.type).toBe('delete');

    // Both are in provenance graph
    const graph = session.getProvenance();
    const types = graph.nodes.map((n) => n.type);
    expect(types).toContain('create');
    expect(types).toContain('delete');

    await session.stop();
  });
});
