/**
 * Prediction Engine
 *
 * Core oracle API: predicts task success probability, token cost, and risks
 * before an AI agent starts working. Pure TypeScript, Node.js built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  PredictionRequest,
  PredictionResult,
  PredictionModel,
  SessionOutcome,
  RiskFactor,
} from './types.js';
import { LocalFingerprintStore } from '../fingerprint/local-store.js';
import { preflight } from '../fingerprint/match.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_VERSION = '1';

/** Domain base success rates when fewer than 3 matched outcomes */
const DOMAIN_SUCCESS_RATES: Record<string, number> = {
  auth: 0.72,
  payments: 0.61,
  database: 0.78,
  devops: 0.65,
};
const DEFAULT_SUCCESS_RATE = 0.70;

/** Domain average token costs when no history is available */
const DOMAIN_TOKEN_COSTS: Record<string, number> = {
  auth: 28000,
  payments: 35000,
  database: 22000,
  devops: 45000,
};
const DEFAULT_TOKEN_COST = 30000;

/** Tokens/min estimate used to convert tokens → minutes */
const TOKENS_PER_MINUTE = 2000;

/** Approximate token savings per recipe step (avoids exploration overhead) */
const TOKENS_SAVED_PER_RECIPE_STEP = 800;

/** Minimum matched outcomes before we trust the empirical rate */
const MIN_OUTCOMES_FOR_EMPIRICAL = 3;

/** Throttle: only write model if >10 new outcomes or >5 min since last write */
const SAVE_OUTCOME_THRESHOLD = 10;
const SAVE_TIME_THRESHOLD_MS = 5 * 60 * 1000;

/** English stopwords to strip during tokenization */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'be', 'as', 'was', 'are',
  'has', 'have', 'do', 'does', 'not', 'this', 'that', 'my', 'your',
  'we', 'i', 'so', 'up', 'out', 'if', 'no', 'can', 'all', 'get', 'use',
  'add', 'set', 'new', 'into', 'using', 'via', 'how', 'when',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tokenize text into meaningful lowercase keywords */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Compute keyword overlap ratio between two keyword arrays */
function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const overlap = a.filter((k) => setB.has(k)).length;
  return overlap / Math.max(a.length, b.length);
}

/** Infer the primary domain from a task description */
function inferDomain(task: string): string {
  const lower = task.toLowerCase();
  if (/stripe|payment|billing|invoice|subscription|checkout|webhook/.test(lower)) return 'payments';
  if (/auth|clerk|supabase|oauth|jwt|login|signup|session|password/.test(lower)) return 'auth';
  if (/prisma|drizzle|postgres|mysql|sqlite|mongo|redis|migration|schema/.test(lower)) return 'database';
  if (/docker|kubernetes|deploy|ci|terraform|pipeline|container/.test(lower)) return 'devops';
  return 'default';
}

/** Compute SHA-256 based model version string */
function computeModelVersion(builtAt: string, sessionCount: number): string {
  return crypto
    .createHash('sha256')
    .update(`${builtAt}:${sessionCount}`)
    .digest('hex')
    .slice(0, 8);
}

/** Compute the median of a numeric array (returns 0 for empty) */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// Local recipe index (loaded lazily from .agentgram/cache/index.json)
// ---------------------------------------------------------------------------

interface LocalRecipeEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  stepCount: number;
}

function loadLocalRecipeIndex(agentgramDir: string): LocalRecipeEntry[] {
  const cachePath = path.join(agentgramDir, 'cache', 'index.json');
  if (!fs.existsSync(cachePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
      recipes?: LocalRecipeEntry[];
    };
    return raw.recipes ?? [];
  } catch {
    return [];
  }
}

/** Find the best matching recipe name for a task, or null */
function findBestRecipe(
  taskKeywords: string[],
  agentgramDir: string,
): { name: string; stepCount: number } | null {
  const recipes = loadLocalRecipeIndex(agentgramDir);
  if (recipes.length === 0) return null;

  let bestMatch: { name: string; stepCount: number } | null = null;
  let bestScore = 0.1; // minimum threshold

  for (const recipe of recipes) {
    const recipeText = `${recipe.name} ${recipe.description} ${recipe.tags.join(' ')}`;
    const recipeKeywords = tokenize(recipeText);
    const score = overlapRatio(taskKeywords, recipeKeywords);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { name: recipe.id, stepCount: recipe.stepCount };
    }
  }

  return bestMatch;
}

// ---------------------------------------------------------------------------
// PredictionEngine
// ---------------------------------------------------------------------------

export class PredictionEngine {
  private model: PredictionModel;
  private modelPath: string;
  private agentgramDir: string;
  private unsavedOutcomes = 0;
  private lastSaveMs = 0;

