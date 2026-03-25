/**
 * Types for the recipe sharing system.
 * SharedRecipe extends Recipe with registry metadata.
 */

import type { Recipe } from '../core/types.js';

/** Unique, URL-safe identifier for a shared recipe */
export type RecipeId = string;

/** Metadata added when a recipe is published to the registry */
export interface RecipeMetadata {
  id: RecipeId;
  author: string;
  createdAt: string;
  updatedAt: string;
  downloads: number;
  rating: number;
  ratingCount: number;
  sourceAgent: string;
  checksum: string;
}

/** A recipe published to the registry */
export interface SharedRecipe extends Recipe {
  metadata: RecipeMetadata;
}

/** Entry in the registry index for fast search */
export interface RecipeIndexEntry {
  id: RecipeId;
  name: string;
  description: string;
  author: string;
  tags: string[];
  sourceAgent: string;
  downloads: number;
  rating: number;
  createdAt: string;
  stepCount: number;
}

/** The full registry index */
export interface RecipeIndex {
  version: string;
  updatedAt: string;
  recipes: RecipeIndexEntry[];
}

/** Configuration for the recipe registry */
export interface RegistryConfig {
  owner: string;
  repo: string;
  branch: string;
  indexPath: string;
  recipesDir: string;
}

export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  owner: 'eclaireai',
  repo: 'agentgram-recipes',
  branch: 'main',
  indexPath: 'index.json',
  recipesDir: 'recipes',
};

/** Search result */
export interface SearchResult {
  entries: RecipeIndexEntry[];
  total: number;
  query: string;
}

/** Options for sharing a recipe */
export interface ShareOptions {
  name?: string;
  tags?: string[];
  sourceAgent?: string;
  author?: string;
}
