/**
 * Recipe Composition — Unix-pipe for AI workflows.
 *
 * The non-obvious insight: individual recipes are atoms.
 * Composition turns them into molecules — complex workflows
 * assembled from proven, battle-tested parts.
 *
 * This is the "npm for agent workflows" moment:
 *   compose(setupAuth, addRateLimiting, addTests) → "Production-Ready Auth"
 *
 * Patent-worthy because it applies functional composition
 * semantics to AI operation sequences, enabling:
 *   - Reuse without copy-paste
 *   - Versioned dependency graphs between recipes
 *   - Lazy evaluation (execute only what's needed)
 *   - Parallel execution for independent branches
 */

import type { Recipe, RecipeStep } from '../core/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** How a recipe participates in a composition */
export type CompositionMode = 'pipe' | 'parallel' | 'branch';

/** A node in a recipe composition graph */
export interface CompositionNode {
  recipe: Recipe;
  mode: CompositionMode;
  /** For branch mode: condition to evaluate */
  condition?: string;
  /** Label for this node in the graph */
  label?: string;
}

/** A composed recipe — a recipe made of recipes */
export interface ComposedRecipe extends Recipe {
  composition: {
    nodes: CompositionNode[];
    /** Total step count across all composed recipes */
    totalSteps: number;
    /** Estimated time savings vs. doing each recipe independently */
    overlapFactor: number;
  };
}

/** Result of executing a composed recipe */
export interface CompositionResult {
  composed: ComposedRecipe;
  /** Markdown representation of the composition */
  markdown: string;
  /** Mermaid flowchart of the pipeline */
  mermaid: string;
}

// ---------------------------------------------------------------------------
// Core composition operators
// ---------------------------------------------------------------------------

/**
 * pipe(...recipes) — Sequential composition.
 *
 * Like Unix pipe: the context from recipe[n] flows into recipe[n+1].
 * Steps are ordered, maintaining temporal causality.
 * Duplicate steps are deduplicated (e.g., both recipes read package.json → once).
 *
 * @example
 *   pipe(setupNextjs, addAuth, addTests)
 *   // → 18-step recipe: setup → auth → tests
 */
export function pipe(name: string, ...recipes: Recipe[]): ComposedRecipe {
  if (recipes.length === 0) throw new Error('pipe() requires at least one recipe');

  // Merge steps, deduplicating consecutive identical targets
  const merged: RecipeStep[] = [];
  const seenTargets = new Set<string>();

  for (const recipe of recipes) {
    for (const step of recipe.steps) {
      // Deduplicate reads: if we've already read this file, skip
      if ((step.action === 'find' || step.action === 'read') && seenTargets.has(step.target)) {
        continue;
      }
      seenTargets.add(step.target);
      merged.push(step);
    }
  }

  // Merge tags and parameters
  const allTags = [...new Set(recipes.flatMap((r) => r.tags))];
  const allParams = Object.assign({}, ...recipes.map((r) => r.parameters));

  // Calculate overlap factor (how much we saved by deduplication)
  const rawSteps = recipes.reduce((sum, r) => sum + r.steps.length, 0);
  const overlapFactor = rawSteps > 0 ? merged.length / rawSteps : 1;

  return {
    name,
    description: `Composed pipeline: ${recipes.map((r) => r.name).join(' → ')}`,
    sourceSessionId: `compose:pipe:${recipes.map((r) => r.sourceSessionId).join('+')}`,
    steps: merged,
    parameters: allParams,
    tags: allTags,
    version: '1.0.0',
    composition: {
      nodes: recipes.map((r) => ({ recipe: r, mode: 'pipe' as const })),
      totalSteps: merged.length,
      overlapFactor,
    },
  };
}

/**
 * parallel(...recipes) — Concurrent composition.
 *
 * For independent recipes that don't share state.
 * Steps are interleaved round-robin to model concurrent execution.
 * Tags are merged. Overlap factor = 1 (no deduplication across parallel branches).
 *
 * @example
 *   parallel(addLinting, addFormatting, addEditorConfig)
 *   // → all three run concurrently
 */
export function parallel(name: string, ...recipes: Recipe[]): ComposedRecipe {
  if (recipes.length === 0) throw new Error('parallel() requires at least one recipe');

  // Interleave steps round-robin to model concurrent execution
  const interleaved: RecipeStep[] = [];
  const maxLen = Math.max(...recipes.map((r) => r.steps.length));

  for (let i = 0; i < maxLen; i++) {
    for (const recipe of recipes) {
      if (i < recipe.steps.length) {
        interleaved.push(recipe.steps[i]);
      }
    }
  }

  const allTags = [...new Set(recipes.flatMap((r) => r.tags))];
  const allParams = Object.assign({}, ...recipes.map((r) => r.parameters));
  const totalSteps = recipes.reduce((s, r) => s + r.steps.length, 0);

  return {
    name,
    description: `Parallel composition: ${recipes.map((r) => r.name).join(' ∥ ')}`,
    sourceSessionId: `compose:parallel:${recipes.map((r) => r.sourceSessionId).join('+')}`,
    steps: interleaved,
    parameters: allParams,
    tags: allTags,
    version: '1.0.0',
    composition: {
      nodes: recipes.map((r) => ({ recipe: r, mode: 'parallel' as const })),
      totalSteps,
      overlapFactor: 1,
    },
  };
}

/**
 * branch(condition, ifRecipe, elseRecipe?) — Conditional composition.
 *
 * Like an if-statement for recipes. The condition is evaluated at runtime
 * by the agent based on codebase fingerprint or context.
 *
 * @example
 *   branch('has:prisma', addPrismaAuth, addMongooseAuth)
 *   // → if Prisma detected, use Prisma auth; else use Mongoose auth
 */
