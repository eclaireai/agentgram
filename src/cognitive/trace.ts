/**
 * Cognitive Trace — Tier 3: The WHY behind every agent action.
 *
 * THE CORE INVENTION.
 *
 * Current tools capture WHAT an agent did (git diff, file ops).
 * agentgram already captures HOW (causal provenance graph — Tier 2).
 * This module captures WHY — the reasoning that caused each action.
 *
 * For every tool call an AI agent makes, there is:
 *   1. A user intent  ("add JWT auth")
 *   2. Agent reasoning ("I need to check if jsonwebtoken is installed first")
 *   3. The tool call   (Read file: package.json)
 *   4. The outcome     (found no JWT dep → decided to install it)
 *   5. Next reasoning  ("no JWT found, will install it")
 *   6. Next tool call  (Exec: npm install jsonwebtoken)
 *
 * This chain IS the cognitive trace. It's what a senior engineer would
 * write in a design doc. It's what makes recipes explainable, not just
 * reproducible. It's what turns "follow these steps" into "understand
 * why these steps".
 *
 * Patent claim: Method for linking AI conversation reasoning turns
 * to specific file operations, capturing dead ends, decision points,
 * and causal reasoning chains for later distillation and replay.
 */

import type { Operation, OperationId } from '../core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single reasoning turn — what the AI agent was "thinking"
 * immediately before it made a tool call.
 */
export interface ReasoningTurn {
  /** The agent's stated reasoning (from assistant message text) */
  text: string;
  /** Timestamp of this reasoning */
  timestamp: number;
  /** Confidence/certainty expressed (extracted via heuristic) */
  certainty: 'high' | 'medium' | 'low' | 'unknown';
}

/**
 * A decision point — where the agent chose between alternatives.
 * Captured when the agent expresses "I could X or Y, I'll do X because..."
 */
export interface DecisionPoint {
  id: string;
  /** The operation that was ultimately taken */
  chosen: OperationId;
  /** Alternatives that were considered but rejected */
  alternatives: Array<{
    description: string;
    rejectedBecause: string;
  }>;
  /** The reasoning that led to the decision */
  reasoning: string;
  timestamp: number;
}

/**
 * A dead end — an operation that was attempted and subsequently reversed.
 * This is critical for recipe distillation: dead ends are EXCLUDED
 * from recipes so the next agent goes straight to the answer.
 *
 * Example: agent installs Jest, then realizes Vitest is better,
 * uninstalls Jest. The "install Jest" is a dead end.
 */
export interface DeadEnd {
  id: string;
  /** The operation that was a mistake */
  operation: Operation;
  /** The operation that undid it */
  undoneBy: Operation;
  /** Why it was a dead end */
  reason: string;
  /** Tokens wasted on this dead end (estimated) */
  estimatedTokensWasted: number;
}

/**
 * A cognitive event — one step in the agent's cognitive process.
 * Links the operation to the full context that caused it.
 */
export interface CognitiveEvent {
  /** The operation itself (read, write, exec, etc.) */
  operation: Operation;
  /** The reasoning turn that immediately preceded this operation */
  reasoning?: ReasoningTurn;
  /** The user intent that ultimately motivated this operation */
  userIntent?: string;
  /** Was this operation part of a dead end? */
  isDeadEnd: boolean;
  /** If dead end, what was the correction? */
  correctedBy?: OperationId;
  /** Is this a decision point? */
  isDecisionPoint: boolean;
  /** If decision point, what alternatives were considered? */
  decisionPoint?: DecisionPoint;
  /** Context window snapshot: what did the agent "know" at this moment? */
  contextSnapshot?: {
    /** Files that were open/recently read */
    openFiles: string[];
    /** Recent commands that were run */
    recentCommands: string[];
    /** Errors that were visible */
    visibleErrors: string[];
  };
}

/**
 * The full cognitive trace for a session.
 * This is the complete "thinking record" of an AI coding session.
 */
export interface CognitiveTrace {
  sessionId: string;
  /** The initial user intent that started this session */
  initialIntent: string;
  /** All cognitive events in chronological order */
  events: CognitiveEvent[];
  /** Dead ends discovered during distillation */
  deadEnds: DeadEnd[];
  /** Decision points where alternatives were weighed */
  decisionPoints: DecisionPoint[];
  /** Total operations */
  totalOperations: number;
  /** Operations that were dead ends (excluded from recipes) */
  wastedOperations: number;
  /** Estimated tokens wasted on dead ends */
  estimatedTokensWasted: number;
  /** When the trace was captured */
  capturedAt: number;
}

