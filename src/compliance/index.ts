/**
 * TraceVault — Compliance Layer Public API
 */

export type {
  KeyPair,
  SignedTrace,
  MerkleNode,
  AuditReport,
  ComplianceBundle,
  VerificationResult,
} from './types.js';

export {
  generateKeyPair,
  saveKeyPair,
  loadActiveKeyPair,
  loadOrCreateKeyPair,
  signTrace,
  verifySignedTrace,
  toCanonicalJson,
} from './sign.js';

export {
  buildNode,
  buildChain,
  verifyChain,
  chainSummary,
  GENESIS_HASH,
} from './merkle.js';

export {
  generateAuditReport,
  formatAuditReportMarkdown,
  formatAuditReportJson,
} from './report.js';

export {
  exportComplianceBundle,
  verifyComplianceBundle,
} from './export.js';
