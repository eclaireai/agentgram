/**
 * Core types for agentgram - agentic session replay & journaling
 */

/** Unique identifier for a session */
export type SessionId = string;

/** Unique identifier for an operation within a session */
export type OperationId = string;

/** Types of operations an agent can perform */
export type OperationType = 'read' | 'write' | 'exec' | 'delete' | 'create';

/** A single tracked operation in an agent session */
export interface Operation {
  id: OperationId;
  type: OperationType;
  timestamp: number;
  /** File path or command */
  target: string;
  /** For reads: content hash. For writes: before/after hash. For exec: command. */
  metadata: OperationMetadata;
  /** Human-readable reason for this operation */
  reason?: string;
  /** IDs of operations that causally influenced this one */
  causedBy: OperationId[];
}

export interface OperationMetadata {
  /** Content hash before operation (writes/deletes) */
  beforeHash?: string;
  /** Content hash after operation (writes/creates) */
  afterHash?: string;
  /** Content hash at time of read */
  contentHash?: string;
  /** Lines read (for partial reads) */
  linesRead?: [number, number];
  /** Command executed */
  command?: string;
  /** Exit code for exec operations */
  exitCode?: number;
  /** Stdout/stderr for exec operations */
  output?: string;
  /** Diff patch for writes */
  patch?: string;
}

/** Session state */
export type SessionState = 'recording' | 'stopped' | 'replaying';

/** A complete agent session */
export interface Session {
  id: SessionId;
  name: string;
  state: SessionState;
  startedAt: number;
  stoppedAt?: number;
  operations: Operation[];
  /** Git branch name for shadow worktree */
  branch: string;
  /** Base commit the session branched from */
  baseCommit: string;
  /** Working directory */
  cwd: string;
}

/** A node in the causal provenance graph */
export interface ProvenanceNode {
  operationId: OperationId;
  target: string;
  type: OperationType;
  timestamp: number;
}

/** An edge in the causal provenance graph */
export interface ProvenanceEdge {
  from: OperationId;
  to: OperationId;
  /** Why this causal link exists */
  relation: 'informed' | 'modified' | 'triggered' | 'depends_on';
}

/** The full causal provenance graph */
export interface ProvenanceGraph {
  sessionId: SessionId;
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
}

/** A step in a distilled recipe */
export interface RecipeStep {
  action: OperationType | 'find' | 'add_dependency' | 'create_file' | 'modify_file' | 'run_command';
  target: string;
  description: string;
  /** Pattern to match (for parameterized recipes) */
  pattern?: string;
  /** Expected outcome */
  expect?: string;
}

/** A distilled, reusable recipe */
export interface Recipe {
  name: string;
  description: string;
  /** Distilled from this session */
  sourceSessionId: SessionId;
  /** High-level steps */
  steps: RecipeStep[];
  /** Parameters that can be customized */
  parameters: Record<string, string>;
  /** Tags for discovery */
  tags: string[];
  version: string;
}

/** Configuration for agentgram */
export interface AgentraceConfig {
  /** Directory for storing session data */
  dataDir: string;
  /** Auto-commit on every operation */
  autoCommit: boolean;
  /** Include file content in operation metadata */
  trackContent: boolean;
  /** Maximum operations per session before auto-archiving */
  maxOperations: number;
  /** Git author for micro-commits */
  gitAuthor: { name: string; email: string };
}

export const DEFAULT_CONFIG: AgentraceConfig = {
  dataDir: '.agentgram',
  autoCommit: true,
  trackContent: true,
  maxOperations: 10000,
  gitAuthor: { name: 'agentgram', email: 'agentgram@local' },
};

/** Events emitted during session recording */
export type SessionEvent =
  | { type: 'operation'; operation: Operation }
  | { type: 'commit'; hash: string; message: string }
  | { type: 'session_start'; sessionId: SessionId }
  | { type: 'session_stop'; sessionId: SessionId }
  | { type: 'error'; error: Error };
