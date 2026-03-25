/**
 * Local Recipe Store
 * Manages .agentgram/recipes/ directory for downloaded/shared recipes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { SharedRecipe, RecipeId } from './types.js';

export class LocalRecipeStore {
  private recipesDir: string;

  constructor(cwd: string) {
    this.recipesDir = path.join(cwd, '.agentgram', 'recipes');
  }

  /** Ensure the recipes directory exists */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.recipesDir, { recursive: true });
  }

  /** Save a recipe to the local store */
  async save(recipe: SharedRecipe): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.recipesDir, `${recipe.metadata.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(recipe, null, 2), 'utf8');
  }

  /** Load a recipe by ID */
  async load(recipeId: RecipeId): Promise<SharedRecipe> {
    const filePath = path.join(this.recipesDir, `${recipeId}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as SharedRecipe;
  }

  /** List all locally stored recipes */
  async list(): Promise<SharedRecipe[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.recipesDir);
    } catch {
      return [];
    }

    const recipes: SharedRecipe[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.recipesDir, entry), 'utf8');
        recipes.push(JSON.parse(raw) as SharedRecipe);
      } catch {
        // skip corrupted
      }
    }

    return recipes.sort((a, b) => b.metadata.downloads - a.metadata.downloads);
  }

  /** Remove a recipe from the local store */
  async remove(recipeId: RecipeId): Promise<void> {
    const filePath = path.join(this.recipesDir, `${recipeId}.json`);
    await fs.unlink(filePath);
  }

  /** Check if a recipe exists locally */
  async exists(recipeId: RecipeId): Promise<boolean> {
    try {
      await fs.access(path.join(this.recipesDir, `${recipeId}.json`));
      return true;
    } catch {
      return false;
    }
  }

  /** Get the path to the recipes directory */
  getStorePath(): string {
    return this.recipesDir;
  }
}
