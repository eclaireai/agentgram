/**
 * TraceVault — Compliance Types
 *
 * Immutable, cryptographically signed records of AI agent activity.
 * Every cognitive trace that passes through agentgram can be signed,
 * chained, and exported into a tamper-evident compliance bundle.
 *
 * Designed to satisfy: SOC2 Type II, HIPAA audit controls,
 * FedRAMP Revision 5 AU-2/AU-3, and ISO 27001 A.12.4.
 */


// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

export interface KeyPair {
  /** Ed25519 private key — PEM format. NEVER exported in audit reports. */
  privateKeyPem: string;
  /** Ed25519 public key — PEM format. Included in every signed trace. */
  publicKeyPem: string;
  /** SHA-256 fingerprint of public key — short ID for humans */
  keyId: string;
}

// ---------------------------------------------------------------------------
// Signed trace
// ---------------------------------------------------------------------------

export interface SignedTrace {
  /** The cognitive trace, serialized to canonical JSON */
  traceJson: string;
  /** SHA-256 hash of traceJson */
  traceHash: string;
  /** Ed25519 signature over traceHash, hex-encoded */
  signature: string;
  /** Public key used for signing, PEM */
  publicKeyPem: string;
  /** Short key ID */
  keyId: string;
  /** ISO timestamp when signed */
  signedAt: string;
  /** SHA-256 hash of the previous trace in the chain (or 'genesis' for first) */
  previousHash: string;
  /** Position in the chain (0-based) */
  chainIndex: number;
}

// ---------------------------------------------------------------------------
// Merkle node — one entry in the tamper-evident chain
// ---------------------------------------------------------------------------

export interface MerkleNode {
  /** Chain index */
  index: number;
  /** Session ID */
  sessionId: string;
  /** SHA-256 hash of (traceHash + previousHash + chainIndex) */
  nodeHash: string;
  /** Hash of previous node (or 'genesis') */
  previousNodeHash: string;
  /** ISO timestamp */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Audit report — what the compliance officer reads
// ---------------------------------------------------------------------------

export interface AuditReport {
  /** Report format version */
  version: '1';
  /** ISO timestamp when report was generated */
  generatedAt: string;
  /** Session ID */
  sessionId: string;
  /** Developer who ran the session (from git config, optional) */
  developer?: string;
  /** Task / intent of the session */
  intent: string;
  /** Files modified */
  filesModified: string[];
  /** Files created */
  filesCreated: string[];
  /** Commands executed */
  commandsExecuted: string[];
  /** Dead ends encountered and resolved */
  deadEnds: Array<{
    description: string;
    resolution: string;
    tokensWasted: number;
  }>;
  /** Decision points — where the agent chose between alternatives */
  decisionPoints: Array<{
    description: string;
    chosen: string;
    alternatives: string[];
  }>;
  /** Signature validity */
  signatureValid: boolean;
  /** Chain integrity */
  chainIntact: boolean;
  /** Key ID used for signing */
  keyId: string;
  /** Signed at timestamp */
  signedAt: string;
  /** Chain index */
  chainIndex: number;
  /** Short summary for non-technical readers */
  summary: string;
}

// ---------------------------------------------------------------------------
// Compliance export bundle
// ---------------------------------------------------------------------------

export interface ComplianceBundle {
  version: '1';
  exportedAt: string;
  /** Who exported (from git config) */
  exportedBy?: string;
  signedTraces: SignedTrace[];
  merkleChain: MerkleNode[];
  reports: AuditReport[];
  /** SHA-256 of the entire bundle JSON (excluding this field) */
  bundleHash?: string;
}

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  sessionId: string;
  signatureValid: boolean;
  chainIntact: boolean;
  hashMatch: boolean;
  errors: string[];
}
