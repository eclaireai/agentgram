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
