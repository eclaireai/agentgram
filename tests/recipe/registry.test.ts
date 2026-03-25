import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GitHubRecipeRegistry, RegistryError } from '../../src/recipe/registry.js';
import type { SharedRecipe, RecipeIndex } from '../../src/recipe/types.js';

function makeSharedRecipe(id: string, name: string): SharedRecipe {
  return {
    name,
    description: `Recipe: ${name}`,
    sourceSessionId: 'test',
    steps: [{ action: 'find', target: 'src/index.ts', description: 'Read' }],
    parameters: {},
    tags: ['auth', 'jwt'],
    version: '1.0.0',
    metadata: {
      id,
      author: 'tester',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      downloads: 42,
      rating: 4.5,
      ratingCount: 10,
      sourceAgent: 'claude-code',
      checksum: 'abc123',
    },
  };
}

const mockIndex: RecipeIndex = {
  version: '1',
  updatedAt: '2026-01-01T00:00:00Z',
  recipes: [
    { id: 'add-auth-abc', name: 'Add JWT Auth', description: 'Add authentication', author: 'alice', tags: ['auth', 'jwt'], sourceAgent: 'claude-code', downloads: 100, rating: 4.5, createdAt: '2026-01-01T00:00:00Z', stepCount: 5 },
    { id: 'setup-vitest-def', name: 'Setup Vitest', description: 'Configure vitest testing', author: 'bob', tags: ['testing', 'vitest'], sourceAgent: 'cursor', downloads: 50, rating: 4.0, createdAt: '2026-01-02T00:00:00Z', stepCount: 3 },
    { id: 'dark-mode-ghi', name: 'Add Dark Mode', description: 'Implement dark mode toggle', author: 'alice', tags: ['ui', 'theme'], sourceAgent: 'claude-code', downloads: 200, rating: 4.8, createdAt: '2026-01-03T00:00:00Z', stepCount: 8 },
  ],
};

describe('GitHubRecipeRegistry', () => {
  let tmpDir: string;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-registry-test-'));
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  function createRegistry(token?: string) {
    return new GitHubRecipeRegistry(
      { owner: 'test-org', repo: 'test-recipes' },
      { token, cacheDir: path.join(tmpDir, 'cache') },
    );
  }

  describe('fetchIndex', () => {
    it('fetches and parses the index', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const index = await registry.fetchIndex();

      expect(index.recipes).toHaveLength(3);
      expect(index.recipes[0].id).toBe('add-auth-abc');
    });

    it('returns empty index on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const registry = createRegistry();
      const index = await registry.fetchIndex();
      expect(index.recipes).toHaveLength(0);
    });

    it('uses cache on second call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      await registry.fetchIndex();
      const index2 = await registry.fetchIndex();

      expect(mockFetch).toHaveBeenCalledTimes(1); // only one fetch
      expect(index2.recipes).toHaveLength(3);
    });
  });

  describe('search', () => {
    it('finds recipes by keyword', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('auth');

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('add-auth-abc');
      expect(result.query).toBe('auth');
    });

    it('matches against name, description, and tags', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('testing');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('setup-vitest-def');
    });

    it('filters by tag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('', { tags: ['ui'] });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('dark-mode-ghi');
    });

    it('filters by agent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('', { agent: 'cursor' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('setup-vitest-def');
    });

    it('sorts by downloads descending', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('');
      expect(result.entries[0].id).toBe('dark-mode-ghi'); // 200 downloads
      expect(result.entries[1].id).toBe('add-auth-abc'); // 100 downloads
    });

    it('respects limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const result = await registry.search('', { limit: 1 });
      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(3);
    });
  });

  describe('pull', () => {
    it('fetches a recipe by ID', async () => {
      const recipe = makeSharedRecipe('test-recipe', 'Test Recipe');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => recipe,
      });

      const registry = createRegistry();
      const pulled = await registry.pull('test-recipe');
      expect(pulled.name).toBe('Test Recipe');
      expect(pulled.metadata.id).toBe('test-recipe');
    });

    it('throws RegistryError on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const registry = createRegistry();
      await expect(registry.pull('missing')).rejects.toThrow(RegistryError);
    });
  });

  describe('list', () => {
    it('returns recipes sorted by downloads', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const entries = await registry.list();
      expect(entries).toHaveLength(3);
      expect(entries[0].downloads).toBeGreaterThanOrEqual(entries[1].downloads);
    });

    it('respects pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockIndex,
      });

      const registry = createRegistry();
      const entries = await registry.list({ limit: 2, offset: 1 });
      expect(entries).toHaveLength(2);
    });
  });

  describe('publish', () => {
    it('throws without a token', async () => {
      const registry = createRegistry(); // no token
      const recipe = makeSharedRecipe('test', 'Test');
      await expect(registry.publish(recipe)).rejects.toThrow('GitHub token required');
    });

    it('makes correct API calls with token', async () => {
      // Mock: check for existing file (404 = new)
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // Mock: PUT recipe file
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) });
      // Mock: GET raw index (for update)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...mockIndex }) });
      // Mock: GET existing index (for SHA)
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sha: 'abc' }) });
      // Mock: PUT updated index
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

      const registry = createRegistry('ghp_test_token');
      const recipe = makeSharedRecipe('new-recipe', 'New Recipe');
      const id = await registry.publish(recipe);

      expect(id).toBe('new-recipe');
      expect(mockFetch).toHaveBeenCalled();

      // Verify auth header was sent
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[1]?.headers?.Authorization).toBe('Bearer ghp_test_token');
    });
  });
});