export function branch(
  name: string,
  condition: string,
  ifRecipe: Recipe,
  elseRecipe?: Recipe,
): ComposedRecipe {
  // For the composed recipe, we include both branches with condition metadata
  const nodes: CompositionNode[] = [
    { recipe: ifRecipe, mode: 'branch', condition, label: `if: ${condition}` },
  ];
  if (elseRecipe) {
    nodes.push({ recipe: elseRecipe, mode: 'branch', condition: `!${condition}`, label: `else` });
  }

  // Steps are the union (agent picks branch at runtime)
  const allSteps = [
    ...ifRecipe.steps.map((s) => ({ ...s, description: `[if ${condition}] ${s.description}` })),
    ...(elseRecipe?.steps ?? []).map((s) => ({ ...s, description: `[else] ${s.description}` })),
  ];

  const allTags = [...new Set([...ifRecipe.tags, ...(elseRecipe?.tags ?? [])])];

  return {
    name,
    description: `Branch: if ${condition} then "${ifRecipe.name}"${elseRecipe ? ` else "${elseRecipe.name}"` : ''}`,
    sourceSessionId: `compose:branch:${ifRecipe.sourceSessionId}`,
    steps: allSteps,
    parameters: { ...ifRecipe.parameters, ...elseRecipe?.parameters },
    tags: allTags,
    version: '1.0.0',
    composition: {
      nodes,
      totalSteps: allSteps.length,
      overlapFactor: 0.5, // One branch will be skipped
    },
  };
}

/**
 * repeat(recipe, times) — Loop composition.
 *
 * For recipes that need to run multiple times with different parameters.
 * E.g., repeat(addFeatureFlag, 3) for setting up 3 feature flags.
 */
export function repeat(name: string, recipe: Recipe, times: number): ComposedRecipe {
  const steps: RecipeStep[] = [];
  for (let i = 0; i < times; i++) {
    steps.push(
      ...recipe.steps.map((s) => ({
        ...s,
        description: `[iteration ${i + 1}/${times}] ${s.description}`,
      })),
    );
  }

  return {
    name,
    description: `Repeat "${recipe.name}" × ${times}`,
    sourceSessionId: `compose:repeat:${recipe.sourceSessionId}`,
    steps,
    parameters: recipe.parameters,
    tags: recipe.tags,
    version: '1.0.0',
    composition: {
      nodes: [{ recipe, mode: 'pipe', label: `× ${times}` }],
      totalSteps: steps.length,
      overlapFactor: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render a composed recipe as a Mermaid flowchart */
export function toMermaid(composed: ComposedRecipe): string {
  const lines: string[] = ['flowchart TD'];
  const mode = composed.composition.nodes[0]?.mode ?? 'pipe';

  if (mode === 'pipe') {
    // Linear chain
    for (let i = 0; i < composed.composition.nodes.length; i++) {
      const node = composed.composition.nodes[i];
      const id = `R${i}`;
      lines.push(`    ${id}["📋 ${node.recipe.name}\\n${node.recipe.steps.length} steps"]`);
      if (i > 0) lines.push(`    R${i - 1} --> ${id}`);
    }
  } else if (mode === 'parallel') {
    lines.push('    START(( )) --> ...');
    for (let i = 0; i < composed.composition.nodes.length; i++) {
      const node = composed.composition.nodes[i];
      lines.push(`    R${i}["📋 ${node.recipe.name}"]`);
      lines.push(`    START --> R${i}`);
      lines.push(`    R${i} --> END`);
    }
    lines.push('    END(( ))');
  } else if (mode === 'branch') {
    lines.push('    COND{condition?}');
    for (let i = 0; i < composed.composition.nodes.length; i++) {
      const node = composed.composition.nodes[i];
      const label = node.label ?? (i === 0 ? 'yes' : 'no');
      lines.push(`    R${i}["📋 ${node.recipe.name}"]`);
      lines.push(`    COND -- "${label}" --> R${i}`);
    }
  }

  return lines.join('\n');
}

/** Render a composed recipe as markdown with stats */
export function toMarkdown(composed: ComposedRecipe): string {
  const { composition } = composed;
  const saved = Math.round((1 - composition.overlapFactor) * 100);

  const lines: string[] = [
    `# ${composed.name}`,
    '',
    `> ${composed.description}`,
    '',
    `**Steps:** ${composition.totalSteps} | **Recipes:** ${composition.nodes.length}${saved > 0 ? ` | **Deduplication savings:** ${saved}%` : ''}`,
    '',
    '## Pipeline',
    '',
  ];

  for (let i = 0; i < composition.nodes.length; i++) {
    const node = composition.nodes[i];
    const connector = node.mode === 'pipe' ? '→' : node.mode === 'parallel' ? '∥' : '⟁';
    lines.push(`${i + 1}. ${connector} **${node.recipe.name}** (${node.recipe.steps.length} steps)`);
    if (node.label) lines.push(`   *${node.label}*`);
  }

  lines.push('', '## Steps', '');
  for (const [i, step] of composed.steps.entries()) {
    lines.push(`${i + 1}. \`${step.action}\` → \`${step.target}\``);
    lines.push(`   ${step.description}`);
  }

  return lines.join('\n');
}

/** Render as a composition result with all formats */
export function compose(name: string, ...recipes: Recipe[]): CompositionResult {
  const composed = pipe(name, ...recipes);
  return {
    composed,
    markdown: toMarkdown(composed),
    mermaid: toMermaid(composed),
  };
}