/**
 * An enriched recipe step with cognitive context attached.
 * This is what "explainable AI" looks like for coding agents.
 */
export interface CognitiveRecipeStep {
  action: string;
  target: string;
  description: string;
  /** WHY the agent did this — from the reasoning turn */
  reasoning: string;
  /** What the agent KNEW when it took this step */
  knewAtThisPoint: string[];
  /** Alternatives the agent considered and rejected */
  alternativesRejected: string[];
  /** Was this step informed by a previous dead end? */
  learnedFromDeadEnd?: string;
}

// ---------------------------------------------------------------------------
// Dead end detector
// ---------------------------------------------------------------------------

/**
 * detectDeadEnds() — Find operations that were attempted and reversed.
 *
 * Pattern matching:
 *   - npm install X followed by npm uninstall X
 *   - create_file X followed by delete X
 *   - modify_file X followed by revert of same file
 *   - exec that failed (exitCode != 0) followed by different exec
 */
export function detectDeadEnds(operations: Operation[]): DeadEnd[] {
  const deadEnds: DeadEnd[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // Pattern 1: npm install X → npm uninstall X
    if (op.type === 'exec') {
      const cmd = (op.metadata.command ?? op.target).toLowerCase();
      if (cmd.includes('npm install') || cmd.includes('npm i ')) {
        // Look ahead for uninstall of same package
        const pkg = extractPackageName(cmd);
        if (pkg) {
          for (let j = i + 1; j < Math.min(i + 10, operations.length); j++) {
            const nextOp = operations[j];
            const nextCmd = (nextOp.metadata.command ?? nextOp.target).toLowerCase();
            if (nextCmd.includes('npm uninstall') && nextCmd.includes(pkg)) {
              deadEnds.push({
                id: `dead-${op.id}`,
                operation: op,
                undoneBy: nextOp,
                reason: `Installed ${pkg} then uninstalled it — wrong package`,
                estimatedTokensWasted: 3000,
              });
              break;
            }
          }
        }
      }
    }

    // Pattern 2: Failed exec (non-zero exit) that wasn't the final attempt
    if (op.type === 'exec' && op.metadata.exitCode !== undefined && op.metadata.exitCode !== 0) {
      // Only a dead end if there's a successful retry later
      const cmd = op.metadata.command ?? op.target;
      const laterSuccess = operations.slice(i + 1).some(
        (o) => o.type === 'exec' &&
          (o.metadata.command ?? o.target) === cmd &&
          o.metadata.exitCode === 0,
      );
      if (laterSuccess) {
        deadEnds.push({
          id: `dead-${op.id}`,
          operation: op,
          undoneBy: operations.slice(i + 1).find(
            (o) => o.type === 'exec' && (o.metadata.command ?? o.target) === cmd
          )!,
          reason: `Command failed (exit ${op.metadata.exitCode}), succeeded on retry`,
          estimatedTokensWasted: 2000,
        });
      }
    }

    // Pattern 3: create_file X → delete X
    if (op.type === 'create') {
      const later = operations.slice(i + 1).find(
        (o) => o.type === 'delete' && o.target === op.target,
      );
      if (later) {
        deadEnds.push({
          id: `dead-${op.id}`,
          operation: op,
          undoneBy: later,
          reason: `Created ${op.target} then deleted it — wrong approach`,
          estimatedTokensWasted: 4000,
        });
      }
    }
  }

  return deadEnds;
}

