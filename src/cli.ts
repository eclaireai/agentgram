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

  // ── helpers ───────────────────────────────────────────────────────────────

  function printPrediction(task: string, result: import('./predict/types.js').PredictionResult): void {
    const pct = Math.round(result.successProbability * 100);
    const pctColor = pct >= 75 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
    const conf = Math.round(result.confidence * 100);

    console.log(chalk.bold(`\n🔮  Prediction: "${task}"\n`));
    console.log(`  ${chalk.dim('Success probability:')}  ${pctColor(`${pct}%`)}  ${chalk.dim(`(confidence: ${conf}%  based on ${result.basedOnSessions} sessions)`)}`);
    console.log(`  ${chalk.dim('Estimated tokens:')}     ${chalk.cyan(result.estimatedTokens.toLocaleString())}`);
    console.log(`  ${chalk.dim('Estimated time:')}       ${chalk.cyan(`~${result.estimatedMinutes} min`)}`);

    if (result.recommendedRecipe) {
      console.log(`  ${chalk.dim('Recommended recipe:')}   ${chalk.green(result.recommendedRecipe)}  ${chalk.dim(`(saves ~${result.tokenSavingsIfRecipeUsed.toLocaleString()} tokens)`)}`);
    }

    if (result.topRisks.length > 0) {
      console.log(chalk.bold(`\n  ⚠  ${result.topRisks.length} known risk${result.topRisks.length > 1 ? 's' : ''}:\n`));
      for (const [i, risk] of result.topRisks.entries()) {
        const prob = Math.round(risk.probability * 100);
        const sev = risk.severity === 'critical' ? chalk.red('critical') : risk.severity === 'high' ? chalk.yellow('high') : chalk.dim(risk.severity);
        console.log(`  ${chalk.dim(String(i + 1))}  ${chalk.bold(risk.pattern)}`);
        console.log(`     ${chalk.dim(`probability: ${prob}%  severity: `)}${sev}  ${chalk.dim(`seen ${risk.seenCount}×`)}`);
        console.log(`     ${chalk.dim('fix:')} ${risk.fix}`);
        console.log();
      }
    } else {
      console.log(chalk.green('\n  ✓  No known risk patterns found\n'));
    }
  }

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
        console.log(chalk.dim('# Generated by agentgram — https://github.com/eclaireai/agentgram'));
        console.log(distiller.toYAML(recipe));
        console.log(chalk.dim('\n─────────────────────────────────────────'));
        console.log(chalk.bold('  💡 Share this recipe?'));
        console.log(chalk.dim(`  agentgram share ${sessionId} --name "..." --tags "..."`));
        console.log(chalk.dim('  Others can pull it with: agentgram pull <recipe-id>'));
        console.log(chalk.dim('─────────────────────────────────────────\n'));
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

        // Fire-and-forget download count ping (doesn't block or fail the pull)
        void fetch(`https://api.agentgram.dev/track?id=${encodeURIComponent(recipeId)}&v=1`, {
          method: 'POST',
          signal: AbortSignal.timeout(2000),
        }).catch(() => {/* offline or service unavailable — ignore */});

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

  // ── extract ────────────────────────────────────────────────────────────────
  program
    .command('extract [path]')
    .description('Extract recipes from git history (reverse-engineer commits into recipes)')
    .option('--limit <n>', 'max commits to scan', '20')
    .option('--since <date>', 'only commits after this date (e.g. "2024-01-01")')
    .action(async (repoPath: string | undefined, options: { limit: string; since?: string }) => {
      const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
      const { extractRecipesFromRepo } = await import('./recipe/extractor.js');

      console.log(chalk.bold(`\n⛏️  Extracting recipes from git history...\n`));
      console.log(chalk.dim(`  Scanning: ${cwd}`));
      console.log(chalk.dim(`  Limit: ${options.limit} commits\n`));

      const recipes = await extractRecipesFromRepo(cwd, {
        limit: parseInt(options.limit, 10),
        since: options.since,
      });

      if (recipes.length === 0) {
        console.log(chalk.dim('  No recipes extracted (commits may be trivial).'));
        return;
      }

      for (const recipe of recipes) {
        console.log(
          `  ${chalk.green('✔')}  ${chalk.bold(recipe.name.slice(0, 60))}` +
          `  ${chalk.cyan(`${recipe.steps.length} steps`)}` +
          `  ${chalk.dim(recipe.tags.slice(0, 3).join(', '))}`
        );
      }

      console.log(chalk.bold(`\n  Extracted ${recipes.length} recipes.\n`));
      console.log(chalk.dim('  To save: agentgram extract --save (coming soon)'));
    });

  // ── fingerprint ────────────────────────────────────────────────────────────
  program
    .command('fingerprint [path]')
    .description('Scan a project and show its tech stack fingerprint')
    .action(async (projectPath?: string) => {
      const cwd = projectPath ? path.resolve(projectPath) : process.cwd();
      const { fingerprint } = await import('./recipe/fingerprint.js');

      const fp = await fingerprint(cwd);

      console.log(chalk.bold(`\n🔍  Codebase Fingerprint\n`));
      console.log(`  ${chalk.dim('Language:')}       ${chalk.cyan(fp.language)}`);
      console.log(`  ${chalk.dim('Framework:')}      ${chalk.cyan(fp.framework)}`);
      console.log(`  ${chalk.dim('ORM:')}            ${chalk.cyan(fp.orm)}`);
      console.log(`  ${chalk.dim('Test framework:')} ${chalk.cyan(fp.testFramework)}`);
      console.log(`  ${chalk.dim('Pkg manager:')}    ${chalk.cyan(fp.packageManager)}`);
      console.log(`  ${chalk.dim('Docker:')}         ${fp.hasDocker ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  ${chalk.dim('CI:')}             ${fp.hasCI ? chalk.green('yes') : chalk.dim('no')}`);
      console.log(`  ${chalk.dim('Monorepo:')}       ${fp.isMonorepo ? chalk.green('yes') : chalk.dim('no')}`);
      console.log();
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

  // ── debug (time-travel debugger) ──────────────────────────────────────────
  program
    .command('debug <session-id>')
    .description('Open the interactive time-travel debugger in your browser')
    .option('-o, --output <file>', 'save HTML to file instead of opening browser')
    .option('--tape <file>', 'attach a replay tape file (.tape.json)')
    .action(async (sessionId: string, options: { output?: string; tape?: string }) => {
      const session = await readSession(sessionId);
      const distiller = new RecipeDistiller();
      const recipe = distiller.distill(session);
      const tracker = new ProvenanceTracker(session.id);

      for (const op of session.operations) {
        if (op.type === 'read') tracker.addRead(op);
        else if (op.type === 'exec') tracker.addExec(op);
        else tracker.addWrite(op);
      }

      const { generateDebuggerHtml } = await import('./viz/html.js');

      // Load tape if provided
      let tape = null;
      if (options.tape) {
        try {
          const { TapePlayer } = await import('./replay/tape-player.js');
          const player = TapePlayer.fromFile(path.resolve(options.tape));
          tape = player['tape'] as unknown;
        } catch (err) {
          console.error(chalk.yellow(`⚠  Could not load tape: ${err instanceof Error ? err.message : err}`));
        }
      }

      const html = generateDebuggerHtml({ session, provenance: tracker.getProvenance(), recipe, tape: tape as never });

      if (options.output) {
        const dest = path.resolve(options.output);
        await fs.writeFile(dest, html, 'utf8');
        console.log(chalk.green('✔') + `  Debugger saved to ${chalk.cyan(dest)}`);
      } else {
        const tmpDir = path.join(process.cwd(), '.agentgram', 'tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `debug-${sessionId.slice(0, 12)}.html`);
        await fs.writeFile(tmpFile, html, 'utf8');
        const { exec } = await import('node:child_process');
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${tmpFile}"`);
        console.log(chalk.green('✔') + `  Opening time-travel debugger...`);
        console.log(chalk.dim(`   ${session.operations.length} operations · step through with ← →`));
        console.log(chalk.dim(`   File: ${tmpFile}`));
      }
    });

  // ── tape ──────────────────────────────────────────────────────────────────
  const tapeCmd = new Command('tape').description('Record and replay deterministic session tapes');

  tapeCmd
    .command('record <session-id>')
    .description('Create a minimal replay tape from a recorded session (~50KB for a 2hr session)')
    .option('-o, --output <file>', 'output path (default: .agentgram/tapes/<session-id>.tape.json)')
    .action(async (sessionId: string, options: { output?: string }) => {
      const session = await readSession(sessionId);
      const { sessionToTape } = await import('./replay/index.js');

      process.stdout.write(chalk.dim('  Building tape...'));
      const tape = sessionToTape(session);
      const outPath = options.output ?? path.join('.agentgram', 'tapes', `${sessionId}.tape.json`);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(tape, null, 2));

      const sizeKb = (JSON.stringify(tape).length / 1024).toFixed(1);
      console.log(chalk.green(' done'));
      console.log(`  ${chalk.green('✔')}  Tape written: ${chalk.bold(outPath)}`);
      console.log(`  ${chalk.dim('Entries:')}       ${tape.entries.length}`);
      console.log(`  ${chalk.dim('Size:')}          ${sizeKb} KB`);
      console.log(`  ${chalk.dim('Tape hash:')}     ${tape.tapeHash.slice(0, 16)}...`);
      console.log(`  ${chalk.dim('Deduped:')}       ${tape.deduplicatedCount} delta entries`);
      console.log(chalk.dim(`\n  Attach to debugger: agentgram debug ${sessionId} --tape ${outPath}\n`));
    });

  tapeCmd
    .command('verify <tape-file>')
    .description('Verify a tape file has not been tampered with')
    .action(async (tapeFile: string) => {
      const { TapePlayer } = await import('./replay/tape-player.js');
      const player = TapePlayer.fromFile(path.resolve(tapeFile));
      const result = player.verify();

      if (result.valid) {
        console.log(chalk.green('\n  ✅  Tape is valid — not tampered with\n'));
        const summary = player.summary();
        console.log(`  ${chalk.dim('Name:')}     ${summary.name}`);
        console.log(`  ${chalk.dim('Model:')}    ${summary.model}`);
        console.log(`  ${chalk.dim('Duration:')} ${summary.duration}`);
        console.log(`  ${chalk.dim('Entries:')}  ${summary.entries}`);
        console.log(`  ${chalk.dim('Size:')}     ${summary.sizeKb} KB\n`);
      } else {
        console.log(chalk.red('\n  ❌  Tape FAILED verification — possible tampering\n'));
        for (const err of result.errors) console.log(chalk.red(`  ✗ ${err}`));
        process.exit(1);
      }
    });

  tapeCmd
    .command('show <tape-file>')
    .description('Print a human-readable summary of a tape file')
    .option('--markdown', 'output as markdown document')
    .action(async (tapeFile: string, options: { markdown?: boolean }) => {
      const { TapePlayer } = await import('./replay/tape-player.js');
      const player = TapePlayer.fromFile(path.resolve(tapeFile));

      if (options.markdown) {
        console.log(player.toMarkdown());
        return;
      }

      const s = player.summary();
      const prompt = player.getPrompt();
      console.log(chalk.bold(`\n📼  Tape: ${s.name}\n`));
      console.log(`  ${chalk.dim('Model:')}     ${s.model}`);
      console.log(`  ${chalk.dim('Duration:')} ${s.duration}`);
      console.log(`  ${chalk.dim('Entries:')}  ${s.entries}`);
      console.log(`  ${chalk.dim('Files:')}    ${s.uniqueFiles}`);
      console.log(`  ${chalk.dim('Commands:')} ${s.commands.length}`);
      console.log(`  ${chalk.dim('Size:')}     ${s.sizeKb} KB`);
      if (prompt) console.log(`\n  ${chalk.dim('Prompt:')} ${prompt.slice(0, 120)}...`);
      console.log();
    });

  program.addCommand(tapeCmd);

  // ── fork ──────────────────────────────────────────────────────────────────
  program
    .command('fork <session-id>')
    .description('Fork a session from a specific step to explore an alternative path')
    .option('--from <op-id>', 'operation ID to fork from (shown in debugger)')
    .option('--from-step <n>', 'step number to fork from (1-indexed)')
    .action(async (sessionId: string, options: { from?: string; fromStep?: string }) => {
      const session = await readSession(sessionId);

      let forkIndex = session.operations.length - 1;

      if (options.from) {
        const idx = session.operations.findIndex((op) => op.id === options.from);
        if (idx === -1) {
          console.error(chalk.red(`✖  Operation not found: ${options.from}`));
          process.exit(1);
        }
        forkIndex = idx;
      } else if (options.fromStep) {
        forkIndex = parseInt(options.fromStep, 10) - 1;
        if (forkIndex < 0 || forkIndex >= session.operations.length) {
          console.error(chalk.red(`✖  Step out of range (1–${session.operations.length})`));
          process.exit(1);
        }
      }

      const forkOp = session.operations[forkIndex];
      const forkedSession = {
        ...session,
        id: `${session.id}-fork-${forkIndex}`,
        name: `${session.name} (fork from step ${forkIndex + 1})`,
        operations: session.operations.slice(0, forkIndex + 1),
        state: 'stopped' as const,
      };

      const outPath = path.join('.agentgram', 'sessions', `${forkedSession.id}.json`);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify({ session: forkedSession }, null, 2));

      console.log(chalk.bold(`\n🍴  Forked session\n`));
      console.log(`  ${chalk.dim('Original:')}   ${session.name}  (${session.operations.length} ops)`);
      console.log(`  ${chalk.dim('Fork point:')} Step ${forkIndex + 1} — ${forkOp.type}: ${forkOp.target}`);
      console.log(`  ${chalk.dim('Fork ID:')}    ${forkedSession.id}`);
      console.log(`  ${chalk.dim('Saved:')}      ${outPath}`);
      console.log(chalk.dim(`\n  Continue: agentgram debug ${forkedSession.id}\n`));
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

  // ── cognitive ─────────────────────────────────────────────────────────────
  program
    .command('cognitive <session-id>')
    .description('Show the cognitive trace — WHY the agent did what it did')
    .option('--dead-ends', 'show only dead ends (wasted work)', false)
    .option('--recipe', 'output as explainable recipe with reasoning', false)
    .option('--json', 'raw JSON output', false)
    .action(async (sessionId: string, options: { deadEnds: boolean; recipe: boolean; json: boolean }) => {
      const { distillCognitiveRecipe, cognitiveTraceToMarkdown } = await import('./cognitive/trace.js');
      const { loadCognitiveTrace } = await import('./cognitive/capture.js');

      const trace = loadCognitiveTrace(sessionId);
      if (!trace) {
        console.log(chalk.red(`✖  No cognitive trace found for session: ${sessionId}`));
        console.log(chalk.dim('  Cognitive traces are captured automatically when Claude Code hooks are active.'));
        console.log(chalk.dim('  Run: agentgram hook install'));
        return;
      }

      if (options.json) { console.log(JSON.stringify(trace, null, 2)); return; }

      if (options.recipe) {
        const steps = distillCognitiveRecipe(trace);
        console.log(chalk.bold(`\n🧠  Explainable Recipe: ${sessionId}\n`));
        for (const [i, step] of steps.entries()) {
          const icon: Record<string, string> = { find: '🔍', run_command: '⚡', create_file: '📄', modify_file: '✏️', delete: '🗑️' };
          console.log(`  ${i + 1}. ${icon[step.action] ?? '→'} ${chalk.bold(step.action)} → ${chalk.cyan(step.target)}`);
          if (step.reasoning) console.log(`     ${chalk.dim('Why:')} ${step.reasoning.slice(0, 100)}`);
          if (step.learnedFromDeadEnd) console.log(`     ${chalk.yellow('⚡ Learned from dead end:')} ${step.learnedFromDeadEnd}`);
          if (step.alternativesRejected.length > 0) console.log(`     ${chalk.dim('Rejected:')} ${step.alternativesRejected[0].slice(0, 80)}`);
        }
        console.log();
        return;
      }

      if (options.deadEnds) {
        if (trace.deadEnds.length === 0) {
          console.log(chalk.green('\n  ✔  No dead ends — agent went straight to the answer.\n'));
          return;
        }
        console.log(chalk.bold(`\n💸  Dead Ends in session ${sessionId}\n`));
        console.log(chalk.dim(`  ${trace.wastedOperations} wasted operations · ~${trace.estimatedTokensWasted.toLocaleString()} tokens wasted\n`));
        for (const d of trace.deadEnds) {
          console.log(`  ❌  ${chalk.red(d.operation.type)} → ${chalk.dim(d.operation.target)}`);
          console.log(`      ${d.reason}`);
          console.log(`      ${chalk.dim(`~${d.estimatedTokensWasted.toLocaleString()} tokens wasted`)}`);
          console.log();
        }
        return;
      }

      // Full markdown view
      console.log(cognitiveTraceToMarkdown(trace));
    });

  // ── suggest ───────────────────────────────────────────────────────────────
  program
    .command('suggest <ticket-url>')
    .description('Suggest recipes BEFORE starting work on a ticket — skip the exploration')
    .option('-n, --limit <n>', 'max suggestions', '5')
    .option('--local', 'search local recipes only (no registry fetch)', false)
    .action(async (ticketUrl: string, options: { limit: string; local: boolean }) => {
      const { parseTicketUrl, formatTicketRef, suggestRecipesForTicket, extractTicketKeywords } = await import('./integrations/ticket.js');
      const { AgentMemory } = await import('./memory/index.js');
      const { GitHubIntegration } = await import('./integrations/github.js');

      const ticketRef = parseTicketUrl(ticketUrl);
      const memory = new AgentMemory();
      let searchText = ticketUrl;
      let issueTitle = '';

      // Fetch issue content from GitHub if available
      if (ticketRef.provider === 'github' && ticketRef.owner && ticketRef.repo) {
        try {
          const gh = new GitHubIntegration();
          process.stdout.write(chalk.dim('  Fetching issue from GitHub...'));
          const issue = await gh.fetchIssue(ticketRef.owner, ticketRef.repo, ticketRef.id);
          issueTitle = issue.title;
          searchText = [issue.title, issue.body ?? '', issue.labels.map((l) => l.name).join(' ')].join(' ');
          process.stdout.write(`\r${' '.repeat(40)}\r`);
        } catch {
          process.stdout.write(`\r${' '.repeat(40)}\r`);
          // Fall through to keyword-only matching
        }
      }

      const allRecipes = memory.list().map((e) => e.recipe);

      if (allRecipes.length === 0) {
        console.log(chalk.dim('\n  No recipes in memory yet.'));
        console.log(chalk.dim('  Run: agentgram memory import  (loads community recipes)\n'));
        return;
      }

      const keywords = extractTicketKeywords(searchText);
      const suggestions = suggestRecipesForTicket(searchText, allRecipes, {
        limit: parseInt(options.limit, 10),
      });

      console.log(chalk.bold(`\n💡  Recipe Suggestions for ${formatTicketRef(ticketRef)}\n`));
      if (issueTitle) console.log(`  ${chalk.dim('Issue:')} ${chalk.white(issueTitle)}\n`);
      if (keywords.length > 0) console.log(`  ${chalk.dim('Keywords:')} ${keywords.slice(0, 8).join(', ')}\n`);

      if (suggestions.length === 0) {
        console.log(chalk.dim('  No relevant recipes found.'));
        console.log(chalk.dim('  Try: agentgram memory import\n'));
        return;
      }

      for (const [i, s] of suggestions.entries()) {
        const pct = Math.round(s.confidence * 100);
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
        const color = pct >= 60 ? chalk.green : pct >= 30 ? chalk.yellow : chalk.dim;

        console.log(`  ${color(bar)} ${pct}%  ${chalk.bold(s.recipe.name)}`);
        console.log(`              ${chalk.dim(s.recipe.description.slice(0, 80))}`);
        console.log(`              ${chalk.cyan(s.reason)}`);
        if (i < suggestions.length - 1) console.log();
      }

      console.log();
      console.log(chalk.dim('  To use the top suggestion:'));
      console.log(chalk.cyan(`  agentgram memory recall "${suggestions[0].recipe.name.toLowerCase()}"`));
      console.log();
    });

  // ── resolve ───────────────────────────────────────────────────────────────
  program
    .command('resolve <session-id> <ticket-url>')
    .description('Link a completed session to a ticket — distill, link, and post the recipe')
    .option('--outcome <text>', 'short description of what was accomplished')
    .option('--pr <url>', 'PR URL that shipped this work')
    .option('--post-comment', 'post recipe card as comment on the GitHub issue/PR', false)
    .option('--publish', 'publish recipe to the community registry', false)
    .option('--name <name>', 'override recipe name')
    .option('--tags <tags>', 'additional tags (comma-separated)')
    .action(async (
      sessionId: string,
      ticketUrl: string,
      options: {
        outcome?: string; pr?: string; postComment: boolean;
        publish: boolean; name?: string; tags?: string;
      },
    ) => {
      const session = await readSession(sessionId);
      const { resolveSessionToTicket } = await import('./integrations/resolve.js');

      console.log(chalk.bold(`\n🔗  Resolving session → ticket\n`));
      console.log(`  Session: ${chalk.cyan(sessionId)}`);
      console.log(`  Ticket:  ${chalk.cyan(ticketUrl)}`);
      if (options.outcome) console.log(`  Outcome: ${chalk.dim(options.outcome)}`);
      console.log();

      const result = await resolveSessionToTicket(session, {
        ticketUrl,
        prUrl: options.pr,
        outcome: options.outcome,
        postComment: options.postComment,
        publish: options.publish,
        name: options.name,
        tags: options.tags?.split(',').map((t) => t.trim()),
        cwd: process.cwd(),
      });

      console.log(chalk.green('✔') + `  Recipe saved: ${chalk.bold(result.recipeName)}`);
      console.log(chalk.green('✔') + `  Ticket linked: ${chalk.cyan(ticketUrl)}`);
      console.log(chalk.green('✔') + `  Steps: ${result.stepCount}  |  Duration: ${Math.round(result.durationMs / 60000)}min`);

      if (result.commentUrl) {
        console.log(chalk.green('✔') + `  Comment posted: ${chalk.cyan(result.commentUrl)}`);
      }

      console.log();
      console.log(chalk.dim('  Future recall:'));
      console.log(chalk.cyan(`  agentgram suggest ${ticketUrl.split('/').slice(0, 7).join('/')}/issues/NEW`));
      console.log(chalk.cyan(`  agentgram memory recall "${result.recipeName.toLowerCase()}"`));
      console.log();
    });

  // ── knowledge ─────────────────────────────────────────────────────────────
  program
    .command('knowledge')
    .description('Your team\'s complete AI development history — every ticket resolved with AI')
    .option('-n, --limit <n>', 'max entries to show', '20')
    .option('--tag <tag>', 'filter by tag')
    .option('--json', 'output raw JSON', false)
    .action(async (options: { limit: string; tag?: string; json: boolean }) => {
      const { buildKnowledgeBase } = await import('./integrations/resolve.js');
      const kb = buildKnowledgeBase();

      const filtered = options.tag
        ? kb.filter((e) => e.tags.includes(options.tag!))
        : kb;

      const limited = filtered.slice(0, parseInt(options.limit, 10));

      if (options.json) {
        console.log(JSON.stringify(limited, null, 2));
        return;
      }

      if (limited.length === 0) {
        console.log(chalk.dim('\n  No tickets resolved yet.'));
        console.log(chalk.dim('  After finishing a session, run:'));
        console.log(chalk.cyan('  agentgram resolve <session-id> <ticket-url>\n'));
        return;
      }

      console.log(chalk.bold(`\n📚  Team Knowledge Base\n`));
      console.log(chalk.dim(`  ${limited.length} tickets resolved with AI${options.tag ? ` (filtered: ${options.tag})` : ''}\n`));

      for (const entry of limited) {
        const _date = new Date(entry.resolvedAt).toLocaleDateString();
        const dur = entry.durationMin > 0 ? chalk.dim(`${entry.durationMin}min`) : '';

        console.log(
          `  ${chalk.green('●')}  ${chalk.bold(entry.recipeName.slice(0, 45).padEnd(45))}` +
          `  ${chalk.cyan(`${entry.stepCount} steps`).padEnd(12)}  ${dur}`
        );
        console.log(`     ${chalk.dim(entry.ticketUrl)}`);
        if (entry.outcome) console.log(`     ${chalk.dim('→')} ${entry.outcome}`);
        if (entry.tags.length > 0) {
          console.log(`     ${entry.tags.slice(0, 5).map((t) => chalk.dim(`[${t}]`)).join(' ')}`);
        }
        console.log();
      }

      // Summary stats
      const totalMinutes = kb.reduce((s, e) => s + e.durationMin, 0);
      const uniqueTags = [...new Set(kb.flatMap((e) => e.tags))];
      console.log(chalk.bold(`  Summary:`));
      console.log(`    ${chalk.cyan(kb.length)} tickets resolved  ·  ${chalk.cyan(totalMinutes)}min AI time  ·  ${chalk.cyan(uniqueTags.length)} unique patterns`);
      console.log();
    });

  // ── memory ────────────────────────────────────────────────────────────────
  const memCmd = program
    .command('memory')
    .description('Agent long-term memory — recall relevant recipes for any task')
    .addHelpText('after', `
${chalk.dim('Subcommands:')}
  ${chalk.cyan('recall <task>')}    Find recipes relevant to a task
  ${chalk.cyan('list')}             Show all memories
  ${chalk.cyan('stats')}            Memory health statistics
  ${chalk.cyan('import')}           Import recipes from registry into memory
  ${chalk.cyan('forget <id>')}      Remove a recipe from memory

${chalk.dim('Examples:')}
  ${chalk.cyan('agentgram memory recall "set up JWT auth"')}
  ${chalk.cyan('agentgram memory recall "add prisma postgres" --fingerprint')}
  ${chalk.cyan('agentgram memory list')}
  ${chalk.cyan('agentgram memory import --limit 50')}`);

  memCmd
    .command('recall <task>')
    .description('Find recipes most relevant to a task description')
    .option('-n, --limit <n>', 'max results', '5')
    .option('-s, --min-score <n>', 'minimum relevance score (0-1)', '0.05')
    .option('-f, --fingerprint', 'match against current project stack', false)
    .action(async (task: string, options: { limit: string; minScore: string; fingerprint: boolean }) => {
      const { AgentMemory } = await import('./memory/index.js');
      const memory = new AgentMemory();

      let fp;
      if (options.fingerprint) {
        const { fingerprint } = await import('./recipe/fingerprint.js');
        fp = await fingerprint(process.cwd());
        console.log(chalk.dim(`  Stack: ${fp.language}/${fp.framework}/${fp.orm}\n`));
      }

      const results = memory.recall({
        task,
        fingerprint: fp,
        limit: parseInt(options.limit, 10),
        minScore: parseFloat(options.minScore),
      });

      if (results.length === 0) {
        console.log(chalk.dim(`\n  No relevant recipes found for: "${task}"`));
        console.log(chalk.dim('  Try: agentgram memory import  (to load community recipes)\n'));
        return;
      }

      console.log(chalk.bold(`\n🧠  Memory Recall: "${task}"\n`));

      for (const result of results) {
        const score = Math.round(result.relevance.score * 100);
        const scoreColor = score >= 60 ? chalk.green : score >= 30 ? chalk.yellow : chalk.dim;

        console.log(
          `  ${scoreColor(`${score}%`)}  ${chalk.bold(result.entry.recipe.name)}` +
          `  ${chalk.cyan(`${result.entry.recipe.steps.length} steps`)}` +
          `  ${chalk.dim(`used ${result.entry.recallCount}×`)}`
        );
        console.log(`       ${chalk.dim(result.entry.recipe.description.slice(0, 80))}`);
        if (result.relevance.matches.length > 0) {
          console.log(`       ${chalk.dim('↳ ' + result.relevance.matches.join(' · '))}`);
        }
        console.log();
      }

      console.log(chalk.dim(`  To use: agentgram pull <recipe-name>  or  agentgram recipe <session-id>\n`));
    });

  memCmd
    .command('list')
    .description('List all recipes in agent memory')
    .action(async () => {
      const { AgentMemory } = await import('./memory/index.js');
      const memory = new AgentMemory();
      const entries = memory.list();

      if (entries.length === 0) {
        console.log(chalk.dim('\n  Memory is empty. Run: agentgram memory import\n'));
        return;
      }

      console.log(chalk.bold(`\n🧠  Agent Memory (${entries.length} recipes)\n`));
      const sorted = entries.sort((a, b) => b.recallCount - a.recallCount);

      for (const entry of sorted) {
        console.log(
          `  ${chalk.bold(entry.recipe.name.slice(0, 40).padEnd(40))}` +
          `  ${chalk.cyan(`${entry.recipe.steps.length} steps`).padEnd(10)}` +
          `  ${chalk.dim(`${entry.recallCount}× used`).padEnd(12)}` +
          `  ${chalk.dim(entry.recipe.tags.slice(0, 3).join(', '))}`
        );
      }
      console.log();
    });

  memCmd
    .command('stats')
    .description('Memory health and usage statistics')
    .action(async () => {
      const { AgentMemory } = await import('./memory/index.js');
      const memory = new AgentMemory();
      const stats = memory.stats();

      console.log(chalk.bold(`\n🧠  Memory Statistics\n`));
      console.log(`  ${chalk.dim('Total recipes:')}  ${chalk.cyan(stats.totalRecipes)}`);
      console.log(`  ${chalk.dim('Avg recall:')}     ${chalk.cyan(stats.avgRecallCount.toFixed(1))}× per recipe\n`);

      if (stats.mostUsed.length > 0) {
        console.log(chalk.bold('  Most recalled:'));
        for (const e of stats.mostUsed) {
          console.log(`    ${chalk.green(`${e.recallCount}×`)}  ${e.recipe.name}`);
        }
        console.log();
      }

      if (stats.recentlyLearned.length > 0) {
        console.log(chalk.bold('  Recently learned:'));
        for (const e of stats.recentlyLearned) {
          const age = Math.round((Date.now() - e.learnedAt) / (1000 * 60 * 60 * 24));
          console.log(`    ${chalk.dim(`${age}d ago`)}  ${e.recipe.name}`);
        }
        console.log();
      }
    });

  memCmd
    .command('import')
    .description('Import recipes from the community registry into memory')
    .option('-n, --limit <n>', 'max recipes to import', '100')
    .option('-t, --tag <tag>', 'import only recipes with this tag')
    .action(async (options: { limit: string; tag?: string }) => {
      const { AgentMemory } = await import('./memory/index.js');
      const { GitHubRecipeRegistry } = await import('./recipe/registry.js');


      const registry = new GitHubRecipeRegistry({});
      const memory = new AgentMemory();

      console.log(chalk.bold('\n🧠  Importing from community registry...\n'));

      const entries = await registry.list({ limit: parseInt(options.limit, 10) });
      const filtered = options.tag
        ? entries.filter((e) => e.tags.includes(options.tag!))
        : entries;

      let imported = 0;
      for (const entry of filtered) {
        try {
          const shared = await registry.pull(entry.id);
          const recipe = await shared;
          memory.remember(recipe);
          imported++;
          process.stdout.write(`\r  ${chalk.green('✔')} Imported ${imported}/${filtered.length}`);
        } catch {
          // Skip failed pulls silently
        }
      }

      console.log(`\n\n  ${chalk.green(`✔  ${imported} recipes`)} imported into memory.`);
      console.log(chalk.dim('  Now try: agentgram memory recall "your task here"\n'));
    });

  memCmd
    .command('forget <id>')
    .description('Remove a recipe from memory')
    .action(async (id: string) => {
      const { AgentMemory } = await import('./memory/index.js');
      const memory = new AgentMemory();
      const removed = memory.forget(id);

      if (removed) {
        console.log(chalk.green('✔') + `  Forgot recipe: ${chalk.bold(id)}`);
      } else {
        console.log(chalk.yellow('⚠') + `  Recipe not found in memory: ${id}`);
      }
    });

  // ── preflight ─────────────────────────────────────────────────────────────
  program
    .command('preflight <task>')
    .description('Check a task description against known dead-end patterns before starting')
    .option('-n, --limit <n>', 'max warnings to show', '5')
    .option('--domain <domain>', 'filter to a specific domain (ai, auth, payments, devops, ...)')
    .option('--json', 'output as JSON')
    .action(async (task: string, options: { limit: string; domain?: string; json?: boolean }) => {
      const { LocalFingerprintStore, preflight, formatPreflightResult, ensureSeeded } = await import('./fingerprint/index.js');
      // Auto-seed on first run so preflight shows value immediately
      ensureSeeded();
      const store = new LocalFingerprintStore();
      const result = preflight(task, store, {
        limit: parseInt(options.limit, 10),
        domain: options.domain,
      });
      if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(formatPreflightResult(result));
    });

  const deadendsCmd = new Command('deadends').description('Manage the dead-end pattern database (crowdsourced warnings)');

  deadendsCmd
    .command('sync')
    .description('Sync local dead-end patterns with the agentgram cloud')
    .action(async () => {
      const { syncWithCloud } = await import('./fingerprint/index.js');
      process.stdout.write(chalk.dim('  Syncing dead-end patterns...'));
      const result = await syncWithCloud();
      console.log(chalk.green(' done'));
      console.log(`  Pushed: ${result.pushed}  Pulled: ${result.pulled}  New warnings: ${result.newWarnings}`);
      if (result.errors.length > 0) result.errors.forEach((e) => console.log(chalk.yellow('  ⚠ ' + e)));
    });

  deadendsCmd
    .command('stats')
    .description('Show dead-end pattern database statistics')
    .action(async () => {
      const { LocalFingerprintStore } = await import('./fingerprint/index.js');
      const store = new LocalFingerprintStore();
      const stats = store.stats();
      console.log(`\n  ${chalk.bold('Dead-End Pattern Database')}`);
      console.log(`  Total patterns: ${chalk.cyan(stats.total)}`);
      console.log(`  Total tokens wasted: ${chalk.yellow(stats.totalWasted.toLocaleString())}`);
      for (const [domain, count] of Object.entries(stats.byDomain).sort(([, a], [, b]) => (b as number) - (a as number))) {
        console.log(`    ${domain.padEnd(12)} ${count} occurrences`);
      }
      console.log();
    });

  deadendsCmd
    .command('extract <session-id>')
    .description('Extract dead-end patterns from a cognitive trace session')
    .action(async (sessionId: string) => {
      const { loadCognitiveTrace } = await import('./cognitive/capture.js');
      const { extractAndStore } = await import('./fingerprint/index.js');
      const trace = loadCognitiveTrace(sessionId);
      if (!trace) { console.log(chalk.red(`✖  Session not found: ${sessionId}`)); process.exit(1); }
      const count = extractAndStore(trace);
      console.log(`\n  ${chalk.green(`✔  ${count} pattern${count !== 1 ? 's' : ''}`)} extracted from ${sessionId}\n`);
    });

  program.addCommand(deadendsCmd);

  // ── compliance / tracevault ───────────────────────────────────────────────
  const tracevaultCmd = new Command('tracevault').description('Tamper-evident compliance bundles for AI agent sessions');

  tracevaultCmd
    .command('export')
    .description('Export signed compliance bundle')
    .requiredOption('--sessions <ids>', 'comma-separated session IDs')
    .requiredOption('--out <dir>', 'output directory for the bundle')
    .option('--developer <name>', 'developer name for audit reports')
    .option('--force', 'overwrite existing output directory')
    .action(async (options: { sessions: string; out: string; developer?: string; force?: boolean }) => {
      const { exportComplianceBundle } = await import('./compliance/index.js');
      const sessionIds = options.sessions.split(',').map((s) => s.trim()).filter(Boolean);
      console.log(`\n  ${chalk.bold('TraceVault')} — exporting ${sessionIds.length} session${sessionIds.length !== 1 ? 's' : ''}...`);
      const result = await exportComplianceBundle({ sessionIds, outputDir: options.out, developer: options.developer, force: options.force });
      if (result.errors.length > 0) result.errors.forEach((e) => console.log(chalk.yellow('  ⚠ ' + e)));
      console.log(`\n  ${chalk.green('✔')}  Bundle → ${chalk.cyan(result.bundlePath)}`);
      console.log(`     ${result.sessionCount} session${result.sessionCount !== 1 ? 's' : ''} — signed, chained, audit-ready`);
      console.log(chalk.dim(`\n  Verify: agentgram tracevault verify --bundle ${result.bundlePath}\n`));
    });

  tracevaultCmd
    .command('verify')
    .description('Verify integrity of a compliance bundle')
    .requiredOption('--bundle <dir>', 'path to compliance bundle directory')
    .option('--json', 'output as JSON')
    .action(async (options: { bundle: string; json?: boolean }) => {
      const { verifyComplianceBundle } = await import('./compliance/index.js');
      const results = verifyComplianceBundle(options.bundle);
      if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
      const allValid = results.every((r) => r.valid);
      console.log(`\n  ${chalk.bold('TraceVault Verification')} — ${results.length} session${results.length !== 1 ? 's' : ''}\n`);
      for (const r of results) {
        const icon = r.valid ? chalk.green('✔') : chalk.red('✖');
        const sigStr = r.signatureValid ? chalk.green('sig✓') : chalk.red('sig✗');
        const chainStr = r.chainIntact ? chalk.green('chain✓') : chalk.red('chain✗');
        console.log(`  ${icon}  ${r.sessionId}  ${sigStr}  ${chainStr}`);
        if (r.errors.length > 0) r.errors.forEach((e) => console.log(chalk.red(`     ✗ ${e}`)));
      }
      console.log();
      if (allValid) {
        console.log(chalk.green('  ✅ All sessions verified — bundle intact\n'));
      } else {
        console.log(chalk.red('  ❌ Verification FAILED — possible tampering\n'));
        process.exit(1);
      }
    });

  program.addCommand(tracevaultCmd);

  // ── compose ───────────────────────────────────────────────────────────────
  program
    .command('compose <name> <recipe-ids...>')
    .description('Compose multiple recipes into a pipeline')
    .option('-m, --mode <mode>', 'composition mode: pipe|parallel', 'pipe')
    .option('--mermaid', 'output Mermaid flowchart diagram')
    .action(async (name: string, recipeIds: string[], options: { mode: string; mermaid: boolean }) => {
      const { LocalRecipeStore } = await import('./recipe/store.js');
      const { pipe, parallel, toMermaid, toMarkdown } = await import('./recipe/compose.js');

      const store = new LocalRecipeStore(process.cwd());
      const recipes = [];

      for (const id of recipeIds) {
        try {
          const recipe = await store.load(id);
          recipes.push(recipe);
        } catch {
          console.error(chalk.red(`✖  Recipe not found: ${id}`));
          console.error(chalk.dim(`   Pull it first: agentgram pull ${id}`));
          process.exit(1);
        }
      }

      const composed = options.mode === 'parallel'
        ? parallel(name, ...recipes)
        : pipe(name, ...recipes);

      if (options.mermaid) {
        console.log(toMermaid(composed));
        return;
      }

      console.log(toMarkdown(composed));
      console.log(chalk.dim(`\n  ${composed.steps.length} total steps | ${composed.composition.nodes.length} recipes composed`));

      if (composed.composition.overlapFactor < 1) {
        const saved = Math.round((1 - composed.composition.overlapFactor) * 100);
        console.log(chalk.green(`  ↓ ${saved}% step reduction via deduplication\n`));
      }
    });

  // ── predict ───────────────────────────────────────────────────────────────
  program
    .command('predict <task>')
    .description('Predict success probability, token cost, and risks for a task before starting')
    .option('--stack <json>', 'JSON stack context e.g. \'{"framework":"nextjs","payments":"stripe"}\'')
    .option('--agent <name>', 'agent name: claude-code | cursor | devin | copilot')
    .option('--json', 'output raw JSON')
    .option('--api-key <key>', 'agentgram API key (or set AGENTGRAM_API_KEY)')
    .option('--local', 'use local model only — no API call')
    .action(async (task: string, options: { stack?: string; agent?: string; json?: boolean; apiKey?: string; local?: boolean }) => {
      const key = options.apiKey ?? process.env['AGENTGRAM_API_KEY'];
      let stack: Record<string, string> | undefined;
      if (options.stack) {
        try { stack = JSON.parse(options.stack) as Record<string, string>; }
        catch { console.error(chalk.red('✖  Invalid --stack JSON')); process.exit(1); }
      }

      if (options.local || !key) {
        // Local prediction — uses the on-disk model
        const { PredictionEngine } = await import('./predict/engine.js');
        const engine = new PredictionEngine();
        const result = engine.predict({ task, stack, agent: options.agent });
        if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
        printPrediction(task, result);
        return;
      }

      // Remote prediction via API
      const { AgentgramClient } = await import('./predict/sdk.js');
      const client = new AgentgramClient({ apiKey: key });
      try {
        const result = await client.predict(task, stack);
        if (options.json) { console.log(JSON.stringify(result, null, 2)); return; }
        printPrediction(task, result);
      } catch (err) {
        console.error(chalk.red('✖  Prediction failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── predict serve ─────────────────────────────────────────────────────────
  program
    .command('predict-serve')
    .description('Start the agentgram prediction API server (port 3847)')
    .option('--port <n>', 'port to listen on', '3847')
    .option('--bootstrap', 'bootstrap model from existing sessions before starting')
    .action(async (options: { port: string; bootstrap?: boolean }) => {
      const { startPredictServer } = await import('./predict/server.js');
      const { bootstrapModel } = await import('./predict/outcome-extractor.js');

      if (options.bootstrap) {
        process.stdout.write(chalk.dim('  Bootstrapping model from sessions...'));
        const count = await bootstrapModel();
        console.log(chalk.green(` done (${count} outcomes extracted)`));
      }

      const server = await startPredictServer({ port: parseInt(options.port, 10) });
      const addr = server.address() as { port: number };
      console.log(chalk.bold(`\n🔮  Prediction API running\n`));
      console.log(`  ${chalk.dim('URL:')}    http://localhost:${addr.port}`);
      console.log(`  ${chalk.dim('Predict:')} POST http://localhost:${addr.port}/v1/predict`);
      console.log(`  ${chalk.dim('Stats:')}  GET  http://localhost:${addr.port}/v1/model/stats`);
      console.log(`  ${chalk.dim('Health:')} GET  http://localhost:${addr.port}/v1/health\n`);
      console.log(chalk.dim('  Press Ctrl+C to stop\n'));

      process.on('SIGINT', () => { server.close(); process.exit(0); });
    });

  // ── predict bootstrap ─────────────────────────────────────────────────────
  program
    .command('predict-bootstrap')
    .description('Build prediction model from all recorded sessions')
    .action(async () => {
      const { bootstrapModel } = await import('./predict/outcome-extractor.js');
      process.stdout.write(chalk.dim('  Scanning sessions and building model...'));
      const count = await bootstrapModel();
      console.log(chalk.green(' done'));
      console.log(`  ${chalk.bold(String(count))} session outcomes extracted`);
      console.log(chalk.dim('  Run agentgram predict-serve to start the API\n'));
    });

  // ── apikey ────────────────────────────────────────────────────────────────
  const apikeyCmd = new Command('apikey').description('Manage agentgram API keys');

  apikeyCmd
    .command('create <name>')
    .description('Generate a new API key')
    .option('--tier <tier>', 'free | pro | enterprise', 'free')
    .action(async (name: string, options: { tier: string }) => {
      const { ApiKeyStore } = await import('./predict/auth.js');
      const store = new ApiKeyStore();
      const { key, record } = store.createKey(name, options.tier as 'free' | 'pro' | 'enterprise');
      console.log(chalk.bold(`\n🔑  API key created\n`));
      console.log(`  ${chalk.dim('Key:')}  ${chalk.green(key)}`);
      console.log(`  ${chalk.dim('Name:')} ${record.name}`);
      console.log(`  ${chalk.dim('Tier:')} ${record.tier}`);
      console.log(chalk.yellow('\n  Save this key — it will not be shown again.\n'));
    });

  apikeyCmd
    .command('list')
    .description('List all API keys (hashes only)')
    .action(async () => {
      const { ApiKeyStore } = await import('./predict/auth.js');
      const store = new ApiKeyStore();
      const keys = store.listKeys();
      if (keys.length === 0) {
        console.log(chalk.dim('\n  No API keys. Create one with: agentgram apikey create <name>\n'));
        return;
      }
      console.log(chalk.bold(`\n🔑  API keys (${keys.length})\n`));
      for (const k of keys) {
        console.log(
          `  ${chalk.bold(k.name.padEnd(24))}  ${chalk.dim(k.tier.padEnd(12))}  ` +
          `requests: ${k.requestCount}  created: ${new Date(k.createdAt).toLocaleDateString()}`
        );
      }
      console.log();
    });

  program.addCommand(apikeyCmd);

  // ── context ───────────────────────────────────────────────────────────────
  program
    .command('context')
    .description('Refresh the project context file (.agentgram/CONTEXT.md) from recorded sessions')
    .option('--show', 'print the context to stdout instead of just writing the file')
    .option('--inject', 'output a compact version ready to paste into CLAUDE.md')
    .action(async (options: { show?: boolean; inject?: boolean }) => {
      const { ProjectContextManager } = await import('./memory/project-context.js');
      const mgr = new ProjectContextManager();

      if (options.inject) {
        const text = mgr.getContextForInjection();
        if (!text) {
          console.log(chalk.dim('\n  No context yet. Run agentgram context first.\n'));
        } else {
          console.log(chalk.bold('\n  Paste into CLAUDE.md:\n'));
          console.log(text);
        }
        return;
      }

      process.stdout.write(chalk.dim('  Building project context from sessions...'));
      const outPath = await mgr.updateContextFile();
      console.log(chalk.green(' done'));
      console.log(`  Written: ${chalk.bold(outPath)}`);

      if (options.show) {
        const fs = await import('node:fs/promises');
        const content = await fs.readFile(outPath, 'utf8');
        console.log('\n' + content);
      } else {
        console.log(chalk.dim('  Run with --show to print, --inject for CLAUDE.md snippet\n'));
      }
    });

  // ── eu-report ─────────────────────────────────────────────────────────────
  program
    .command('eu-report')
    .description('Generate EU AI Act compliance documentation from TraceVault bundles')
    .option('--bundle <dir>', 'path to a tracevault bundle directory', './audit-bundle')
    .option('--output <file>', 'output file path', './eu-ai-act-report.md')
    .option('--json', 'output machine-readable JSON instead of markdown')
    .option('--risk <level>', 'risk category: limited | high', 'limited')
    .action(async (options: { bundle: string; output: string; json?: boolean; risk: string }) => {
      const { generateEuAiActReport, formatEuAiActReportMarkdown, formatEuAiActReportJson } = await import('./compliance/eu-ai-act.js');
      const fs = await import('node:fs/promises');

      try {
        process.stdout.write(chalk.dim('  Loading bundle...'));
        const bundleJsonPath = path.join(options.bundle, 'bundle.json');
        const bundleRaw = await fs.readFile(bundleJsonPath, 'utf8');
        const bundle = JSON.parse(bundleRaw) as import('./compliance/types.js').ComplianceBundle;
        console.log(chalk.green(' done'));

        process.stdout.write(chalk.dim('  Generating EU AI Act report...'));
        const report = generateEuAiActReport({
          bundle,
          riskCategory: options.risk as 'limited' | 'high',
        });
        console.log(chalk.green(' done'));

        const content = options.json
          ? formatEuAiActReportJson(report)
          : formatEuAiActReportMarkdown(report);

        await fs.writeFile(options.output, content, 'utf8');
        console.log(`\n  ${chalk.green('✔')}  Report written: ${chalk.bold(options.output)}`);
        console.log(`  Sessions: ${report.totalSessions}  ·  Human oversight events: ${report.humanOversightEvents}`);

        const compliant = report.sections.filter((s) => s.status === 'compliant').length;
        const partial = report.sections.filter((s) => s.status === 'partial').length;
        console.log(`  Articles: ${chalk.green(compliant + ' compliant')}  ${chalk.yellow(partial + ' partial')}\n`);
      } catch (err) {
        console.error(chalk.red('\n✖  Failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  // ── marketplace ───────────────────────────────────────────────────────────
  program
    .command('marketplace <recipe-id>')
    .description('Show marketplace listing for a recipe with drift detection and premium metadata')
    .action(async (recipeId: string) => {
      const { LocalRecipeStore } = await import('./recipe/store.js');
      const { detectRecipeDrift, formatMarketplaceListing } = await import('./recipe/premium.js');
      const store = new LocalRecipeStore(process.cwd());

      let recipe;
      try {
        recipe = await store.load(recipeId);
      } catch {
        console.error(chalk.red(`✖  Recipe not found locally: ${recipeId}`));
        console.error(chalk.dim(`   Pull it first: agentgram pull ${recipeId}`));
        process.exit(1);
      }

      const drift = detectRecipeDrift(recipe);
      const metadata = (recipe as unknown as Record<string, unknown>).metadata as import('./recipe/premium.js').PremiumRecipeMetadata | undefined;

      if (!metadata) {
        // Basic listing for non-premium recipes
        console.log(chalk.bold(`\n📦  ${recipe.name}\n`));
        console.log(`  Steps: ${recipe.steps.length}  Tags: ${recipe.tags.join(', ')}`);
        if (drift.hasDrift) {
          console.log(chalk.yellow('\n  ⚠  Version drift detected:'));
          for (const w of drift.warnings) {
            console.log(`    ${w.package}: recipe=${w.recipeVersion} local=${w.installedVersion} (${w.severity})`);
          }
        } else {
          console.log(chalk.green('\n  ✓  No version drift detected'));
        }
        console.log();
        return;
      }

      console.log(formatMarketplaceListing(recipe, metadata));
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
