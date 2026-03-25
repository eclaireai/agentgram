import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ShadowWorktree } from '../../src/worktree/shadow.js';

// ---- helpers ----

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgram-test-'));

  // Minimal git setup
  const _run = (cmd: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const { execFile } = require('node:child_process');
      execFile(cmd, args, { cwd: dir }, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

  await runGit(dir, ['init', '--initial-branch=main']);
  await runGit(dir, ['config', 'user.email', 'test@agentgram.local']);
  await runGit(dir, ['config', 'user.name', 'agentgram-test']);

  // Need at least one commit so HEAD exists
  const readmePath = path.join(dir, 'README.md');
  await fs.writeFile(readmePath, '# test repo\n');
  await runGit(dir, ['add', '.']);
  await runGit(dir, ['commit', '-m', 'initial commit']);

  return dir;
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile('git', args, { cwd }, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---- tests ----

describe('ShadowWorktree', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempRepo();
  });

  afterEach(async () => {
    await removeDir(tmpDir);
  });

  it('create() creates a new shadow branch from current HEAD', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'my-session');
    const { execa: _unused } = await import('node:path' as string); // dummy import to force async
    // Read current branch via git
    const currentBranch = await new Promise<string>((resolve, reject) => {
      const { execFile } = require('node:child_process');
      execFile(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: tmpDir },
        (err: Error | null, stdout: string) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        },
      );
    });

    expect(currentBranch).toMatch(/^agentgram\/my-session-/);

    const ops = sw.getOperations();
    expect(ops).toHaveLength(0);
  });

  it('trackRead() records a read operation without committing', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'read-session');

    const targetFile = 'README.md';
    const op = await sw.trackRead(targetFile, { reason: 'checking readme' });

    expect(op.type).toBe('read');
    expect(op.target).toBe(targetFile);
    expect(op.reason).toBe('checking readme');
    expect(op.metadata.contentHash).toBeDefined();
    expect(op.causedBy).toEqual([]);

    const ops = sw.getOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'read', target: targetFile });

    // read should NOT create a new commit
    const commitCount = await getCommitCount(tmpDir);
    // still only the initial commit + 0 (reads don't commit)
    expect(commitCount).toBe(1);
  });

  it('trackRead() records linesRead metadata', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'linesread-session');
    const op = await sw.trackRead('README.md', { linesRead: [1, 10] });

    expect(op.metadata.linesRead).toEqual([1, 10]);
  });

  it('trackWrite() records a write operation and auto-commits', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'write-session');

    const filePath = path.join(tmpDir, 'hello.txt');
    await fs.writeFile(filePath, 'hello world\n');

    const op = await sw.trackWrite('hello.txt', { reason: 'writing hello file' });

    expect(op.type).toBe('write');
    expect(op.target).toBe('hello.txt');
    expect(op.reason).toBe('writing hello file');
    expect(op.metadata.afterHash).toBeDefined();

    // Should have created 1 micro-commit (initial + 1)
    const count = await getCommitCount(tmpDir);
    expect(count).toBe(2);

    // Commit message should contain metadata
    const lastMsg = await getLastCommitMessage(tmpDir);
    expect(lastMsg).toContain('[agentgram]');
    expect(lastMsg).toContain('write');
    expect(lastMsg).toContain('hello.txt');
    expect(lastMsg).toContain('writing hello file');
  });

  it('trackExec() records a command execution and auto-commits', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'exec-session');

    const op = await sw.trackExec(
      'npm test',
      { exitCode: 0, output: 'All tests passed' },
      { reason: 'running tests' },
    );

    expect(op.type).toBe('exec');
    expect(op.target).toBe('npm test');
    expect(op.metadata.command).toBe('npm test');
    expect(op.metadata.exitCode).toBe(0);
    expect(op.metadata.output).toBe('All tests passed');

    const count = await getCommitCount(tmpDir);
    expect(count).toBe(2);

    const lastMsg = await getLastCommitMessage(tmpDir);
    expect(lastMsg).toContain('[agentgram]');
    expect(lastMsg).toContain('exec');
    expect(lastMsg).toContain('npm test');
  });

  it('getHistory() returns micro-commits since base commit', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'history-session');

    // Write two files to create two micro-commits
    await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'content1');
    await sw.trackWrite('file1.txt', { reason: 'first write' });

    await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'content2');
    await sw.trackWrite('file2.txt', { reason: 'second write' });

    const history = await sw.getHistory();
    expect(history.total).toBeGreaterThanOrEqual(2);

    const messages = history.all.map((c) => c.message);
    expect(messages.some((m) => m.includes('file1.txt'))).toBe(true);
    expect(messages.some((m) => m.includes('file2.txt'))).toBe(true);
  });

  it('stop() returns to original branch and produces a session summary', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'stop-session');

    await fs.writeFile(path.join(tmpDir, 'change.txt'), 'data');
    await sw.trackWrite('change.txt', { reason: 'test change' });

    const summary = await sw.stop();

    // Should be back on main
    const currentBranch = await getCurrentBranch(tmpDir);
    expect(currentBranch).toBe('main');

    expect(summary.session.state).toBe('stopped');
    expect(summary.session.stoppedAt).toBeDefined();
    expect(summary.branchName).toMatch(/^agentgram\/stop-session-/);
    expect(summary.operations).toHaveLength(1);
    expect(summary.totalCommits).toBeGreaterThanOrEqual(1);
    expect(summary.baseCommit).toBeTruthy();
  });

  it('getOperations() returns all recorded operations', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'ops-session');

    await sw.trackRead('README.md');
    await fs.writeFile(path.join(tmpDir, 'new.txt'), 'new content');
    await sw.trackWrite('new.txt', { reason: 'add new file' });
    await sw.trackExec('ls -la', { exitCode: 0, output: 'some output' });

    const ops = sw.getOperations();
    expect(ops).toHaveLength(3);
    expect(ops[0].type).toBe('read');
    expect(ops[1].type).toBe('write');
    expect(ops[2].type).toBe('exec');
  });

  it('multiple operations create correct linear commit history', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'linear-session');

    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'aaa');
    await sw.trackWrite('a.txt', { reason: 'write a' });

    await sw.trackExec('echo hello', { exitCode: 0, output: 'hello' });

    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'bbb');
    await sw.trackWrite('b.txt', { reason: 'write b' });

    // Initial commit + 3 micro-commits = 4
    const count = await getCommitCount(tmpDir);
    expect(count).toBe(4);

    const log = await getAllCommitMessages(tmpDir);
    // Most recent first
    expect(log[0]).toContain('b.txt');
    expect(log[1]).toContain('exec');
    expect(log[2]).toContain('a.txt');
  });

  it('commit messages contain operation metadata (file path, operation type, reason)', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'msg-session');

    await fs.writeFile(path.join(tmpDir, 'target.ts'), 'export const x = 1;');
    await sw.trackWrite('target.ts', { reason: 'implement feature X' });

    const msg = await getLastCommitMessage(tmpDir);
    // Format: [agentgram] write(target.ts): implement feature X
    expect(msg).toMatch(/\[agentgram\] write\(target\.ts\): implement feature X/);
  });

  it('trackCreate() stages and commits a new file', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'create-session');

    const newFile = path.join(tmpDir, 'brand-new.ts');
    await fs.writeFile(newFile, 'export default {};');

    const op = await sw.trackCreate('brand-new.ts', { reason: 'scaffolding new module' });

    expect(op.type).toBe('create');
    expect(op.target).toBe('brand-new.ts');
    expect(op.metadata.afterHash).toBeDefined();

    const count = await getCommitCount(tmpDir);
    expect(count).toBe(2);

    const msg = await getLastCommitMessage(tmpDir);
    expect(msg).toContain('[agentgram]');
    expect(msg).toContain('create');
    expect(msg).toContain('brand-new.ts');
  });

  it('trackDelete() stages and commits a file deletion', async () => {
    // Create a file in the initial commit first
    const doomed = path.join(tmpDir, 'doomed.txt');
    await fs.writeFile(doomed, 'to be deleted\n');
    await runGit(tmpDir, ['add', '.']);
    await runGit(tmpDir, ['commit', '-m', 'add doomed file']);

    const sw = await ShadowWorktree.create(tmpDir, 'delete-session');

    // Now delete it
    await fs.unlink(doomed);

    const op = await sw.trackDelete('doomed.txt', { reason: 'cleaning up' });

    expect(op.type).toBe('delete');
    expect(op.target).toBe('doomed.txt');

    const count = await getCommitCount(tmpDir);
    expect(count).toBeGreaterThanOrEqual(2);

    const msg = await getLastCommitMessage(tmpDir);
    expect(msg).toContain('[agentgram]');
    expect(msg).toContain('delete');
    expect(msg).toContain('doomed.txt');
  });

  it('operations have unique IDs', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'id-session');

    await sw.trackRead('README.md');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'f');
    await sw.trackWrite('f.txt');
    await sw.trackExec('pwd', { exitCode: 0 });

    const ops = sw.getOperations();
    const ids = ops.map((o) => o.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('operations have monotonically increasing timestamps', async () => {
    const sw = await ShadowWorktree.create(tmpDir, 'ts-session');

    await sw.trackRead('README.md');
    await fs.writeFile(path.join(tmpDir, 'ts.txt'), 'ts');
    await sw.trackWrite('ts.txt');

    const ops = sw.getOperations();
    expect(ops[1].timestamp).toBeGreaterThanOrEqual(ops[0].timestamp);
  });
});

// ---- git helpers for test assertions ----

function getCommitCount(cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd },
      (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve(parseInt(stdout.trim(), 10));
      },
    );
  });
}

function getLastCommitMessage(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile(
      'git',
      ['log', '-1', '--pretty=%s'],
      { cwd },
      (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      },
    );
  });
}

function getAllCommitMessages(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile(
      'git',
      ['log', '--pretty=%s'],
      { cwd },
      (err: Error | null, stdout: string) => {
        if (err) reject(err);
        else resolve(stdout.trim().split('\n').filter(Boolean));
      },
    );
  });
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
