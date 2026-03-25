/**
 * Cognitive Capture — Enhanced hook handler for Claude Code.
 *
 * Extends the basic PostToolUse hook to capture conversation context:
 * the assistant's reasoning turn that preceded each tool call.
 *
 * Claude Code's hook payload includes:
 *   {
 *     session_id: string,
 *     tool_name: "Read" | "Write" | "Edit" | "Bash" | ...,
 *     tool_input: { ... },
 *     tool_response: { ... },
 *     assistant_message?: string,  // ← the reasoning text before this call
 *   }
 *
 * We capture the assistant_message and link it to the operation,
 * building a cognitive trace as the session progresses.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Operation } from '../core/types.js';
import { CognitiveTraceBuilder } from './trace.js';
import type { CognitiveTrace } from './trace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCodeHookPayload {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  /** The assistant message text that preceded this tool call — the reasoning */
  assistant_message?: string;
  /** The user's message that triggered the current task */
  user_message?: string;
}

export interface CognitiveSessionStore {
  [sessionId: string]: {
    builder: CognitiveTraceBuilder;
    startedAt: number;
    lastActivity: number;
  };
}

// ---------------------------------------------------------------------------
// Global session store (in-process)
// ---------------------------------------------------------------------------

const activeSessions: CognitiveSessionStore = {};

// ---------------------------------------------------------------------------
// Hook handler
// ---------------------------------------------------------------------------

/**
 * handleCognitiveCapture() — Process one Claude Code PostToolUse event.
 *
 * Called for every tool invocation. Extracts:
 * - The operation (what was done)
 * - The reasoning (why the agent did it)
 * - The user intent (what the user originally asked for)
 *
 * Builds a cognitive trace incrementally.
 */
export function handleCognitiveCapture(payload: ClaudeCodeHookPayload): void {
  const { session_id, tool_name, tool_input, tool_response, assistant_message, user_message } = payload;

  // Get or create session builder
  if (!activeSessions[session_id]) {
    activeSessions[session_id] = {
      builder: new CognitiveTraceBuilder(session_id),
      startedAt: Date.now(),
      lastActivity: Date.now(),
    };
    if (user_message) {
      activeSessions[session_id].builder.setInitialIntent(user_message);
    }
  }

  const session = activeSessions[session_id];
  session.lastActivity = Date.now();

  // Map Claude Code tool name → operation
  const operation = hookPayloadToOperation(tool_name, tool_input, tool_response);
  if (!operation) return; // not a trackable operation

  // Add cognitive event with reasoning
  session.builder.addEvent(operation, assistant_message, user_message);
}

/**
 * finalizeCognitiveTrace() — Complete and save the cognitive trace.
 *
 * Called when a session ends (SessionStop hook).
 * Runs dead end detection and saves the trace to disk.
 */
export function finalizeCognitiveTrace(sessionId: string, outputDir = '.agentgram'): CognitiveTrace | null {
  const session = activeSessions[sessionId];
  if (!session) return null;

  const trace = session.builder.build();

  // Save to disk
  const dir = path.join(outputDir, 'cognitive');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify(trace, null, 2),
  );

  // Clean up
  delete activeSessions[sessionId];

  return trace;
}

/**
 * loadCognitiveTrace() — Load a saved cognitive trace.
 */
export function loadCognitiveTrace(sessionId: string, outputDir = '.agentgram'): CognitiveTrace | null {
  const file = path.join(outputDir, 'cognitive', `${sessionId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CognitiveTrace;
}

// ---------------------------------------------------------------------------
// Tool → Operation mapper
// ---------------------------------------------------------------------------

let opCounter = 0;

function hookPayloadToOperation(
  toolName: string,
  input: Record<string, unknown>,
  response?: Record<string, unknown>,
): Operation | null {
  const id = `op-cog-${++opCounter}-${Date.now()}`;
  const timestamp = Date.now();
  const metadata: Operation['metadata'] = {};

  switch (toolName) {
    case 'Read':
      return {
        id, type: 'read', timestamp,
        target: String(input.file_path ?? input.path ?? ''),
        metadata,
        causedBy: [],
      };

    case 'Write':
      return {
        id, type: 'create', timestamp,
        target: String(input.file_path ?? input.path ?? ''),
        metadata,
        causedBy: [],
      };

    case 'Edit':
    case 'MultiEdit':
      return {
        id, type: 'write', timestamp,
        target: String(input.file_path ?? input.path ?? ''),
        metadata: {
          patch: String(input.new_string ?? input.old_string ?? '').slice(0, 500),
        },
        causedBy: [],
      };

    case 'Bash': {
      const cmd = String(input.command ?? '');
      const exitCode = typeof response?.exit_code === 'number' ? response.exit_code : undefined;
      const output = String(response?.stdout ?? response?.output ?? '').slice(0, 1000);
      return {
        id, type: 'exec', timestamp,
        target: cmd,
        metadata: { command: cmd, exitCode, output },
        causedBy: [],
      };
    }

    case 'Glob':
    case 'Grep':
      return {
        id, type: 'read', timestamp,
        target: String(input.pattern ?? input.path ?? ''),
        metadata: {},
        causedBy: [],
      };

    case 'NotebookEdit':
      return {
        id, type: 'write', timestamp,
        target: String(input.notebook_path ?? ''),
        metadata: {},
        causedBy: [],
      };

    default:
      return null; // agent_thinking, etc. — not a file operation
  }
}

// ---------------------------------------------------------------------------
// JSONL cognitive event log (for persistence across processes)
// ---------------------------------------------------------------------------

const COGNITIVE_LOG_FILE = path.join('.agentgram', 'cognitive', 'events.jsonl');

/**
 * appendCognitiveEvent() — Append a raw hook payload to the JSONL log.
 *
 * This enables post-hoc cognitive trace reconstruction from a log file,
 * useful for long sessions or when the process restarts.
 */
export function appendCognitiveEvent(payload: ClaudeCodeHookPayload): void {
  const dir = path.dirname(COGNITIVE_LOG_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    COGNITIVE_LOG_FILE,
    JSON.stringify({ ...payload, _ts: Date.now() }) + '\n',
  );
}

/**
 * replayFromLog() — Reconstruct a cognitive trace from the JSONL event log.
 *
 * Useful for recovering traces from long sessions or process restarts.
 */
export function replayFromLog(sessionId: string, logFile = COGNITIVE_LOG_FILE): CognitiveTrace | null {
  if (!fs.existsSync(logFile)) return null;

  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  const events = lines
    .map((l) => JSON.parse(l) as ClaudeCodeHookPayload & { _ts: number })
    .filter((e) => e.session_id === sessionId);

  if (events.length === 0) return null;

  const builder = new CognitiveTraceBuilder(sessionId);
  if (events[0].user_message) builder.setInitialIntent(events[0].user_message);

  for (const event of events) {
    const op = hookPayloadToOperation(event.tool_name, event.tool_input, event.tool_response);
    if (op) {
      op.timestamp = event._ts;
      builder.addEvent(op, event.assistant_message, event.user_message);
    }
  }

  return builder.build();
}
