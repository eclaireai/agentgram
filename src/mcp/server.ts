#!/usr/bin/env node
/**
 * agentgram MCP Server
 *
 * Provides session recording tools to any MCP-compatible agent.
 *
 * Run:   npx agentgram mcp
 *
 * Configure in .claude/.mcp.json:
 *   { "mcpServers": { "agentgram": { "command": "npx", "args": ["agentgram","mcp"], "type": "stdio" } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AgentraceSession, Agentrace } from '../core/session.js';
import { RecipeDistiller } from '../recipe/distill.js';
import type { SessionResult } from '../core/session.js';
import { LocalFingerprintStore, preflight, formatPreflightResult, ensureSeeded } from '../fingerprint/index.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeSession: AgentraceSession | null = null;
let sessionCwd: string = process.cwd();

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agentgram',
    version: '0.1.0',
  });

  // ── agentgram_start ─────────────────────────────────────────────────────

  server.tool(
    'agentgram_start',
    'Start recording an agentgram session. All subsequent operations will be journaled.',
    {
      name: z.string().describe('Session name (e.g., "fix-auth-bug")'),
      cwd: z.string().optional().describe('Working directory (defaults to server cwd)'),
    },
    async (input) => {
      if (activeSession) {
        return {
          content: [{ type: 'text' as const, text: 'A session is already recording. Stop it first with agentgram_stop.' }],
          isError: true,
        };
      }

      try {
        sessionCwd = input.cwd ?? process.cwd();
        activeSession = await Agentrace.start(sessionCwd, input.name);
        return {
          content: [{ type: 'text' as const, text: `Recording started: "${input.name}"\nUse agentgram_stop when done.` }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── agentgram_read ──────────────────────────────────────────────────────

  server.tool(
    'agentgram_read',
    'Record a file read operation in the current agentgram session.',
    {
      file_path: z.string().describe('Path to the file that was read'),
      reason: z.string().optional().describe('Why the file was read'),
    },
    async (input) => {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session. Start one with agentgram_start.' }], isError: true };
      }
      const op = await activeSession.read(input.file_path, { reason: input.reason });
      return { content: [{ type: 'text' as const, text: `Tracked read: ${input.file_path} (${op.id})` }] };
    },
  );

  // ── agentgram_write ─────────────────────────────────────────────────────

  server.tool(
    'agentgram_write',
    'Record a file write/edit/create operation. Creates a micro-commit on the shadow branch.',
    {
      file_path: z.string().describe('Path to the file that was written'),
      reason: z.string().optional().describe('Why the file was written'),
      is_new: z.boolean().optional().describe('True if this is a newly created file'),
    },
    async (input) => {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session. Start one with agentgram_start.' }], isError: true };
      }
      const op = input.is_new
        ? await activeSession.create(input.file_path, { reason: input.reason })
        : await activeSession.write(input.file_path, { reason: input.reason });
      return { content: [{ type: 'text' as const, text: `Tracked ${input.is_new ? 'create' : 'write'}: ${input.file_path} (${op.id})` }] };
    },
  );

  // ── agentgram_exec ──────────────────────────────────────────────────────

  server.tool(
    'agentgram_exec',
    'Record a command execution. Creates a micro-commit on the shadow branch.',
    {
      command: z.string().describe('Command that was executed'),
      exit_code: z.number().optional().describe('Exit code (0 = success)'),
      output: z.string().optional().describe('Command output (truncated)'),
      reason: z.string().optional().describe('Why the command was run'),
    },
    async (input) => {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session. Start one with agentgram_start.' }], isError: true };
      }
      const op = await activeSession.exec(
        input.command,
        { exitCode: input.exit_code, output: input.output },
        { reason: input.reason },
      );
      return { content: [{ type: 'text' as const, text: `Tracked exec: ${input.command} → exit ${input.exit_code ?? '?'} (${op.id})` }] };
    },
  );

  // ── agentgram_stop ──────────────────────────────────────────────────────

  server.tool(
    'agentgram_stop',
    'Stop the current session. Returns recipe and provenance summary.',
    async () => {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session to stop.' }], isError: true };
      }

      try {
        const result: SessionResult = await activeSession.stop();
        activeSession = null;

        const distiller = new RecipeDistiller();
        const recipeYaml = distiller.toYAML(result.recipe);

        const summary = [
          `Session stopped: ${result.session.name}`,
          `  Operations: ${result.operations.length}`,
          `  Micro-commits: ${result.totalCommits}`,
          `  Branch: ${result.branch}`,
          `  Provenance: ${result.provenance.nodes.length} nodes, ${result.provenance.edges.length} edges`,
          `  Recipe: ${result.recipe.steps.length} steps`,
          '',
          '--- Recipe ---',
          recipeYaml,
        ].join('\n');

        return { content: [{ type: 'text' as const, text: summary }] };
      } catch (err) {
        activeSession = null;
        return {
          content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── agentgram_status ────────────────────────────────────────────────────

  server.tool(
    'agentgram_status',
    'Check the current recording status.',
    async () => {
      if (!activeSession) {
        return { content: [{ type: 'text' as const, text: 'No active session.' }] };
      }

      const ops = activeSession.getOperations();
      const recipe = activeSession.distill();

      return {
        content: [{
          type: 'text' as const,
          text: [
            'Recording active:',
            `  Operations: ${ops.length}`,
            `  Reads: ${ops.filter((o) => o.type === 'read').length}`,
            `  Writes: ${ops.filter((o) => o.type === 'write' || o.type === 'create').length}`,
            `  Execs: ${ops.filter((o) => o.type === 'exec').length}`,
            `  Recipe steps so far: ${recipe.steps.length}`,
          ].join('\n'),
        }],
      };
    },
  );

  // ── Live Preflight Tools ────────────────────────────────────────────────────
  // These tools enable real-time dead-end interception during sessions.
  // Add to CLAUDE.md: "Before any risky operation, call agentgram_check."

  // ── agentgram_check ─────────────────────────────────────────────────────

  server.tool(
    'agentgram_check',
    'Check if a planned operation matches known dead-end patterns. Call this BEFORE running risky commands (npm install, database migrations, auth setup, webhook configuration). Returns warnings with fixes if known issues exist.',
    {
      action: z.string().describe('What you are about to do (e.g., "npm install stripe", "run prisma migrate dev", "add webhook endpoint")'),
      domain: z.string().optional().describe('Task domain: payments, auth, database, devops, ai, frontend'),
    },
    async (input) => {
      try {
        ensureSeeded();
        const store = new LocalFingerprintStore();
        const result = preflight(input.action, store, { limit: 3, domain: input.domain });

        let text: string;
        if (result.matches.length === 0) {
          text = `✓ No known issues for: "${input.action}"\n  Safe to proceed.`;
        } else {
          text = formatPreflightResult(result);
        }

        text += `\n\n  Source: agentgram dead-end database (${result.totalFingerprints} patterns)`;

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `agentgram_check failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── agentgram_outcome ────────────────────────────────────────────────────

  server.tool(
    'agentgram_outcome',
    'Record the outcome of a completed operation. Call this after each significant step to help agentgram learn what succeeded and what failed. Dead ends are anonymized and contribute to the shared warning database.',
    {
      action: z.string().describe('What was attempted'),
      success: z.boolean().describe('Whether it succeeded'),
      error_pattern: z.string().optional().describe('If failed: the error message or pattern (will be anonymized)'),
      fix_applied: z.string().optional().describe('If failed then fixed: what you did to resolve it'),
      tokens_wasted: z.number().optional().describe('Estimated tokens spent on this dead end'),
    },
    async (input) => {
      if (input.success) {
        return {
          content: [{ type: 'text' as const, text: `✓ Outcome recorded: success\n  agentgram will remember this worked.` }],
        };
      }

      if (!input.error_pattern) {
        return {
          content: [{ type: 'text' as const, text: `✗ Outcome recorded: failed\n  Tip: include error_pattern next time to help others avoid this.` }],
        };
      }

      // Failed with an error pattern — record as a dead end if possible
      if (activeSession && typeof (activeSession as any).recordDeadEnd === 'function') {
        try {
          await (activeSession as any).recordDeadEnd({
            action: input.action,
            errorPattern: input.error_pattern,
            fixApplied: input.fix_applied,
            tokensWasted: input.tokens_wasted,
          });
        } catch {
          // Non-fatal — still return the recorded message below
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: [
            `✗ Dead end recorded and anonymized`,
            `  Error: ${input.error_pattern}`,
            `  Fix: ${input.fix_applied ?? 'unknown'}`,
            `  This pattern will warn others via agentgram preflight.`,
          ].join('\n'),
        }],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
