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

// Recipe execution tracking
export {
  RecipeExecutor,
  submitFeedback,
  saveReport,
  loadReports,
} from './recipe/executor.js';
export type {
  StepResult,
  CostMetrics,
  ExecutionReport,
} from './recipe/executor.js';

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

// Codebase fingerprinting
export { fingerprint } from './recipe/fingerprint.js';
export type { CodebaseFingerprint } from './recipe/fingerprint.js';

// Enriched recipes (provenance-attached)
export { enrichRecipeWithProvenance } from './recipe/enriched.js';
export type { EnrichedRecipe, EnrichedStep } from './recipe/enriched.js';

// PR→Recipe reverse extractor
export { extractRecipeFromCommit, extractRecipesFromRepo } from './recipe/extractor.js';

// Ticket integrations — link sessions to GitHub/Jira/Linear tickets
export {
  parseTicketUrl,
  formatTicketRef,
  extractTicketKeywords,
  suggestRecipesForTicket,
  formatTicketComment,
} from './integrations/ticket.js';
export type { TicketRef, TicketRecipe, RecipeSuggestion, TicketProvider } from './integrations/ticket.js';

export { GitHubIntegration } from './integrations/github.js';
export type { GitHubIssue, GitHubPR, GitHubIntegrationConfig } from './integrations/github.js';

export {
  resolveSessionToTicket,
  buildKnowledgeBase,
  loadTicketLinks,
  findRecipesForTicket,
  findTicketsForRecipe,
} from './integrations/resolve.js';
export type { ResolveOptions, ResolveResult, TicketKnowledgeEntry } from './integrations/resolve.js';

// Recipe composition — chain recipes like Unix pipes
export { pipe, parallel, branch, repeat, compose, toMermaid, toMarkdown } from './recipe/compose.js';
export type { ComposedRecipe, CompositionNode, CompositionMode, CompositionResult } from './recipe/compose.js';

// Agent memory — long-term memory layer for AI coding agents
export { AgentMemory, getAgentMemory } from './memory/index.js';
export type { MemoryEntry, RecallResult, RecallOptions } from './memory/index.js';

// Utilities
export { contentHash, generateId, sessionBranchName } from './utils/hash.js';
export { isGitRepo, createGit } from './utils/git.js';
