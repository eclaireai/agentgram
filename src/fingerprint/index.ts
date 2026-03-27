/**
 * Dead-End Fingerprint Database — Public API
 */

export type {
  FingerprintRecord,
  FingerprintMatch,
  FingerprintStore,
  PreflightResult,
  SyncResult,
} from './types.js';

export { anonymizeDeadEnd, anonymizeDeadEnds } from './anonymize.js';
export { LocalFingerprintStore } from './local-store.js';
export { matchFingerprints, preflight, formatPreflightResult } from './match.js';
export { HttpCloudClient, OfflineCloudClient, createCloudClient } from './client.js';

import { LocalFingerprintStore } from './local-store.js';
import { anonymizeDeadEnds } from './anonymize.js';
import { createCloudClient } from './client.js';
import type { CognitiveTrace } from '../cognitive/trace.js';
import type { SyncResult } from './types.js';

/**
 * High-level: extract fingerprints from a cognitive trace and add to local store.
 * Call this after every session is finalized.
 */
export function extractAndStore(
  trace: CognitiveTrace,
  agentgramDir = '.agentgram',
): number {
  if (trace.deadEnds.length === 0) return 0;

  const store = new LocalFingerprintStore(agentgramDir);
  const fingerprints = anonymizeDeadEnds(trace.deadEnds);

  for (const fp of fingerprints) {
    store.upsert(fp);
  }
  store.save();

  return fingerprints.length;
}

/**
 * High-level: sync local fingerprints with the cloud.
 * Push new local ones, pull new cloud ones.
 */
export async function syncWithCloud(agentgramDir = '.agentgram'): Promise<SyncResult> {
  const store = new LocalFingerprintStore(agentgramDir);
  const client = createCloudClient();
  const errors: string[] = [];

  let pushed = 0;
  let pulled = 0;
  let newWarnings = 0;

  // Push local fingerprints
  const pending = store.getPendingSync();
  if (pending.length > 0) {
    const result = await client.push(pending);
    pushed = result.accepted;
    errors.push(...result.errors);
  }

  // Pull latest from cloud
  const cloudFingerprints = await client.pull();
  if (cloudFingerprints.length > 0) {
    const { added } = store.upsertMany(cloudFingerprints);
    pulled = cloudFingerprints.length;
    newWarnings = added;
  }

  store.save();

  return { pushed, pulled, newWarnings, errors };
}
