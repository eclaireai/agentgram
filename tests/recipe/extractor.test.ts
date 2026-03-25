import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { extractRecipeFromCommit, extractRecipesFromRepo } from '../../src/recipe/extractor.js';

describe('PR→Recipe Reverse Extractor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-extract-test-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.name "test"', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });

    // Create initial commit
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    execSync('git add -A && git commit -m "initial"', { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCommit(message: string, files: Record<string, string | null>) {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(tmpDir, file);
      if (content === null) {
        // Delete
        try { fs.unlinkSync(full); } catch { /* ok */ }
      } else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
    }
    execSync('git add -A && git commit -m ' + JSON.stringify(message), { cwd: tmpDir });
    return execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();
  }

  describe('extractRecipeFromCommit', () => {
    it('extracts a recipe from a commit that adds files', async () => {
      const sha = makeCommit('feat: add auth middleware', {
        'src/middleware/auth.ts': 'export function auth() {}',
        'tests/auth.test.ts': 'test("auth", () => {})',
      });

      const recipe = await extractRecipeFromCommit(tmpDir, sha);
      expect(recipe).not.toBeNull();
      expect(recipe!.name).toContain('auth middleware');
      expect(recipe!.steps.length).toBeGreaterThan(0);

      // Should have create_file steps for new files
      const creates = recipe!.steps.filter((s) => s.action === 'create_file');
      expect(creates.length).toBeGreaterThan(0);
    });

    it('extracts a recipe from a commit that modifies files', async () => {
      // Create a source file first, then modify it
      makeCommit('feat: add utils', { 'src/utils.ts': 'export const a = 1;' });
      const sha = makeCommit('fix: update utils', {
        'src/utils.ts': 'export const a = 2; export const b = 3;',
      });

      const recipe = await extractRecipeFromCommit(tmpDir, sha);
      expect(recipe).not.toBeNull();

      const modifies = recipe!.steps.filter((s) => s.action === 'modify_file');
      expect(modifies.length).toBeGreaterThan(0);
    });

    it('extracts install commands from package.json changes', async () => {
      const sha = makeCommit('feat: add JWT support', {
        'package.json': '{"name":"test","dependencies":{"jsonwebtoken":"^9.0","bcrypt":"^5.1"}}',
      });

      const recipe = await extractRecipeFromCommit(tmpDir, sha);
      expect(recipe).not.toBeNull();

      // Should infer a run_command step for new deps
      const installs = recipe!.steps.filter((s) => s.action === 'run_command');
      expect(installs.length).toBeGreaterThan(0);
      expect(installs[0].target).toContain('install');
    });

    it('skips trivial commits (only lockfile changes)', async () => {
      const sha = makeCommit('chore: update lockfile', {
        'package-lock.json': '{"lockfileVersion":3}',
      });

      const recipe = await extractRecipeFromCommit(tmpDir, sha);
      expect(recipe).toBeNull();
    });

    it('includes commit message as recipe description', async () => {
      const sha = makeCommit('feat: add rate limiting to protect API endpoints', {
        'src/middleware/rate-limit.ts': 'export const limiter = {}',
      });

      const recipe = await extractRecipeFromCommit(tmpDir, sha);
      expect(recipe).not.toBeNull();
      expect(recipe!.description).toContain('rate limiting');
    });
  });

  describe('extractRecipesFromRepo', () => {
    it('extracts recipes from multiple commits', async () => {
      makeCommit('feat: add auth', { 'src/auth.ts': 'export function auth() {}' });
      makeCommit('feat: add logging', { 'src/logger.ts': 'export function log() {}' });
      makeCommit('chore: update lockfile', { 'package-lock.json': '{}' }); // should skip

      const recipes = await extractRecipesFromRepo(tmpDir, { limit: 10 });
      expect(recipes.length).toBe(2); // skips trivial
    });

    it('respects limit', async () => {
      makeCommit('feat: one', { 'src/a.ts': 'a' });
      makeCommit('feat: two', { 'src/b.ts': 'b' });
      makeCommit('feat: three', { 'src/c.ts': 'c' });

      const recipes = await extractRecipesFromRepo(tmpDir, { limit: 2 });
      expect(recipes.length).toBe(2);
    });
  });
});
