import { describe, it, expect } from 'vitest';
import { pipe, parallel, branch, repeat, compose, toMermaid, toMarkdown } from '../../src/recipe/compose.js';
import type { Recipe } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(name: string, steps: number, tags: string[] = []): Recipe {
  return {
    name,
    description: `${name} description`,
    sourceSessionId: `sess-${name}`,
    steps: Array.from({ length: steps }, (_, i) => ({
      action: i % 2 === 0 ? 'find' : 'modify_file',
      target: `${name}/file-${i}.ts`,
      description: `Step ${i + 1} of ${name}`,
    })),
    parameters: { [`${name}Param`]: 'default' },
    tags,
    version: '1.0.0',
  };
}

const authRecipe = makeRecipe('setup-auth', 6, ['auth', 'jwt', 'typescript']);
const testRecipe = makeRecipe('add-tests', 4, ['testing', 'vitest', 'typescript']);
const lintRecipe = makeRecipe('add-linting', 3, ['lint', 'eslint']);
const formatRecipe = makeRecipe('add-formatting', 3, ['format', 'prettier']);

// ---------------------------------------------------------------------------
// pipe()
// ---------------------------------------------------------------------------

describe('pipe() — sequential composition', () => {
  it('combines steps from multiple recipes in order', () => {
    const result = pipe('auth + tests', authRecipe, testRecipe);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeLessThanOrEqual(authRecipe.steps.length + testRecipe.steps.length);
  });

  it('merges tags from all recipes', () => {
    const result = pipe('auth + tests', authRecipe, testRecipe);
    expect(result.tags).toContain('auth');
    expect(result.tags).toContain('jwt');
    expect(result.tags).toContain('testing');
    expect(result.tags).toContain('vitest');
    // Deduplicates: typescript appears in both but only once
    expect(result.tags.filter((t) => t === 'typescript')).toHaveLength(1);
  });

  it('merges parameters from all recipes', () => {
    const result = pipe('auth + tests', authRecipe, testRecipe);
    expect(result.parameters).toHaveProperty('setup-authParam');
    expect(result.parameters).toHaveProperty('add-testsParam');
  });

  it('deduplicates consecutive reads of the same file', () => {
    const recipeA: Recipe = {
      name: 'A',
      description: 'A',
      sourceSessionId: 'a',
      steps: [
        { action: 'find', target: 'package.json', description: 'check deps' },
        { action: 'modify_file', target: 'src/a.ts', description: 'add feature' },
      ],
      parameters: {},
      tags: [],
      version: '1.0.0',
    };
    const recipeB: Recipe = {
      name: 'B',
      description: 'B',
      sourceSessionId: 'b',
      steps: [
        { action: 'find', target: 'package.json', description: 'also check deps' }, // duplicate!
        { action: 'modify_file', target: 'src/b.ts', description: 'add other feature' },
      ],
      parameters: {},
      tags: [],
      version: '1.0.0',
    };

    const result = pipe('A + B', recipeA, recipeB);
    // package.json should only be read once
    const packageJsonReads = result.steps.filter(
      (s) => s.target === 'package.json' && s.action === 'find',
    );
    expect(packageJsonReads).toHaveLength(1);
  });

  it('sets correct name and description', () => {
    const result = pipe('My Pipeline', authRecipe, testRecipe);
    expect(result.name).toBe('My Pipeline');
    expect(result.description).toContain('setup-auth');
    expect(result.description).toContain('add-tests');
  });

  it('includes composition metadata', () => {
    const result = pipe('pipeline', authRecipe, testRecipe);
    expect(result.composition.nodes).toHaveLength(2);
    expect(result.composition.nodes[0].mode).toBe('pipe');
    expect(result.composition.totalSteps).toBeGreaterThan(0);
    expect(result.composition.overlapFactor).toBeGreaterThan(0);
    expect(result.composition.overlapFactor).toBeLessThanOrEqual(1);
  });

  it('throws if no recipes provided', () => {
    expect(() => pipe('empty')).toThrow();
  });

  it('works with a single recipe', () => {
    const result = pipe('solo', authRecipe);
    expect(result.steps).toHaveLength(authRecipe.steps.length);
    expect(result.name).toBe('solo');
  });

  it('handles 3+ recipes in sequence', () => {
    const result = pipe('full stack', authRecipe, testRecipe, lintRecipe);
    expect(result.composition.nodes).toHaveLength(3);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parallel()
// ---------------------------------------------------------------------------

describe('parallel() — concurrent composition', () => {
  it('interleaves steps round-robin', () => {
    const result = parallel('linting setup', lintRecipe, formatRecipe);
    // Round-robin: lint[0], format[0], lint[1], format[1], lint[2], format[2]
    expect(result.steps).toHaveLength(lintRecipe.steps.length + formatRecipe.steps.length);
  });

  it('has overlap factor of 1 (no deduplication)', () => {
    const result = parallel('parallel', lintRecipe, formatRecipe);
    expect(result.composition.overlapFactor).toBe(1);
  });

  it('marks all nodes as parallel mode', () => {
    const result = parallel('parallel', lintRecipe, formatRecipe);
    for (const node of result.composition.nodes) {
      expect(node.mode).toBe('parallel');
    }
  });

  it('description uses ∥ separator', () => {
    const result = parallel('parallel', lintRecipe, formatRecipe);
    expect(result.description).toContain('∥');
  });

  it('throws if no recipes provided', () => {
    expect(() => parallel('empty')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// branch()
// ---------------------------------------------------------------------------

describe('branch() — conditional composition', () => {
  it('includes steps from both branches', () => {
    const result = branch('auth-by-orm', 'has:prisma', authRecipe, testRecipe);
    // Both branch steps are included (with [if] / [else] prefixes)
    const ifSteps = result.steps.filter((s) => s.description.includes('[if'));
    const elseSteps = result.steps.filter((s) => s.description.includes('[else]'));
    expect(ifSteps.length).toBeGreaterThan(0);
    expect(elseSteps.length).toBeGreaterThan(0);
  });

  it('works without else branch', () => {
    const result = branch('maybe-auth', 'has:prisma', authRecipe);
    expect(result.composition.nodes).toHaveLength(1);
    expect(result.steps.length).toBe(authRecipe.steps.length);
  });

  it('includes condition in description', () => {
    const result = branch('auth-by-orm', 'has:prisma', authRecipe, testRecipe);
    expect(result.description).toContain('has:prisma');
    expect(result.description).toContain('setup-auth');
    expect(result.description).toContain('add-tests');
  });

  it('has overlap factor of 0.5 (one branch skipped at runtime)', () => {
    const result = branch('branch', 'condition', authRecipe, testRecipe);
    expect(result.composition.overlapFactor).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// repeat()
// ---------------------------------------------------------------------------

describe('repeat() — loop composition', () => {
  it('repeats steps N times', () => {
    const result = repeat('repeat-auth-3x', authRecipe, 3);
    expect(result.steps).toHaveLength(authRecipe.steps.length * 3);
  });

  it('adds iteration labels to descriptions', () => {
    const result = repeat('repeat', authRecipe, 2);
    expect(result.steps[0].description).toContain('[iteration 1/2]');
    expect(result.steps[authRecipe.steps.length].description).toContain('[iteration 2/2]');
  });

  it('preserves original tags', () => {
    const result = repeat('repeat', authRecipe, 2);
    expect(result.tags).toEqual(authRecipe.tags);
  });
});

// ---------------------------------------------------------------------------
// compose() convenience function
// ---------------------------------------------------------------------------

describe('compose() — convenience wrapper', () => {
  it('returns composed recipe, markdown, and mermaid', () => {
    const result = compose('full pipeline', authRecipe, testRecipe);
    expect(result.composed).toBeDefined();
    expect(result.markdown).toBeDefined();
    expect(result.mermaid).toBeDefined();
  });

  it('markdown includes recipe names', () => {
    const result = compose('my pipeline', authRecipe, testRecipe);
    expect(result.markdown).toContain('setup-auth');
    expect(result.markdown).toContain('add-tests');
  });

  it('mermaid includes flowchart directive', () => {
    const result = compose('pipeline', authRecipe, testRecipe);
    expect(result.mermaid).toContain('flowchart');
  });
});

// ---------------------------------------------------------------------------
// toMermaid()
// ---------------------------------------------------------------------------

describe('toMermaid()', () => {
  it('generates valid mermaid for pipe', () => {
    const composed = pipe('pipeline', authRecipe, testRecipe);
    const diagram = toMermaid(composed);
    expect(diagram).toContain('flowchart');
    expect(diagram).toContain('setup-auth');
    expect(diagram).toContain('add-tests');
  });

  it('generates valid mermaid for parallel', () => {
    const composed = parallel('parallel', lintRecipe, formatRecipe);
    const diagram = toMermaid(composed);
    expect(diagram).toContain('flowchart');
  });
});

// ---------------------------------------------------------------------------
// toMarkdown()
// ---------------------------------------------------------------------------

describe('toMarkdown()', () => {
  it('generates markdown with heading', () => {
    const composed = pipe('my pipeline', authRecipe, testRecipe);
    const md = toMarkdown(composed);
    expect(md).toContain('# my pipeline');
    expect(md).toContain('## Steps');
  });

  it('includes step count', () => {
    const composed = pipe('pipeline', authRecipe, testRecipe);
    const md = toMarkdown(composed);
    expect(md).toContain('Steps:');
  });

  it('mentions all recipe names in pipeline section', () => {
    const composed = pipe('full', authRecipe, testRecipe, lintRecipe);
    const md = toMarkdown(composed);
    expect(md).toContain('setup-auth');
    expect(md).toContain('add-tests');
    expect(md).toContain('add-linting');
  });
});
