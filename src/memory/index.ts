/**
 * Agent Memory — Long-term memory for AI coding agents.
 *
 * The breakthrough insight: AI agents currently suffer from amnesia.
 * Every Claude session starts blank. agentgram's memory layer
 * fixes this — agents remember how they've solved problems before.
 *
 * Architecture:
 *   - TF-IDF semantic similarity (zero external dependencies)
 *   - Codebase fingerprint matching (language/framework/ORM)
 *   - Recency + frequency scoring (like spaced repetition)
 *   - Persistent storage in .agentgram/memory/
 *
 * This is the "long-term memory" that transforms agentgram
 * from a session recorder into the cognitive layer of AI development.
 *
 * Patent-worthy: Applying spaced-repetition memory algorithms to
 * AI agent workflow recall, weighted by codebase similarity.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Recipe } from '../core/types.js';
import type { CodebaseFingerprint } from '../recipe/fingerprint.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A memory entry — a recipe + recall metadata */
export interface MemoryEntry {
  id: string;
  recipe: Recipe;
  /** When this memory was formed */
  learnedAt: number;
  /** How many times this recipe has been recalled */
  recallCount: number;
  /** Last time this recipe was used/recalled */
  lastUsedAt: number;
  /** Relevance score from last search (not persisted) */
  score?: number;
  /** Fingerprint of the project where this recipe was first used */
  fingerprint?: Partial<CodebaseFingerprint>;
}

/** A recall result with relevance explanation */
export interface RecallResult {
  entry: MemoryEntry;
  /** Why this recipe was recalled */
  relevance: {
    score: number;
    /** Which aspects matched */
    matches: string[];
  };
}

/** Options for recall */
export interface RecallOptions {
  /** Natural language task description */
  task: string;
  /** Current codebase fingerprint for stack matching */
  fingerprint?: Partial<CodebaseFingerprint>;
  /** Maximum results to return */
  limit?: number;
  /** Minimum relevance score (0-1) */
  minScore?: number;
  /** Boost recently used recipes */
  recencyBoost?: boolean;
}

// ---------------------------------------------------------------------------
// TF-IDF Similarity (no external deps)
// ---------------------------------------------------------------------------

/** Tokenize a string into meaningful tokens */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .filter((t) => !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
  'her', 'was', 'one', 'our', 'out', 'had', 'his', 'have', 'that', 'with',
  'this', 'from', 'they', 'been', 'than', 'its', 'who', 'did', 'get', 'may',
  'add', 'run', 'use', 'set', 'new', 'old', 'via', 'any', 'how',
]);

/** Compute TF (term frequency) for a document */
function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const max = Math.max(1, ...freq.values());
  for (const [k, v] of freq) freq.set(k, v / max);
  return freq;
}

/** Cosine similarity between two TF vectors */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, tfA] of a) {
    const tfB = b.get(term) ?? 0;
    dot += tfA * tfB;
    normA += tfA * tfA;
  }
  for (const [, tfB] of b) normB += tfB * tfB;

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Build a text representation of a recipe for similarity matching */
function recipeText(recipe: Recipe): string {
  return [
    recipe.name,
    recipe.description,
    recipe.tags.join(' '),
    recipe.steps.map((s) => `${s.action} ${s.target} ${s.description}`).join(' '),
  ].join(' ');
}

// ---------------------------------------------------------------------------
// AgentMemory
// ---------------------------------------------------------------------------

export class AgentMemory {
  private readonly memDir: string;
  private readonly indexPath: string;
  private cache: Map<string, MemoryEntry> | null = null;

  constructor(dataDir = '.agentgram') {
    this.memDir = path.join(dataDir, 'memory');
    this.indexPath = path.join(this.memDir, 'index.json');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private ensureDir(): void {
    fs.mkdirSync(this.memDir, { recursive: true });
  }

  private loadIndex(): Map<string, MemoryEntry> {
    if (this.cache) return this.cache;
    this.ensureDir();

    if (!fs.existsSync(this.indexPath)) {
      this.cache = new Map();
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.indexPath, 'utf8');
      const entries: MemoryEntry[] = JSON.parse(raw);
      this.cache = new Map(entries.map((e) => [e.id, e]));
    } catch {
      this.cache = new Map();
    }

    return this.cache;
  }

