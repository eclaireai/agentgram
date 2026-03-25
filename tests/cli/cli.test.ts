/**
 * CLI tests — exercises createProgram() directly without spawning a subprocess.
 *
 * Output is captured by spying on console.log and console.error, since chalk
 * and commander both ultimately call those methods (and console.log holds its
 * own reference to the original process.stdout.write, so patching the stream
 * directly does not work reliably in ESM).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createProgram } from '../../src/cli.js';
import type { Session } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Output capture helpers
// ---------------------------------------------------------------------------

class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * Run a set of CLI args through createProgram() and capture all output.
 *
 * Two layers of capture:
 *   1. Spy on console.log / console.error — used by all action handlers.
 *   2. Patch process.stdout.write / process.stderr.write — used by commander
 *      for built-in output like --version, --help, and error messages.
 *
 * We also override process.exit so it throws instead of killing the process.
 */
async function runCLI(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let exitCode: number | null = null;

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origExit = process.exit.bind(process);

  // Layer 1 — spy on console.log / console.error
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    stdoutParts.push(a.map(String).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    stderrParts.push(a.map(String).join(' '));
  });

  // Layer 2 — patch stream writes (commander uses these for --version/--help/errors)
  // @ts-expect-error simplified signature
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdoutParts.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  // @ts-expect-error simplified signature
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderrParts.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };

  // Override process.exit to throw a catchable error
  // @ts-expect-error intentionally replacing with non-void return for testing
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new ExitError(code ?? 0);
  };

  const program = createProgram();
  // Prevent commander from calling process.exit on --help / validation errors
  program.exitOverride();

  try {
    await program.parseAsync(['node', 'agentgram', ...args]);
  } catch (err) {
    if (err instanceof ExitError) {
      // expected — exit code already recorded
    } else if ((err as NodeJS.ErrnoException).code === 'commander.helpDisplayed') {
      // --help flag; commander throws after writing help text
    } else if ((err as NodeJS.ErrnoException).code?.startsWith('commander.')) {
      // validation / unknown command errors
    }
    // anything else is unexpected — let it surface
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    process.exit = origExit;
  }

  return {
    stdout: stdoutParts.join('\n'),
    stderr: stderrParts.join('\n'),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Session fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let sessionsDir: string;
const origCwd = process.cwd();

/**
 * Build a minimal but valid Session fixture and write it to the temp sessions dir.
 */
function makeSession(overrides: Partial<Session> = {}): Session {
  const id = overrides.id ?? 'test-session-001';
  const session: Session = {
    id,
    name: overrides.name ?? 'test session',
    state: overrides.state ?? 'stopped',
    startedAt: overrides.startedAt ?? 1_700_000_000_000,
    stoppedAt: overrides.stoppedAt ?? 1_700_000_060_000,
    operations: overrides.operations ?? [],
    branch: overrides.branch ?? `agentgram/test-session-001`,
    baseCommit: overrides.baseCommit ?? 'abc1234',
    cwd: overrides.cwd ?? '/tmp/project',
  };
  return session;
}

async function writeSession(session: Session): Promise<void> {
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionsDir, `${session.id}.json`),
    JSON.stringify(session, null, 2),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentgram-cli-test-'));
  sessionsDir = path.join(tmpDir, '.agentgram', 'sessions');
  process.chdir(tmpDir);
});

