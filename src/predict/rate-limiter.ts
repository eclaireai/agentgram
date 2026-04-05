/**
 * Sliding Window Rate Limiter
 *
 * Pure in-memory, zero external dependencies.
 * Uses a per-key array of request timestamps; evicts entries older than 60s on each check.
 */

export interface RateLimits {
  free: number;
  pro: number;
  enterprise: number;
}

const DEFAULT_LIMITS: RateLimits = {
  free: 60,
  pro: 1000,
  enterprise: 10000,
};

const WINDOW_MS = 60_000; // 60 seconds

export class RateLimiter {
  private limits: RateLimits;
  /** Map<apiKey, timestamps[]> of requests within the current window */
  private windows: Map<string, number[]> = new Map();

  constructor(limits?: Partial<RateLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  private evict(key: string): number[] {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const existing = this.windows.get(key) ?? [];
    const fresh = existing.filter((ts) => ts > cutoff);
    this.windows.set(key, fresh);
    return fresh;
  }

  /**
   * Check if a key is within its tier limit.
   * Records the request timestamp if allowed (returns true).
   * Returns false if the key has exceeded its limit.
   */
  check(key: string, tier: keyof RateLimits): boolean {
    const fresh = this.evict(key);
    const limit = this.limits[tier];

    if (fresh.length >= limit) {
      return false;
    }

    fresh.push(Date.now());
    this.windows.set(key, fresh);
    return true;
  }

  /**
   * Seconds until the oldest request in the window expires (the window resets).
   * Returns 0 if the key is not rate-limited.
   */
  retryAfter(key: string): number {
    const timestamps = this.windows.get(key);
    if (!timestamps || timestamps.length === 0) return 0;

    const oldest = Math.min(...timestamps);
    const resetsAt = oldest + WINDOW_MS;
    const remaining = resetsAt - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  /**
   * Current usage stats for a key.
   */
  usage(
    key: string,
    tier: keyof RateLimits = 'free',
  ): { count: number; limit: number; resetsIn: number } {
    const timestamps = this.evict(key);
    const limit = this.limits[tier];
    const resetsIn = this.retryAfter(key);
    return { count: timestamps.length, limit, resetsIn };
  }

  /** Exposed limits (useful for response headers) */
  getLimit(tier: keyof RateLimits): number {
    return this.limits[tier];
  }
}
