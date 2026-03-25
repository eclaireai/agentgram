/**
 * GitHub-based Recipe Registry
 *
 * Uses a public GitHub repo as the recipe store.
 * Recipes are JSON files, with a single index.json for fast search.
 * No custom backend needed.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  SharedRecipe,
  RecipeId,
  RecipeIndex,
  RecipeIndexEntry,
  RegistryConfig,
  SearchResult,
} from './types.js';
import { DEFAULT_REGISTRY_CONFIG } from './types.js';

export class RegistryError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

interface GitHubContentResponse {
  sha: string;
  content?: string;
  download_url?: string;
}

export class GitHubRecipeRegistry {
  private config: RegistryConfig;
  private token: string | undefined;
  private cacheDir: string;
  private indexCacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    config: Partial<RegistryConfig> = {},
    options: { token?: string; cacheDir?: string } = {},
  ) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.AGENTGRAM_TOKEN;
    this.cacheDir = options.cacheDir ?? path.join(process.cwd(), '.agentgram', 'cache');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Publish a recipe to the registry */
  async publish(recipe: SharedRecipe): Promise<RecipeId> {
    if (!this.token) {
      throw new RegistryError(
        'GitHub token required to publish. Set GITHUB_TOKEN or AGENTGRAM_TOKEN env var.',
      );
    }

    const filename = `${recipe.metadata.id}.json`;
    const filepath = `${this.config.recipesDir}/${filename}`;
    const content = JSON.stringify(recipe, null, 2);
    const encoded = Buffer.from(content).toString('base64');

    // 1. Upload recipe file
    await this.putFile(filepath, encoded, `Add recipe: ${recipe.name}`);

    // 2. Update index
    await this.updateIndex(recipe);

    return recipe.metadata.id;
  }

  /** Fetch the recipe index (cached) */
  async fetchIndex(): Promise<RecipeIndex> {
    // Check cache
    const cached = await this.readCache('index.json');
    if (cached) {
      try {
        return JSON.parse(cached) as RecipeIndex;
      } catch {
        // corrupt cache, refetch
      }
    }

    // Fetch from GitHub
    const url = this.rawUrl(this.config.indexPath);
    const response = await this.fetch(url);

    if (response.status === 404) {
      // Index doesn't exist yet — return empty
      return { version: '1', updatedAt: new Date().toISOString(), recipes: [] };
    }

    if (!response.ok) {
      throw new RegistryError(`Failed to fetch index: ${response.status}`, response.status);
    }

    const index = (await response.json()) as RecipeIndex;

    // Cache it
    await this.writeCache('index.json', JSON.stringify(index));

    return index;
  }

  /** Search recipes by keyword */
  async search(query: string, options: { tags?: string[]; agent?: string; limit?: number } = {}): Promise<SearchResult> {
    const index = await this.fetchIndex();
    const limit = options.limit ?? 20;
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/).filter(Boolean);

    let entries = index.recipes.filter((entry) => {
      const searchable = `${entry.name} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase();
      return words.every((word) => searchable.includes(word));
    });

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      const tagsLower = options.tags.map((t) => t.toLowerCase());
      entries = entries.filter((e) =>
        tagsLower.some((t) => e.tags.map((et) => et.toLowerCase()).includes(t)),
      );
    }

    // Filter by agent
    if (options.agent) {
      entries = entries.filter((e) => e.sourceAgent === options.agent);
    }

    // Sort by downloads descending
    entries.sort((a, b) => b.downloads - a.downloads);

    return {
      entries: entries.slice(0, limit),
      total: entries.length,
      query,
    };
  }

  /** Pull a recipe by ID */
  async pull(recipeId: RecipeId): Promise<SharedRecipe> {
    const filepath = `${this.config.recipesDir}/${recipeId}.json`;
    const url = this.rawUrl(filepath);
    const response = await this.fetch(url);

    if (response.status === 404) {
      throw new RegistryError(`Recipe not found: ${recipeId}`, 404);
    }

    if (!response.ok) {
      throw new RegistryError(`Failed to fetch recipe: ${response.status}`, response.status);
    }

    return (await response.json()) as SharedRecipe;
  }

  /** List recipes from the registry */
  async list(options: { limit?: number; offset?: number } = {}): Promise<RecipeIndexEntry[]> {
    const index = await this.fetchIndex();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    return index.recipes
      .sort((a, b) => b.downloads - a.downloads)
      .slice(offset, offset + limit);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private apiUrl(filepath: string): string {
    return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/contents/${filepath}`;
  }

  private rawUrl(filepath: string): string {
    return `https://raw.githubusercontent.com/${this.config.owner}/${this.config.repo}/${this.config.branch}/${filepath}`;
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'agentgram-cli',
      ...(init?.headers as Record<string, string> ?? {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return globalThis.fetch(url, { ...init, headers });
  }

  private async putFile(filepath: string, base64Content: string, message: string): Promise<void> {
    const url = this.apiUrl(filepath);

    // Get existing file SHA if it exists (needed for updates)
    let sha: string | undefined;
    try {
      const existing = await this.fetch(url);
      if (existing.ok) {
        const data = (await existing.json()) as GitHubContentResponse;
        sha = data.sha;
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    const body: Record<string, string> = {
      message,
      content: base64Content,
      branch: this.config.branch,
    };
    if (sha) body.sha = sha;

    const response = await this.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new RegistryError(`Failed to upload ${filepath}: ${response.status} ${text}`, response.status);
    }
  }

  private async updateIndex(recipe: SharedRecipe): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Fetch current index
        const index = await this.fetchIndexFresh();

        // Add or update entry
        const entry: RecipeIndexEntry = {
          id: recipe.metadata.id,
          name: recipe.name,
          description: recipe.description,
          author: recipe.metadata.author,
          tags: recipe.tags,
          sourceAgent: recipe.metadata.sourceAgent,
          downloads: recipe.metadata.downloads,
          rating: recipe.metadata.rating,
          createdAt: recipe.metadata.createdAt,
          stepCount: recipe.steps.length,
        };

        const existingIdx = index.recipes.findIndex((r) => r.id === entry.id);
        if (existingIdx >= 0) {
          index.recipes[existingIdx] = entry;
        } else {
          index.recipes.push(entry);
        }

        index.updatedAt = new Date().toISOString();

        // Write updated index
        const encoded = Buffer.from(JSON.stringify(index, null, 2)).toString('base64');
        await this.putFile(this.config.indexPath, encoded, `Update index: add ${recipe.name}`);

        // Invalidate cache
        await this.clearCache('index.json');

        return;
      } catch (err) {
        if (attempt === maxRetries - 1) throw err;
        // Brief pause before retry (conflict)
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  /** Fetch index without cache (for writes) */
  private async fetchIndexFresh(): Promise<RecipeIndex> {
    const url = this.rawUrl(this.config.indexPath);
    const response = await this.fetch(url);

    if (response.status === 404) {
      return { version: '1', updatedAt: new Date().toISOString(), recipes: [] };
    }

    if (!response.ok) {
      throw new RegistryError(`Failed to fetch index: ${response.status}`, response.status);
    }

    return (await response.json()) as RecipeIndex;
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  private async readCache(filename: string): Promise<string | null> {
    try {
      const filepath = path.join(this.cacheDir, filename);
      const stat = await fs.stat(filepath);
      if (Date.now() - stat.mtimeMs > this.indexCacheTtlMs) return null;
      return await fs.readFile(filepath, 'utf8');
    } catch {
      return null;
    }
  }

  private async writeCache(filename: string, content: string): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(path.join(this.cacheDir, filename), content, 'utf8');
    } catch {
      // Cache write failure is non-fatal
    }
  }

  private async clearCache(filename: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.cacheDir, filename));
    } catch {
      // ignore
    }
  }
}
