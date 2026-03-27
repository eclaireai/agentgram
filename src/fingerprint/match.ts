/**
 * Fingerprint Matcher — Preflight Query Engine
 *
 * Given a task description ("add stripe subscriptions with webhooks"),
 * returns the most relevant fingerprints from the store as warnings.
 *
 * Uses a lightweight TF-IDF-style term overlap + domain matching.
 * No embeddings required — runs entirely offline in <5ms.
 */

import type { FingerprintRecord, FingerprintMatch, PreflightResult } from './types.js';
import type { LocalFingerprintStore } from './local-store.js';

// ---------------------------------------------------------------------------
// Domain keywords — map task description words to domains
// ---------------------------------------------------------------------------

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  payments: ['stripe', 'payment', 'billing', 'invoice', 'subscription', 'checkout', 'lemon', 'squeezy', 'webhook', 'revenue'],
  auth: ['auth', 'clerk', 'supabase', 'oauth', 'jwt', 'login', 'signup', 'session', 'password', 'magic link', 'social'],
  database: ['prisma', 'drizzle', 'postgres', 'mysql', 'sqlite', 'mongo', 'redis', 'migration', 'schema', 'orm'],
  devops: ['docker', 'kubernetes', 'helm', 'terraform', 'deploy', 'ci', 'github actions', 'pipeline', 'container', 'k8s'],
  ai: ['openai', 'anthropic', 'llm', 'embedding', 'vector', 'rag', 'pgvector', 'langchain', 'chatbot', 'ai', 'gpt'],
  build: ['webpack', 'vite', 'tsup', 'rollup', 'esbuild', 'build', 'bundle', 'compile'],
  testing: ['test', 'vitest', 'jest', 'playwright', 'cypress', 'spec', 'coverage'],
  dx: ['eslint', 'prettier', 'lint', 'format', 'typescript', 'monorepo', 'turborepo'],
  mobile: ['expo', 'react native', 'capacitor', 'mobile', 'ios', 'android'],
  security: ['cors', 'helmet', 'csrf', 'rate limit', 'security', 'owasp', 'secrets'],
};

function inferDomainsFromTask(task: string): Set<string> {
  const lower = task.toLowerCase();
  const domains = new Set<string>();

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      domains.add(domain);
    }
  }

  return domains;
}

// ---------------------------------------------------------------------------
// Token overlap score — how many words from the task appear in the fingerprint
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function tokenOverlapScore(taskTokens: Set<string>, fpText: string): number {
  const fpTokens = tokenize(fpText);
  let overlap = 0;
  for (const t of taskTokens) {
    if (fpTokens.has(t)) overlap++;
  }
  // Normalize by task token count
  return taskTokens.size > 0 ? overlap / taskTokens.size : 0;
}

// ---------------------------------------------------------------------------
// Core: match fingerprints against a task description
// ---------------------------------------------------------------------------

export interface MatchOptions {
  /** Max fingerprints to return (default: 5) */
  limit?: number;
  /** Min score threshold 0-1 (default: 0.1) */
  threshold?: number;
  /** Only return matches from specific domain */
  domain?: string;
}

export function matchFingerprints(
  task: string,
  fingerprints: FingerprintRecord[],
  options: MatchOptions = {},
): FingerprintMatch[] {
  const { limit = 5, threshold = 0.08 } = options;

  const taskTokens = tokenize(task);
  const taskDomains = inferDomainsFromTask(task);

  const scored: FingerprintMatch[] = [];

  for (const fp of fingerprints) {
    let score = 0;
    let matchReason = '';

    // Domain match — strong signal
    if (taskDomains.has(fp.domain)) {
      score += 0.4;
      matchReason = `domain:${fp.domain}`;
    }

    // Tag overlap
    const fpTagText = fp.tags.join(' ');
    const tagScore = tokenOverlapScore(taskTokens, fpTagText) * 0.3;
    if (tagScore > 0) {
      score += tagScore;
      if (!matchReason) matchReason = 'tag-match';
    }

    // Error pattern overlap
    const errorScore = tokenOverlapScore(taskTokens, fp.errorPattern) * 0.2;
    score += errorScore;

    // Occurrence boost (popular patterns are more likely relevant)
    const occurrenceBoost = Math.min(fp.occurrences / 1000, 0.1);
    score += occurrenceBoost;

    // Domain filter
    if (options.domain && fp.domain !== options.domain) continue;

    if (score >= threshold) {
      scored.push({ fingerprint: fp, score, matchReason: matchReason || 'token-overlap' });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Preflight: full result with store context
// ---------------------------------------------------------------------------

export function preflight(
  task: string,
  store: LocalFingerprintStore,
  options: MatchOptions = {},
): PreflightResult {
  const allFingerprints = store.getAll();
  const matches = matchFingerprints(task, allFingerprints, options);

  return {
    task,
    matches,
    totalFingerprints: store.size(),
    cloudSynced: false, // updated after cloud sync
  };
}

// ---------------------------------------------------------------------------
// Format preflight result for CLI output
// ---------------------------------------------------------------------------

export function formatPreflightResult(result: PreflightResult): string {
  const lines: string[] = [];

  lines.push(`\n⚡ agentgram preflight — "${result.task}"`);
  lines.push(`   Checked ${result.totalFingerprints} known dead-end patterns\n`);

  if (result.matches.length === 0) {
    lines.push('   ✅ No known dead ends for this task. Good to go.\n');
    return lines.join('\n');
  }

  lines.push(`   ⚠️  Found ${result.matches.length} relevant warning${result.matches.length > 1 ? 's' : ''}:\n`);

  for (let i = 0; i < result.matches.length; i++) {
    const { fingerprint: fp, score } = result.matches[i]!;
    const relevance = Math.round(score * 100);
    const occStr = fp.occurrences > 1 ? ` · seen ${fp.occurrences}x` : '';

    lines.push(`   ${i + 1}. [${fp.domain}${occStr}] (${relevance}% match)`);
    lines.push(`      ⚠  ${fp.warning}`);
    if (fp.fix) {
      lines.push(`      ✓  ${fp.fix}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