function extractPackageName(npmCmd: string): string | null {
  const match = npmCmd.match(/npm (?:install|i|uninstall|remove|rm)\s+(?:-[a-z]+\s+)*([a-z@][a-z0-9@/_-]*)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Reasoning extractor
// ---------------------------------------------------------------------------

/**
 * extractReasoning() — Parse agent reasoning from hook event text.
 *
 * Claude Code's PostToolUse hook provides:
 *   - tool_name: what tool was called
 *   - tool_input: what arguments were passed
 *   - assistant_message: the full assistant turn (includes reasoning text)
 *
 * This function extracts the reasoning that preceded the tool call.
 */
export function extractReasoning(assistantMessage: string, _toolName: string): ReasoningTurn | null {
  if (!assistantMessage) return null;

  // Find the text block before the tool use
  // In Claude's format, reasoning appears as text content before tool_use blocks
  const lines = assistantMessage.split('\n').filter((l) => l.trim());

  // Heuristic: find lines that express reasoning about the upcoming action
  const reasoningIndicators = [
    /\b(need to|should|will|let me|i'll|i will|going to|must)\b/i,
    /\b(check|look|examine|inspect|verify|read|see if)\b/i,
    /\b(because|since|as|therefore|so that|in order to)\b/i,
    /\b(first|next|then|after|before)\b/i,
  ];

  const reasoningLines = lines.filter((line) => {
    // Skip lines that are clearly not reasoning
    if (line.startsWith('```') || line.startsWith('#') || line.length < 10) return false;
    return reasoningIndicators.some((r) => r.test(line));
  });

  if (reasoningLines.length === 0) return null;

  const text = reasoningLines.slice(0, 3).join(' ').slice(0, 500);

  // Determine certainty from language
  let certainty: ReasoningTurn['certainty'] = 'medium';
  if (/\b(definitely|certainly|must|clearly|obviously)\b/i.test(text)) certainty = 'high';
  if (/\b(might|maybe|perhaps|possibly|not sure|let me check)\b/i.test(text)) certainty = 'low';

  return { text, timestamp: Date.now(), certainty };
}

/**
 * detectDecisionPoint() — Find places where the agent weighed alternatives.
 *
 * Heuristic: assistant message contains "could X or Y" / "I'll use X instead of Y"
 * / "rather than X, I'll do Y"
 */
export function detectDecisionPoint(
  assistantMessage: string,
  operationId: OperationId,
): DecisionPoint | null {
  if (!assistantMessage) return null;

  const decisionPatterns = [
    /(?:instead of|rather than|not using)\s+([^,\.]+)[,\.]\s*(?:I(?:'ll| will)|let me|going to)\s+([^\.]+)/i,
    /(?:could|can)\s+(?:use|do|try)\s+([^,]+)\s+or\s+([^,\.]+)/i,
    /(?:I'll use|using)\s+([^,\.]+)\s+(?:instead|because|rather)/i,
  ];

  for (const pattern of decisionPatterns) {
    const match = assistantMessage.match(pattern);
    if (match) {
      return {
        id: `decision-${operationId}`,
        chosen: operationId,
        alternatives: [{ description: match[1]?.trim() ?? 'alternative approach', rejectedBecause: 'agent preference' }],
        reasoning: match[0],
        timestamp: Date.now(),
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cognitive trace builder
// ---------------------------------------------------------------------------

export class CognitiveTraceBuilder {
  private events: CognitiveEvent[] = [];
  private initialIntent = '';
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setInitialIntent(intent: string): void {
    this.initialIntent = intent;
  }

  /**
   * addEvent() — Record one cognitive event.
   *
   * Called by the hook handler for every tool invocation.
   * The assistantMessage is the full text of the assistant turn
   * that immediately preceded this tool call.
   */
  addEvent(
    operation: Operation,
    assistantMessage?: string,
    userIntent?: string,
  ): CognitiveEvent {
    const reasoning = assistantMessage
      ? extractReasoning(assistantMessage, operation.type)
      : undefined;

    const decisionPoint = assistantMessage
      ? detectDecisionPoint(assistantMessage, operation.id)
      : null;

    const event: CognitiveEvent = {
      operation,
      reasoning: reasoning ?? undefined,
      userIntent: userIntent ?? this.initialIntent,
      isDeadEnd: false, // will be updated by detectDeadEnds
      isDecisionPoint: decisionPoint !== null,
      decisionPoint: decisionPoint ?? undefined,
    };

    this.events.push(event);
    return event;
  }

  /**
   * build() — Finalize the cognitive trace.
   *
   * Runs dead end detection across all events,
   * marks dead end events, and returns the complete trace.
   */
  build(): CognitiveTrace {
    const operations = this.events.map((e) => e.operation);
    const deadEnds = detectDeadEnds(operations);
    const deadEndIds = new Set(deadEnds.map((d) => d.operation.id));

    // Mark dead end events
    for (const event of this.events) {
      if (deadEndIds.has(event.operation.id)) {
        event.isDeadEnd = true;
        const deadEnd = deadEnds.find((d) => d.operation.id === event.operation.id);
        event.correctedBy = deadEnd?.undoneBy.id;
      }
    }

    const decisionPoints = this.events
      .filter((e) => e.isDecisionPoint && e.decisionPoint)
      .map((e) => e.decisionPoint!);

    const wastedOperations = deadEnds.length;
    const estimatedTokensWasted = deadEnds.reduce((s, d) => s + d.estimatedTokensWasted, 0);

    return {
      sessionId: this.sessionId,
      initialIntent: this.initialIntent,
      events: this.events,
      deadEnds,
      decisionPoints,
      totalOperations: this.events.length,
      wastedOperations,
      estimatedTokensWasted,
      capturedAt: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Cognitive recipe distiller
// ---------------------------------------------------------------------------

/**
 * distillCognitiveRecipe() — Extract an explainable recipe from a cognitive trace.
 *
 * Unlike the basic recipe distiller (which only sees operations),
 * this produces steps enriched with the WHY — the reasoning that
 * caused each step.
 *
 * This is what transforms a recipe from a checklist into an explanation.
 */
export function distillCognitiveRecipe(trace: CognitiveTrace): CognitiveRecipeStep[] {
  // Filter out dead ends
  const liveEvents = trace.events.filter((e) => !e.isDeadEnd);

  // Group consecutive similar events (deduplication)
  const deduped: CognitiveEvent[] = [];
  for (const event of liveEvents) {
    const last = deduped[deduped.length - 1];
    // Skip duplicate reads of the same file
    if (
      last &&
      last.operation.type === 'read' &&
      event.operation.type === 'read' &&
      last.operation.target === event.operation.target
    ) {
      continue;
    }
    deduped.push(event);
  }

  return deduped.map((event): CognitiveRecipeStep => {
    const op = event.operation;

    // Map operation type to recipe action
    const action = {
      read: 'find',
      write: 'modify_file',
      create: 'create_file',
      delete: 'delete',
      exec: 'run_command',
    }[op.type] ?? op.type;

    // Build the "knew at this point" context
    const knewAtThisPoint: string[] = [];
    if (event.reasoning?.text) {
      knewAtThisPoint.push(event.reasoning.text.slice(0, 150));
    }

    // If this step learned from a dead end in the trace
    const relevantDeadEnd = trace.deadEnds.find(
      (d) => d.undoneBy.id === op.id,
    );
    const learnedFromDeadEnd = relevantDeadEnd
      ? `Previous attempt failed: ${relevantDeadEnd.reason}`
      : undefined;

    // Alternatives rejected
    const alternativesRejected = event.decisionPoint?.alternatives
      .map((a) => `${a.description} — rejected because: ${a.rejectedBecause}`)
      ?? [];

    return {
      action,
      target: op.target,
      description: op.reason ?? `${action} ${op.target}`,
      reasoning: event.reasoning?.text ?? event.userIntent ?? '',
      knewAtThisPoint,
      alternativesRejected,
      learnedFromDeadEnd,
    };
  });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Render a cognitive trace as a human-readable markdown document */
export function cognitiveTraceToMarkdown(trace: CognitiveTrace): string {
  const lines: string[] = [
    `# Cognitive Trace: ${trace.sessionId}`,
    '',
    `**Intent:** ${trace.initialIntent}`,
    `**Operations:** ${trace.totalOperations} total, ${trace.wastedOperations} wasted (dead ends)`,
    `**Tokens wasted on dead ends:** ~${trace.estimatedTokensWasted.toLocaleString()}`,
    '',
  ];

  if (trace.deadEnds.length > 0) {
    lines.push('## Dead Ends (excluded from recipe)', '');
    for (const d of trace.deadEnds) {
      lines.push(`- ❌ \`${d.operation.type}\` → \`${d.operation.target}\``);
      lines.push(`  *${d.reason}* — ~${d.estimatedTokensWasted.toLocaleString()} tokens wasted`);
    }
    lines.push('');
  }

  if (trace.decisionPoints.length > 0) {
    lines.push('## Decision Points', '');
    for (const d of trace.decisionPoints) {
      lines.push(`- **Chose:** operation \`${d.chosen}\``);
      lines.push(`  *${d.reasoning}*`);
      for (const alt of d.alternatives) {
        lines.push(`  - Rejected: ${alt.description} — ${alt.rejectedBecause}`);
      }
    }
    lines.push('');
  }

  lines.push('## Cognitive Events', '');
  for (const [i, event] of trace.events.entries()) {
    const op = event.operation;
    const deadMark = event.isDeadEnd ? ' ❌ DEAD END' : '';
    const decMark = event.isDecisionPoint ? ' 🔀 DECISION' : '';

    lines.push(`### Step ${i + 1}: \`${op.type}\` → \`${op.target}\`${deadMark}${decMark}`);

    if (event.reasoning) {
      lines.push('');
      lines.push(`**Reasoning (${event.reasoning.certainty} certainty):**`);
      lines.push(`> ${event.reasoning.text}`);
    }

    if (event.userIntent) {
      lines.push(`**User intent:** ${event.userIntent}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
