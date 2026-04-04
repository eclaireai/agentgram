/**
 * Project Context Manager — Auto-maintained project memory.
 *
 * After every agentgram session it reads all past sessions and writes/updates
 * `.agentgram/CONTEXT.md` — a structured, human-and-AI readable file that
 * captures architectural decisions, rejected approaches, dead ends, applied
 * recipes, and key files.
 *
 * The CONTEXT.md is designed to be auto-injected into every new Claude Code
 * session so the agent walks in briefed on the full project decision history.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Session, Operation } from '../core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectDecision {
  /** What was decided */
  what: string;
  /** Reasoning behind the decision */
  why: string;
  /** Unix timestamp (ms) */
  when: number;
  sessionId: string;
  type: 'architectural' | 'rejected' | 'dead-end' | 'recipe-applied';
}

export interface ProjectContext {
  projectName: string;
  lastUpdated: string;
  decisions: ProjectDecision[];
  appliedRecipes: string[];
  /** Files touched most frequently across sessions */
  keyFiles: string[];
  /** Project-specific failure patterns */
  deadEnds: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a unix ms timestamp as YYYY-MM-DD */
function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Derive a human-friendly project name from a directory path */
function projectNameFromDir(dir: string): string {
  const resolved = path.resolve(dir);
  return path.basename(path.dirname(resolved)) || path.basename(resolved) || 'Unknown Project';
}

/**
 * Attempt to infer the recipe name embedded in a session name.
 * Heuristic: session names that contain known recipe-like patterns
 * e.g. "add-auth-clerk", "setup-stripe", "add-payments".
 */
function looksLikeRecipeName(name: string): boolean {
  return /^(add|setup|init|configure|install|integrate|create|build|fix|refactor)-/.test(name);
}

/** Extract the command string from an exec operation */
function execCommand(op: Operation): string {
  return (op.metadata?.command ?? op.target ?? '').trim();
}

// ---------------------------------------------------------------------------
// ProjectContextManager
// ---------------------------------------------------------------------------

export class ProjectContextManager {
  private readonly agentgramDir: string;
  private readonly sessionsDir: string;
  private readonly contextPath: string;

  constructor(agentgramDir = '.agentgram') {
    this.agentgramDir = agentgramDir;
    this.sessionsDir = path.join(agentgramDir, 'sessions');
    this.contextPath = path.join(agentgramDir, 'CONTEXT.md');
  }

  // ── Session loading ────────────────────────────────────────────────────────

