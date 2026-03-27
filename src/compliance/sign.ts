/**
 * Ed25519 Signing — Cryptographic layer for compliance traces
 *
 * Uses Node.js built-in crypto — no external dependencies.
 * Ed25519 chosen for: small key size, fast verification, strong security,
 * and deterministic signatures (no nonce required).
 */

import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { KeyPair, SignedTrace } from './types.js';
import type { CognitiveTrace } from '../cognitive/trace.js';

// ---------------------------------------------------------------------------
// Key generation & storage
// ---------------------------------------------------------------------------

export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const keyId = createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 16);

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    keyId,
  };
}

const KEY_DIR_DEFAULT = path.join(process.env['HOME'] ?? '.', '.agentgram', 'keys');

export function saveKeyPair(keyPair: KeyPair, dir = KEY_DIR_DEFAULT): void {
  fs.mkdirSync(dir, { recursive: true });
  // Private key: chmod 600
  const privPath = path.join(dir, `${keyPair.keyId}.private.pem`);
  fs.writeFileSync(privPath, keyPair.privateKeyPem, { mode: 0o600 });
  // Public key: readable
  fs.writeFileSync(path.join(dir, `${keyPair.keyId}.public.pem`), keyPair.publicKeyPem);
  // Active key pointer
  fs.writeFileSync(path.join(dir, 'active'), keyPair.keyId);
}

export function loadActiveKeyPair(dir = KEY_DIR_DEFAULT): KeyPair | null {
  const activePath = path.join(dir, 'active');
  if (!fs.existsSync(activePath)) return null;

  const keyId = fs.readFileSync(activePath, 'utf8').trim();
  const privPath = path.join(dir, `${keyId}.private.pem`);
  const pubPath = path.join(dir, `${keyId}.public.pem`);

  if (!fs.existsSync(privPath) || !fs.existsSync(pubPath)) return null;

  return {
    privateKeyPem: fs.readFileSync(privPath, 'utf8'),
    publicKeyPem: fs.readFileSync(pubPath, 'utf8'),
    keyId,
  };
}

export function loadOrCreateKeyPair(dir = KEY_DIR_DEFAULT): KeyPair {
  const existing = loadActiveKeyPair(dir);
  if (existing) return existing;
  const kp = generateKeyPair();
  saveKeyPair(kp, dir);
  return kp;
}

// ---------------------------------------------------------------------------
// Canonical JSON — deterministic serialization for signing
// ---------------------------------------------------------------------------

export function toCanonicalJson(obj: unknown): string {
  // Sort keys for determinism
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// Sign a cognitive trace
// ---------------------------------------------------------------------------

export function signTrace(
  trace: CognitiveTrace,
  keyPair: KeyPair,
  previousHash: string,
  chainIndex: number,
): SignedTrace {
  const traceJson = toCanonicalJson(trace);
  const traceHash = createHash('sha256').update(traceJson).digest('hex');

  // Ed25519: pass null as algorithm — Node.js handles hashing internally
  const signature = cryptoSign(null, Buffer.from(traceHash), keyPair.privateKeyPem).toString('hex');

  return {
    traceJson,
    traceHash,
    signature,
    publicKeyPem: keyPair.publicKeyPem,
    keyId: keyPair.keyId,
    signedAt: new Date().toISOString(),
    previousHash,
    chainIndex,
  };
}

// ---------------------------------------------------------------------------
// Verify a signed trace
// ---------------------------------------------------------------------------

export function verifySignedTrace(signed: SignedTrace): {
  signatureValid: boolean;
  hashMatch: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Verify hash
  const computedHash = createHash('sha256').update(signed.traceJson).digest('hex');
  const hashMatch = computedHash === signed.traceHash;
  if (!hashMatch) {
    errors.push(`Hash mismatch: expected ${signed.traceHash}, got ${computedHash}`);
  }

  // Verify signature
  let signatureValid = false;
  try {
    signatureValid = cryptoVerify(
      null,
      Buffer.from(signed.traceHash),
      signed.publicKeyPem,
      Buffer.from(signed.signature, 'hex'),
    );
    if (!signatureValid) errors.push('Signature verification failed');
  } catch (err) {
    signatureValid = false;
    errors.push(`Signature error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { signatureValid, hashMatch, errors };
}
