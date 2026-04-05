/**
 * Agentgram Prediction SDK
 *
 * Zero-dependency embeddable client for Cursor, Devin, Claude Code extensions,
 * and other AI tools. Requires Node.js 18+ (native fetch).
 */

import type { PredictionResult, StackContext, SessionOutcome } from './types.js';

export type { PredictionResult, StackContext, SessionOutcome };

export interface AgentgramClientOptions {
  /** Defaults to env AGENTGRAM_API_KEY */
  apiKey?: string;
  /** Defaults to 'https://api.agentgram.dev' */
  baseUrl?: string;
  /** Milliseconds, default 5000 */
  timeout?: number;
  /** If true, falls back gracefully when API unreachable. Default true. */
  gracefulFallback?: boolean;
}

/** PredictionResult extended with a debug cache flag. */
export interface PredictionResultWithMeta extends PredictionResult {
  /** Non-standard debug field: true if this result came from the in-memory cache. */
  _cached: boolean;
}

const DEFAULT_BASE_URL = 'https://api.agentgram.dev';
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Returned when the API is unreachable and gracefulFallback is true. */
function buildFallbackResult(): PredictionResultWithMeta {
  return {
    successProbability: 0.70,
    estimatedTokens: 30000,
    estimatedMinutes: 15,
    tokenSavingsIfRecipeUsed: 0,
    topRisks: [],
    recommendedRecipe: null,
    confidence: 0,
    basedOnSessions: 0,
    modelVersion: 'fallback',
    generatedAt: new Date().toISOString(),
    _cached: false,
  };
}

/** SHA-256 of a string using the Web Crypto API (available in Node 18+). */
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface CacheEntry {
  result: PredictionResultWithMeta;
  expiresAt: number;
}

/**
 * Lightweight Agentgram prediction client.
 *
 * @example
 * ```ts
 * const client = new AgentgramClient({ apiKey: process.env.AGENTGRAM_API_KEY })
 * const prediction = await client.predict('add stripe subscriptions to nextjs', {
 *   framework: 'nextjs', payments: 'stripe'
 * })
 * console.log(prediction.successProbability) // 0.67
 * ```
 */
export class AgentgramClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly gracefulFallback: boolean;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: AgentgramClientOptions = {}) {
    this.apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env['AGENTGRAM_API_KEY'] ?? '' : '');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.gracefulFallback = options.gracefulFallback ?? true;
  }

  /**
   * Predict success probability, token cost, and risks before starting a task.
   * The main entry point — call this before every agent task.
   *
   * Returns a cached result if the same task+stack was requested within 5 minutes.
   * Falls back gracefully (confidence: 0) when the API is unreachable, unless
   * gracefulFallback is false.
   */
  async predict(task: string, stack?: StackContext): Promise<PredictionResultWithMeta> {
    const cacheKey = await sha256(task + JSON.stringify(stack ?? null));

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.result, _cached: true };
    }

    try {
      const result = await this._fetchWithRetry<PredictionResult>('/v1/predict', {
        method: 'POST',
        body: JSON.stringify({ task, stack }),
      });

      const resultWithMeta: PredictionResultWithMeta = { ...result, _cached: false };

      this.cache.set(cacheKey, {
        result: resultWithMeta,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return resultWithMeta;
    } catch (err) {
      if (this.gracefulFallback) {
        return buildFallbackResult();
      }
      throw err;
    }
  }

  /**
   * Record what actually happened — feeds back into the prediction model.
   * Call this when a session ends.
   */
  async recordOutcome(
    outcome: Partial<SessionOutcome> & { task: string; success: boolean }
  ): Promise<void> {
    try {
      await this._fetchWithRetry<void>('/v1/outcome', {
        method: 'POST',
        body: JSON.stringify(outcome),
      });
    } catch {
      // Never throw — recording outcomes is best-effort.
    }
  }

  /**
   * Check if the API is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const res = await globalThis.fetch(`${this.baseUrl}/v1/ping`, {
          method: 'GET',
          headers: this._headers(),
          signal: controller.signal,
        });
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Fetch with a single retry on network error.
   * No retry on 4xx responses.
   */
  private async _fetchWithRetry<T>(path: string, init: RequestInit): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        let res: Response;
        try {
          res = await globalThis.fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: this._headers(),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        // Do not retry client errors.
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => '');
          throw new AgentgramApiError(res.status, text);
        }

        if (!res.ok) {
          throw new AgentgramApiError(res.status, `Server error ${res.status}`);
        }

        // 204 No Content or void responses
        const contentType = res.headers.get('content-type') ?? '';
        if (res.status === 204 || !contentType.includes('application/json')) {
          return undefined as T;
        }

        return (await res.json()) as T;
      } catch (err) {
        // Don't retry 4xx client errors
        if (err instanceof AgentgramApiError && err.status < 500) {
          throw err;
        }
        lastError = err;
        // Only retry once — on second attempt, bubble the error up
        if (attempt === 1) {
          throw lastError;
        }
      }
    }

    throw lastError;
  }
}

/** Error thrown for non-2xx API responses. */
export class AgentgramApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(`AgentgramApiError ${status}: ${message}`);
    this.name = 'AgentgramApiError';
  }
}

/**
 * Convenience one-liner for quick integration.
 *
 * @example
 * ```ts
 * import { predict } from 'agentgram'
 * const p = await predict('add stripe subscriptions', { apiKey: '...', stack: { payments: 'stripe' } })
 * ```
 */
export async function predict(
  task: string,
  options?: AgentgramClientOptions & { stack?: StackContext }
): Promise<PredictionResultWithMeta> {
  const { stack, ...clientOptions } = options ?? {};
  const client = new AgentgramClient(clientOptions);
  return client.predict(task, stack);
}
