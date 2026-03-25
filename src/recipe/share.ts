/**
 * Share Orchestration
 * Prepares a session for sharing: distill → parameterize → attach metadata
 */

import { createHash } from 'node:crypto';
import type { Session } from '../core/types.js';
import { RecipeDistiller } from './distill.js';
import type { SharedRecipe, ShareOptions } from './types.js';

/**
 * Generate a URL-safe recipe ID from a name.
 */
export function generateRecipeId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const hash = Math.random().toString(36).slice(2, 8);
  return `${slug}-${hash}`;
}

/**
 * Detect which agent created the session based on operation patterns.
 */
export function detectSourceAgent(session: Session): string {
  const tools = session.operations
    .map((op) => op.reason ?? '')
    .join(' ');

  if (tools.includes('Claude Code') || tools.includes('claude')) return 'claude-code';
  if (tools.includes('Cursor') || tools.includes('cursor')) return 'cursor';
  if (tools.includes('Copilot') || tools.includes('copilot')) return 'copilot';
  if (tools.includes('Aider') || tools.includes('aider')) return 'aider';

  // Check if captured via agentgram hooks
  if (session.operations.some((op) => op.reason?.includes('agentgram'))) return 'claude-code';

  return 'unknown';
}

/**
 * Compute a checksum for a recipe's content (for integrity verification).
 */
export function recipeChecksum(recipe: SharedRecipe): string {
  const content = JSON.stringify({
    name: recipe.name,
    steps: recipe.steps,
    parameters: recipe.parameters,
  });
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Prepare a session for sharing as a SharedRecipe.
 */
export function prepareForSharing(
  session: Session,
  options: ShareOptions = {},
): SharedRecipe {
  const distiller = new RecipeDistiller();

  // Distill and parameterize
  const raw = distiller.distill(session);
  const parameterized = distiller.parameterize(raw);

  // Override name/tags if provided
  const name = options.name ?? parameterized.name;
  const tags = options.tags ?? parameterized.tags;
  const sourceAgent = options.sourceAgent ?? detectSourceAgent(session);
  const author = options.author ?? 'anonymous';
  const id = generateRecipeId(name);
  const now = new Date().toISOString();

  const shared: SharedRecipe = {
    ...parameterized,
    name,
    tags,
    metadata: {
      id,
      author,
      createdAt: now,
      updatedAt: now,
      downloads: 0,
      rating: 0,
      ratingCount: 0,
      sourceAgent,
      checksum: '', // computed below
    },
  };

  shared.metadata.checksum = recipeChecksum(shared);

  return shared;
}