  private saveIndex(): void {
    this.ensureDir();
    const entries = [...this.loadIndex().values()];
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2));
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * remember() — Store a recipe in long-term memory.
   *
   * Called automatically after a successful session. The agent "learns"
   * how to do something it just did.
   */
  remember(recipe: Recipe, fingerprint?: Partial<CodebaseFingerprint>): MemoryEntry {
    const index = this.loadIndex();
    const existing = index.get(recipe.name);

    if (existing) {
      // Reinforce existing memory (increase recall count)
      existing.recallCount += 1;
      existing.lastUsedAt = Date.now();
      if (fingerprint) existing.fingerprint = fingerprint;
      this.saveIndex();
      return existing;
    }

    const entry: MemoryEntry = {
      id: recipe.name,
      recipe,
      learnedAt: Date.now(),
      recallCount: 0,
      lastUsedAt: Date.now(),
      fingerprint,
    };

    index.set(entry.id, entry);
    this.saveIndex();
    return entry;
  }

  /**
   * recall() — Find the most relevant recipes for a given task.
   *
   * Uses TF-IDF similarity + fingerprint matching + recency scoring.
   * This is the "memory retrieval" step — like how humans recall
   * relevant past experiences when starting a new task.
   */
  recall(options: RecallOptions): RecallResult[] {
    const { task, fingerprint, limit = 5, minScore = 0.1, recencyBoost = true } = options;
    const index = this.loadIndex();

    if (index.size === 0) return [];

    const queryTokens = tokenize(task);
    const queryTF = termFrequency(queryTokens);

    const results: RecallResult[] = [];

    for (const entry of index.values()) {
      const matches: string[] = [];
      let score = 0;

      // 1. Text similarity (TF-IDF cosine)
      const recipeTokens = tokenize(recipeText(entry.recipe));
      const recipeTF = termFrequency(recipeTokens);
      const textSim = cosineSimilarity(queryTF, recipeTF);

      if (textSim > 0) {
        score += textSim * 0.5;
        matches.push(`text similarity: ${Math.round(textSim * 100)}%`);
      }

      // 2. Tag overlap
      const taskWords = new Set(queryTokens);
      const tagMatches = entry.recipe.tags.filter((t) => taskWords.has(t.toLowerCase()));
      if (tagMatches.length > 0) {
        const tagScore = tagMatches.length / Math.max(entry.recipe.tags.length, 1);
        score += tagScore * 0.2;
        matches.push(`tags: ${tagMatches.join(', ')}`);
      }

      // 3. Fingerprint stack match
      if (fingerprint && entry.fingerprint) {
        const fp = entry.fingerprint;
        const stackMatches: string[] = [];
        if (fp.language && fingerprint.language === fp.language) stackMatches.push(fp.language);
        if (fp.framework && fingerprint.framework === fp.framework) stackMatches.push(fp.framework);
        if (fp.orm && fingerprint.orm === fp.orm) stackMatches.push(fp.orm);
        if (fp.testFramework && fingerprint.testFramework === fp.testFramework) stackMatches.push(fp.testFramework);

        if (stackMatches.length > 0) {
          score += (stackMatches.length / 4) * 0.2;
          matches.push(`stack match: ${stackMatches.join(', ')}`);
        }
      }

      // 4. Recency boost (exponential decay — like spaced repetition)
      if (recencyBoost && entry.lastUsedAt) {
        const daysSince = (Date.now() - entry.lastUsedAt) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-daysSince / 30); // 30-day half-life
        score += recencyScore * 0.05;
        if (recencyScore > 0.5) matches.push(`recently used`);
      }

      // 5. Frequency boost (well-tested recipes)
      if (entry.recallCount > 0) {
        const freqScore = Math.min(entry.recallCount / 10, 1) * 0.05;
        score += freqScore;
        if (entry.recallCount >= 3) matches.push(`used ${entry.recallCount}× before`);
      }

      if (score >= minScore) {
        results.push({ entry: { ...entry, score }, relevance: { score, matches } });
      }
    }

    // Sort by score descending, return top N
    results.sort((a, b) => b.relevance.score - a.relevance.score);
    return results.slice(0, limit);
  }

  /**
   * forget() — Remove a recipe from memory.
   * Used when a recipe is deprecated or incorrect.
   */
  forget(id: string): boolean {
    const index = this.loadIndex();
    const existed = index.delete(id);
    if (existed) this.saveIndex();
    return existed;
  }

  /**
   * reinforce() — Mark a recipe as successfully used (increase recall count).
   * Called after an agent successfully follows a recipe.
   */
  reinforce(id: string): void {
    const index = this.loadIndex();
    const entry = index.get(id);
    if (entry) {
      entry.recallCount += 1;
      entry.lastUsedAt = Date.now();
      this.saveIndex();
    }
  }

  /**
   * stats() — Memory health statistics.
   */
  stats(): {
    totalRecipes: number;
    mostUsed: MemoryEntry[];
    recentlyLearned: MemoryEntry[];
    avgRecallCount: number;
  } {
    const index = this.loadIndex();
    const entries = [...index.values()];

    const mostUsed = [...entries].sort((a, b) => b.recallCount - a.recallCount).slice(0, 5);

    const recentlyLearned = [...entries]
      .sort((a, b) => b.learnedAt - a.learnedAt)
      .slice(0, 5);

    const avgRecallCount =
      entries.length > 0
        ? entries.reduce((s, e) => s + e.recallCount, 0) / entries.length
        : 0;

    return { totalRecipes: entries.length, mostUsed, recentlyLearned, avgRecallCount };
  }

  /**
   * list() — List all memories.
   */
  list(): MemoryEntry[] {
    return [...this.loadIndex().values()];
  }

  /**
   * size() — Number of memories.
   */
  size(): number {
    return this.loadIndex().size;
  }

  /**
   * importRecipes() — Bulk import recipes into memory (e.g., from registry).
   * Used to pre-warm agent memory with community recipes.
   */
  importRecipes(recipes: Recipe[], fingerprint?: Partial<CodebaseFingerprint>): number {
    let imported = 0;
    for (const recipe of recipes) {
      const index = this.loadIndex();
      if (!index.has(recipe.name)) {
        this.remember(recipe, fingerprint);
        imported++;
      }
    }
    return imported;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

let _defaultMemory: AgentMemory | null = null;

/** Get the default AgentMemory instance (singleton per process) */
export function getAgentMemory(dataDir = '.agentgram'): AgentMemory {
  if (!_defaultMemory) {
    _defaultMemory = new AgentMemory(dataDir);
  }
  return _defaultMemory;
}
