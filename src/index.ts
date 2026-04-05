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

// Cognitive trace — Tier 3: captures the WHY behind every agent action
export {
  CognitiveTraceBuilder,
  detectDeadEnds,
  extractReasoning,
  detectDecisionPoint,
  distillCognitiveRecipe,
  cognitiveTraceToMarkdown,
} from './cognitive/trace.js';
export type {
  CognitiveTrace,
  CognitiveEvent,
  CognitiveRecipeStep,
  ReasoningTurn,
  DecisionPoint,
  DeadEnd,
} from './cognitive/trace.js';

export {
  handleCognitiveCapture,
  finalizeCognitiveTrace,
  loadCognitiveTrace,
  appendCognitiveEvent,
  replayFromLog,
} from './cognitive/capture.js';
export type { ClaudeCodeHookPayload } from './cognitive/capture.js';

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

// Dead-End Fingerprint Database — crowdsourced warning system
export { anonymizeDeadEnd, anonymizeDeadEnds, LocalFingerprintStore, matchFingerprints, preflight, formatPreflightResult, extractAndStore, syncWithCloud, createCloudClient } from './fingerprint/index.js';
export type { FingerprintRecord, FingerprintMatch, PreflightResult, SyncResult } from './fingerprint/types.js';

// TraceVault — compliance replay & tamper-evident audit trail
export { generateKeyPair, loadOrCreateKeyPair, signTrace, verifySignedTrace, buildChain, verifyChain, chainSummary, generateAuditReport, formatAuditReportMarkdown, exportComplianceBundle, verifyComplianceBundle } from './compliance/index.js';
export type { KeyPair, SignedTrace, MerkleNode, AuditReport, ComplianceBundle, VerificationResult } from './compliance/types.js';

// EU AI Act compliance documentation generator
export { generateEuAiActReport, formatEuAiActReportMarkdown, formatEuAiActReportJson } from './compliance/eu-ai-act.js';
export type { EuAiActReport, EuAiActSection } from './compliance/eu-ai-act.js';

// Project context — auto-maintained memory file for agent briefing
export { ProjectContextManager, refreshProjectContext } from './memory/project-context.js';
export type { ProjectContext, ProjectDecision } from './memory/project-context.js';

// Recipe economy — premium recipes, drift detection, marketplace
export { detectRecipeDrift, formatEarningsReport, formatMarketplaceListing } from './recipe/premium.js';
export type { PremiumRecipeMetadata, DriftReport, DriftWarning } from './recipe/premium.js';

// Deterministic Replay Tapes — minimal-footprint session replay
export { TapeRecorder, TapePlayer, sessionToTape } from './replay/index.js';
export type { TapeEntry, ReplayTape, TapeStats, ReplayFrame } from './replay/types.js';

// Interactive Time-Travel Debugger
export { generateDebuggerHtml } from './viz/html.js';

// Prediction API — oracle layer for AI tools
export { PredictionEngine, AgentgramClient, predict, ApiKeyStore, RateLimiter, createPredictServer, startPredictServer, extractOutcome, extractAllOutcomes, inferStack, bootstrapModel, DEV_API_KEY } from './predict/index.js';
export type { PredictionRequest, PredictionResult, RiskFactor, StackContext, SessionOutcome, PredictionModel } from './predict/types.js';
