/**
 * GitHub Integration — posts recipes to issues and PRs automatically.
 *
 * When a developer resolves a GitHub issue with Claude/Cursor,
 * this module posts the distilled recipe as a comment — making the
 * "how we did this" permanently discoverable in the issue thread.
 *
 * Also: fetches issue/PR context to suggest recipes BEFORE work begins.
 */

import type { TicketRef, TicketRecipe, RecipeSuggestion } from './ticket.js';
import { formatTicketComment, suggestRecipesForTicket } from './ticket.js';
import type { Recipe } from '../core/types.js';
import type { SharedRecipe } from '../recipe/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: Array<{ name: string }>;
  html_url: string;
  pull_request?: { url: string };
}

export interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  diff_url: string;
}

export interface GitHubIntegrationConfig {
  token?: string;
  /** Override API base (for GitHub Enterprise) */
  apiBase?: string;
}

// ---------------------------------------------------------------------------
// GitHubIntegration
// ---------------------------------------------------------------------------

export class GitHubIntegration {
  private token: string | undefined;
  private apiBase: string;

  constructor(config: GitHubIntegrationConfig = {}) {
    this.token = config.token ?? process.env.GITHUB_TOKEN ?? process.env.AGENTGRAM_TOKEN;
    this.apiBase = config.apiBase ?? 'https://api.github.com';
  }

  // ── Internal fetch ─────────────────────────────────────────────────────────

  private async ghFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agentgram/1.0',
      ...(options.headers as Record<string, string> ?? {}),
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    return fetch(`${this.apiBase}${path}`, { ...options, headers });
  }

  // ── Issue / PR fetching ────────────────────────────────────────────────────

  /** Fetch issue details (title, body, labels) for recipe suggestion */
  async fetchIssue(owner: string, repo: string, number: string | number): Promise<GitHubIssue> {
    const res = await this.ghFetch(`/repos/${owner}/${repo}/issues/${number}`);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<GitHubIssue>;
  }

  /** Fetch PR details */
  async fetchPR(owner: string, repo: string, number: string | number): Promise<GitHubPR> {
    const res = await this.ghFetch(`/repos/${owner}/${repo}/pulls/${number}`);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<GitHubPR>;
  }

  // ── Recipe suggestion (BEFORE work begins) ─────────────────────────────────

  /**
   * suggestForIssue() — The "pre-flight" moment.
   *
   * Before a developer starts on an issue, agentgram shows
   * which proven recipes are relevant. This is the moment that
   * saves hours of exploration.
   *
   * Usage:
   *   agentgram suggest https://github.com/owner/repo/issues/123
   */
  async suggestForIssue(
    ref: TicketRef,
    availableRecipes: Array<Recipe | SharedRecipe>,
    options: { limit?: number } = {},
  ): Promise<{ issue: GitHubIssue; suggestions: RecipeSuggestion[] }> {
    if (!ref.owner || !ref.repo) throw new Error('GitHub ref requires owner and repo');

    const issue = await this.fetchIssue(ref.owner, ref.repo, ref.id);

    // Build search text from issue title + body + labels
    const searchText = [
      issue.title,
      issue.body ?? '',
      issue.labels.map((l) => l.name).join(' '),
    ].join(' ');

    const suggestions = suggestRecipesForTicket(searchText, availableRecipes, {
      limit: options.limit ?? 5,
      minConfidence: 0.08,
    });

    return { issue, suggestions };
  }

  // ── Recipe posting (AFTER work is done) ───────────────────────────────────

  /**
   * postRecipeComment() — Posts the recipe card to the issue/PR.
   *
   * Called automatically after a session is resolved.
   * The recipe card becomes the permanent record of how this was solved.
   */
  async postRecipeComment(
    ref: TicketRef,
    ticketRecipe: TicketRecipe,
  ): Promise<GitHubComment> {
    if (!ref.owner || !ref.repo) throw new Error('GitHub ref requires owner and repo');
    if (!this.token) throw new Error('GitHub token required to post comments. Set GITHUB_TOKEN.');

    const body = formatTicketComment(ticketRecipe);

    const res = await this.ghFetch(
      `/repos/${ref.owner}/${ref.repo}/issues/${ref.id}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to post comment: ${res.status} ${text}`);
    }

    return res.json() as Promise<GitHubComment>;
  }

  /**
   * linkPRToRecipe() — Updates a PR description with the recipe link.
   *
   * Appends an agentgram section to the PR body so code reviewers
   * can see exactly what the agent did and why.
   */
  async linkPRToRecipe(
    ref: TicketRef,
    ticketRecipe: TicketRecipe,
  ): Promise<void> {
    if (!ref.owner || !ref.repo) throw new Error('GitHub ref requires owner and repo');
    if (!this.token) throw new Error('GitHub token required. Set GITHUB_TOKEN.');

    const pr = await this.fetchPR(ref.owner, ref.repo, ref.id);
    const existingBody = pr.body ?? '';

    // Don't add twice
    if (existingBody.includes('agentgram Recipe')) return;

    const recipeSection = `\n\n---\n\n${formatTicketComment(ticketRecipe)}`;
    const newBody = existingBody + recipeSection;

    await this.ghFetch(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: newBody }),
    });
  }

  /**
   * fetchRecentIssues() — Get recent open issues for recipe pre-loading.
   *
   * Used to warm the agent's memory with recipes relevant to your team's
   * current work backlog.
   */
  async fetchRecentIssues(
    owner: string,
    repo: string,
    options: { limit?: number; labels?: string[] } = {},
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({
      state: 'open',
      sort: 'updated',
      per_page: String(options.limit ?? 20),
    });
    if (options.labels?.length) params.set('labels', options.labels.join(','));

    const res = await this.ghFetch(`/repos/${owner}/${repo}/issues?${params}`);
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const issues = await res.json() as GitHubIssue[];
    // Filter out PRs (GitHub includes them in /issues)
    return issues.filter((i) => !i.pull_request);
  }
}
