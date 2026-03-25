#!/usr/bin/env node
/**
 * agentgram Claude Code Hook
 *
 * Zero-config auto-capture: intercepts every Read, Write, Edit, and Bash
 * tool call in Claude Code and records it into an agentgram session.
 *
 * Install:
 *   npx agentgram hook install        # adds to ~/.claude/settings.json
 *   npx agentgram hook install --project  # adds to .claude/settings.json
 *
 * Or manually add to settings.json:
 *   {
 *     "hooks": {
 *       "PostToolUse": [{
 *         "matcher": "Read|Write|Edit|Bash|Grep|Glob",
 *         "hooks": [{ "type": "command", "command": "npx agentgram hook capture" }]
 *       }],
 *       "SessionStart": [{
 *         "matcher": "",
 *         "hooks": [{ "type": "command", "command": "npx agentgram hook session-start" }]
 *       }]
 *     }
 *   }
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types matching Claude Code hook stdin JSON
// ---------------------------------------------------------------------------

interface HookInput {
  session_id: string;
  hook_event_name: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { success?: boolean; output?: string };
  tool_use_id?: string;
  cwd: string;
  source?: string;
}

interface AgentgramEvent {
  timestamp: number;
  claudeSessionId: string;
  toolUseId?: string;
  event: string;
  tool?: string;
  target: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Session state file
// ---------------------------------------------------------------------------

const AGENTGRAM_DIR = '.agentgram';
const ACTIVE_SESSION_FILE = 'active-hook-session.json';

interface HookSessionState {
  sessionId: string;
  claudeSessionId: string;
  startedAt: number;
  cwd: string;
  eventCount: number;
}

function getSessionDir(cwd: string): string {
  return path.join(cwd, AGENTGRAM_DIR);
}

function getSessionStatePath(cwd: string): string {
  return path.join(getSessionDir(cwd), ACTIVE_SESSION_FILE);
}

function getEventsPath(cwd: string, sessionId: string): string {
  return path.join(getSessionDir(cwd), 'hook-events', `${sessionId}.jsonl`);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function loadSessionState(cwd: string): HookSessionState | null {
  try {
    const raw = fs.readFileSync(getSessionStatePath(cwd), 'utf8');
    return JSON.parse(raw) as HookSessionState;
  } catch {
    return null;
  }
}

function saveSessionState(cwd: string, state: HookSessionState): void {
  ensureDir(getSessionDir(cwd));
  fs.writeFileSync(getSessionStatePath(cwd), JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Event extraction from Claude Code tool calls
// ---------------------------------------------------------------------------

function extractEvent(input: HookInput): AgentgramEvent | null {
  const tool = input.tool_name;
  if (!tool) return null;

  const toolInput = input.tool_input ?? {};
  const toolResponse = input.tool_response ?? {};
  const timestamp = Date.now();

  switch (tool) {
    case 'Read': {
      const filePath = (toolInput.file_path as string) ?? '';
      return {
        timestamp,
        claudeSessionId: input.session_id,
        toolUseId: input.tool_use_id,
        event: 'read',
        tool,
        target: filePath,
        metadata: {
          offset: toolInput.offset,
          limit: toolInput.limit,
        },
      };
    }

    case 'Write': {
      const filePath = (toolInput.file_path as string) ?? '';
      return {
        timestamp,
        claudeSessionId: input.session_id,
        toolUseId: input.tool_use_id,
        event: 'write',
        tool,
        target: filePath,
        metadata: {
          contentLength: typeof toolInput.content === 'string' ? (toolInput.content as string).length : 0,
        },
      };
    }

    case 'Edit': {
      const filePath = (toolInput.file_path as string) ?? '';
      return {
        timestamp,
        claudeSessionId: input.session_id,
        toolUseId: input.tool_use_id,
        event: 'write',
        tool,
        target: filePath,
        metadata: {
          oldString: typeof toolInput.old_string === 'string' ? (toolInput.old_string as string).slice(0, 100) : '',
          replaceAll: toolInput.replace_all,
        },
      };
    }

    case 'Bash': {
      const command = (toolInput.command as string) ?? '';
      return {
        timestamp,
        claudeSessionId: input.session_id,
        toolUseId: input.tool_use_id,
        event: 'exec',
        tool,
        target: command,
        metadata: {
          exitCode: toolResponse.success ? 0 : 1,
          outputLength: typeof toolResponse.output === 'string' ? toolResponse.output.length : 0,
        },
      };
    }

    case 'Grep':
    case 'Glob': {
      const pattern = (toolInput.pattern as string) ?? '';
      const searchPath = (toolInput.path as string) ?? '.';
      return {
        timestamp,
        claudeSessionId: input.session_id,
        toolUseId: input.tool_use_id,
        event: 'read',
        tool,
        target: `${searchPath}/${pattern}`,
        metadata: {
          pattern,
          path: searchPath,
        },
      };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Hook commands
// ---------------------------------------------------------------------------

/**
 * Handle SessionStart hook — create or resume an agentgram session.
 */
