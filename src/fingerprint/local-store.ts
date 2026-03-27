/**
 * Local Fingerprint Store
 *
 * Persists fingerprints to .agentgram/fingerprints/store.json
 * Works entirely offline — cloud sync is additive, not required.
 *
 * On sync, pulled fingerprints from the cloud are merged here.
 * On preflight, this store is queried (with optional cloud overlay).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FingerprintRecord, FingerprintStore } from './types.js';

const STORE_VERSION = '1';

export class LocalFingerprintStore {
  private storePath: string;
  private store: FingerprintStore;
  private dirty = false;

  constructor(agentgramDir = '.agentgram') {
    this.storePath = path.join(agentgramDir, 'fingerprints', 'store.json');
    this.store = this.load();
  }

  private load(): FingerprintStore {
    if (fs.existsSync(this.storePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as FingerprintStore;
      } catch {
        // corrupted — start fresh
      }
    }
    return {
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
      fingerprints: [],
    };
  }

  save(): void {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
    this.dirty = false;
  }

  /** Add or merge a fingerprint into the store */
  upsert(fp: FingerprintRecord): 'added' | 'merged' {
    const existing = this.store.fingerprints.find((f) => f.id === fp.id);

    if (existing) {
      existing.occurrences += fp.occurrences;
      existing.lastSeen = fp.lastSeen > existing.lastSeen ? fp.lastSeen : existing.lastSeen;
      existing.estimatedTokensWasted = Math.max(existing.estimatedTokensWasted, fp.estimatedTokensWasted);
      // Prefer the more recent warning/fix
      if (fp.lastSeen > existing.lastSeen) {
        existing.warning = fp.warning;
        if (fp.fix) existing.fix = fp.fix;
      }
      this.dirty = true;
      return 'merged';
    }

    this.store.fingerprints.push({ ...fp });
    this.dirty = true;
    return 'added';
  }

  /** Bulk upsert from cloud sync */
  upsertMany(fingerprints: FingerprintRecord[]): { added: number; merged: number } {
    let added = 0;
    let merged = 0;
    for (const fp of fingerprints) {
      const result = this.upsert(fp);
      if (result === 'added') added++;
      else merged++;
    }
    return { added, merged };
  }

  /** Get all fingerprints for a given domain */
  getByDomain(domain: string): FingerprintRecord[] {
    return this.store.fingerprints.filter((fp) => fp.domain === domain);
  }

  /** Get all fingerprints that share at least one tag */
  getByTags(tags: string[]): FingerprintRecord[] {
    const tagSet = new Set(tags);
    return this.store.fingerprints.filter((fp) =>
      fp.tags.some((t) => tagSet.has(t))
    );
  }

  /** Get all fingerprints sorted by occurrences (most common first) */
  getAll(): FingerprintRecord[] {
    return [...this.store.fingerprints].sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Get fingerprints not yet uploaded to cloud */
  getPendingSync(): FingerprintRecord[] {
    // All local-origin fingerprints with occurrences === 1 are candidates
    // In practice, track a "synced" flag. Simple heuristic for now.
    return this.store.fingerprints.filter((fp) => fp.occurrences === 1);
  }

  size(): number {
    return this.store.fingerprints.length;
  }

  stats(): { total: number; byDomain: Record<string, number>; totalWasted: number } {
    const byDomain: Record<string, number> = {};
    let totalWasted = 0;

    for (const fp of this.store.fingerprints) {
      byDomain[fp.domain] = (byDomain[fp.domain] ?? 0) + fp.occurrences;
      totalWasted += fp.estimatedTokensWasted * fp.occurrences;
    }

    return {
      total: this.store.fingerprints.length,
      byDomain,
      totalWasted,
    };
  }
}
