import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalRecipeStore } from '../../src/recipe/store.js';
import type { SharedRecipe } from '../../src/recipe/types.js';

function makeRecipe(id: string, name: string, downloads = 0): SharedRecipe {
  return {
    name,
    description: `Recipe: ${name}`,
    sourceSessionId: 'test-session',
    steps: [
      { action: 'find', target: 'src/index.ts', description: 'Read source' },
      { action: 'modify_file', target: 'src/index.ts', description: 'Edit source' },
    ],
    parameters: {},
    tags: ['test'],
    version: '1.0.0',
    metadata: {
      id,
      author: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloads,
      rating: 0,
      ratingCount: 0,
      sourceAgent: 'claude-code',
      checksum: 'abc123',
    },
  };
}

describe('LocalRecipeStore', () => {
  let tmpDir: string;
  let store: LocalRecipeStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-store-test-'));
    store = new LocalRecipeStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save and load round-trip', async () => {
    const recipe = makeRecipe('test-1', 'Add Authentication');
    await store.save(recipe);
    const loaded = await store.load('test-1');
    expect(loaded.name).toBe('Add Authentication');
    expect(loaded.metadata.id).toBe('test-1');
    expect(loaded.steps).toHaveLength(2);
  });

  it('creates directory lazily on save', async () => {
    const recipesDir = path.join(tmpDir, '.agentgram', 'recipes');
    expect(fs.existsSync(recipesDir)).toBe(false);

    await store.save(makeRecipe('test-1', 'Test'));
    expect(fs.existsSync(recipesDir)).toBe(true);
  });

  it('list returns all saved recipes', async () => {
    await store.save(makeRecipe('r1', 'Recipe One', 10));
    await store.save(makeRecipe('r2', 'Recipe Two', 50));
    await store.save(makeRecipe('r3', 'Recipe Three', 30));

    const recipes = await store.list();
    expect(recipes).toHaveLength(3);
    // Sorted by downloads descending
    expect(recipes[0].metadata.id).toBe('r2');
    expect(recipes[1].metadata.id).toBe('r3');
    expect(recipes[2].metadata.id).toBe('r1');
  });

  it('list returns empty array when no recipes', async () => {
    const recipes = await store.list();
    expect(recipes).toHaveLength(0);
  });

  it('remove deletes a recipe', async () => {
    await store.save(makeRecipe('r1', 'Test'));
    expect(await store.exists('r1')).toBe(true);

    await store.remove('r1');
    expect(await store.exists('r1')).toBe(false);
  });

  it('exists returns true for saved, false for missing', async () => {
    expect(await store.exists('missing')).toBe(false);
    await store.save(makeRecipe('found', 'Found'));
    expect(await store.exists('found')).toBe(true);
  });

  it('getStorePath returns the recipes directory', () => {
    expect(store.getStorePath()).toBe(path.join(tmpDir, '.agentgram', 'recipes'));
  });
});