export function handleSessionStart(input: HookInput): string {
  const cwd = input.cwd;
  const existing = loadSessionState(cwd);

  // If there's already an active session for this Claude session, reuse it
  if (existing && existing.claudeSessionId === input.session_id) {
    return JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[agentgram] Resuming session ${existing.sessionId} (${existing.eventCount} events recorded)`,
      },
    });
  }

  // Create new session
  const sessionId = `hook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const state: HookSessionState = {
    sessionId,
    claudeSessionId: input.session_id,
    startedAt: Date.now(),
    cwd,
    eventCount: 0,
  };

  saveSessionState(cwd, state);
  ensureDir(path.dirname(getEventsPath(cwd, sessionId)));

  return JSON.stringify({
    hookSpecificOutput: {
      additionalContext: `[agentgram] Recording session ${sessionId}. All file reads, writes, and commands will be journaled.`,
    },
  });
}

/**
 * Handle PostToolUse hook — capture the tool call event.
 */
export function handleCapture(input: HookInput): string {
  const cwd = input.cwd;
  const state = loadSessionState(cwd);

  if (!state) {
    // No active session — silently skip
    return '';
  }

  const event = extractEvent(input);
  if (!event) return '';

  // Append event to JSONL file
  const eventsFile = getEventsPath(cwd, state.sessionId);
  ensureDir(path.dirname(eventsFile));
  fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');

  // Update event count
  state.eventCount++;
  saveSessionState(cwd, state);

  return '';
}

// ---------------------------------------------------------------------------
// Settings.json generation
// ---------------------------------------------------------------------------

export interface HookConfig {
  hooks: {
    PostToolUse: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    SessionStart: Array<{
      matcher: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
  };
}

export function generateHookConfig(): HookConfig {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Read|Write|Edit|Bash|Grep|Glob',
          hooks: [
            {
              type: 'command',
              command: 'npx agentgram hook capture',
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'npx agentgram hook session-start',
            },
          ],
        },
      ],
    },
  };
}

/**
 * Install hooks into Claude Code settings.json
 */
export function installHooks(scope: 'user' | 'project', cwd: string): { path: string; created: boolean } {
  const settingsPath =
    scope === 'user'
      ? path.join(process.env.HOME ?? '~', '.claude', 'settings.json')
      : path.join(cwd, '.claude', 'settings.json');

  ensureDir(path.dirname(settingsPath));

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    // File doesn't exist, start fresh
  }

  const hookConfig = generateHookConfig();

  // Merge hooks into existing settings
  const existingHooks = (existing.hooks ?? {}) as Record<string, unknown[]>;

  // Add PostToolUse hooks
  const postToolUse = (existingHooks.PostToolUse ?? []) as unknown[];
  const alreadyHasCapture = postToolUse.some(
    (h: unknown) => JSON.stringify(h).includes('agentgram'),
  );
  if (!alreadyHasCapture) {
    postToolUse.push(...hookConfig.hooks.PostToolUse);
  }

  // Add SessionStart hooks
  const sessionStart = (existingHooks.SessionStart ?? []) as unknown[];
  const alreadyHasSessionStart = sessionStart.some(
    (h: unknown) => JSON.stringify(h).includes('agentgram'),
  );
  if (!alreadyHasSessionStart) {
    sessionStart.push(...hookConfig.hooks.SessionStart);
  }

  existing.hooks = {
    ...existingHooks,
    PostToolUse: postToolUse,
    SessionStart: sessionStart,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));

  return { path: settingsPath, created: true };
}

/**
 * Uninstall hooks from Claude Code settings.json
 */
export function uninstallHooks(scope: 'user' | 'project', cwd: string): boolean {
  const settingsPath =
    scope === 'user'
      ? path.join(process.env.HOME ?? '~', '.claude', 'settings.json')
      : path.join(cwd, '.claude', 'settings.json');

  try {
    const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;

    // Filter out agentgram hooks
    for (const eventName of Object.keys(hooks)) {
      if (Array.isArray(hooks[eventName])) {
        hooks[eventName] = hooks[eventName].filter(
          (h: unknown) => !JSON.stringify(h).includes('agentgram'),
        );
        if (hooks[eventName].length === 0) {
          delete hooks[eventName];
        }
      }
    }

    existing.hooks = hooks;
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point for hook commands
// ---------------------------------------------------------------------------

export function runHookCommand(args: string[]): void {
  const subcommand = args[0];

  switch (subcommand) {
    case 'session-start': {
      const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8')) as HookInput;
      const output = handleSessionStart(input);
      if (output) process.stdout.write(output);
      break;
    }

    case 'capture': {
      const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8')) as HookInput;
      const output = handleCapture(input);
      if (output) process.stdout.write(output);
      break;
    }

    case 'install': {
      const scope = args.includes('--project') ? 'project' : 'user';
      const result = installHooks(scope as 'user' | 'project', process.cwd());
      console.log(`✔ Hooks installed to ${result.path}`);
      console.log('  agentgram will now auto-capture all Claude Code sessions.');
      break;
    }

    case 'uninstall': {
      const scope = args.includes('--project') ? 'project' : 'user';
      const removed = uninstallHooks(scope as 'user' | 'project', process.cwd());
      if (removed) {
        console.log('✔ Hooks removed from settings.json');
      } else {
        console.log('No agentgram hooks found to remove.');
      }
      break;
    }

    default:
      console.error(`Unknown hook command: ${subcommand}`);
      console.error('Usage: agentgram hook <session-start|capture|install|uninstall>');
      process.exit(1);
  }
}