  constructor(modelPath?: string) {
    this.agentgramDir = modelPath
      ? path.dirname(path.dirname(modelPath)) // parent of predict/
      : '.agentgram';
    this.modelPath = modelPath ?? path.join(this.agentgramDir, 'predict', 'model.json');
    this.model = this.loadModel();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private loadModel(): PredictionModel {
    if (fs.existsSync(this.modelPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.modelPath, 'utf8')) as PredictionModel;
      } catch {
        // corrupted — start fresh
      }
    }
    return {
      version: MODEL_VERSION,
      builtAt: new Date().toISOString(),
      sessionCount: 0,
      outcomeIndex: [],
      domainTokenCosts: { ...DOMAIN_TOKEN_COSTS },
      keywordSuccessRates: {},
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Return a summary of the current model state, suitable for the /v1/model/stats endpoint. */
  getStats(): {
    sessionCount: number;
    builtAt: string;
    modelVersion: string;
    domainCount: number;
    topDomains: Array<{ domain: string; patterns: number }>;
  } {
    const modelVersion = computeModelVersion(this.model.builtAt, this.model.sessionCount);

    // Count outcomes by domain
    const domainCounts: Record<string, number> = {};
    for (const outcome of this.model.outcomeIndex) {
      const domain = inferDomain(outcome.task);
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    }

    // Also count domains from the built-in domain cost map (fallback for zero outcomes)
    for (const domain of Object.keys(this.model.domainTokenCosts)) {
      if (!(domain in domainCounts)) {
        domainCounts[domain] = 0;
      }
    }

    const topDomains = Object.entries(domainCounts)
      .filter(([, count]) => count > 0)
      .map(([domain, patterns]) => ({ domain, patterns }))
      .sort((a, b) => b.patterns - a.patterns)
      .slice(0, 5);

    return {
      sessionCount: this.model.sessionCount,
      builtAt: this.model.builtAt,
      modelVersion,
      domainCount: Object.keys(this.model.domainTokenCosts).length,
      topDomains,
    };
  }

  /** Persist the model to disk */
  saveModel(): void {
    fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
    fs.writeFileSync(this.modelPath, JSON.stringify(this.model, null, 2));
    this.unsavedOutcomes = 0;
    this.lastSaveMs = Date.now();
  }

  /** Add a new session outcome and update model statistics */
  recordOutcome(outcome: SessionOutcome): void {
    this.model.outcomeIndex.push(outcome);
    this.model.sessionCount++;

    // Update domain token costs (running average)
    const domain = inferDomain(outcome.task);
    const current = this.model.domainTokenCosts[domain] ?? DEFAULT_TOKEN_COST;
    // Exponential moving average: weight new value at 10%
    this.model.domainTokenCosts[domain] = current * 0.9 + outcome.totalTokens * 0.1;

    // Update keyword success rates
    const keywords = tokenize(outcome.task);
    for (const kw of keywords) {
      const existing = this.model.keywordSuccessRates[kw];
      if (existing === undefined) {
        this.model.keywordSuccessRates[kw] = outcome.success ? 1 : 0;
      } else {
        // Running average (EMA weight 0.2 for faster adaptation)
        this.model.keywordSuccessRates[kw] = existing * 0.8 + (outcome.success ? 1 : 0) * 0.2;
      }
    }

    this.unsavedOutcomes++;

    // Throttled save
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveMs;
    if (
      this.unsavedOutcomes >= SAVE_OUTCOME_THRESHOLD ||
      (this.lastSaveMs > 0 && timeSinceLastSave >= SAVE_TIME_THRESHOLD_MS)
    ) {
      this.saveModel();
    }
  }

  /** Rebuild domain/keyword indexes from the full outcome history */
  rebuildIndex(): void {
    // Reset aggregates
    this.model.domainTokenCosts = { ...DOMAIN_TOKEN_COSTS };
    this.model.keywordSuccessRates = {};

    const domainTokenSums: Record<string, { sum: number; count: number }> = {};

    for (const outcome of this.model.outcomeIndex) {
      // Domain token costs: true average
      const domain = inferDomain(outcome.task);
      if (!domainTokenSums[domain]) domainTokenSums[domain] = { sum: 0, count: 0 };
      domainTokenSums[domain]!.sum += outcome.totalTokens;
      domainTokenSums[domain]!.count++;

      // Keyword success rates: accumulate
      const keywords = tokenize(outcome.task);
      for (const kw of keywords) {
        if (!this.model.keywordSuccessRates[kw]) {
          this.model.keywordSuccessRates[kw] = 0;
        }
      }
    }

    // Compute true averages for domain token costs
    for (const [domain, { sum, count }] of Object.entries(domainTokenSums)) {
      if (count > 0) {
        this.model.domainTokenCosts[domain] = sum / count;
      }
    }

    // Compute keyword success rates from scratch
    const kwCounts: Record<string, { successes: number; total: number }> = {};
    for (const outcome of this.model.outcomeIndex) {
      const keywords = tokenize(outcome.task);
      for (const kw of keywords) {
        if (!kwCounts[kw]) kwCounts[kw] = { successes: 0, total: 0 };
        kwCounts[kw]!.total++;
        if (outcome.success) kwCounts[kw]!.successes++;
      }
    }
    for (const [kw, { successes, total }] of Object.entries(kwCounts)) {
      this.model.keywordSuccessRates[kw] = total > 0 ? successes / total : 0.5;
    }

    this.model.sessionCount = this.model.outcomeIndex.length;
    this.model.builtAt = new Date().toISOString();
    this.saveModel();
  }

  /** Core prediction — called by the API */
  predict(req: PredictionRequest): PredictionResult {
    const taskKeywords = tokenize(req.task);
    const domain = inferDomain(req.task);

    // 1. Find matching outcomes (keyword overlap >= 30%)
    const matchedOutcomes = this.model.outcomeIndex.filter((o) => {
      const outcomeKeywords = tokenize(o.task);
      return overlapRatio(taskKeywords, outcomeKeywords) >= 0.3;
    });

    // 2. Compute successProbability
    let successProbability: number;
    if (matchedOutcomes.length >= MIN_OUTCOMES_FOR_EMPIRICAL) {
      const successCount = matchedOutcomes.filter((o) => o.success).length;
      successProbability = successCount / matchedOutcomes.length;
    } else {
      successProbability = DOMAIN_SUCCESS_RATES[domain] ?? DEFAULT_SUCCESS_RATE;
    }

    // 3. Compute topRisks via preflight fingerprint matching
    const topRisks: RiskFactor[] = [];
    try {
      const fingerprintStore = new LocalFingerprintStore(this.agentgramDir);
      const preflightResult = preflight(req.task, fingerprintStore, { limit: 5 });
      const totalFingerprints = preflightResult.totalFingerprints || 1;

      for (const match of preflightResult.matches) {
        const fp = match.fingerprint;
        const probability = Math.min(fp.occurrences / totalFingerprints, 0.95);

        // Map occurrences-based probability to severity
        let severity: RiskFactor['severity'];
        if (probability >= 0.5) severity = 'critical';
        else if (probability >= 0.3) severity = 'high';
        else if (probability >= 0.15) severity = 'medium';
        else severity = 'low';

        topRisks.push({
          pattern: fp.warning,
          probability,
          severity,
          fix: fp.fix ?? fp.reversalPattern,
          seenCount: fp.occurrences,
          domain: fp.domain,
        });
      }

      // Sort by probability descending
      topRisks.sort((a, b) => b.probability - a.probability);
    } catch {
      // Fingerprint store unavailable — skip risks
    }

    // Adjust successProbability down for each critical risk factor > 0.7 probability
    const criticalHighProbRisks = topRisks.filter(
      (r) => r.severity === 'critical' && r.probability > 0.7,
    );
    successProbability = Math.max(0, successProbability - criticalHighProbRisks.length * 0.05);
    // Clamp to [0, 1]
    successProbability = Math.min(1, Math.max(0, successProbability));

    // 4. Compute estimatedTokens
    let estimatedTokens: number;
    if (matchedOutcomes.length > 0) {
      estimatedTokens = median(matchedOutcomes.map((o) => o.totalTokens));
    } else {
      estimatedTokens = this.model.domainTokenCosts[domain] ?? DEFAULT_TOKEN_COST;
    }

    const estimatedMinutes = estimatedTokens / TOKENS_PER_MINUTE;

    // 5. Find recommended recipe
    const recipeMatch = findBestRecipe(taskKeywords, this.agentgramDir);
    const recommendedRecipe = recipeMatch ? recipeMatch.name : null;

    // 6. Compute tokenSavingsIfRecipeUsed
    let tokenSavingsIfRecipeUsed = 0;
    if (recipeMatch) {
      tokenSavingsIfRecipeUsed = Math.max(
        0,
        estimatedTokens - recipeMatch.stepCount * TOKENS_SAVED_PER_RECIPE_STEP,
      );
    }

    // 7. Confidence
    const basedOnSessions = matchedOutcomes.length;
    const confidence = Math.min(0.95, basedOnSessions / 20);

    // 8. Model version
    const modelVersion = computeModelVersion(this.model.builtAt, this.model.sessionCount);

    return {
      successProbability: Math.round(successProbability * 1000) / 1000,
      estimatedTokens: Math.round(estimatedTokens),
      estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
      tokenSavingsIfRecipeUsed: Math.round(tokenSavingsIfRecipeUsed),
      topRisks,
      recommendedRecipe,
      confidence: Math.round(confidence * 1000) / 1000,
      basedOnSessions,
      modelVersion,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Stats (public endpoint) ───────────────────────────────────────────────

  /** Return aggregate model statistics for the public /v1/model/stats endpoint. */
  stats(): {
    sessionCount: number;
    modelVersion: string;
    builtAt: string;
    domainCount: number;
    topDomains: Array<{ domain: string; patterns: number }>;
  } {
    const domainCounts: Record<string, number> = {};
    for (const outcome of this.model.outcomeIndex) {
      const domain = inferDomain(outcome.task);
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    }

    const topDomains = Object.entries(domainCounts)
      .map(([domain, patterns]) => ({ domain, patterns }))
      .sort((a, b) => b.patterns - a.patterns)
      .slice(0, 5);

    const modelVersion = computeModelVersion(this.model.builtAt, this.model.sessionCount);

    return {
      sessionCount: this.model.sessionCount,
      modelVersion,
      builtAt: this.model.builtAt,
      domainCount: Object.keys(domainCounts).length,
      topDomains,
    };
  }
}
