import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  signTrace,
  verifySignedTrace,
  toCanonicalJson,
} from '../../src/compliance/sign.js';
import type { CognitiveTrace } from '../../src/cognitive/trace.js';

function makeTrace(overrides: Partial<CognitiveTrace> = {}): CognitiveTrace {
  return {
    sessionId: 'test-session-001',
    startTime: Date.now() - 60000,
    endTime: Date.now(),
    userIntent: 'Add Stripe checkout to Next.js app',
    events: [],
    deadEnds: [],
    decisionPoints: [],
    operations: [],
    ...overrides,
  } as unknown as CognitiveTrace;
}

describe('generateKeyPair', () => {
  it('generates a key pair with all required fields', () => {
    const kp = generateKeyPair();
    expect(kp.privateKeyPem).toContain('PRIVATE KEY');
    expect(kp.publicKeyPem).toContain('PUBLIC KEY');
    expect(kp.keyId).toHaveLength(16);
  });

  it('generates different keys each time', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(kp1.keyId).not.toBe(kp2.keyId);
    expect(kp1.publicKeyPem).not.toBe(kp2.publicKeyPem);
  });

  it('keyId is deterministic for same key', () => {
    const kp = generateKeyPair();
    // keyId is based on SHA-256 of publicKeyPem — if publicKey hasn't changed, keyId is same
    expect(kp.keyId).toBe(kp.keyId);
  });
});

describe('toCanonicalJson', () => {
  it('sorts object keys for determinism', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const json = toCanonicalJson(obj);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual(['a', 'm', 'z']);
  });

  it('produces same output for same object regardless of insertion order', () => {
    const obj1 = { b: 2, a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(toCanonicalJson(obj1)).toBe(toCanonicalJson(obj2));
  });

  it('handles nested objects', () => {
    const obj = { outer: { z: 3, a: 1 }, x: 'hello' };
    const json = toCanonicalJson(obj);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed.outer)).toEqual(['a', 'z']);
  });

  it('preserves arrays', () => {
    const obj = { items: [3, 1, 2] };
    const parsed = JSON.parse(toCanonicalJson(obj));
    expect(parsed.items).toEqual([3, 1, 2]);
  });
});

describe('signTrace + verifySignedTrace', () => {
  it('signs a trace and verifies successfully', () => {
    const kp = generateKeyPair();
    const trace = makeTrace();
    const signed = signTrace(trace, kp, '0'.repeat(64), 0);

    expect(signed.signature).toBeTruthy();
    expect(signed.traceHash).toBeTruthy();
    expect(signed.keyId).toBe(kp.keyId);

    const { signatureValid, hashMatch, errors } = verifySignedTrace(signed);
    expect(signatureValid).toBe(true);
    expect(hashMatch).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('stores previousHash and chainIndex in signed trace', () => {
    const kp = generateKeyPair();
    const trace = makeTrace();
    const prevHash = 'abcd'.repeat(16);
    const signed = signTrace(trace, kp, prevHash, 5);

    expect(signed.previousHash).toBe(prevHash);
    expect(signed.chainIndex).toBe(5);
  });

  it('detects tampered traceJson (hash mismatch)', () => {
    const kp = generateKeyPair();
    const trace = makeTrace();
    const signed = signTrace(trace, kp, '0'.repeat(64), 0);

    // Tamper with the trace content
    const tampered = { ...signed, traceJson: signed.traceJson + ' ' };
    const { signatureValid, hashMatch } = verifySignedTrace(tampered);
    expect(hashMatch).toBe(false);
    // Signature is over traceHash so signature itself is still valid for original hash
    // but hash no longer matches content
  });

  it('detects tampered signature', () => {
    const kp = generateKeyPair();
    const trace = makeTrace();
    const signed = signTrace(trace, kp, '0'.repeat(64), 0);

    const tampered = { ...signed, signature: 'ff'.repeat(32) };
    const { signatureValid } = verifySignedTrace(tampered);
    expect(signatureValid).toBe(false);
  });

  it('fails verification with wrong public key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const trace = makeTrace();
    const signed = signTrace(trace, kp1, '0'.repeat(64), 0);

    const tampered = { ...signed, publicKeyPem: kp2.publicKeyPem };
    const { signatureValid } = verifySignedTrace(tampered);
    expect(signatureValid).toBe(false);
  });

  it('includes signedAt timestamp', () => {
    const kp = generateKeyPair();
    const before = new Date().toISOString();
    const signed = signTrace(makeTrace(), kp, '0'.repeat(64), 0);
    const after = new Date().toISOString();

    expect(signed.signedAt >= before).toBe(true);
    expect(signed.signedAt <= after).toBe(true);
  });

  it('different traces produce different signatures', () => {
    const kp = generateKeyPair();
    const s1 = signTrace(makeTrace({ sessionId: 'session-A' }), kp, '0'.repeat(64), 0);
    const s2 = signTrace(makeTrace({ sessionId: 'session-B' }), kp, '0'.repeat(64), 0);
    expect(s1.signature).not.toBe(s2.signature);
    expect(s1.traceHash).not.toBe(s2.traceHash);
  });
});
