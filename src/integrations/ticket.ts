/**
 * Ticket Integration — the missing link between AI sessions and work.
 *
 * The insight: every Claude/Cursor session that resolves a ticket is a recipe.
 * That recipe should live next to the ticket — forever searchable, forever reusable.
 *
 * Flow:
 *   1. Developer opens a ticket (GitHub, Jira, Linear)
 *   2. agentgram SUGGESTS relevant recipes before work begins
 *   3. Developer uses Claude/Cursor — session is recorded
 *   4. agentgram RESOLVES: distills session → recipe → links to ticket → posts to PR
 *   5. Team now has documented, searchable knowledge of how this was solved
 *
 * 6 months later: "how did we add rate limiting?" → search → find the exact recipe
 * from ticket #47 with provenance, steps, and outcome. Zero tribal knowledge loss.
 */

import type { Recipe } from '../core/types.js';
import type { SharedRecipe } from '../recipe/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported ticket providers */
export type TicketProvider = 'github' | 'jira' | 'linear' | 'notion' | 'url';

/** A parsed ticket reference */
export interface TicketRef {
  provider: TicketProvider;
  /** Full URL to the ticket */
  url: string;
  /** Provider-specific ID (e.g. "123", "PROJ-456") */
  id: string;
  /** Repository owner (GitHub only) */
  owner?: string;
  /** Repository name (GitHub only) */
  repo?: string;
  /** Project key (Jira only) */
  project?: string;
  /** Team key (Linear only) */
  team?: string;
}

/** A recipe linked to a ticket */
export interface TicketRecipe {
  /** The distilled recipe */
  recipe: Recipe | SharedRecipe;
  /** The ticket this recipe resolved */
  ticket: TicketRef;
  /** Session ID that produced this recipe */
  sessionId: string;
  /** When the link was created */
  resolvedAt: number;
  /** Short summary of the outcome */
  outcome?: string;
  /** PR/commit URL that shipped this */
  prUrl?: string;
  /** Time taken in milliseconds */
  durationMs?: number;
  /** Estimated tokens used */
  tokensUsed?: number;
}

/** A suggested recipe for an open ticket */
export interface RecipeSuggestion {
  recipe: Recipe | SharedRecipe;
  /** Why this recipe was suggested */
  reason: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Which part of the ticket matched */
  matchedOn: string[];
}

// ---------------------------------------------------------------------------
// Ticket URL parser
// ---------------------------------------------------------------------------

/**
 * parseTicketUrl() — Parse any ticket URL into a structured TicketRef.
 *
 * Supports:
 *   GitHub:  https://github.com/owner/repo/issues/123
 *            https://github.com/owner/repo/pull/456
 *   Jira:    https://company.atlassian.net/browse/PROJ-123
 *   Linear:  https://linear.app/team/issue/TEAM-123
 *   Generic: any URL (stored as-is)
 */
export function parseTicketUrl(url: string): TicketRef {
  // GitHub issue/PR
  const ghMatch = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/,
  );
  if (ghMatch) {
    return {
      provider: 'github',
      url,
      id: ghMatch[4],
      owner: ghMatch[1],
      repo: ghMatch[2],
    };
  }

  // Jira
  const jiraMatch = url.match(/atlassian\.net\/browse\/([A-Z]+-\d+)/);
  if (jiraMatch) {
    return {
      provider: 'jira',
      url,
      id: jiraMatch[1],
      project: jiraMatch[1].split('-')[0],
    };
  }

  // Linear
  const linearMatch = url.match(/linear\.app\/([^/]+)\/issue\/([A-Z]+-\d+)/);
  if (linearMatch) {
    return {
      provider: 'linear',
      url,
      id: linearMatch[2],
      team: linearMatch[1],
    };
  }

  // Fallback: treat as opaque URL
  const id = url.split('/').pop() ?? url;
  return { provider: 'url', url, id };
}

/**
 * formatTicketRef() — Human-readable ticket reference.
 * e.g. "GitHub #123 (owner/repo)" or "Jira PROJ-456"
 */
export function formatTicketRef(ref: TicketRef): string {
  switch (ref.provider) {
    case 'github':
      return `GitHub #${ref.id} (${ref.owner}/${ref.repo})`;
    case 'jira':
      return `Jira ${ref.id}`;
    case 'linear':
      return `Linear ${ref.id}`;
    default:
      return ref.url;
  }
}

// ---------------------------------------------------------------------------
// Ticket text extraction for recipe matching
// ---------------------------------------------------------------------------

/**
 * extractTicketKeywords() — Pull meaningful terms from a ticket URL or title.
 *
 * Used to find relevant recipes before work begins.
 * E.g. "Add JWT auth to user service" → ['jwt', 'auth', 'user', 'service']
 */
