/**
 * Dead-End Fingerprint Database — Types
 *
 * A fingerprint is an anonymized dead-end pattern stripped of any
 * identifying information (file paths, variable names, company tokens)
 * so it can be safely shared across the agentgram network.
 *
 * The value proposition: every dead end you contribute makes the
 * preflight warnings smarter for every other user.
 */

export interface FingerprintRecord {
  /** Deterministic ID: SHA-256 of (operationType + errorPattern + reversalPattern) */
  id: string;

  /** Structural operation type: 'exec', 'create', 'write', 'delete' */
  operationType: string;

  /**
   * Anonymized error pattern. File paths replaced with {path},
   * package names kept (they're public), variable names removed.
   * e.g. "npm install failed: peer dependency conflict"
   */
  errorPattern: string;

  /**
   * What the agent did to recover.
   * e.g. "uninstalled package, switched to alternative"
   */
  reversalPattern: string;

  /**
   * High-level task domain: 'auth', 'payments', 'database', 'devops', etc.
   * Inferred from operation targets and context.
   */
  domain: string;

  /**
   * Structural tags extracted from the dead end.
   * e.g. ['npm', 'peer-dependency', 'install-failure']
   * Never contain PII or company-specific tokens.
   */
  tags: string[];

  /** Estimated tokens wasted on this dead end */
  estimatedTokensWasted: number;

  /** How many times this pattern has been seen (incremented on cloud) */
  occurrences: number;

  /** ISO timestamp when first recorded */
  firstSeen: string;

  /** ISO timestamp when last seen */
  lastSeen: string;

  /**
   * Short human-readable warning for preflight output.
   * Explains what to watch out for and what to do instead.
   */
  warning: string;

  /**
   * The known fix / skip path.
   * Concrete actionable alternative to avoid this dead end.
   */
  fix?: string;
}

export interface FingerprintMatch {
  fingerprint: FingerprintRecord;
  /** Similarity score 0-1 against the preflight task description */
  score: number;
  /** Why this match was returned */
  matchReason: string;
}

export interface FingerprintStore {
  version: string;
  updatedAt: string;
  fingerprints: FingerprintRecord[];
}

export interface PreflightResult {
  task: string;
  matches: FingerprintMatch[];
  /** Total dead ends in the local store */
  totalFingerprints: number;
  /** Whether cloud sync is available */
  cloudSynced: boolean;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  newWarnings: number;
  errors: string[];
}
