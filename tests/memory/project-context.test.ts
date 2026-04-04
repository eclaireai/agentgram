import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ProjectContextManager,
  refreshProjectContext,
  type ProjectDecision,
} from '../../src/memory/project-context.js';
import type { Session, Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let opCounter = 0;
function makeOp(
  type: Operation['type'],
  target: string,
  overrides: Partial<Operation> = {},
): Operation {
  opCounter++;
  return {
    id: `op-${opCounter}`,
    type,
    timestamp: Date.now() + opCounter * 100,
    target,
    metadata: {},
    causedBy: [],
    ...overrides,
  };
}

function makeExecOp(command: string, exitCode = 0): Operation {
  return makeOp('exec', command, {
    metadata: { command, exitCode },
  });
}

function makeSession(
  id: string,
  name: string,
  ops: Operation[],
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    name,
    state: 'stopped',
    startedAt: Date.now() - 10000,
    stoppedAt: Date.now(),
    operations: ops,
    branch: 'main',
    baseCommit: 'abc123',
    cwd: '/project',
    ...overrides,
  };
}

function writeSessions(sessionsDir: string, sessions: Session[]): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  for (const s of sessions) {
    fs.writeFileSync(
      path.join(sessionsDir, `${s.id}.json`),
      JSON.stringify(s, null, 2),
    );
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let agentgramDir: string;
let sessionsDir: string;
let manager: ProjectContextManager;

beforeEach(() => {
  opCounter = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-ctx-test-'));
  agentgramDir = path.join(tmpDir, '.agentgram');
  sessionsDir = path.join(agentgramDir, 'sessions');
  manager = new ProjectContextManager(agentgramDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// buildFromSessions()
// ---------------------------------------------------------------------------

describe('buildFromSessions()', () => {
  it('returns empty context when sessions directory does not exist', async () => {
    const ctx = await manager.buildFromSessions();

    expect(ctx.decisions).toEqual([]);
    expect(ctx.appliedRecipes).toEqual([]);
    expect(ctx.keyFiles).toEqual([]);
    expect(ctx.deadEnds).toEqual([]);
    expect(ctx.projectName).toBeTruthy();
    expect(ctx.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns empty context when sessions directory is empty', async () => {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const ctx = await manager.buildFromSessions();

    expect(ctx.decisions).toEqual([]);
    expect(ctx.keyFiles).toEqual([]);
    expect(ctx.deadEnds).toEqual([]);
  });

  it('identifies key files written across multiple sessions', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth', [
        makeOp('write', 'src/auth/middleware.ts'),
        makeOp('write', 'src/auth/index.ts'),
      ]),
      makeSession('s2', 'fix-auth', [
        makeOp('write', 'src/auth/middleware.ts'),
        makeOp('write', 'src/api/routes.ts'),
      ]),
      makeSession('s3', 'add-payments', [
        makeOp('write', 'src/api/stripe.ts'),
        makeOp('write', 'src/auth/middleware.ts'),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    const ctx = await manager.buildFromSessions();

    // src/auth/middleware.ts was written in 3 sessions — must be a key file
    expect(ctx.keyFiles).toContain('src/auth/middleware.ts');
    // src/auth/index.ts only in 1 session but there are only 4 unique files total
    // and we fall back to single-session files when fewer than 3 multi-session files exist
  });

  it('detects dead ends from repeated failed exec commands', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'setup-db', [
        makeExecOp('prisma migrate dev', 1),
        makeExecOp('prisma generate', 0),
        makeExecOp('prisma migrate dev', 0),
      ]),
      makeSession('s2', 'fix-db', [
        makeExecOp('prisma migrate dev', 1),
        makeExecOp('prisma generate', 0),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    const ctx = await manager.buildFromSessions();

    // 'prisma migrate dev' failed in 2 sessions → dead end
    expect(ctx.deadEnds.some((d) => d.includes('prisma migrate dev'))).toBe(true);
    expect(ctx.deadEnds.some((d) => d.includes('2 occurrences'))).toBe(true);
  });

  it('detects applied recipes from session names', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth-clerk', [
        makeOp('write', 'src/auth/clerk.ts'),
        makeOp('write', 'middleware.ts'),
        makeOp('write', 'app/layout.tsx'),
      ]),
      makeSession('s2', 'add-payments-stripe', [
        makeOp('write', 'src/api/stripe.ts'),
        makeOp('write', 'src/hooks/useSubscription.ts'),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    const ctx = await manager.buildFromSessions();

    expect(ctx.appliedRecipes).toContain('add-auth-clerk');
    expect(ctx.appliedRecipes).toContain('add-payments-stripe');
  });

  it('populates lastUpdated from most recent session', async () => {
    const now = Date.now();
    const sessions: Session[] = [
      makeSession('s1', 'first-session', [makeOp('write', 'foo.ts')], {
        startedAt: now - 100000,
        stoppedAt: now - 90000,
      }),
      makeSession('s2', 'second-session', [makeOp('write', 'bar.ts')], {
        startedAt: now - 10000,
        stoppedAt: now - 5000,
      }),
    ];
    writeSessions(sessionsDir, sessions);

    const ctx = await manager.buildFromSessions();

    // lastUpdated should be the date of the most recent session
    expect(ctx.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should be today or a recent date
    const today = new Date().toISOString().slice(0, 10);
    expect(ctx.lastUpdated).toBe(today);
  });

  it('skips malformed JSON session files gracefully', async () => {
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'bad.json'), '{ invalid json !!!');

    const ctx = await manager.buildFromSessions();
    expect(ctx.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractDecisionsFromSession()
// ---------------------------------------------------------------------------

describe('extractDecisionsFromSession()', () => {
  it('marks short sessions with no writes as rejected', () => {
    const session = makeSession('s1', 'try-nextauth', [
      makeOp('read', 'package.json'),
      makeOp('read', 'src/app/page.tsx'),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe('rejected');
    expect(decisions[0].what).toContain('try-nextauth');
    expect(decisions[0].what).toContain('2 ops');
  });

  it('marks recipe-named sessions with writes as recipe-applied', () => {
    const session = makeSession('s1', 'add-auth-clerk', [
      makeOp('write', 'src/auth/clerk.ts'),
      makeOp('write', 'middleware.ts'),
      makeOp('write', 'app/layout.tsx'),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    const recipeDecisions = decisions.filter((d) => d.type === 'recipe-applied');
    expect(recipeDecisions.length).toBeGreaterThan(0);
    expect(recipeDecisions[0].what).toBe('add-auth-clerk');
  });

  it('produces architectural decision for sessions with 3+ writes', () => {
    const session = makeSession('s1', 'setup-database', [
      makeOp('write', 'prisma/schema.prisma'),
      makeOp('write', 'src/db/client.ts'),
      makeOp('write', 'src/db/migrations.ts'),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    const archDecisions = decisions.filter((d) => d.type === 'architectural');
    expect(archDecisions.length).toBeGreaterThan(0);
    expect(archDecisions[0].what).toContain('setup-database');
  });

  it('records dead-end for failed exec operations', () => {
    const session = makeSession('s1', 'setup-db', [
      makeExecOp('prisma migrate dev', 1),
      makeOp('write', 'prisma/schema.prisma'),
      makeExecOp('prisma generate', 0),
      makeExecOp('prisma migrate dev', 0),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    const deadEnds = decisions.filter((d) => d.type === 'dead-end');
    expect(deadEnds.length).toBeGreaterThan(0);
    expect(deadEnds[0].what).toContain('prisma migrate dev');
    expect(deadEnds[0].what).toContain('exit 1');
  });

  it('returns correct sessionId on all decisions', () => {
    const session = makeSession('sess-xyz', 'add-auth', [
      makeOp('write', 'src/auth.ts'),
      makeOp('write', 'src/middleware.ts'),
      makeOp('write', 'src/config.ts'),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    for (const d of decisions) {
      expect(d.sessionId).toBe('sess-xyz');
    }
  });

  it('returns empty array for a session with no operations', () => {
    const session = makeSession('s1', 'empty-session', []);
    const decisions = manager.extractDecisionsFromSession(session);
    expect(decisions).toEqual([]);
  });

  it('handles sessions with only read operations (not rejected if ≥5 reads)', () => {
    // Session has 6 ops but all reads and no writes — not "rejected" (<5 threshold)
    const session = makeSession('s1', 'explore-codebase', [
      makeOp('read', 'src/a.ts'),
      makeOp('read', 'src/b.ts'),
      makeOp('read', 'src/c.ts'),
      makeOp('read', 'src/d.ts'),
      makeOp('read', 'src/e.ts'),
      makeOp('read', 'src/f.ts'),
    ]);

    const decisions = manager.extractDecisionsFromSession(session);

    // Should NOT produce a 'rejected' decision (session has 6 ops ≥ 5 threshold)
    const rejected = decisions.filter((d) => d.type === 'rejected');
    expect(rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateContextFile()
// ---------------------------------------------------------------------------

describe('updateContextFile()', () => {
  it('writes CONTEXT.md to the agentgram directory', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth', [
        makeOp('write', 'src/auth.ts'),
        makeOp('write', 'src/middleware.ts'),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    const writtenPath = await manager.updateContextFile();

    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(writtenPath).toContain('CONTEXT.md');
  });

  it('written file contains required markdown sections', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth-clerk', [
        makeOp('write', 'src/auth/clerk.ts'),
        makeOp('write', 'middleware.ts'),
        makeOp('write', 'app/layout.tsx'),
      ]),
      makeSession('s2', 'add-auth-clerk', [
        makeOp('write', 'src/auth/clerk.ts'),
        makeExecOp('prisma migrate dev', 1),
        makeExecOp('prisma migrate dev', 1),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();

    const content = fs.readFileSync(
      path.join(agentgramDir, 'CONTEXT.md'),
      'utf8',
    );

    expect(content).toContain('## Key Files');
    expect(content).toContain('## Applied Recipes');
    expect(content).toContain('## Architectural Decisions');
    expect(content).toContain('## Known Dead Ends');
    expect(content).toContain('## Rejected Approaches');
    expect(content).toContain('Auto-generated by agentgram');
  });

  it('includes session count in the header', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'first', [makeOp('write', 'a.ts')]),
      makeSession('s2', 'second', [makeOp('write', 'b.ts')]),
      makeSession('s3', 'third', [makeOp('write', 'c.ts')]),
    ];
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();

    const content = fs.readFileSync(
      path.join(agentgramDir, 'CONTEXT.md'),
      'utf8',
    );
    expect(content).toContain('3 sessions recorded');
  });

  it('creates agentgram directory if it does not exist', async () => {
    const newDir = path.join(tmpDir, 'brand-new');
    const newManager = new ProjectContextManager(newDir);
    const writtenPath = await newManager.updateContextFile();

    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('lists key files with session count annotation', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'setup', [makeOp('write', 'src/core.ts')]),
      makeSession('s2', 'refactor', [makeOp('write', 'src/core.ts')]),
      makeSession('s3', 'bugfix', [makeOp('write', 'src/core.ts')]),
    ];
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();

    const content = fs.readFileSync(path.join(agentgramDir, 'CONTEXT.md'), 'utf8');
    expect(content).toContain('src/core.ts');
    expect(content).toContain('3 sessions');
  });
});

// ---------------------------------------------------------------------------
// getContextForInjection()
// ---------------------------------------------------------------------------

describe('getContextForInjection()', () => {
  it('returns placeholder text when CONTEXT.md does not exist', () => {
    const result = manager.getContextForInjection();
    expect(result).toContain('No project context');
  });

  it('returns content under 500 words', async () => {
    // Create a moderately rich context
    const sessions: Session[] = Array.from({ length: 10 }, (_, i) =>
      makeSession(`s${i}`, `add-feature-${i}`, [
        makeOp('write', `src/feature${i}/index.ts`),
        makeOp('write', `src/feature${i}/types.ts`),
        makeOp('write', `src/feature${i}/utils.ts`),
        makeExecOp('npm test', i % 3 === 0 ? 1 : 0),
      ]),
    );
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();
    const injection = manager.getContextForInjection();

    const wordCount = injection.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(500);
  });

  it('returns plain text without markdown headers', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth', [
        makeOp('write', 'src/auth.ts'),
        makeOp('write', 'src/middleware.ts'),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();
    const injection = manager.getContextForInjection();

    // Should not contain markdown headers (##)
    expect(injection).not.toMatch(/^## /m);
    // Should not be empty
    expect(injection.trim().length).toBeGreaterThan(10);
  });

  it('includes key section labels in compressed form', async () => {
    const sessions: Session[] = [
      makeSession('s1', 'add-auth-clerk', [
        makeOp('write', 'src/auth/clerk.ts'),
        makeOp('write', 'middleware.ts'),
        makeOp('write', 'app/layout.tsx'),
      ]),
    ];
    writeSessions(sessionsDir, sessions);

    await manager.updateContextFile();
    const injection = manager.getContextForInjection();

    // Should contain bracketed section labels from compression
    expect(injection).toMatch(/\[.+\]/);
  });
});

// ---------------------------------------------------------------------------
// refreshProjectContext() convenience export
// ---------------------------------------------------------------------------

describe('refreshProjectContext()', () => {
  it('writes CONTEXT.md and returns the path', async () => {
    writeSessions(sessionsDir, [
      makeSession('s1', 'init', [makeOp('write', 'src/index.ts')]),
    ]);

    const writtenPath = await refreshProjectContext(agentgramDir);

    expect(fs.existsSync(writtenPath)).toBe(true);
    expect(writtenPath.endsWith('CONTEXT.md')).toBe(true);
  });

  it('works with default argument structure', async () => {
    // Create agentgramDir at the specific path and use the manager directly
    writeSessions(sessionsDir, [
      makeSession('s1', 'add-feature', [makeOp('create', 'src/feature.ts')]),
    ]);

    const result = await refreshProjectContext(agentgramDir);
    expect(typeof result).toBe('string');
    expect(result).toContain('CONTEXT.md');
  });
});
