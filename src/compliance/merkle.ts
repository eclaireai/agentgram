/**
 * Merkle Chain — Tamper-Evident Chain of Compliance Records
 *
 * Each node contains the hash of (traceHash + previousNodeHash + chainIndex).
 * Deleting or modifying any trace breaks the chain — immediately detectable.
 *
 * NOT a full Merkle tree — this is a hash chain (like a blockchain).
 * Chosen for simplicity and auditability: any auditor can verify by hand.
 */

import { createHash } from 'node:crypto';
import type { MerkleNode, SignedTrace } from './types.js';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Build a chain node from a signed trace
// ---------------------------------------------------------------------------

export function buildNode(signed: SignedTrace, previousNodeHash: string): MerkleNode {
  const nodeInput = `${signed.traceHash}::${previousNodeHash}::${signed.chainIndex}`;
  const nodeHash = createHash('sha256').update(nodeInput).digest('hex');

  // Extract sessionId from traceJson
  let sessionId = `session-${signed.chainIndex}`;
  try {
    const trace = JSON.parse(signed.traceJson) as { sessionId?: string };
    if (trace.sessionId) sessionId = trace.sessionId;
  } catch { /* ignore parse errors */ }

  return {
    index: signed.chainIndex,
    sessionId,
    nodeHash,
    previousNodeHash,
    timestamp: signed.signedAt,
  };
}

// ---------------------------------------------------------------------------
// Build chain from array of signed traces (must be in order)
// ---------------------------------------------------------------------------

export function buildChain(signedTraces: SignedTrace[]): MerkleNode[] {
  const chain: MerkleNode[] = [];
  let previousNodeHash = GENESIS_HASH;

  for (const signed of signedTraces) {
    const node = buildNode(signed, previousNodeHash);
    chain.push(node);
    previousNodeHash = node.nodeHash;
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Verify chain integrity
// ---------------------------------------------------------------------------

export interface ChainVerification {
  intact: boolean;
  length: number;
  firstBrokenIndex?: number;
  errors: string[];
}

export function verifyChain(
  chain: MerkleNode[],
  signedTraces: SignedTrace[],
): ChainVerification {
  const errors: string[] = [];

  if (chain.length !== signedTraces.length) {
    return {
      intact: false,
      length: chain.length,
      errors: [`Chain length ${chain.length} !== traces count ${signedTraces.length}`],
    };
  }

  let previousNodeHash = GENESIS_HASH;

  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    const signed = signedTraces[i]!;

    // Verify previous hash linkage
    if (node.previousNodeHash !== previousNodeHash) {
      errors.push(`Chain broken at index ${i}: previousHash mismatch`);
      return { intact: false, length: chain.length, firstBrokenIndex: i, errors };
    }

    // Verify node hash
    const nodeInput = `${signed.traceHash}::${previousNodeHash}::${node.index}`;
    const computedNodeHash = createHash('sha256').update(nodeInput).digest('hex');
    if (computedNodeHash !== node.nodeHash) {
      errors.push(`Node hash mismatch at index ${i}`);
      return { intact: false, length: chain.length, firstBrokenIndex: i, errors };
    }

    // Verify chain index matches
    if (node.index !== i) {
      errors.push(`Index mismatch at position ${i}: node.index is ${node.index}`);
      return { intact: false, length: chain.length, firstBrokenIndex: i, errors };
    }

    previousNodeHash = node.nodeHash;
  }

  return { intact: true, length: chain.length, errors: [] };
}

// ---------------------------------------------------------------------------
// Chain summary
// ---------------------------------------------------------------------------

export function chainSummary(chain: MerkleNode[]): {
  length: number;
  headHash: string;
  genesisTimestamp: string;
  headTimestamp: string;
} {
  if (chain.length === 0) {
    return { length: 0, headHash: GENESIS_HASH, genesisTimestamp: '', headTimestamp: '' };
  }

  return {
    length: chain.length,
    headHash: chain[chain.length - 1]!.nodeHash,
    genesisTimestamp: chain[0]!.timestamp,
    headTimestamp: chain[chain.length - 1]!.timestamp,
  };
}