  /** Load all sessions from `.agentgram/sessions/*.json` */
  private loadSessions(): Session[] {
    if (!fs.existsSync(this.sessionsDir)) return [];

    const files = fs
      .readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json'));

    const sessions: Session[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.sessionsDir, file), 'utf8');
        const parsed = JSON.parse(raw) as Session;
        sessions.push(parsed);
      } catch {
        // Skip malformed session files
      }
    }

    return sessions.sort((a, b) => a.startedAt - b.startedAt);
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * buildFromSessions() — Read all sessions and produce a ProjectContext.
   *
   * - Key files: files written across multiple sessions
   * - Dead ends: same exec command failed (non-zero exit) 2+ times
   * - Applied recipes: sessions whose names match recipe-like patterns
   * - Rejected approaches: sessions with <5 ops and no write/create ops
   */
  async buildFromSessions(): Promise<ProjectContext> {
    const sessions = this.loadSessions();
    const projectName = projectNameFromDir(this.agentgramDir);
    const lastUpdated = sessions.length > 0
      ? formatDate(Math.max(...sessions.map((s) => s.stoppedAt ?? s.startedAt)))
      : formatDate(Date.now());

    // ── Key files: count how many sessions wrote each file ──────────────────
    const fileSessionCount = new Map<string, Set<string>>();

    for (const session of sessions) {
      for (const op of session.operations) {
        if (op.type === 'write' || op.type === 'create') {
          const target = op.target;
          if (!fileSessionCount.has(target)) {
            fileSessionCount.set(target, new Set());
          }
          fileSessionCount.get(target)!.add(session.id);
        }
      }
    }

    // Files touched in more than one session are "key files"
    const keyFiles = [...fileSessionCount.entries()]
      .filter(([, sessions]) => sessions.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .map(([file]) => file);

    // Also include files from a single session if there are fewer than 3 multi-session files
    if (keyFiles.length < 3) {
      const singleSessionFiles = [...fileSessionCount.entries()]
        .filter(([, sessions]) => sessions.size === 1)
        .sort((a, b) => b[1].size - a[1].size)
        .map(([file]) => file)
        .slice(0, 5 - keyFiles.length);
      keyFiles.push(...singleSessionFiles);
    }

    // ── Dead ends: exec commands that failed 2+ times ────────────────────────
    const failedCommandCounts = new Map<string, number>();

    for (const session of sessions) {
      for (const op of session.operations) {
        if (
          op.type === 'exec' &&
          op.metadata?.exitCode !== undefined &&
          op.metadata.exitCode !== 0
        ) {
          const cmd = execCommand(op);
          if (cmd) {
            failedCommandCounts.set(cmd, (failedCommandCounts.get(cmd) ?? 0) + 1);
          }
        }
      }
    }

    const deadEnds = [...failedCommandCounts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([cmd, count]) => `\`${cmd}\` failed (${count} occurrences)`);

    // ── Applied recipes & decisions from all sessions ────────────────────────
    const allDecisions: ProjectDecision[] = [];
    const appliedRecipesSet = new Set<string>();

    for (const session of sessions) {
      const decisions = this.extractDecisionsFromSession(session);
      allDecisions.push(...decisions);

      // Recipe-named sessions
      if (looksLikeRecipeName(session.name)) {
        appliedRecipesSet.add(session.name);
      }
    }

    // Also collect recipe-applied decisions
    for (const d of allDecisions) {
      if (d.type === 'recipe-applied') {
        appliedRecipesSet.add(d.what);
      }
    }

    return {
      projectName,
      lastUpdated,
      decisions: allDecisions,
      appliedRecipes: [...appliedRecipesSet],
      keyFiles,
      deadEnds,
    };
  }

  /**
   * extractDecisionsFromSession() — Parse decisions from a single Session.
   *
   * Produces:
   *   - `architectural` for sessions with write ops that look intentional
   *   - `rejected` for sessions that were very short (<5 ops) with no writes
   *   - `dead-end` for exec ops with non-zero exit codes
   *   - `recipe-applied` for sessions whose names match recipe-like patterns
   */
  extractDecisionsFromSession(session: Session): ProjectDecision[] {
    const decisions: ProjectDecision[] = [];
    const ops = session.operations;
    const writeOps = ops.filter((o) => o.type === 'write' || o.type === 'create');
    const execOps = ops.filter((o) => o.type === 'exec');
    const sessionTime = session.stoppedAt ?? session.startedAt;

    // Rejected approach: session with <5 ops and no writes
    if (ops.length > 0 && ops.length < 5 && writeOps.length === 0) {
      decisions.push({
        what: `Attempted "${session.name}" (abandoned after ${ops.length} ops)`,
        why: 'Session was very short with no writes — likely abandoned approach',
        when: sessionTime,
        sessionId: session.id,
        type: 'rejected',
      });
      return decisions; // Return early — nothing else useful from this session
    }

    // Recipe applied: session name looks like a recipe
    if (looksLikeRecipeName(session.name) && writeOps.length > 0) {
      decisions.push({
        what: session.name,
        why: `Applied via session "${session.name}" — ${writeOps.length} files written`,
        when: sessionTime,
        sessionId: session.id,
        type: 'recipe-applied',
      });
    }

    // Architectural: sessions with substantial writes
    if (writeOps.length >= 3) {
      const targets = writeOps.map((o) => o.target).slice(0, 3).join(', ');
      decisions.push({
        what: `Built/modified key files in session "${session.name}"`,
        why: `Session "${session.name}" wrote ${writeOps.length} files: ${targets}${writeOps.length > 3 ? ` (+${writeOps.length - 3} more)` : ''}`,
        when: sessionTime,
        sessionId: session.id,
        type: 'architectural',
      });
    } else if (writeOps.length > 0 && writeOps.length < 3) {
      // Still an architectural decision but smaller scope
      const targets = writeOps.map((o) => o.target).join(', ');
      decisions.push({
        what: `Modified ${targets} — session "${session.name}"`,
        why: `Session "${session.name}" wrote to: ${targets}`,
        when: sessionTime,
        sessionId: session.id,
        type: 'architectural',
      });
    }

    // Dead ends: exec commands that failed
    const failedExecs = execOps.filter(
      (o) => o.metadata?.exitCode !== undefined && o.metadata.exitCode !== 0,
    );
    for (const op of failedExecs) {
      const cmd = execCommand(op);
      if (cmd) {
        decisions.push({
          what: `Command \`${cmd}\` failed (exit ${op.metadata.exitCode})`,
          why: `exec failed during session "${session.name}"`,
          when: op.timestamp,
          sessionId: session.id,
          type: 'dead-end',
        });
      }
    }

    return decisions;
  }

  /**
   * updateContextFile() — Write `.agentgram/CONTEXT.md`.
   * Returns the path written to.
   */
  async updateContextFile(): Promise<string> {
    const ctx = await this.buildFromSessions();
    const sessions = this.loadSessions();
    const md = this._renderMarkdown(ctx, sessions);

    fs.mkdirSync(this.agentgramDir, { recursive: true });
    fs.writeFileSync(this.contextPath, md, 'utf8');

    return this.contextPath;
  }

  /**
   * getContextForInjection() — Returns a compressed plain-text version of
   * CONTEXT.md suitable for inline injection into CLAUDE.md (≤500 words).
   */
  getContextForInjection(): string {
    if (!fs.existsSync(this.contextPath)) {
      return '(No project context available yet. Run `agentgram context update` to generate it.)';
    }

    const raw = fs.readFileSync(this.contextPath, 'utf8');
    return this._compressForInjection(raw);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderMarkdown(ctx: ProjectContext, sessions: Session[]): string {
    const lines: string[] = [];

    // Header
    lines.push('# Project Context (auto-maintained by agentgram)');
    lines.push(`Last updated: ${ctx.lastUpdated} · ${sessions.length} session${sessions.length !== 1 ? 's' : ''} recorded`);
    lines.push('');

    // Key Files
    lines.push('## Key Files');
    if (ctx.keyFiles.length === 0) {
      lines.push('_(No files written across multiple sessions yet)_');
    } else {
      // Count write ops per file across all sessions
      const fileWriteCounts = new Map<string, number>();
      const fileSessionCounts = new Map<string, Set<string>>();
      for (const session of sessions) {
        for (const op of session.operations) {
          if (op.type === 'write' || op.type === 'create') {
            fileWriteCounts.set(op.target, (fileWriteCounts.get(op.target) ?? 0) + 1);
            if (!fileSessionCounts.has(op.target)) fileSessionCounts.set(op.target, new Set());
            fileSessionCounts.get(op.target)!.add(session.id);
          }
        }
      }
      for (const file of ctx.keyFiles.slice(0, 10)) {
        const sessionCount = fileSessionCounts.get(file)?.size ?? 1;
        lines.push(`- ${file} — written in ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`);
      }
    }
    lines.push('');

    // Applied Recipes
    lines.push('## Applied Recipes');
    if (ctx.appliedRecipes.length === 0) {
      lines.push('_(No recipes detected yet)_');
    } else {
      // Map recipe name → session info
      const recipeDecisions = ctx.decisions.filter((d) => d.type === 'recipe-applied');
      const recipeMap = new Map<string, ProjectDecision>();
      for (const d of recipeDecisions) {
        if (!recipeMap.has(d.what)) recipeMap.set(d.what, d);
      }

      for (const recipe of ctx.appliedRecipes) {
        const d = recipeMap.get(recipe);
        if (d) {
          lines.push(`- ${recipe} (session: ${d.sessionId}, ${formatDate(d.when)})`);
        } else {
          lines.push(`- ${recipe}`);
        }
      }
    }
    lines.push('');

    // Architectural Decisions
    lines.push('## Architectural Decisions');
    const archDecisions = ctx.decisions.filter((d) => d.type === 'architectural');
    if (archDecisions.length === 0) {
      lines.push('_(No architectural decisions recorded yet)_');
    } else {
      for (const d of archDecisions) {
        lines.push(`- ${d.what} — session: ${d.sessionId}`);
      }
    }
    lines.push('');

    // Known Dead Ends
    lines.push('## Known Dead Ends (this project)');
    if (ctx.deadEnds.length === 0) {
      lines.push('_(No repeated failures detected)_');
    } else {
      for (const de of ctx.deadEnds) {
        lines.push(`- ${de}`);
      }
      // Also add dead-end decisions that have specific context
      const deadEndDecisions = ctx.decisions.filter((d) => d.type === 'dead-end');
      const seen = new Set<string>(ctx.deadEnds.map((s) => s.toLowerCase()));
      for (const d of deadEndDecisions) {
        const key = d.what.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          lines.push(`- ${d.what} (session: ${d.sessionId})`);
        }
      }
    }
    lines.push('');

    // Rejected Approaches
    lines.push('## Rejected Approaches');
    const rejected = ctx.decisions.filter((d) => d.type === 'rejected');
    if (rejected.length === 0) {
      lines.push('_(No rejected approaches recorded)_');
    } else {
      for (const d of rejected) {
        lines.push(`- ${formatDate(d.when)}: ${d.what}`);
      }
    }
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('_Auto-generated by agentgram. Do not edit manually._');

    return lines.join('\n');
  }

  /**
   * Compress CONTEXT.md into ≤500 words of plain text for CLAUDE.md injection.
   * Strips markdown formatting; keeps only the most actionable content.
   */
  private _compressForInjection(markdown: string): string {
    const sections = markdown.split(/^## /m).filter(Boolean);

    const parts: string[] = [];

    // First line is the title + date line (before any ##)
    const headerLines = sections[0]?.split('\n').filter((l) => l.trim()) ?? [];
    const headerText = headerLines.slice(0, 2).join(' ').replace(/^#+ /, '').trim();
    if (headerText) parts.push(headerText);

    for (const section of sections.slice(1)) {
      const [heading, ...bodyLines] = section.split('\n');
      const body = bodyLines
        .filter((l) => l.trim() && !l.startsWith('_(') && !l.startsWith('---') && !l.startsWith('_Auto'))
        .map((l) => l.replace(/^- /, '• ').replace(/[_*`]/g, '').trim())
        .filter(Boolean)
        .slice(0, 6); // Max 6 items per section

      if (body.length > 0) {
        parts.push(`[${heading.trim()}] ${body.join(' | ')}`);
      }
    }

    const text = parts.join('\n');

    // Enforce ≤500 words
    const words = text.split(/\s+/);
    if (words.length <= 500) return text;

    // Truncate to 500 words
    return words.slice(0, 500).join(' ') + ' ...';
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * refreshProjectContext() — Build context from all sessions and write CONTEXT.md.
 * Returns the path to the written file.
 */
export async function refreshProjectContext(agentgramDir = '.agentgram'): Promise<string> {
  const manager = new ProjectContextManager(agentgramDir);
  return manager.updateContextFile();
}
