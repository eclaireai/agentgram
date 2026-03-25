/**
 * Hook Ingestion Pipeline
 *
 * Bridges the gap between Claude Code hook JSONL events and the
 * agentgram core pipeline (ProvenanceTracker + RecipeDistiller).
 *
 * The ShadowWorktree requires a live git branch, so we can't replay
 * into it after the fact. Instead, we:
 *   1. Parse JSONL events captured by the hook
 *   2. Convert them into agentgram Operation objects
 *   3. Build a ProvenanceGraph from those operations
 *   4. Distill a Recipe
 *   5. Save the result as a standard agentgram session file
 *
 * This means hook-captured sessions get the full provenance + recipe
 * treatment, just without the git micro-commits (since those require
 * real-time recording on a shadow branch).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Session, Operation, Recipe } from '../core/types.js';
import { ProvenanceTracker } from '../provenance/graph.js';
import { RecipeDistiller } from '../recipe/distill.js';
import { generateId } from '../utils/hash.js';

// ---------------------------------------------------------------------------
// Types matching hook JSONL format
// ---------------------------------------------------------------------------

interface HookEvent {
  timestamp: number;
  claudeSessionId: string;
  toolUseId?: string;
  event: string; // 'read' | 'write' | 'exec'
  tool?: string; // 'Read' | 'Write' | 'Edit' | 'Bash' | 'Grep' | 'Glob'
  target: string;
  metadata: Record<string, unknown>;
}

interface HookSessionState {
  sessionId: string;
  claudeSessionId: string;
  startedAt: number;
  cwd: string;
  eventCount: number;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSONL events file into HookEvent objects.
 */
export function parseEventsFile(filePath: string): HookEvent[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line) as HookEvent);
}

/**
 * Convert a HookEvent into an agentgram Operation.
 */
export function eventToOperation(event: HookEvent): Operation {
  const type = event.event === 'exec' ? 'exec'
    : event.event === 'write' ? 'write'
    : 'read';

  return {
    id: event.toolUseId ?? generateId(),
    type,
    timestamp: event.timestamp,
    target: event.target,
    metadata: {
      command: type === 'exec' ? event.target : undefined,
      exitCode: type === 'exec' ? (event.metadata.exitCode as number | undefined) : undefined,
      output: type === 'exec' ? (event.metadata.output as string | undefined) : undefined,
      contentHash: undefined,
    },
    reason: event.tool ? `Claude Code ${event.tool} tool` : undefined,
    causedBy: [],
  };
}

/**
 * Ingest hook events into a full agentgram session with provenance and recipe.
 */
export function ingestHookSession(
  cwd: string,
  sessionState: HookSessionState,
  events: HookEvent[],
): { session: Session; provenance: ReturnType<ProvenanceTracker['getProvenance']>; recipe: Recipe } {
  // Convert events to operations
  const operations = events.map(eventToOperation);

  // Build session object
  const session: Session = {
    id: sessionState.sessionId,
    name: `claude-${sessionState.claudeSessionId.slice(0, 8)}`,
    state: 'stopped',
    startedAt: sessionState.startedAt,
    stoppedAt: events.length > 0 ? events[events.length - 1].timestamp : Date.now(),
    operations,
    branch: '', // No shadow branch for hook-captured sessions
    baseCommit: '',
    cwd,
  };

  // Build provenance graph
  const tracker = new ProvenanceTracker(session.id);
  for (const op of operations) {
    if (op.type === 'read') {
      tracker.addRead(op);
    } else if (op.type === 'exec') {
      tracker.addExec(op);
    } else {
      tracker.addWrite(op);
    }
  }

  // Distill recipe
  const distiller = new RecipeDistiller();
  const recipe = distiller.distill(session);

  return { session, provenance: tracker.getProvenance(), recipe };
}

/**
 * Ingest all hook sessions from a directory and save as standard agentgram session files.
 */
export function ingestAndSave(cwd: string): string[] {
  const agentgramDir = path.join(cwd, '.agentgram');
  const hookEventsDir = path.join(agentgramDir, 'hook-events');
  const sessionsDir = path.join(agentgramDir, 'sessions');

  if (!fs.existsSync(hookEventsDir)) {
    return [];
  }

  const savedIds: string[] = [];
  const eventFiles = fs.readdirSync(hookEventsDir).filter((f) => f.endsWith('.jsonl'));

  for (const file of eventFiles) {
    const sessionId = file.replace('.jsonl', '');
    const eventsPath = path.join(hookEventsDir, file);
    const events = parseEventsFile(eventsPath);

    if (events.length === 0) continue;

    // Build session state from events
    const state: HookSessionState = {
      sessionId,
      claudeSessionId: events[0].claudeSessionId,
      startedAt: events[0].timestamp,
      cwd,
      eventCount: events.length,
    };

    const result = ingestHookSession(cwd, state, events);

    // Save as standard session file
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ session: result.session, provenance: result.provenance, recipe: result.recipe }, null, 2),
    );

    savedIds.push(sessionId);
  }

  return savedIds;
}
