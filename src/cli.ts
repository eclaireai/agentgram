/**
 * agentgram CLI
 *
 * Entry point: dist/cli.js (ESM, shebang injected by tsup)
 * Export: createProgram() for programmatic/test usage
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from './core/types.js';
import { ProvenanceTracker } from './provenance/graph.js';
import { RecipeDistiller } from './recipe/distill.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSIONS_DIR = path.join('.agentgram', 'sessions');

/** Shape stored on disk by the session orchestrator */
interface PersistedSession {
  session: Session;
  provenance: unknown;
  recipe: unknown;
}

async function readSession(sessionId: string): Promise<Session> {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    console.error(chalk.red(`✖  Session not found: ${sessionId}`));
    console.error(chalk.dim(`   Expected: ${file}`));
    process.exit(1);
  }
  const data = JSON.parse(raw) as PersistedSession | Session;
  // Handle both PersistedSession wrapper and bare Session formats
  if ('session' in data && data.session && typeof data.session === 'object' && 'id' in data.session) {
    return data.session as Session;
  }
  return data as Session;
}

async function listSessionFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SESSIONS_DIR);
    return entries.filter((e) => e.endsWith('.json')).map((e) => e.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(startedAt: number, stoppedAt?: number): string {
  if (!stoppedAt) return chalk.yellow('(recording…)');
  const ms = stoppedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function opTypeColor(type: string): string {
  switch (type) {
    case 'read':    return chalk.cyan(type);
    case 'write':   return chalk.yellow(type);
    case 'create':  return chalk.green(type);
    case 'delete':  return chalk.red(type);
    case 'exec':    return chalk.magenta(type);
    default:        return type;
  }
}

// ---------------------------------------------------------------------------
// createProgram
// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();

  program
    .name('agentgram')
    .description(
      chalk.bold('agentgram') + '  —  replay, retrace & journal agentic coding sessions',
    )
    .version('0.1.0', '-v, --version', 'print version')
    .addHelpText(
      'afterAll',
      `\n${chalk.dim('Examples:')}
  ${chalk.cyan('agentgram list')}
  ${chalk.cyan('agentgram show <session-id>')}
  ${chalk.cyan('agentgram provenance <session-id> --format dot')}
  ${chalk.cyan('agentgram recipe <session-id> --format markdown')}
`,
    );

  // ── list ──────────────────────────────────────────────────────────────────
  program
    .command('list')
    .description('List all recorded sessions')
    .action(async () => {
      const ids = await listSessionFiles();

      if (ids.length === 0) {
        console.log(chalk.dim('📭  No sessions found in') + ' ' + chalk.cyan(SESSIONS_DIR));
        return;
      }

      console.log(chalk.bold('\n📋  Sessions\n'));

      const sessions: Session[] = [];
      for (const id of ids) {
        try {
          const raw = await fs.readFile(path.join(SESSIONS_DIR, `${id}.json`), 'utf8');
          const data = JSON.parse(raw) as PersistedSession | Session;
          // Handle both PersistedSession wrapper and bare Session formats
          if ('session' in data && data.session && typeof data.session === 'object' && 'id' in data.session) {
            sessions.push(data.session as Session);
          } else {
            sessions.push(data as Session);
          }
        } catch {
          // skip malformed
        }
      }

      sessions.sort((a, b) => b.startedAt - a.startedAt);

      for (const s of sessions) {
        const stateColor =
          s.state === 'recording'
            ? chalk.green(s.state)
            : s.state === 'stopped'
            ? chalk.dim(s.state)
            : chalk.yellow(s.state);

        console.log(
          `  ${chalk.bold(s.id)}  ${chalk.whiteBright(s.name)}`,
        );
        console.log(
          `  ${chalk.dim('State:')} ${stateColor}   ` +
          `${chalk.dim('Ops:')} ${chalk.cyan(String(s.operations.length))}   ` +
          `${chalk.dim('Started:')} ${formatTimestamp(s.startedAt)}   ` +
          `${chalk.dim('Duration:')} ${formatDuration(s.startedAt, s.stoppedAt)}`,
        );
        console.log();
      }
    });

  // ── show ──────────────────────────────────────────────────────────────────
  program
    .command('show <session-id>')
    .description('Show full details of a session')
    .action(async (sessionId: string) => {
      const session = await readSession(sessionId);

      console.log(chalk.bold(`\n🔍  Session: ${session.id}\n`));
      console.log(`  ${chalk.dim('Name:')}     ${chalk.whiteBright(session.name)}`);
      console.log(`  ${chalk.dim('State:')}    ${session.state}`);
      console.log(`  ${chalk.dim('Branch:')}   ${chalk.cyan(session.branch)}`);
      console.log(`  ${chalk.dim('Base:')}     ${chalk.dim(session.baseCommit)}`);
      console.log(`  ${chalk.dim('CWD:')}      ${session.cwd}`);
      console.log(`  ${chalk.dim('Started:')}  ${formatTimestamp(session.startedAt)}`);
      if (session.stoppedAt) {
        console.log(`  ${chalk.dim('Stopped:')}  ${formatTimestamp(session.stoppedAt)}`);
        console.log(`  ${chalk.dim('Duration:')} ${formatDuration(session.startedAt, session.stoppedAt)}`);
      }
      console.log(`  ${chalk.dim('Ops:')}      ${chalk.cyan(String(session.operations.length))}`);

      if (session.operations.length > 0) {
        console.log(chalk.bold('\n  Operations:\n'));
        for (const op of session.operations) {
          const ts = new Date(op.timestamp).toISOString().slice(11, 19);
          const reason = op.reason ? chalk.dim(` — ${op.reason}`) : '';
          console.log(
            `  ${chalk.dim(ts)}  ${opTypeColor(op.type).padEnd(8)}  ${op.target}${reason}`,
          );
        }
      }

      console.log();
    });

  // ── log ───────────────────────────────────────────────────────────────────
  program
    .command('log <session-id>')
    .description('Show micro-commit history for a session')
    .action(async (sessionId: string) => {
      const session = await readSession(sessionId);

      console.log(chalk.bold(`\n📜  Micro-commit log: ${session.id}\n`));
      console.log(`  ${chalk.dim('Branch:')} ${chalk.cyan(session.branch)}`);
      console.log(`  ${chalk.dim('Base:')}   ${chalk.dim(session.baseCommit)}`);
      console.log();

      if (session.operations.length === 0) {
        console.log(chalk.dim('  (no operations recorded)'));
      } else {
        const writeOps = session.operations.filter(
          (o) => o.type === 'write' || o.type === 'create' || o.type === 'delete' || o.type === 'exec',
        );

        if (writeOps.length === 0) {
          console.log(chalk.dim('  (no commits — only read operations recorded)'));
        } else {
          writeOps.forEach((op, i) => {
            const num = String(writeOps.length - i).padStart(3, ' ');
            const ts = new Date(op.timestamp).toISOString().slice(0, 19).replace('T', ' ');
            const defaultDesc =
              op.type === 'exec'
                ? (op.metadata.command ?? op.target)
                : `${op.type}(${op.target})`;
            const desc = op.reason ?? defaultDesc;
            console.log(
              `  ${chalk.dim(num)}  ${chalk.yellow(op.id.slice(0, 8))}  ${chalk.dim(ts)}  ${desc}`,
            );
          });
        }
      }

      console.log();
    });

  // ── diff ──────────────────────────────────────────────────────────────────
  program
    .command('diff <session-id>')
    .description('Show a summary of file changes in the session')
    .action(async (sessionId: string) => {
      const session = await readSession(sessionId);

      console.log(chalk.bold(`\n📊  Diff summary: ${session.id}\n`));

      const changed = new Map<string, { type: string; before?: string; after?: string }>();

      for (const op of session.operations) {
        if (op.type === 'create') {
          changed.set(op.target, { type: 'create', after: op.metadata.afterHash });
        } else if (op.type === 'delete') {
          changed.set(op.target, { type: 'delete', before: op.metadata.beforeHash });
        } else if (op.type === 'write') {
          const existing = changed.get(op.target);
          if (existing?.type === 'create') {
            changed.set(op.target, { type: 'create', after: op.metadata.afterHash });
          } else {
            changed.set(op.target, {
              type: 'write',
              before: op.metadata.beforeHash,
              after: op.metadata.afterHash,
            });
          }
        }
      }

      if (changed.size === 0) {
        console.log(chalk.dim('  (no file changes recorded)'));
      }

      for (const [file, info] of changed) {
        if (info.type === 'create') {
          console.log(`  ${chalk.green('+')}  ${chalk.green(file)}  ${chalk.dim('(created)')}`);
          if (info.after) console.log(`     ${chalk.dim('hash:')} ${info.after}`);
        } else if (info.type === 'delete') {
          console.log(`  ${chalk.red('-')}  ${chalk.red(file)}  ${chalk.dim('(deleted)')}`);
          if (info.before) console.log(`     ${chalk.dim('hash:')} ${info.before}`);
        } else {
          console.log(`  ${chalk.yellow('~')}  ${chalk.yellow(file)}  ${chalk.dim('(modified)')}`);
          if (info.before && info.after) {
            console.log(`     ${chalk.dim('before:')} ${info.before}  ${chalk.dim('after:')} ${info.after}`);
          }
        }
      }

      const execs = session.operations.filter((o) => o.type === 'exec');
      if (execs.length > 0) {
        console.log();
        console.log(chalk.dim(`  ${execs.length} command(s) executed`));
        for (const op of execs) {
          const cmd = op.metadata.command ?? op.target;
          const exit = op.metadata.exitCode !== undefined ? ` [exit ${op.metadata.exitCode}]` : '';
          console.log(`  ${chalk.magenta('$')}  ${cmd}${chalk.dim(exit)}`);
        }
      }

      console.log();
    });

  // ── provenance ────────────────────────────────────────────────────────────
  program
    .command('provenance <session-id>')
    .description('Output the causal provenance graph')
    .option('--format <fmt>', 'output format: dot | mermaid', 'mermaid')
    .action(async (sessionId: string, options: { format: string }) => {
      const session = await readSession(sessionId);
      const tracker = new ProvenanceTracker(session.id);

      for (const op of session.operations) {
        if (op.type === 'read') {
          tracker.addRead(op);
        } else if (op.type === 'exec') {
          tracker.addExec(op);
        } else {
          tracker.addWrite(op);
        }
      }

      const fmt = options.format.toLowerCase();
      if (fmt === 'dot') {
        console.log(tracker.toDot());
      } else if (fmt === 'mermaid') {
        console.log(tracker.toMermaid());
      } else {
        console.error(chalk.red(`✖  Unknown format: ${options.format}`));
        console.error(chalk.dim('  Supported formats: dot, mermaid'));
        process.exit(1);
      }
    });

  // ── recipe ────────────────────────────────────────────────────────────────
  program
    .command('recipe <session-id>')
    .description('Output the distilled recipe for a session')
    .option('--format <fmt>', 'output format: yaml | markdown | json', 'yaml')
    .action(async (sessionId: string, options: { format: string }) => {
      const session = await readSession(sessionId);
      const distiller = new RecipeDistiller();
      const recipe = distiller.distill(session);

      const fmt = options.format.toLowerCase();
      if (fmt === 'yaml') {
        console.log(distiller.toYAML(recipe));
      } else if (fmt === 'markdown') {
        console.log(distiller.toMarkdown(recipe));
      } else if (fmt === 'json') {
        console.log(distiller.toJSON(recipe));
      } else {
        console.error(chalk.red(`✖  Unknown format: ${options.format}`));
        console.error(chalk.dim('  Supported formats: yaml, markdown, json'));
        process.exit(1);
      }
    });

  // ── export ────────────────────────────────────────────────────────────────
  program
    .command('export <session-id> <outfile>')
    .description('Export full session data to a JSON file')
    .action(async (sessionId: string, outfile: string) => {
      const session = await readSession(sessionId);
      const distiller = new RecipeDistiller();
      const recipe = distiller.distill(session);
      const tracker = new ProvenanceTracker(session.id);

      for (const op of session.operations) {
        if (op.type === 'read') {
          tracker.addRead(op);
        } else if (op.type === 'exec') {
          tracker.addExec(op);
        } else {
          tracker.addWrite(op);
        }
      }

      const payload = {
        session,
        recipe,
        provenance: tracker.getProvenance(),
      };

      const dest = path.resolve(outfile);
      await fs.writeFile(dest, JSON.stringify(payload, null, 2), 'utf8');
      console.log(
        chalk.green('✔') +
        `  Exported session ${chalk.bold(sessionId)} to ${chalk.cyan(dest)}`,
      );
    });

  return program;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Only run when this file is the main module (not imported in tests)
if (
  process.argv[1] &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts'))
) {
  createProgram().parseAsync(process.argv).catch((err: unknown) => {
    console.error(chalk.red('✖  Unexpected error:'), err);
    process.exit(1);
  });
}
