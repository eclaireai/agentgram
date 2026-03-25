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

  // ── recipe (distill from session) ────────────────────────────────────────
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

  // ── share ──────────────────────────────────────────────────────────────────
  program
    .command('share <session-id>')
    .description('Parameterize and publish a recipe to the agentgram registry')
    .option('--name <name>', 'recipe name (defaults to session name)')
    .option('--tags <tags>', 'comma-separated tags', '')
    .option('--agent <agent>', 'source agent (claude-code, cursor, etc.)')
    .option('--yes', 'skip confirmation prompt')
    .action(async (sessionId: string, options: { name?: string; tags: string; agent?: string; yes?: boolean }) => {
      const session = await readSession(sessionId);
      const { prepareForSharing } = await import('./recipe/share.js');
      const { GitHubRecipeRegistry } = await import('./recipe/registry.js');

      const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
      const shared = prepareForSharing(session, {
        name: options.name,
        tags,
        sourceAgent: options.agent,
      });

      console.log(chalk.bold(`\n📦  Recipe: ${shared.name}\n`));
      console.log(`  ${chalk.dim('ID:')}     ${shared.metadata.id}`);
      console.log(`  ${chalk.dim('Steps:')}  ${shared.steps.length}`);
      console.log(`  ${chalk.dim('Tags:')}   ${shared.tags.join(', ') || '(none)'}`);
      console.log(`  ${chalk.dim('Agent:')}  ${shared.metadata.sourceAgent}`);
      console.log();

      for (const [i, step] of shared.steps.entries()) {
        console.log(`  ${chalk.dim(String(i + 1).padStart(2))}  ${chalk.cyan(step.action.padEnd(14))} ${step.target}`);
      }

      if (Object.keys(shared.parameters).length > 0) {
        console.log(chalk.bold('\n  Parameters:'));
        for (const [key, value] of Object.entries(shared.parameters)) {
          console.log(`    ${chalk.yellow(`{${key}}`)} = ${value}`);
        }
      }

      console.log();

      if (!options.yes) {
        console.log(chalk.yellow('  Publish to agentgram registry? Set --yes to auto-confirm.\n'));
        return;
      }

      try {
        const registry = new GitHubRecipeRegistry();
        const id = await registry.publish(shared);
        console.log(chalk.green('✔') + `  Published: ${chalk.bold(id)}`);
        console.log(chalk.dim(`  https://github.com/eclaireai/agentgram-recipes/blob/main/recipes/${id}.json`));
      } catch (err) {
        console.error(chalk.red('✖  Publish failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── search ─────────────────────────────────────────────────────────────────
  program
    .command('search <query>')
    .description('Search the agentgram recipe registry')
    .option('--tag <tag>', 'filter by tag')
    .option('--agent <agent>', 'filter by source agent')
    .option('--limit <n>', 'max results', '20')
    .action(async (query: string, options: { tag?: string; agent?: string; limit: string }) => {
      const { GitHubRecipeRegistry } = await import('./recipe/registry.js');
      const registry = new GitHubRecipeRegistry();

      try {
        const result = await registry.search(query, {
          tags: options.tag ? [options.tag] : undefined,
          agent: options.agent,
          limit: parseInt(options.limit, 10),
        });

        if (result.entries.length === 0) {
          console.log(chalk.dim(`\n  No recipes found for "${query}"\n`));
          return;
        }

        console.log(chalk.bold(`\n🔍  ${result.total} recipe(s) matching "${query}"\n`));

        for (const entry of result.entries) {
          console.log(
            `  ${chalk.bold(entry.id)}  ${chalk.whiteBright(entry.name)}` +
            `  ${chalk.dim('by')} ${entry.author}` +
            `  ${chalk.cyan(`${entry.stepCount} steps`)}` +
            `  ${chalk.dim(`↓${entry.downloads}`)}`
          );
          if (entry.tags.length > 0) {
            console.log(`    ${chalk.dim('tags:')} ${entry.tags.join(', ')}`);
          }
        }

        console.log(chalk.dim(`\n  Pull with: agentgram pull <recipe-id>\n`));
      } catch (err) {
        console.error(chalk.red('✖  Search failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── pull ───────────────────────────────────────────────────────────────────
  program
    .command('pull <recipe-id>')
    .description('Download a recipe from the registry to your local store')
    .action(async (recipeId: string) => {
      const { GitHubRecipeRegistry } = await import('./recipe/registry.js');
      const { LocalRecipeStore } = await import('./recipe/store.js');

      const registry = new GitHubRecipeRegistry();
      const store = new LocalRecipeStore(process.cwd());

      try {
        const recipe = await registry.pull(recipeId);
        await store.save(recipe);

        console.log(chalk.green('✔') + `  Pulled: ${chalk.bold(recipe.name)}`);
        console.log(`  ${chalk.dim('ID:')}      ${recipe.metadata.id}`);
        console.log(`  ${chalk.dim('Author:')}  ${recipe.metadata.author}`);
        console.log(`  ${chalk.dim('Steps:')}   ${recipe.steps.length}`);
        console.log(`  ${chalk.dim('Saved:')}   ${store.getStorePath()}`);
      } catch (err) {
        console.error(chalk.red('✖  Pull failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── recipes (list local/remote) ────────────────────────────────────────────
  program
    .command('recipes')
    .description('List recipes (local by default, --remote for registry)')
    .option('--remote', 'list from the registry instead of local store')
    .option('--limit <n>', 'max results', '20')
    .action(async (options: { remote?: boolean; limit: string }) => {
      const limit = parseInt(options.limit, 10);

      if (options.remote) {
        const { GitHubRecipeRegistry } = await import('./recipe/registry.js');
        const registry = new GitHubRecipeRegistry();

        try {
          const entries = await registry.list({ limit });

          if (entries.length === 0) {
            console.log(chalk.dim('\n  No recipes in the registry yet.\n'));
            return;
          }

          console.log(chalk.bold(`\n🌐  Registry recipes\n`));
          for (const entry of entries) {
            console.log(
              `  ${chalk.bold(entry.id)}  ${chalk.whiteBright(entry.name)}` +
              `  ${chalk.dim('by')} ${entry.author}` +
              `  ${chalk.cyan(`${entry.stepCount} steps`)}` +
              `  ${chalk.dim(`↓${entry.downloads}`)}`
            );
          }
          console.log();
        } catch (err) {
          console.error(chalk.red('✖  Failed:'), err instanceof Error ? err.message : err);
          process.exit(1);
        }
      } else {
        const { LocalRecipeStore } = await import('./recipe/store.js');
        const store = new LocalRecipeStore(process.cwd());
        const recipes = await store.list();

        if (recipes.length === 0) {
          console.log(chalk.dim('\n  No local recipes. Pull some with: agentgram pull <recipe-id>\n'));
          return;
        }

        console.log(chalk.bold(`\n📚  Local recipes (${recipes.length})\n`));
        for (const r of recipes.slice(0, limit)) {
          console.log(
            `  ${chalk.bold(r.metadata.id)}  ${chalk.whiteBright(r.name)}` +
            `  ${chalk.cyan(`${r.steps.length} steps`)}` +
            `  ${chalk.dim(r.metadata.sourceAgent)}`
          );
        }
        console.log();
      }
    });

  // ── report ─────────────────────────────────────────────────────────────────
  program
    .command('report [recipe-id]')
    .description('View execution reports for recipes')
    .action(async (recipeId?: string) => {
      const { loadReports } = await import('./recipe/executor.js');
      const reports = await loadReports(process.cwd(), recipeId);

      if (reports.length === 0) {
        console.log(chalk.dim('\n  No execution reports found.\n'));
        return;
      }

      console.log(chalk.bold(`\n📊  Execution Reports${recipeId ? ` for ${recipeId}` : ''}\n`));

      for (const report of reports) {
        const successIcon = report.success ? chalk.green('✔') : chalk.red('✖');
        const scoreColor = report.score >= 4 ? chalk.green : report.score >= 2.5 ? chalk.yellow : chalk.red;

        console.log(
          `  ${successIcon}  ${chalk.bold(report.recipeName)}` +
          `  ${scoreColor(`★ ${report.score}/5`)}` +
          `  ${chalk.cyan(`${Math.round(report.completionRate * 100)}% complete`)}` +
          `  ${chalk.dim(new Date(report.executedAt).toLocaleDateString())}`
        );
        console.log(
          `     ${chalk.dim('Ops:')} ${report.metrics.totalOperations}` +
          `  ${chalk.dim('On-recipe:')} ${report.metrics.onRecipeOperations}` +
          `  ${chalk.dim('Extra:')} ${report.metrics.extraOperations}` +
          `  ${chalk.dim('Efficiency:')} ${chalk.cyan(`${Math.round(report.metrics.efficiency * 100)}%`)}` +
          `  ${chalk.green(`↓${report.metrics.savingsPercent}% cost`)}`
        );
        console.log();
      }

      // Aggregate stats
      if (reports.length > 1) {
        const avgScore = reports.reduce((s, r) => s + r.score, 0) / reports.length;
        const avgCompletion = reports.reduce((s, r) => s + r.completionRate, 0) / reports.length;
        const avgSavings = reports.reduce((s, r) => s + r.metrics.savingsPercent, 0) / reports.length;
        const totalTokensSaved = reports.reduce((s, r) => s + r.metrics.estimatedTokensSaved, 0);

        console.log(chalk.bold('  Aggregate:'));
        console.log(
          `    Avg score: ${chalk.cyan(avgScore.toFixed(1))}/5` +
          `  Avg completion: ${chalk.cyan(`${Math.round(avgCompletion * 100)}%`)}` +
          `  Avg savings: ${chalk.green(`${Math.round(avgSavings)}%`)}` +
          `  Total tokens saved: ${chalk.green(totalTokensSaved.toLocaleString())}`
        );
        console.log();
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

  // ── viz ───────────────────────────────────────────────────────────────────
  program
    .command('viz <session-id>')
    .description('Open an interactive provenance graph in the browser')
    .option('-o, --output <file>', 'save HTML to file instead of opening browser')
    .action(async (sessionId: string, options: { output?: string }) => {
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

      const { generateVizHtml } = await import('./viz/html.js');
      const html = generateVizHtml({
        session,
        provenance: tracker.getProvenance(),
        recipe,
      });

      if (options.output) {
        const dest = path.resolve(options.output);
        await fs.writeFile(dest, html, 'utf8');
        console.log(chalk.green('✔') + `  Saved visualization to ${chalk.cyan(dest)}`);
      } else {
        // Write to temp file and open in browser
        const tmpDir = path.join(process.cwd(), '.agentgram', 'tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `viz-${sessionId.slice(0, 12)}.html`);
        await fs.writeFile(tmpFile, html, 'utf8');

        const { exec } = await import('node:child_process');
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${tmpFile}"`);
        console.log(chalk.green('✔') + `  Opening visualization in browser...`);
        console.log(chalk.dim(`   File: ${tmpFile}`));
      }
    });

  // ── hook ──────────────────────────────────────────────────────────────────
  const hookCmd = program
    .command('hook <subcommand>')
    .description('Claude Code hook management')
    .addHelpText('after', `
${chalk.dim('Subcommands:')}
  ${chalk.cyan('install')}          Add agentgram hooks to Claude Code settings
  ${chalk.cyan('install --project')} Add hooks to project settings only
  ${chalk.cyan('uninstall')}        Remove agentgram hooks
  ${chalk.cyan('session-start')}    Internal: called by Claude Code on session start
  ${chalk.cyan('capture')}          Internal: called by Claude Code on tool use
`);

  hookCmd.action(async (subcommand: string) => {
    const { runHookCommand } = await import('./hooks/claude-code.js');
    runHookCommand([subcommand, ...hookCmd.args.slice(1)]);
  });

  // ── ingest ────────────────────────────────────────────────────────────────
  program
    .command('ingest')
    .description('Convert captured hook events into full agentgram sessions with provenance + recipe')
    .action(async () => {
      const { ingestAndSave } = await import('./hooks/ingest.js');
      const savedIds = ingestAndSave(process.cwd());
      if (savedIds.length === 0) {
        console.log(chalk.dim('No hook events found to ingest.'));
        console.log(chalk.dim('Run `agentgram hook install` to start capturing Claude Code sessions.'));
      } else {
        console.log(chalk.green('✔') + `  Ingested ${savedIds.length} session(s):`);
        for (const id of savedIds) {
          console.log(`   ${chalk.cyan(id)}`);
        }
        console.log(chalk.dim('\nView with: agentgram show <session-id>'));
        console.log(chalk.dim('Visualize: agentgram viz <session-id>'));
      }
    });

  // ── mcp ───────────────────────────────────────────────────────────────────
  program
    .command('mcp')
    .description('Start the agentgram MCP server (stdio transport)')
    .action(async () => {
      const { startMcpServer } = await import('./mcp/server.js');
      await startMcpServer();
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
