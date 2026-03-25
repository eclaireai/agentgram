import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AgentMemory } from '../../src/memory/index.js';
import type { Recipe } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(
  name: string,
  description: string,
  tags: string[],
  steps: { action: string; target: string; description: string }[] = [],
): Recipe {
  return {
    name,
    description,
    sourceSessionId: `sess-${name}`,
    steps: steps.length > 0 ? (steps as Recipe['steps']) : [
      { action: 'find', target: 'package.json', description: `Check deps for ${name}` },
      { action: 'modify_file', target: 'src/index.ts', description: `Apply ${name}` },
      { action: 'run_command', target: 'npm test', description: 'Verify' },
    ],
    parameters: {},
    tags,
    version: '1.0.0',
  };
}

const authRecipe = makeRecipe(
  'setup-jwt-auth',
  'Set up JWT authentication with refresh tokens',
  ['auth', 'jwt', 'security', 'typescript'],
);

const vitestRecipe = makeRecipe(
  'setup-vitest',
  'Configure Vitest with TypeScript and coverage reporting',
  ['testing', 'vitest', 'coverage', 'typescript'],
);

const eslintRecipe = makeRecipe(
  'add-eslint',
  'Add ESLint with TypeScript and import rules',
  ['lint', 'eslint', 'typescript', 'quality'],
);

const prismaRecipe = makeRecipe(
  'setup-prisma-postgres',
  'Set up Prisma ORM with PostgreSQL database',
  ['database', 'prisma', 'postgres', 'orm'],
);

