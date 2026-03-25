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

// Session orchestrator — main user-facing API
export { AgentraceSession, Agentrace } from './core/session.js';
export type { SessionResult } from './core/session.js';

// Core types
export * from './core/types.js';

// Utilities
export { contentHash, generateId, sessionBranchName } from './utils/hash.js';
export { isGitRepo, createGit } from './utils/git.js';
