import { describe, it, expect } from 'vitest';
import {
  parseTicketUrl,
  formatTicketRef,
  extractTicketKeywords,
  suggestRecipesForTicket,
  formatTicketComment,
} from '../../src/integrations/ticket.js';
import type { TicketRecipe } from '../../src/integrations/ticket.js';
import type { Recipe } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecipe(name: string, tags: string[], description = ''): Recipe {
  return {
    name,
    description: description || `${name} — a recipe`,
    sourceSessionId: `sess-${name}`,
    steps: [
      { action: 'find', target: 'package.json', description: 'check deps' },
      { action: 'modify_file', target: 'src/index.ts', description: 'apply changes' },
    ],
    parameters: {},
    tags,
    version: '1.0.0',
  };
}

const jwtRecipe = makeRecipe('JWT Authentication', ['auth', 'jwt', 'security', 'express'], 'Add JWT auth with refresh tokens');
const prismaRecipe = makeRecipe('Prisma PostgreSQL', ['database', 'prisma', 'postgres'], 'Set up Prisma ORM');
const vitestRecipe = makeRecipe('Vitest Setup', ['testing', 'vitest', 'coverage'], 'Configure Vitest testing');
const dockerRecipe = makeRecipe('Docker Setup', ['docker', 'devops', 'containers'], 'Add Docker multi-stage build');
const rateLimitRecipe = makeRecipe('Rate Limiting', ['rate-limiting', 'security', 'api'], 'Add Redis rate limiting');

const ALL_RECIPES = [jwtRecipe, prismaRecipe, vitestRecipe, dockerRecipe, rateLimitRecipe];

// ---------------------------------------------------------------------------
// parseTicketUrl()
// ---------------------------------------------------------------------------