export function extractTicketKeywords(input: string): string[] {
  // Strip URLs, punctuation, camelCase split
  const text = input
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_/]/g, ' ')
    .toLowerCase();

  const tokens = text.split(/\s+/).filter((t) => t.length > 2);

  const stopwords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'add', 'fix', 'bug',
    'feat', 'feature', 'implement', 'update', 'refactor', 'change',
    'should', 'need', 'want', 'make', 'also', 'this', 'that', 'with',
  ]);

  return [...new Set(tokens.filter((t) => !stopwords.has(t)))];
}

// ---------------------------------------------------------------------------
// Recipe suggestion engine
// ---------------------------------------------------------------------------

/**
 * suggestRecipesForTicket() — The magic moment.
 *
 * Before a developer starts working on a ticket, agentgram shows
 * exactly which proven recipes are relevant. No more starting from scratch.
 *
 * Matching strategy:
 *   1. Keyword overlap between ticket text and recipe name/tags/description
 *   2. Category hints from ticket URL structure
 *   3. Stack match from codebase fingerprint
 */
export function suggestRecipesForTicket(
  ticketText: string,
  availableRecipes: Array<Recipe | SharedRecipe>,
  options: { limit?: number; minConfidence?: number } = {},
): RecipeSuggestion[] {
  const { limit = 5, minConfidence = 0.1 } = options;
  const ticketKeywords = new Set(extractTicketKeywords(ticketText));

  const suggestions: RecipeSuggestion[] = [];

  for (const recipe of availableRecipes) {
    const matchedOn: string[] = [];
    let score = 0;

    // Name match
    const nameWords = new Set(extractTicketKeywords(recipe.name));
    const nameMatches = [...ticketKeywords].filter((k) => nameWords.has(k));
    if (nameMatches.length > 0) {
      score += (nameMatches.length / Math.max(ticketKeywords.size, 1)) * 0.5;
      matchedOn.push(`name: ${nameMatches.join(', ')}`);
    }

    // Tag match
    const tagMatches = recipe.tags.filter((t) => ticketKeywords.has(t.toLowerCase()));
    if (tagMatches.length > 0) {
      score += (tagMatches.length / Math.max(recipe.tags.length, 1)) * 0.35;
      matchedOn.push(`tags: ${tagMatches.join(', ')}`);
    }

    // Description match
    const descWords = new Set(extractTicketKeywords(recipe.description));
    const descMatches = [...ticketKeywords].filter((k) => descWords.has(k));
    if (descMatches.length > 0) {
      score += (descMatches.length / Math.max(ticketKeywords.size, 1)) * 0.15;
      matchedOn.push(`description match`);
    }

    if (score >= minConfidence) {
      const reason = matchedOn.length > 0
        ? `Matched on ${matchedOn.join(' · ')}`
        : 'General relevance';

      suggestions.push({ recipe, reason, confidence: score, matchedOn });
    }
  }

  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Ticket recipe comment formatter
// ---------------------------------------------------------------------------

/**
 * formatTicketComment() — The recipe card posted to a GitHub issue/PR.
 *
 * This is what developers see in their ticket after the work is done.
 * Clean, scannable, actionable.
 */
export function formatTicketComment(tr: TicketRecipe): string {
  const recipe = tr.recipe;
  const durationStr = tr.durationMs
    ? `${Math.round(tr.durationMs / 60000)} min`
    : 'unknown';
  const stepsPreview = recipe.steps
    .slice(0, 6)
    .map((s, i) => {
      const iconMap: Record<string, string> = { find: '🔍', run_command: '⚡', create_file: '📄', modify_file: '✏️', delete: '🗑️', read: '🔍', write: '✏️', create: '📄', exec: '⚡', add_dependency: '📦' };
    const icon = iconMap[s.action] ?? '→';
      return `${i + 1}. ${icon} \`${s.action}\` → \`${s.target}\``;
    })
    .join('\n');
  const moreSteps = recipe.steps.length > 6 ? `\n_(+${recipe.steps.length - 6} more steps)_` : '';

  return `## 🤖 agentgram Recipe

This issue was resolved with AI assistance. The session has been distilled into a reusable recipe.

**Recipe:** \`${recipe.name}\`
**Steps:** ${recipe.steps.length} | **Time:** ${durationStr}${tr.tokensUsed ? ` | **Tokens:** ~${tr.tokensUsed.toLocaleString()}` : ''}
${tr.outcome ? `**Outcome:** ${tr.outcome}\n` : ''}
### What the agent did

${stepsPreview}${moreSteps}

### Reuse this recipe

\`\`\`bash
# Next time you need this — skip the exploration, go straight to the answer
agentgram recipe pull ${(recipe as SharedRecipe).metadata?.id ?? recipe.name.toLowerCase().replace(/\s+/g, '-')}
agentgram memory recall "${recipe.name.toLowerCase()}"
\`\`\`

> **Tags:** ${recipe.tags.map((t) => `\`${t}\``).join(' ')}

---
_Tracked by [agentgram](https://github.com/eclaireai/agentgram) · Session \`${tr.sessionId.slice(0, 12)}\`_`;
}
