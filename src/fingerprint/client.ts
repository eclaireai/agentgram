/**
 * Fingerprint Cloud Client
 *
 * Syncs anonymized dead-end fingerprints with the agentgram cloud.
 * Falls back gracefully to local-only mode when offline or unconfigured.
 *
 * Privacy: only anonymized FingerprintRecord objects are sent.
 * You can inspect what gets sent with: agentgram fingerprint show --pending
 */

import type { FingerprintRecord } from './types.js';

export const CLOUD_API = process.env['AGENTGRAM_API'] ?? 'https://api.agentgram.dev';
export const SYNC_TIMEOUT_MS = 5000;

export interface CloudClient {
  push(fingerprints: FingerprintRecord[]): Promise<{ accepted: number; errors: string[] }>;
  pull(since?: string): Promise<FingerprintRecord[]>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// HTTP Cloud Client (production)
// ---------------------------------------------------------------------------

export class HttpCloudClient implements CloudClient {
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl = CLOUD_API) {
    this.apiKey = apiKey ?? process.env['AGENTGRAM_API_KEY'];
    this.baseUrl = baseUrl;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async push(fingerprints: FingerprintRecord[]): Promise<{ accepted: number; errors: string[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/v1/fingerprints`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ fingerprints }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { accepted: 0, errors: [`HTTP ${res.status}: ${text}`] };
      }

      const data = (await res.json()) as { accepted: number; errors?: string[] };
      return { accepted: data.accepted ?? 0, errors: data.errors ?? [] };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return { accepted: 0, errors: [msg] };
    }
  }

  async pull(since?: string): Promise<FingerprintRecord[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

    try {
      const url = new URL(`${this.baseUrl}/v1/fingerprints`);
      if (since) url.searchParams.set('since', since);

      const res = await fetch(url.toString(), {
        headers: this.headers(),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) return [];

      const data = (await res.json()) as { fingerprints: FingerprintRecord[] };
      return data.fingerprints ?? [];
    } catch {
      clearTimeout(timer);
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);

    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Stub / offline client (used in tests and when no API key configured)
// ---------------------------------------------------------------------------

export class OfflineCloudClient implements CloudClient {
  async push(_: FingerprintRecord[]) { return { accepted: 0, errors: ['offline mode'] }; }
  async pull(_?: string) { return []; }
  async isAvailable() { return false; }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCloudClient(): CloudClient {
  const apiKey = process.env['AGENTGRAM_API_KEY'];
  if (!apiKey) return new OfflineCloudClient();
  return new HttpCloudClient(apiKey);
}
