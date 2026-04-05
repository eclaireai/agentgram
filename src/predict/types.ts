/**
 * Prediction Engine Types
 *
 * Types for the oracle API — a probability model that predicts task success,
 * token cost, and risks before an AI agent starts working.
 */

export interface StackContext {
  framework?: string;   // 'nextjs' | 'express' | 'fastapi' | 'rails' etc
  language?: string;    // 'typescript' | 'python' | 'ruby' etc
  version?: string;     // framework version e.g. '15.1'
  orm?: string;         // 'prisma' | 'drizzle' | 'sqlalchemy'
  auth?: string;        // 'clerk' | 'nextauth' | 'auth0'
  payments?: string;    // 'stripe' | 'paddle'
  database?: string;    // 'postgres' | 'mysql' | 'sqlite'
  deployment?: string;  // 'vercel' | 'aws' | 'docker'
}

export interface PredictionRequest {
  task: string;         // natural language task description
  stack?: StackContext;
  agent?: string;       // 'claude-code' | 'cursor' | 'devin' | 'copilot'
  /** caller's API key — not stored with prediction data */
  apiKey?: string;
}

export interface RiskFactor {
  pattern: string;      // description of the risk
  probability: number;  // 0-1
  severity: 'critical' | 'high' | 'medium' | 'low';
  fix: string;          // actionable fix
  seenCount: number;    // how many times this was seen across sessions
  domain: string;
}

export interface PredictionResult {
  /** Probability 0-1 that this task succeeds without hitting a dead end */
  successProbability: number;
  /** Estimated tokens to complete (median across similar sessions) */
  estimatedTokens: number;
  /** Estimated minutes (based on token rate ~2000 tokens/min) */
  estimatedMinutes: number;
  /** Tokens saved if recommended recipe is used */
  tokenSavingsIfRecipeUsed: number;
  /** Top risks ordered by probability */
  topRisks: RiskFactor[];
  /** Best matching recipe from registry */
  recommendedRecipe: string | null;
  /** Confidence in this prediction (0-1) — based on how much data we have */
  confidence: number;
  /** How many sessions this prediction is based on */
  basedOnSessions: number;
  /** Model version for cache invalidation */
  modelVersion: string;
  /** ISO timestamp */
  generatedAt: string;
}

export interface SessionOutcome {
  sessionId: string;
  task: string;
  stack: StackContext;
  agent?: string;
  success: boolean;
  totalTokens: number;
  durationMinutes: number;
  deadEndCount: number;
  deadEndPatterns: string[];  // anonymized
  recipeUsed?: string;
  recordedAt: string;
}

export interface PredictionModel {
  version: string;
  builtAt: string;
  sessionCount: number;
  outcomeIndex: SessionOutcome[];
  /** Domain → average token cost */
  domainTokenCosts: Record<string, number>;
  /** Task keyword → success rate */
  keywordSuccessRates: Record<string, number>;
}
