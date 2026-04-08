/**
 * Full Binary Merkle Tree — Content-Addressable Session Graph
 *
 * Upgrades from the linear hash chain (merkle.ts) to a proper binary
 * Merkle tree. This enables:
 *  - Sub-session deduplication: if two sessions share a common subtree,
 *    they share the same sub-root hash and need not be re-verified.
 *  - Proof of inclusion: prove a leaf exists in the tree with O(log n) hashes.
 *  - Partial verification: verify a subset of sessions without re-hashing all.
 *
 * The linear chain remains in merkle.ts for backward compat.
 * This module adds the full tree on top.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A node in the Merkle tree */
export interface MerkleTreeNode {
  /** SHA-256 hash of this node */
  hash: string;
  /** Left child hash (undefined for leaf nodes) */
  left?: string;
  /** Right child hash (undefined for leaf nodes) */
  right?: string;
  /** True if this is a leaf node */
  isLeaf: boolean;
  /** Original leaf data (only set for leaf nodes) */
  data?: string;
  /** 0-based index of the leaf in the original array (only for leaves) */
  leafIndex?: number;
}

/** A Merkle proof: list of sibling hashes from leaf to root */
export interface MerkleProof {
  /** Hash of the leaf being proven */
  leafHash: string;
  /** Index of the leaf in the original array */
  leafIndex: number;
  /** Sibling hashes from leaf to root, with direction */
  path: Array<{ hash: string; direction: 'left' | 'right' }>;
  /** Root hash of the tree */
  root: string;
}

/** Result of verifying a Merkle proof */
export interface ProofVerification {
  valid: boolean;
  computedRoot: string;
  expectedRoot: string;
  error?: string;
}

/** Summary of a built tree */
export interface MerkleTreeSummary {
  root: string;
  leafCount: number;
  nodeCount: number;
  depth: number;
  /** Leaf hashes in order */
  leaves: string[];
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Hash a leaf node: H('leaf' + data) */
function hashLeaf(data: string): string {
  return sha256('leaf:' + data);
}

/** Hash an internal node: H('node' + leftHash + rightHash) */
function hashNode(left: string, right: string): string {
  return sha256('node:' + left + right);
}

// ---------------------------------------------------------------------------
// Build the tree
// ---------------------------------------------------------------------------

/**
 * Build a full binary Merkle tree from an array of data items.
 *
 * If the number of leaves is not a power of 2, the last leaf is
 * duplicated to fill the tree (standard Bitcoin-style padding).
 *
 * Returns all nodes (leaves + internal) keyed by their hash.
 * Call `getMerkleRoot(items)` for just the root hash.
 */
export function buildMerkleTree(items: string[]): {
  nodes: Map<string, MerkleTreeNode>;
  root: string;
  leaves: string[];
} {
  if (items.length === 0) {
    const emptyHash = sha256('empty_tree');
    return {
      nodes: new Map([[emptyHash, { hash: emptyHash, isLeaf: true, data: '', leafIndex: 0 }]]),
      root: emptyHash,
      leaves: [],
    };
  }

  const nodes = new Map<string, MerkleTreeNode>();

  // Create leaf nodes
  let level: string[] = items.map((item, i) => {
    const h = hashLeaf(item);
    nodes.set(h, { hash: h, isLeaf: true, data: item, leafIndex: i });
    return h;
  });

  const leaves = [...level];

  // Build up the tree level by level
  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      const leftHash = level[i]!;
      // Duplicate last node if odd number (standard Merkle padding)
      const rightHash = level[i + 1] ?? leftHash;

      const parentHash = hashNode(leftHash, rightHash);
      nodes.set(parentHash, {
        hash: parentHash,
        left: leftHash,
        right: rightHash,
        isLeaf: false,
      });

      nextLevel.push(parentHash);
    }

    level = nextLevel;
  }

  return { nodes, root: level[0]!, leaves };
}

// ---------------------------------------------------------------------------
// Root hash (fast path)
// ---------------------------------------------------------------------------

/**
 * Compute only the Merkle root hash from an array of items.
 * More efficient than buildMerkleTree when you only need the root.
 */
