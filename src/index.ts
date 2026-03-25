// Re-export all public API

// Shadow worktree — records every file read/write/exec into a parallel git branch
export { ShadowWorktree } from './worktree/shadow.js';
export type {
  TrackReadOptions,
  TrackWriteOptions,
  TrackExecResult,
  SessionSummary,
} from './worktree/shadow.js';

// Causal provenance graph — connects operations across files and sessions
export { ProvenanceTracker } from './provenance/graph.js';

// Recipe distiller — extracts minimal reproducible steps from a session
export { RecipeDistiller } from './recipe/distill.js';

// Recipe sharing — publish, search, pull recipes
export * from './recipe/types.js';
export { LocalRecipeStore } from './recipe/store.js';
export { GitHubRecipeRegistry, RegistryError } from './recipe/registry.js';
export { prepareForSharing, generateRecipeId, detectSourceAgent } from './recipe/share.js';

// Session orchestrator — main user-facing API
export { AgentraceSession, Agentrace } from './core/session.js';
export type { SessionResult } from './core/session.js';

// Core types
export * from './core/types.js';

// Claude Code hooks — zero-config auto-capture
export {
  installHooks,
  uninstallHooks,
  generateHookConfig,
} from './hooks/claude-code.js';

// Hook ingestion pipeline — converts JSONL events to full sessions
export {
  parseEventsFile,
  eventToOperation,
  ingestHookSession,
  ingestAndSave,
} from './hooks/ingest.js';

// MCP server — universal agent support
export { createMcpServer, startMcpServer } from './mcp/server.js';

// Interactive visualizer
export { generateVizHtml } from './viz/html.js';
export type { VizData } from './viz/html.js';

// Utilities
export { contentHash, generateId, sessionBranchName } from './utils/hash.js';
export { isGitRepo, createGit } from './utils/git.js';
