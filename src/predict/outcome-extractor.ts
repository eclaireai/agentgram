/**
 * Outcome Extractor
 *
 * Converts recorded agentgram Sessions into SessionOutcome objects
 * that can be fed into the PredictionEngine model.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '../core/types.js';
import type { SessionOutcome, StackContext } from './types.js';
import { PredictionEngine } from './engine.js';

// ---------------------------------------------------------------------------
// Stack detection patterns
// ---------------------------------------------------------------------------

/** Infer StackContext from a session's operation targets and exec commands */
export function inferStack(session: Session): StackContext {
  const stack: StackContext = {};

  const targets = session.operations.map((op) => op.target.toLowerCase());
  const commands = session.operations
    .filter((op) => op.type === 'exec')
    .map((op) => (op.metadata.command ?? op.target).toLowerCase());

  const allText = [...targets, ...commands];

  // Framework detection
  if (allText.some((t) => /next\.config\.|app\/|pages\//.test(t))) {
    stack.framework = 'nextjs';
  } else if (allText.some((t) => /express/.test(t))) {
    stack.framework = 'express';
  } else if (allText.some((t) => /fastapi|main\.py/.test(t))) {
    stack.framework = 'fastapi';
  } else if (allText.some((t) => /rails|gemfile/.test(t))) {
    stack.framework = 'rails';
  }

  // Language detection
  if (allText.some((t) => /requirements\.txt|\.py$/.test(t))) {
    stack.language = 'python';
  } else if (allText.some((t) => /gemfile|\.rb$/.test(t))) {
    stack.language = 'ruby';
  } else if (allText.some((t) => /\.ts$|tsconfig/.test(t))) {
    stack.language = 'typescript';
  } else if (allText.some((t) => /\.js$/.test(t))) {
    stack.language = 'javascript';
  }

  // ORM detection
  if (allText.some((t) => /schema\.prisma/.test(t))) {
    stack.orm = 'prisma';
  } else if (allText.some((t) => /drizzle\.config/.test(t))) {
    stack.orm = 'drizzle';
  } else if (allText.some((t) => /sqlalchemy/.test(t))) {
    stack.orm = 'sqlalchemy';
  }

  // Auth detection
  if (commands.some((c) => /clerk/.test(c)) || targets.some((t) => /clerk/.test(t))) {
    stack.auth = 'clerk';
  } else if (allText.some((t) => /nextauth|next-auth/.test(t))) {
    stack.auth = 'nextauth';
  } else if (allText.some((t) => /auth0/.test(t))) {
    stack.auth = 'auth0';
  }

  // Payments detection
  if (commands.some((c) => /stripe/.test(c)) || targets.some((t) => /stripe/.test(t))) {
    stack.payments = 'stripe';
  } else if (allText.some((t) => /paddle/.test(t))) {
    stack.payments = 'paddle';
  }

  // Database detection
  if (commands.some((c) => /postgres|pg\b/.test(c)) || targets.some((t) => /postgres|\.pg/.test(t))) {
    stack.database = 'postgres';
  } else if (allText.some((t) => /mysql/.test(t))) {
    stack.database = 'mysql';
  } else if (allText.some((t) => /sqlite/.test(t))) {
    stack.database = 'sqlite';
  }

  // Deployment detection
  if (allText.some((t) => /dockerfile|docker-compose/.test(t))) {
    stack.deployment = 'docker';
  } else if (
    targets.some((t) => /vercel\.json/.test(t)) ||
    commands.some((c) => /vercel/.test(c))
  ) {
    stack.deployment = 'vercel';
  }

  return stack;
}

// ---------------------------------------------------------------------------
// Anonymization helpers
// ---------------------------------------------------------------------------

/** Replace file paths, IPs, and tokens with structural placeholders */
function anonymizeErrorOutput(output: string): string {
  return output
    // Absolute paths → {path}
    .replace(/\/[^\s:'"]+/g, '{path}')
    // Windows paths → {path}
    .replace(/[A-Za-z]:\\[^\s:'"]+/g, '{path}')
    // IP addresses → {ip}
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{ip}')
    // Hex tokens / hashes → {token}
    .replace(/\b[0-9a-f]{16,}\b/gi, '{token}')
    // Truncate very long lines
    .split('\n')
    .slice(0, 5)
    .join('\n');
}

// ---------------------------------------------------------------------------
// extractOutcome
// ---------------------------------------------------------------------------

/**
 * Extract a SessionOutcome from a recorded Session.
 * The session.name is used as the task description (best approximation
 * when no explicit task field exists on the Session type).
 */
export function extractOutcome(session: Session, _agentgramDir?: string): SessionOutcome {
  const ops = session.operations;

  // success: session has ≥1 write/create operation AND no failed exec in last 3 ops
  const writeOps = ops.filter((op) => op.type === 'write' || op.type === 'create');
  const last3Ops = ops.slice(-3);
  const hasFailedExecInLast3 = last3Ops.some(
    (op) => op.type === 'exec' && (op.metadata.exitCode ?? 0) > 0,
  );
  const success = writeOps.length >= 1 && !hasFailedExecInLast3;

  // totalTokens estimate: reads*200 + writes*500 + execs*300
  const readCount = ops.filter((op) => op.type === 'read').length;
  const writeCount = ops.filter((op) => op.type === 'write' || op.type === 'create').length;
  const execCount = ops.filter((op) => op.type === 'exec').length;
  const totalTokens = readCount * 200 + writeCount * 500 + execCount * 300;

  // durationMinutes
  const durationMinutes =
    session.stoppedAt && session.startedAt
      ? (session.stoppedAt - session.startedAt) / 60000
      : 0;

  // deadEndCount: execs with exitCode > 0
  const failedExecs = ops.filter(
    (op) => op.type === 'exec' && (op.metadata.exitCode ?? 0) > 0,
  );
  const deadEndCount = failedExecs.length;

  // deadEndPatterns: anonymized error outputs
  const deadEndPatterns = failedExecs
    .map((op) => anonymizeErrorOutput(op.metadata.output ?? op.target))
    .filter(Boolean)
    .slice(0, 10);

  const stack = inferStack(session);

  return {
    sessionId: session.id,
    task: session.name,
    stack,
    success,
    totalTokens,
    durationMinutes,
    deadEndCount,
    deadEndPatterns,
    recordedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// extractAllOutcomes
// ---------------------------------------------------------------------------

/** Scan all sessions in .agentgram/sessions/ and extract outcomes */
export async function extractAllOutcomes(agentgramDir = '.agentgram'): Promise<SessionOutcome[]> {
  const sessionsDir = path.join(agentgramDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) return [];

  let filenames: string[];
  try {
    filenames = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const outcomes: SessionOutcome[] = [];

  for (const filename of filenames) {
    const filepath = path.join(sessionsDir, filename);
    try {
      const raw = JSON.parse(fs.readFileSync(filepath, 'utf8')) as { session?: Session };
      // Sessions are stored with a wrapper { session, operations, ... }
      const session = raw.session ?? (raw as unknown as Session);
      if (session && session.id) {
        outcomes.push(extractOutcome(session, agentgramDir));
      }
    } catch {
      // Skip corrupt files
    }
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// bootstrapModel
// ---------------------------------------------------------------------------

/**
 * Scan all existing sessions, extract outcomes, and build the initial model.
 * Returns the count of outcomes extracted.
 */
export async function bootstrapModel(agentgramDir = '.agentgram'): Promise<number> {
  const outcomes = await extractAllOutcomes(agentgramDir);

  if (outcomes.length === 0) return 0;

  const engine = new PredictionEngine(path.join(agentgramDir, 'predict', 'model.json'));

  for (const outcome of outcomes) {
    engine.recordOutcome(outcome);
  }

  // Force save after bootstrap regardless of throttle
  engine.saveModel();

  return outcomes.length;
}