export function getMerkleRoot(items: string[]): string {
  if (items.length === 0) return sha256('empty_tree');

  let level = items.map(hashLeaf);

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hashNode(level[i]!, level[i + 1] ?? level[i]!));
    }
    level = next;
  }

  return level[0]!;
}

// ---------------------------------------------------------------------------
// Proof generation and verification
// ---------------------------------------------------------------------------

/**
 * Generate a Merkle inclusion proof for the item at `index`.
 *
 * The proof is a list of sibling hashes from the leaf to the root.
 * To verify: start with hashLeaf(item), then for each step hash
 * (sibling, current) or (current, sibling) depending on direction.
 */
export function getMerkleProof(items: string[], index: number): MerkleProof {
  if (index < 0 || index >= items.length) {
    throw new RangeError(`Index ${index} out of range for ${items.length} items`);
  }

  const leafHash = hashLeaf(items[index]!);
  const root = getMerkleRoot(items);
  const path: MerkleProof['path'] = [];

  let level = items.map(hashLeaf);
  let idx = index;

  while (level.length > 1) {
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    const siblingHash = level[siblingIdx] ?? level[idx]!; // padding

    path.push({
      hash: siblingHash,
      direction: isRightNode ? 'left' : 'right',
    });

    // Move up to parent level
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hashNode(level[i]!, level[i + 1] ?? level[i]!));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }

  return { leafHash, leafIndex: index, path, root };
}

/**
 * Verify a Merkle proof.
 *
 * Recomputes the root from the leaf hash + sibling path and
 * checks it matches the claimed root.
 */
export function verifyMerkleProof(
  leafData: string,
  proof: MerkleProof,
): ProofVerification {
  const computedLeaf = hashLeaf(leafData);

  if (computedLeaf !== proof.leafHash) {
    return {
      valid: false,
      computedRoot: '',
      expectedRoot: proof.root,
      error: `Leaf hash mismatch: computed=${computedLeaf} proof=${proof.leafHash}`,
    };
  }

  let current = computedLeaf;

  for (const step of proof.path) {
    if (step.direction === 'left') {
      // sibling is on the left
      current = hashNode(step.hash, current);
    } else {
      // sibling is on the right
      current = hashNode(current, step.hash);
    }
  }

  return {
    valid: current === proof.root,
    computedRoot: current,
    expectedRoot: proof.root,
    error: current !== proof.root
      ? `Root mismatch: computed=${current} expected=${proof.root}`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Sub-session deduplication
// ---------------------------------------------------------------------------

/**
 * Check whether two sets of sessions share a common sub-tree.
 *
 * Returns the shared sub-root hashes (if any).
 * Shared sub-trees do not need re-verification — if you trust the root,
 * and the sub-root appears identically in both trees, the sub-tree is identical.
 */
export function findSharedSubtrees(
  itemsA: string[],
  itemsB: string[],
): { sharedHashes: string[]; uniqueToA: string[]; uniqueToB: string[] } {
  const { nodes: nodesA } = buildMerkleTree(itemsA);
  const { nodes: nodesB } = buildMerkleTree(itemsB);

  const hashesA = new Set(nodesA.keys());
  const hashesB = new Set(nodesB.keys());

  const sharedHashes: string[] = [];
  const uniqueToA: string[] = [];
  const uniqueToB: string[] = [];

  for (const h of hashesA) {
    if (hashesB.has(h)) {
      sharedHashes.push(h);
    } else {
      uniqueToA.push(h);
    }
  }

  for (const h of hashesB) {
    if (!hashesA.has(h)) {
      uniqueToB.push(h);
    }
  }

  return { sharedHashes, uniqueToA, uniqueToB };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function getMerkleTreeSummary(items: string[]): MerkleTreeSummary {
  const { nodes, root, leaves } = buildMerkleTree(items);

  // Compute depth: log2(nextPowerOf2(leafCount))
  const depth = items.length <= 1 ? 0 : Math.ceil(Math.log2(items.length));

  return {
    root,
    leafCount: items.length,
    nodeCount: nodes.size,
    depth,
    leaves,
  };
}
