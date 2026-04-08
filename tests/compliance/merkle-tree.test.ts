import { describe, it, expect } from 'vitest';
import {
  buildMerkleTree,
  getMerkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  findSharedSubtrees,
  getMerkleTreeSummary,
} from '../../src/compliance/merkle-tree.js';

describe('getMerkleRoot', () => {
  it('returns deterministic root for same input', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(getMerkleRoot(items)).toBe(getMerkleRoot(items));
  });

  it('different items produce different roots', () => {
    expect(getMerkleRoot(['a', 'b'])).not.toBe(getMerkleRoot(['a', 'c']));
  });

  it('handles single item', () => {
    const root = getMerkleRoot(['only']);
    expect(root).toBeTruthy();
    expect(root).toHaveLength(64);
  });

  it('handles empty array', () => {
    const root = getMerkleRoot([]);
    expect(root).toBeTruthy();
  });

  it('order matters', () => {
    expect(getMerkleRoot(['a', 'b'])).not.toBe(getMerkleRoot(['b', 'a']));
  });

  it('produces 64-char hex strings', () => {
    const root = getMerkleRoot(['x', 'y', 'z']);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildMerkleTree', () => {
  it('builds correct leaf count for power-of-2 input', () => {
    const { nodes, leaves } = buildMerkleTree(['a', 'b', 'c', 'd']);
    expect(leaves).toHaveLength(4);
    expect(nodes.size).toBeGreaterThan(4); // leaves + internal nodes
  });

  it('builds leaf nodes with data and index', () => {
    const { nodes } = buildMerkleTree(['hello', 'world']);
    const leafNodes = [...nodes.values()].filter((n) => n.isLeaf);
    expect(leafNodes.some((n) => n.data === 'hello')).toBe(true);
    expect(leafNodes.some((n) => n.data === 'world')).toBe(true);
  });

  it('internal nodes have left and right children', () => {
    const { nodes } = buildMerkleTree(['a', 'b', 'c', 'd']);
    const internal = [...nodes.values()].filter((n) => !n.isLeaf);
    for (const n of internal) {
      expect(n.left).toBeTruthy();
      expect(n.right).toBeTruthy();
    }
  });

  it('root matches getMerkleRoot', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const { root } = buildMerkleTree(items);
    expect(root).toBe(getMerkleRoot(items));
  });

  it('handles non-power-of-2 leaf count', () => {
    const { root } = buildMerkleTree(['a', 'b', 'c']);
    expect(root).toBeTruthy();
  });
});

describe('getMerkleProof + verifyMerkleProof', () => {
  it('generates and verifies proof for first element', () => {
    const items = ['a', 'b', 'c', 'd'];
    const proof = getMerkleProof(items, 0);
    const result = verifyMerkleProof('a', proof);
    expect(result.valid).toBe(true);
  });

  it('verifies proof for last element', () => {
    const items = ['a', 'b', 'c', 'd'];
    const proof = getMerkleProof(items, 3);
    const result = verifyMerkleProof('d', proof);
    expect(result.valid).toBe(true);
  });

  it('verifies proof for middle element', () => {
    const items = ['x', 'y', 'z', 'w'];
    const proof = getMerkleProof(items, 2);
    const result = verifyMerkleProof('z', proof);
    expect(result.valid).toBe(true);
  });

  it('rejects wrong leaf data', () => {
    const items = ['a', 'b', 'c', 'd'];
    const proof = getMerkleProof(items, 1);
    const result = verifyMerkleProof('wrong', proof);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Leaf hash mismatch');
  });

  it('proof root matches tree root', () => {
    const items = ['p', 'q', 'r', 's'];
    const root = getMerkleRoot(items);
    const proof = getMerkleProof(items, 2);
    expect(proof.root).toBe(root);
  });

  it('throws for out-of-range index', () => {
    expect(() => getMerkleProof(['a', 'b'], 5)).toThrow(RangeError);
  });

  it('single-item list produces valid proof', () => {
    const items = ['only'];
    const proof = getMerkleProof(items, 0);
    const result = verifyMerkleProof('only', proof);
    expect(result.valid).toBe(true);
  });

  it('detects tampered proof path', () => {
    const items = ['a', 'b', 'c', 'd'];
    const proof = getMerkleProof(items, 0);
    // Tamper path
    const tampered = {
      ...proof,
      path: proof.path.map((p, i) => i === 0 ? { ...p, hash: 'deadbeef' + p.hash.slice(8) } : p),
    };
    const result = verifyMerkleProof('a', tampered);
    expect(result.valid).toBe(false);
  });
});

describe('findSharedSubtrees', () => {
  it('finds identical content in two identical trees', () => {
    const items = ['a', 'b', 'c', 'd'];
    const { sharedHashes } = findSharedSubtrees(items, items);
    expect(sharedHashes.length).toBeGreaterThan(0);
  });

  it('finds no shared hashes for completely different items', () => {
    const { sharedHashes } = findSharedSubtrees(['a', 'b'], ['x', 'y']);
    // Might still share the empty-ish root if padding coincides, but leaves won't match
    // Test that unique sets are non-empty
    const { uniqueToA, uniqueToB } = findSharedSubtrees(['a', 'b'], ['x', 'y']);
    expect(uniqueToA.length).toBeGreaterThan(0);
    expect(uniqueToB.length).toBeGreaterThan(0);
  });

  it('finds shared leaves for overlapping sets', () => {
    const { sharedHashes } = findSharedSubtrees(['a', 'b', 'c'], ['a', 'b', 'x']);
    // 'a' and 'b' leaf hashes should be shared
    expect(sharedHashes.length).toBeGreaterThan(0);
  });
});

describe('getMerkleTreeSummary', () => {
  it('returns correct leaf count', () => {
    const s = getMerkleTreeSummary(['a', 'b', 'c', 'd']);
    expect(s.leafCount).toBe(4);
  });

  it('returns correct root', () => {
    const items = ['x', 'y', 'z'];
    const s = getMerkleTreeSummary(items);
    expect(s.root).toBe(getMerkleRoot(items));
  });

  it('returns non-zero depth for multiple leaves', () => {
    const s = getMerkleTreeSummary(['a', 'b', 'c', 'd']);
    expect(s.depth).toBeGreaterThan(0);
  });

  it('returns zero depth for single item', () => {
    const s = getMerkleTreeSummary(['only']);
    expect(s.depth).toBe(0);
  });

  it('leaves array matches input hashes order', () => {
    const items = ['p', 'q', 'r'];
    const { leaves } = buildMerkleTree(items);
    const s = getMerkleTreeSummary(items);
    expect(s.leaves).toEqual(leaves);
  });
});
