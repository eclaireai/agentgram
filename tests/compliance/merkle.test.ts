import { describe, it, expect } from 'vitest';
import { buildChain, verifyChain, chainSummary, GENESIS_HASH } from '../../src/compliance/merkle.js';
import { generateKeyPair, signTrace } from '../../src/compliance/sign.js';
import type { CognitiveTrace } from '../../src/cognitive/trace.js';

function makeTrace(id: string): CognitiveTrace {
  return {
    sessionId: id,
    startTime: Date.now(),
    endTime: Date.now() + 1000,
    userIntent: `Task for session ${id}`,
    events: [],
    deadEnds: [],
    decisionPoints: [],
    operations: [],
  } as unknown as CognitiveTrace;
}

function makeSignedTraces(count: number) {
  const kp = generateKeyPair();
  const traces = Array.from({ length: count }, (_, i) => makeTrace(`session-${i}`));
  const signedTraces = [];
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < traces.length; i++) {
    const signed = signTrace(traces[i]!, kp, prevHash, i);
    signedTraces.push(signed);
    prevHash = signed.traceHash;
  }

  return signedTraces;
}

describe('buildChain', () => {
  it('builds an empty chain for empty input', () => {
    expect(buildChain([])).toEqual([]);
  });

  it('builds a chain with correct length', () => {
    const signedTraces = makeSignedTraces(3);
    const chain = buildChain(signedTraces);
    expect(chain).toHaveLength(3);
  });

  it('first node has GENESIS as previousNodeHash', () => {
    const signedTraces = makeSignedTraces(1);
    const chain = buildChain(signedTraces);
    expect(chain[0]!.previousNodeHash).toBe(GENESIS_HASH);
  });

  it('each node links to previous node hash', () => {
    const signedTraces = makeSignedTraces(4);
    const chain = buildChain(signedTraces);

    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.previousNodeHash).toBe(chain[i - 1]!.nodeHash);
    }
  });

  it('assigns correct index to each node', () => {
    const signedTraces = makeSignedTraces(3);
    const chain = buildChain(signedTraces);
    chain.forEach((node, i) => {
      expect(node.index).toBe(i);
    });
  });

  it('each node has a unique nodeHash', () => {
    const signedTraces = makeSignedTraces(5);
    const chain = buildChain(signedTraces);
    const hashes = chain.map((n) => n.nodeHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(5);
  });

  it('node hashes are deterministic for same input', () => {
    const signedTraces = makeSignedTraces(3);
    const chain1 = buildChain(signedTraces);
    const chain2 = buildChain(signedTraces);
    chain1.forEach((node, i) => {
      expect(node.nodeHash).toBe(chain2[i]!.nodeHash);
    });
  });
});

describe('verifyChain', () => {
  it('verifies a valid chain as intact', () => {
    const signedTraces = makeSignedTraces(5);
    const chain = buildChain(signedTraces);
    const result = verifyChain(chain, signedTraces);
    expect(result.intact).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects chain/traces length mismatch', () => {
    const signedTraces = makeSignedTraces(3);
    const chain = buildChain(signedTraces);
    const result = verifyChain(chain.slice(0, 2), signedTraces);
    expect(result.intact).toBe(false);
  });

  it('detects tampered node hash', () => {
    const signedTraces = makeSignedTraces(3);
    const chain = buildChain(signedTraces);

    // Tamper with middle node
    const tampered = chain.map((n, i) =>
      i === 1 ? { ...n, nodeHash: 'tampered' + n.nodeHash.slice(8) } : n
    );
    const result = verifyChain(tampered, signedTraces);
    expect(result.intact).toBe(false);
  });

  it('detects broken previous hash link', () => {
    const signedTraces = makeSignedTraces(4);
    const chain = buildChain(signedTraces);

    // Break the link in node 2
    const tampered = chain.map((n, i) =>
      i === 2 ? { ...n, previousNodeHash: 'wronghash' + n.previousNodeHash.slice(9) } : n
    );
    const result = verifyChain(tampered, signedTraces);
    expect(result.intact).toBe(false);
    expect(result.firstBrokenIndex).toBe(2);
  });

  it('returns length of chain', () => {
    const signedTraces = makeSignedTraces(7);
    const chain = buildChain(signedTraces);
    const result = verifyChain(chain, signedTraces);
    expect(result.length).toBe(7);
  });

  it('verifies empty chain', () => {
    const result = verifyChain([], []);
    expect(result.intact).toBe(true);
  });
});

describe('chainSummary', () => {
  it('returns zero-length summary for empty chain', () => {
    const s = chainSummary([]);
    expect(s.length).toBe(0);
    expect(s.headHash).toBe(GENESIS_HASH);
  });

  it('returns correct length and headHash', () => {
    const signedTraces = makeSignedTraces(3);
    const chain = buildChain(signedTraces);
    const s = chainSummary(chain);
    expect(s.length).toBe(3);
    expect(s.headHash).toBe(chain[2]!.nodeHash);
  });

  it('includes genesis and head timestamps', () => {
    const signedTraces = makeSignedTraces(2);
    const chain = buildChain(signedTraces);
    const s = chainSummary(chain);
    expect(s.genesisTimestamp).toBeTruthy();
    expect(s.headTimestamp).toBeTruthy();
  });
});