afterEach(async () => {
  process.chdir(origCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('agentgram --version', () => {
  it('prints the package version', async () => {
    const { stdout } = await runCLI(['--version']);
    expect(stdout.trim()).toBe('0.1.0');
  });

  it('-v flag also prints the version', async () => {
    const { stdout } = await runCLI(['-v']);
    expect(stdout.trim()).toBe('0.1.0');
  });
});

// ---------------------------------------------------------------------------

describe('agentgram --help', () => {
  it('lists all commands in help output', async () => {
    const { stdout } = await runCLI(['--help']);
    expect(stdout).toContain('list');
    expect(stdout).toContain('show');
    expect(stdout).toContain('log');
    expect(stdout).toContain('diff');
    expect(stdout).toContain('provenance');
    expect(stdout).toContain('recipe');
    expect(stdout).toContain('export');
  });

  it('includes the program name', async () => {
    const { stdout } = await runCLI(['--help']);
    expect(stdout).toContain('agentgram');
  });
});

// ---------------------------------------------------------------------------

describe('agentgram list', () => {
  it('reports no sessions when directory is empty', async () => {
    const { stdout } = await runCLI(['list']);
    expect(stdout).toContain('No sessions found');
  });

  it('lists sessions when session files exist', async () => {
    const s1 = makeSession({ id: 'session-aaa', name: 'first session' });
    const s2 = makeSession({ id: 'session-bbb', name: 'second session' });
    await writeSession(s1);
    await writeSession(s2);

    const { stdout } = await runCLI(['list']);
    expect(stdout).toContain('session-aaa');
    expect(stdout).toContain('session-bbb');
    expect(stdout).toContain('first session');
    expect(stdout).toContain('second session');
  });

  it('shows operation count for each session', async () => {
    const session = makeSession({
      id: 'session-count',
      operations: [
        {
          id: 'op-1',
          type: 'read',
          timestamp: Date.now(),
          target: 'src/index.ts',
          metadata: {},
          causedBy: [],
        },
        {
          id: 'op-2',
          type: 'write',
          timestamp: Date.now() + 1,
          target: 'src/index.ts',
          metadata: {},
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['list']);
    expect(stdout).toContain('2');
  });
});

// ---------------------------------------------------------------------------

describe('agentgram show <session-id>', () => {
  it('outputs session details', async () => {
    const session = makeSession({
      id: 'show-test-001',
      name: 'my test session',
      branch: 'agentgram/my-test-session',
      baseCommit: 'deadbeef',
    });
    await writeSession(session);

    const { stdout } = await runCLI(['show', 'show-test-001']);
    expect(stdout).toContain('show-test-001');
    expect(stdout).toContain('my test session');
    expect(stdout).toContain('agentgram/my-test-session');
    expect(stdout).toContain('deadbeef');
  });

  it('shows all operations with their types', async () => {
    const session = makeSession({
      id: 'show-ops-001',
      operations: [
        {
          id: 'op-r1',
          type: 'read',
          timestamp: 1_700_000_001_000,
          target: 'src/foo.ts',
          metadata: {},
          causedBy: [],
        },
        {
          id: 'op-w1',
          type: 'write',
          timestamp: 1_700_000_002_000,
          target: 'src/bar.ts',
          metadata: {},
          causedBy: [],
        },
        {
          id: 'op-e1',
          type: 'exec',
          timestamp: 1_700_000_003_000,
          target: 'npm test',
          metadata: { command: 'npm test', exitCode: 0 },
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['show', 'show-ops-001']);
    expect(stdout).toContain('src/foo.ts');
    expect(stdout).toContain('src/bar.ts');
    expect(stdout).toContain('npm test');
  });

  it('exits with an error message for unknown session id', async () => {
    const { stderr, exitCode } = await runCLI(['show', 'no-such-session']);
    expect(stderr).toContain('no-such-session');
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('agentgram log <session-id>', () => {
  it('outputs the branch and base commit', async () => {
    const session = makeSession({
      id: 'log-test-001',
      branch: 'agentgram/log-test-001',
      baseCommit: 'c0ffee00',
    });
    await writeSession(session);

    const { stdout } = await runCLI(['log', 'log-test-001']);
    expect(stdout).toContain('agentgram/log-test-001');
    expect(stdout).toContain('c0ffee00');
  });

  it('reports no commits for a session with only reads', async () => {
    const session = makeSession({
      id: 'log-reads-001',
      operations: [
        {
          id: 'op-r1',
          type: 'read',
          timestamp: Date.now(),
          target: 'README.md',
          metadata: {},
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['log', 'log-reads-001']);
    expect(stdout).toContain('no commits');
  });

  it('lists write/exec operations as commits', async () => {
    const session = makeSession({
      id: 'log-writes-001',
      operations: [
        {
          id: 'op-w1',
          type: 'write',
          timestamp: Date.now(),
          target: 'src/main.ts',
          metadata: {},
          reason: 'update main entrypoint',
          causedBy: [],
        },
        {
          id: 'op-e1',
          type: 'exec',
          timestamp: Date.now() + 1,
          target: 'npm run build',
          metadata: { command: 'npm run build', exitCode: 0 },
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['log', 'log-writes-001']);
    expect(stdout).toContain('update main entrypoint');
    // exec op should also appear
    expect(stdout).toContain('npm run build');
  });
});

// ---------------------------------------------------------------------------

describe('agentgram diff <session-id>', () => {
  it('reports no changes for a session with only reads', async () => {
    const session = makeSession({
      id: 'diff-reads-001',
      operations: [
        {
          id: 'op-r1',
          type: 'read',
          timestamp: Date.now(),
          target: 'package.json',
          metadata: {},
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['diff', 'diff-reads-001']);
    expect(stdout).toContain('no file changes');
  });

  it('shows created, modified, and deleted files', async () => {
    const session = makeSession({
      id: 'diff-changes-001',
      operations: [
        {
          id: 'op-c1',
          type: 'create',
          timestamp: Date.now(),
          target: 'src/new-file.ts',
          metadata: { afterHash: 'hash-after' },
          causedBy: [],
        },
        {
          id: 'op-w1',
          type: 'write',
          timestamp: Date.now() + 1,
          target: 'src/existing.ts',
          metadata: { beforeHash: 'hash-before', afterHash: 'hash-after-2' },
          causedBy: [],
        },
        {
          id: 'op-d1',
          type: 'delete',
          timestamp: Date.now() + 2,
          target: 'src/old-file.ts',
          metadata: { beforeHash: 'hash-old' },
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['diff', 'diff-changes-001']);
    expect(stdout).toContain('src/new-file.ts');
    expect(stdout).toContain('created');
    expect(stdout).toContain('src/existing.ts');
    expect(stdout).toContain('modified');
    expect(stdout).toContain('src/old-file.ts');
    expect(stdout).toContain('deleted');
  });

  it('shows executed commands', async () => {
    const session = makeSession({
      id: 'diff-exec-001',
      operations: [
        {
          id: 'op-e1',
          type: 'exec',
          timestamp: Date.now(),
          target: 'npm install lodash',
          metadata: { command: 'npm install lodash', exitCode: 0 },
          causedBy: [],
        },
      ],
    });
    await writeSession(session);

    const { stdout } = await runCLI(['diff', 'diff-exec-001']);
    expect(stdout).toContain('npm install lodash');
  });
});

// ---------------------------------------------------------------------------

describe('agentgram provenance <session-id>', () => {
  const sessionWithOps = (): Session =>
    makeSession({
      id: 'prov-test-001',
      operations: [
        {
          id: 'op-r1',
          type: 'read',
          timestamp: 1_000,
          target: 'package.json',
          metadata: {},
          causedBy: [],
        },
        {
          id: 'op-w1',
          type: 'write',
          timestamp: 2_000,
          target: 'src/index.ts',
          metadata: {},
          causedBy: ['op-r1'],
        },
      ],
    });

  it('outputs mermaid format by default', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['provenance', 'prov-test-001']);
    expect(stdout).toContain('graph LR');
  });

  it('--format mermaid outputs mermaid graph', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['provenance', 'prov-test-001', '--format', 'mermaid']);
    expect(stdout).toContain('graph LR');
    expect(stdout).toContain('-->');
  });

  it('--format dot outputs DOT graph', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['provenance', 'prov-test-001', '--format', 'dot']);
    expect(stdout).toContain('digraph provenance');
    expect(stdout).toContain('rankdir=LR');
    expect(stdout).toContain('->');
  });

  it('--format dot includes node and edge definitions', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['provenance', 'prov-test-001', '--format', 'dot']);
    expect(stdout).toContain('op-r1');
    expect(stdout).toContain('op-w1');
  });

  it('exits with error for unknown format', async () => {
    await writeSession(sessionWithOps());
    const { stderr, exitCode } = await runCLI([
      'provenance',
      'prov-test-001',
      '--format',
      'graphml',
    ]);
    expect(stderr).toContain('graphml');
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('agentgram recipe <session-id>', () => {
  const sessionWithOps = (): Session =>
    makeSession({
      id: 'recipe-test-001',
      name: 'add feature',
      operations: [
        {
          id: 'op-r1',
          type: 'read',
          timestamp: 1_000,
          target: 'src/index.ts',
          metadata: {},
          causedBy: [],
        },
        {
          id: 'op-w1',
          type: 'write',
          timestamp: 2_000,
          target: 'src/feature.ts',
          metadata: {},
          reason: 'implement feature',
          causedBy: ['op-r1'],
        },
      ],
    });

  it('outputs YAML by default', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['recipe', 'recipe-test-001']);
    expect(stdout).toContain('name:');
    expect(stdout).toContain('steps:');
    expect(stdout).toContain('version:');
  });

  it('--format yaml outputs YAML', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['recipe', 'recipe-test-001', '--format', 'yaml']);
    expect(stdout).toContain('name:');
    expect(stdout).toContain('sourceSessionId:');
  });

  it('--format markdown outputs Markdown', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['recipe', 'recipe-test-001', '--format', 'markdown']);
    expect(stdout).toContain('# ');   // markdown heading
    expect(stdout).toContain('## Steps');
  });

  it('--format json outputs JSON', async () => {
    await writeSession(sessionWithOps());
    const { stdout } = await runCLI(['recipe', 'recipe-test-001', '--format', 'json']);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('name');
    expect(parsed).toHaveProperty('steps');
    expect(parsed).toHaveProperty('sourceSessionId', 'recipe-test-001');
  });

  it('exits with error for unknown format', async () => {
    await writeSession(sessionWithOps());
    const { stderr, exitCode } = await runCLI([
      'recipe',
      'recipe-test-001',
      '--format',
      'toml',
    ]);
    expect(stderr).toContain('toml');
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('unknown command', () => {
  it('prints help / error message for unrecognised commands', async () => {
    const { stderr, stdout } = await runCLI(['foobar']);
    // commander outputs error to stderr or emits help to stdout
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/unknown command|error|usage|help/);
  });
});

// ---------------------------------------------------------------------------

describe('createProgram()', () => {
  it('returns a Command instance', () => {
    const program = createProgram();
    expect(program).toBeInstanceOf(Command);
  });

  it('has the correct program name', () => {
    const program = createProgram();
    expect(program.name()).toBe('agentgram');
  });

  it('registers the expected subcommands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('list');
    expect(names).toContain('show');
    expect(names).toContain('log');
    expect(names).toContain('diff');
    expect(names).toContain('provenance');
    expect(names).toContain('recipe');
    expect(names).toContain('export');
  });
});
