/**
 * Session Resolver — the "boom, enormous value" moment.
 *
 * Takes a completed agent session, a ticket URL, and:
 *   1. Distills the session → recipe
 *   2. Saves recipe locally + publishes to registry
 *   3. Links recipe to ticket
 *   4. Posts recipe card to GitHub issue/PR comment
 *   5. Saves to agent memory for future recall
 *
 * This is the flywheel:
 *   Session → Recipe → Ticket link → Team knowledge → Future suggestions
 *
 * One command:
 *   agentgram resolve <session-id> <ticket-url> [--publish] [--pr <url>]
 */

import type { Session } from '../core/types.js';
import type { TicketRecipe } from './ticket.js';
import { parseTicketUrl } from './ticket.js';
import { GitHubIntegration } from './github.js';
import { RecipeDistiller } from '../recipe/distill.js';
import { prepareForSharing } from '../recipe/share.js';
import { LocalRecipeStore } from '../recipe/store.js';
import { AgentMemory } from '../memory/index.js';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** Ticket URL (GitHub, Jira, Linear) */
  ticketUrl: string;
  /** PR URL (if different from the ticket) */
  prUrl?: string;
  /** Short outcome description */
  outcome?: string;
  /** Post recipe as comment on the ticket */
  postComment?: boolean;
  /** Publish recipe to the community registry */
  publish?: boolean;
  /** Override recipe name */
  name?: string;
  /** Additional tags */
  tags?: string[];
  /** Working directory */
  cwd?: string;
}

export interface ResolveResult {
  recipeId: string;
  recipeName: string;
  ticketRef: ReturnType<typeof parseTicketUrl>;
  commentUrl?: string;
  registryUrl?: string;
  stepCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Ticket recipe store
// ---------------------------------------------------------------------------

const TICKET_LINKS_FILE = path.join('.agentgram', 'ticket-links.json');

/** Load all ticket→recipe links */
export function loadTicketLinks(): TicketRecipe[] {
  try {
    return JSON.parse(fs.readFileSync(TICKET_LINKS_FILE, 'utf8')) as TicketRecipe[];
  } catch {
    return [];
  }
}

/** Save a new ticket→recipe link */
export function saveTicketLink(link: TicketRecipe): void {
  fs.mkdirSync(path.dirname(TICKET_LINKS_FILE), { recursive: true });
  const links = loadTicketLinks();
  links.push(link);
  fs.writeFileSync(TICKET_LINKS_FILE, JSON.stringify(links, null, 2));
}

/** Find all recipes that resolved a given ticket URL */
export function findRecipesForTicket(ticketUrl: string): TicketRecipe[] {
  return loadTicketLinks().filter((l) => l.ticket.url === ticketUrl);
}

/** Find all tickets resolved by a given recipe */
export function findTicketsForRecipe(recipeId: string): TicketRecipe[] {
  const links = loadTicketLinks();
  return links.filter((l) => {
    const id = (l.recipe as { metadata?: { id?: string } }).metadata?.id ?? l.recipe.name;
    return id === recipeId;
  });
}

// ---------------------------------------------------------------------------
// Core resolve function
// ---------------------------------------------------------------------------

/**
 * resolveSessionToTicket() — The main pipeline.
 *
 * Takes a session + ticket URL and produces:
 * - A saved recipe (locally + optionally in registry)
 * - A ticket link in .agentgram/ticket-links.json
 * - A comment on the GitHub issue/PR (optional)
 * - A memory entry for future recall
 */
export async function resolveSessionToTicket(
  session: Session,
  options: ResolveOptions,
): Promise<ResolveResult> {
  const _startedAt = Date.now();
  const cwd = options.cwd ?? process.cwd();

  // 1. Parse ticket URL
  const ticketRef = parseTicketUrl(options.ticketUrl);

  // 2. Distill session → recipe
  const distiller = new RecipeDistiller();
  const recipe = distiller.distill(session);
  if (options.name) recipe.name = options.name;
  if (options.tags?.length) recipe.tags = [...new Set([...recipe.tags, ...options.tags])];

  // 3. Prepare for sharing (adds metadata)
  const shared = prepareForSharing(session, {
    name: recipe.name,
    tags: recipe.tags,
    author: process.env.GITHUB_USER ?? 'anonymous',
    sourceAgent: 'claude-code',
  });

  // 4. Save locally
  const store = new LocalRecipeStore(cwd);
  await store.save(shared);

  // 5. Save to agent memory
  const memory = new AgentMemory(cwd);
  memory.remember(shared);

  // 6. Create ticket link
  const durationMs = session.stoppedAt
    ? session.stoppedAt - session.startedAt
    : Date.now() - session.startedAt;

  const ticketRecipe: TicketRecipe = {
    recipe: shared,
    ticket: ticketRef,
    sessionId: session.id,
    resolvedAt: Date.now(),
    outcome: options.outcome,
    prUrl: options.prUrl,
    durationMs,
    tokensUsed: recipe.steps.length * 2000, // estimate
  };

  saveTicketLink(ticketRecipe);

  // 7. Post GitHub comment (if enabled)
  let commentUrl: string | undefined;
  if (options.postComment && ticketRef.provider === 'github') {
    try {
      const gh = new GitHubIntegration();
      const comment = await gh.postRecipeComment(ticketRef, ticketRecipe);
      commentUrl = comment.html_url;
    } catch (err) {
      // Non-fatal — local save succeeded
      console.error(`  ⚠ Could not post GitHub comment: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    recipeId: shared.metadata.id,
    recipeName: shared.name,
    ticketRef,
    commentUrl,
    stepCount: shared.steps.length,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Knowledge base query
// ---------------------------------------------------------------------------

export interface TicketKnowledgeEntry {
  ticketUrl: string;
  recipeName: string;
  recipeId: string;
  resolvedAt: number;
  stepCount: number;
  durationMin: number;
  tags: string[];
  outcome?: string;
}

/**
 * buildKnowledgeBase() — Your team's complete AI development history.
 *
 * Returns every ticket your team has ever resolved with AI,
 * sorted by most recent, with full recipe context.
 */
export function buildKnowledgeBase(): TicketKnowledgeEntry[] {
  const links = loadTicketLinks();

  return links
    .map((link): TicketKnowledgeEntry => ({
      ticketUrl: link.ticket.url,
      recipeName: link.recipe.name,
      recipeId:
        (link.recipe as { metadata?: { id?: string } }).metadata?.id ??
        link.recipe.name.toLowerCase().replace(/\s+/g, '-'),
      resolvedAt: link.resolvedAt,
      stepCount: link.recipe.steps.length,
      durationMin: Math.round((link.durationMs ?? 0) / 60000),
      tags: link.recipe.tags,
      outcome: link.outcome,
    }))
    .sort((a, b) => b.resolvedAt - a.resolvedAt);
}
