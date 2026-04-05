/**
 * API Key Management for the Prediction API
 *
 * Keys are stored in .agentgram/predict/keys.json.
 * Only SHA-256 hashes of raw keys are persisted — the raw key is shown once on creation.
 *
 * Key format: agk_ + 32 random hex chars (via crypto.randomBytes)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type KeyTier = 'free' | 'pro' | 'enterprise';

export interface ApiKey {
  /** 'agk_' + 32 hex chars — NEVER persisted, shown once */
  key: string;
  /** Human-readable label e.g. "Cursor integration" */
  name: string;
  tier: KeyTier;
  createdAt: string;
  lastUsedAt?: string;
  requestCount: number;
  /** SHA-256 hex of the raw key — what we actually store */
  keyHash: string;
}

interface KeyStore {
  version: string;
  updatedAt: string;
  keys: Omit<ApiKey, 'key'>[];
}

const STORE_VERSION = '1';

// ---------------------------------------------------------------------------
// Dev key — always valid locally, never persisted
// ---------------------------------------------------------------------------

export const DEV_API_KEY = 'agk_dev_local_only_not_for_production';

const DEV_KEY_HASH = crypto
  .createHash('sha256')
  .update(DEV_API_KEY)
  .digest('hex');

const DEV_KEY_RECORD: ApiKey = {
  key: DEV_API_KEY,
  keyHash: DEV_KEY_HASH,
  name: 'dev-local',
  tier: 'free',
  createdAt: '2024-01-01T00:00:00.000Z',
  requestCount: 0,
};

// ---------------------------------------------------------------------------
// ApiKeyStore
// ---------------------------------------------------------------------------

export class ApiKeyStore {
  private storePath: string;
  private store: KeyStore;

  constructor(agentgramDir = '.agentgram') {
    this.storePath = path.join(agentgramDir, 'predict', 'keys.json');
    this.store = this.load();
  }

  private load(): KeyStore {
    if (fs.existsSync(this.storePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as KeyStore;
      } catch {
        // corrupted — start fresh
      }
    }
    return { version: STORE_VERSION, updatedAt: new Date().toISOString(), keys: [] };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  /**
   * Generate a new API key, persist its hash, and return the raw key once.
   */
  createKey(name: string, tier: KeyTier): { key: string; record: ApiKey } {
    const rawKey = 'agk_' + crypto.randomBytes(16).toString('hex');
    const keyHash = this.hashKey(rawKey);

    const record: Omit<ApiKey, 'key'> = {
      keyHash,
      name,
      tier,
      createdAt: new Date().toISOString(),
      requestCount: 0,
    };

    this.store.keys.push(record);
    this.save();

    return {
      key: rawKey,
      record: { key: rawKey, ...record },
    };
  }

  /**
   * Validate a raw API key.
   * Returns the ApiKey record (without raw key) if valid, or null.
   */
  validate(rawKey: string): ApiKey | null {
    // Dev key always works
    if (rawKey === DEV_API_KEY) {
      return { ...DEV_KEY_RECORD };
    }

    const hash = this.hashKey(rawKey);
    const found = this.store.keys.find((k) => k.keyHash === hash);
    if (!found) return null;

    // Return a copy without injecting the raw key (we don't have it)
    return { key: '', ...found };
  }

  /**
   * Bump usage counters and last-used timestamp.
   */
  recordUsage(keyHash: string): void {
    // Dev key — don't persist
    if (keyHash === DEV_KEY_HASH) return;

    const found = this.store.keys.find((k) => k.keyHash === keyHash);
    if (!found) return;

    found.requestCount += 1;
    found.lastUsedAt = new Date().toISOString();
    this.save();
  }

  /**
   * List all stored keys (hashes only, never raw keys).
   */
  listKeys(): ApiKey[] {
    return this.store.keys.map((k) => ({ key: '', ...k }));
  }

  /**
   * Resolve tier for rate limiting.
   */
  getTier(rawKey: string): KeyTier | null {
    const record = this.validate(rawKey);
    return record ? record.tier : null;
  }
}