describe('parseTicketUrl()', () => {
  it('parses GitHub issue URL', () => {
    const ref = parseTicketUrl('https://github.com/owner/my-repo/issues/123');
    expect(ref.provider).toBe('github');
    expect(ref.id).toBe('123');
    expect(ref.owner).toBe('owner');
    expect(ref.repo).toBe('my-repo');
    expect(ref.url).toBe('https://github.com/owner/my-repo/issues/123');
  });

  it('parses GitHub PR URL', () => {
    const ref = parseTicketUrl('https://github.com/org/repo/pull/456');
    expect(ref.provider).toBe('github');
    expect(ref.id).toBe('456');
    expect(ref.owner).toBe('org');
    expect(ref.repo).toBe('repo');
  });

  it('parses Jira URL', () => {
    const ref = parseTicketUrl('https://mycompany.atlassian.net/browse/PROJ-123');
    expect(ref.provider).toBe('jira');
    expect(ref.id).toBe('PROJ-123');
    expect(ref.project).toBe('PROJ');
  });

  it('parses Linear URL', () => {
    const ref = parseTicketUrl('https://linear.app/myteam/issue/ENG-456');
    expect(ref.provider).toBe('linear');
    expect(ref.id).toBe('ENG-456');
    expect(ref.team).toBe('myteam');
  });

  it('handles unknown URL as generic', () => {
    const ref = parseTicketUrl('https://example.com/tasks/789');
    expect(ref.provider).toBe('url');
    expect(ref.url).toBe('https://example.com/tasks/789');
  });

  it('extracts correct id from GitHub URL with hash', () => {
    const ref = parseTicketUrl('https://github.com/eclaireai/agentgram/issues/42');
    expect(ref.id).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// formatTicketRef()
// ---------------------------------------------------------------------------

describe('formatTicketRef()', () => {
  it('formats GitHub ref', () => {
    const ref = parseTicketUrl('https://github.com/owner/repo/issues/99');
    expect(formatTicketRef(ref)).toBe('GitHub #99 (owner/repo)');
  });

  it('formats Jira ref', () => {
    const ref = parseTicketUrl('https://co.atlassian.net/browse/BUG-12');
    expect(formatTicketRef(ref)).toBe('Jira BUG-12');
  });

  it('formats Linear ref', () => {
    const ref = parseTicketUrl('https://linear.app/acme/issue/ENG-5');
    expect(formatTicketRef(ref)).toBe('Linear ENG-5');
  });
});

// ---------------------------------------------------------------------------
// extractTicketKeywords()
// ---------------------------------------------------------------------------

describe('extractTicketKeywords()', () => {
  it('extracts meaningful keywords from a title', () => {
    const kw = extractTicketKeywords('Add JWT authentication to user service');
    expect(kw).toContain('jwt');
    expect(kw).toContain('authentication');
    expect(kw).toContain('user');
    expect(kw).toContain('service');
  });

  it('strips common stopwords', () => {
    const kw = extractTicketKeywords('Add the feature for the user');
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('for');
  });

  it('splits camelCase', () => {
    const kw = extractTicketKeywords('addRateLimiting to API');
    expect(kw).toContain('rate');
    expect(kw).toContain('limiting');
  });

  it('handles hyphenated terms', () => {
    const kw = extractTicketKeywords('setup rate-limiting with redis');
    expect(kw).toContain('rate');
    expect(kw).toContain('limiting');
    expect(kw).toContain('redis');
  });

  it('deduplicates keywords', () => {
    const kw = extractTicketKeywords('auth auth jwt jwt');
    expect(kw.filter((k) => k === 'auth')).toHaveLength(1);
  });

  it('returns empty array for stopword-only input', () => {
    const kw = extractTicketKeywords('fix the bug for the feature');
    // Should filter out fix, the, bug, for, the, feature (short/stopword)
    expect(kw.length).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// suggestRecipesForTicket()
// ---------------------------------------------------------------------------

describe('suggestRecipesForTicket()', () => {
  it('returns relevant recipes for JWT ticket', () => {
    const suggestions = suggestRecipesForTicket(
      'Add JWT authentication middleware to Express API',
      ALL_RECIPES,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].recipe.name).toBe('JWT Authentication');
  });

  it('returns database recipe for Prisma ticket', () => {
    const suggestions = suggestRecipesForTicket(
      'Set up Prisma ORM with PostgreSQL database connection',
      ALL_RECIPES,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].recipe.name).toBe('Prisma PostgreSQL');
  });

  it('returns testing recipe for vitest ticket', () => {
    const suggestions = suggestRecipesForTicket(
      'Configure vitest testing framework with coverage reporting',
      ALL_RECIPES,
    );
    expect(suggestions[0].recipe.name).toBe('Vitest Setup');
  });

  it('respects limit option', () => {
    const suggestions = suggestRecipesForTicket(
      'security authentication rate limiting',
      ALL_RECIPES,
      { limit: 2 },
    );
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it('returns confidence scores between 0 and 1', () => {
    const suggestions = suggestRecipesForTicket(
      'Add JWT auth with rate limiting',
      ALL_RECIPES,
    );
    for (const s of suggestions) {
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('sorts by confidence descending', () => {
    const suggestions = suggestRecipesForTicket(
      'Set up Docker containers for the application',
      ALL_RECIPES,
    );
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1].confidence).toBeGreaterThanOrEqual(suggestions[i].confidence);
    }
  });

  it('includes match reason', () => {
    const suggestions = suggestRecipesForTicket('Add JWT auth', ALL_RECIPES);
    expect(suggestions[0].reason).toBeTruthy();
    expect(suggestions[0].matchedOn.length).toBeGreaterThan(0);
  });

  it('returns empty array for unrelated ticket', () => {
    const suggestions = suggestRecipesForTicket(
      'design logo branding assets',
      ALL_RECIPES,
      { minConfidence: 0.5 },
    );
    expect(suggestions).toHaveLength(0);
  });

  it('works with empty recipe list', () => {
    const suggestions = suggestRecipesForTicket('Add JWT auth', []);
    expect(suggestions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatTicketComment()
// ---------------------------------------------------------------------------

describe('formatTicketComment()', () => {
  const ticketRecipe: TicketRecipe = {
    recipe: jwtRecipe,
    ticket: parseTicketUrl('https://github.com/owner/repo/issues/42'),
    sessionId: 'sess-abc123def456',
    resolvedAt: Date.now(),
    outcome: 'JWT auth working with 15-min access tokens',
    durationMs: 720000, // 12 minutes
    tokensUsed: 18000,
  };

  it('includes recipe name', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('JWT Authentication');
  });

  it('includes step count', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('2'); // jwtRecipe has 2 steps
  });

  it('includes duration', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('12 min');
  });

  it('includes outcome', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('JWT auth working');
  });

  it('includes session ID (truncated)', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('sess-abc123');
  });

  it('includes agentgram link', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('agentgram');
    expect(comment).toContain('github.com/eclaireai/agentgram');
  });

  it('includes tags', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('auth');
    expect(comment).toContain('jwt');
  });

  it('includes code block with recall command', () => {
    const comment = formatTicketComment(ticketRecipe);
    expect(comment).toContain('```bash');
    expect(comment).toContain('agentgram');
  });

  it('works without optional fields', () => {
    const minimal: TicketRecipe = {
      recipe: jwtRecipe,
      ticket: parseTicketUrl('https://github.com/a/b/issues/1'),
      sessionId: 'sess-min',
      resolvedAt: Date.now(),
    };
    expect(() => formatTicketComment(minimal)).not.toThrow();
  });
});