const dockerRecipe = makeRecipe(
  'add-docker',
  'Add Docker and docker-compose for development',
  ['docker', 'devops', 'deployment'],
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentMemory', () => {
  let tmpDir: string;
  let memory: AgentMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-mem-test-'));
    memory = new AgentMemory(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── remember() ──────────────────────────────────────────────────────────────

  describe('remember()', () => {
    it('stores a recipe in memory', () => {
      const entry = memory.remember(authRecipe);
      expect(entry.id).toBe('setup-jwt-auth');
      expect(entry.recipe.name).toBe('setup-jwt-auth');
      expect(entry.learnedAt).toBeGreaterThan(0);
      expect(entry.recallCount).toBe(0);
    });

    it('persists across instances', () => {
      memory.remember(authRecipe);

      const memory2 = new AgentMemory(tmpDir);
      expect(memory2.size()).toBe(1);
    });

    it('reinforces existing memory (increments recallCount)', () => {
      memory.remember(authRecipe);
      memory.remember(authRecipe);
      memory.remember(authRecipe);
      // After 3 remember() calls: first creates (count=0), next two reinforce (+1 each)
      const entries = memory.list();
      const entry = entries.find((e) => e.id === 'setup-jwt-auth');
      expect(entry?.recallCount).toBe(2);
    });

    it('stores fingerprint metadata', () => {
      const fp = { language: 'typescript' as const, framework: 'nextjs' as const };
      const entry = memory.remember(authRecipe, fp);
      expect(entry.fingerprint?.language).toBe('typescript');
      expect(entry.fingerprint?.framework).toBe('nextjs');
    });

    it('returns valid timestamps', () => {
      const before = Date.now();
      const entry = memory.remember(authRecipe);
      const after = Date.now();
      expect(entry.learnedAt).toBeGreaterThanOrEqual(before);
      expect(entry.learnedAt).toBeLessThanOrEqual(after);
    });
  });

  // ── recall() ──────────────────────────────────────────────────────────────

  describe('recall()', () => {
    beforeEach(() => {
      memory.remember(authRecipe);
      memory.remember(vitestRecipe);
      memory.remember(eslintRecipe);
      memory.remember(prismaRecipe);
      memory.remember(dockerRecipe);
    });

    it('returns empty array when memory is empty', () => {
      const emptyMemory = new AgentMemory(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-')));
      const results = emptyMemory.recall({ task: 'setup auth' });
      expect(results).toHaveLength(0);
    });

    it('finds relevant recipe by task description', () => {
      const results = memory.recall({ task: 'set up JWT authentication' });
      expect(results.length).toBeGreaterThan(0);
      const topResult = results[0];
      expect(topResult.entry.recipe.name).toBe('setup-jwt-auth');
    });

    it('finds testing recipe when asked about tests', () => {
      const results = memory.recall({ task: 'configure vitest testing coverage' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.recipe.name).toBe('setup-vitest');
    });

    it('finds database recipe when asked about database', () => {
      const results = memory.recall({ task: 'set up prisma postgres database' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.recipe.name).toBe('setup-prisma-postgres');
    });

    it('boosts results by fingerprint stack match', () => {
      const fp = { language: 'typescript' as const, framework: 'nextjs' as const };

      // auth and vitest both have 'typescript' tag but auth was learned with ts/nextjs fingerprint
      memory.remember(authRecipe, fp);

      const results = memory.recall({
        task: 'setup something',
        fingerprint: fp,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('respects limit option', () => {
      const results = memory.recall({ task: 'setup typescript project', limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('respects minScore option', () => {
      const results = memory.recall({ task: 'completely unrelated task xyz123qrs', minScore: 0.9 });
      // With very high minScore, nothing should match
      expect(results).toHaveLength(0);
    });

    it('returns relevance score and matches', () => {
      const results = memory.recall({ task: 'set up JWT authentication' });
      const top = results[0];
      expect(top.relevance.score).toBeGreaterThan(0);
      expect(top.relevance.matches).toBeInstanceOf(Array);
      expect(top.relevance.matches.length).toBeGreaterThan(0);
    });

    it('returns results sorted by score descending', () => {
      const results = memory.recall({ task: 'set up JWT authentication security' });
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevance.score).toBeGreaterThanOrEqual(results[i].relevance.score);
      }
    });
  });

  // ── forget() ──────────────────────────────────────────────────────────────

  describe('forget()', () => {
    it('removes a recipe from memory', () => {
      memory.remember(authRecipe);
      expect(memory.size()).toBe(1);
      memory.forget('setup-jwt-auth');
      expect(memory.size()).toBe(0);
    });

    it('returns true when recipe was found', () => {
      memory.remember(authRecipe);
      const result = memory.forget('setup-jwt-auth');
      expect(result).toBe(true);
    });

    it('returns false when recipe not found', () => {
      const result = memory.forget('nonexistent');
      expect(result).toBe(false);
    });

    it('persists deletion across instances', () => {
      memory.remember(authRecipe);
      memory.forget('setup-jwt-auth');

      const memory2 = new AgentMemory(tmpDir);
      expect(memory2.size()).toBe(0);
    });
  });

  // ── reinforce() ────────────────────────────────────────────────────────────

  describe('reinforce()', () => {
    it('increments recall count', () => {
      memory.remember(authRecipe);
      memory.reinforce('setup-jwt-auth');
      const entries = memory.list();
      const auth = entries.find((e) => e.id === 'setup-jwt-auth');
      expect(auth?.recallCount).toBeGreaterThan(0);
    });

    it('updates lastUsedAt timestamp', () => {
      memory.remember(authRecipe);
      const before = Date.now();
      memory.reinforce('setup-jwt-auth');
      const entries = memory.list();
      const auth = entries.find((e) => e.id === 'setup-jwt-auth');
      expect(auth?.lastUsedAt).toBeGreaterThanOrEqual(before);
    });

    it('does nothing for unknown id', () => {
      expect(() => memory.reinforce('nonexistent')).not.toThrow();
    });
  });

  // ── stats() ─────────────────────────────────────────────────────────────

  describe('stats()', () => {
    it('returns correct total count', () => {
      memory.remember(authRecipe);
      memory.remember(vitestRecipe);
      const stats = memory.stats();
      expect(stats.totalRecipes).toBe(2);
    });

    it('returns empty stats for empty memory', () => {
      const stats = memory.stats();
      expect(stats.totalRecipes).toBe(0);
      expect(stats.mostUsed).toHaveLength(0);
      expect(stats.avgRecallCount).toBe(0);
    });

    it('lists most used recipes', () => {
      memory.remember(authRecipe);
      memory.remember(vitestRecipe);
      memory.reinforce('setup-jwt-auth');
      memory.reinforce('setup-jwt-auth');

      const stats = memory.stats();
      expect(stats.mostUsed[0].id).toBe('setup-jwt-auth');
    });

    it('lists recently learned recipes', () => {
      memory.remember(authRecipe);
      memory.remember(vitestRecipe);
      const stats = memory.stats();
      // Both recipes should appear in recentlyLearned
      const ids = stats.recentlyLearned.map((e) => e.id);
      expect(ids).toContain('setup-jwt-auth');
      expect(ids).toContain('setup-vitest');
    });
  });

  // ── importRecipes() ────────────────────────────────────────────────────────

  describe('importRecipes()', () => {
    it('imports multiple recipes', () => {
      const count = memory.importRecipes([authRecipe, vitestRecipe, eslintRecipe]);
      expect(count).toBe(3);
      expect(memory.size()).toBe(3);
    });

    it('skips already known recipes', () => {
      memory.remember(authRecipe);
      const count = memory.importRecipes([authRecipe, vitestRecipe]);
      expect(count).toBe(1); // Only vitest is new
      expect(memory.size()).toBe(2);
    });

    it('returns 0 for empty array', () => {
      const count = memory.importRecipes([]);
      expect(count).toBe(0);
    });
  });

  // ── list() and size() ──────────────────────────────────────────────────────

  describe('list() and size()', () => {
    it('list returns all entries', () => {
      memory.remember(authRecipe);
      memory.remember(vitestRecipe);
      const entries = memory.list();
      expect(entries).toHaveLength(2);
    });

    it('size returns correct count', () => {
      expect(memory.size()).toBe(0);
      memory.remember(authRecipe);
      expect(memory.size()).toBe(1);
      memory.remember(vitestRecipe);
      expect(memory.size()).toBe(2);
    });
  });
});
