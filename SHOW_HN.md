# Show HN: agentgram — AI agents that remember how to code

**Title:** Show HN: agentgram – Agent memory + recipe sharing for AI coding (154 community recipes)

**URL:** https://github.com/eclaireai/agentgram

---

## The Problem

You've used Claude, Cursor, or Copilot to build something complex — say, JWT auth with
refresh tokens, Prisma, and middleware. It took 47 operations and 15 minutes.

Tomorrow: new project. The agent has no memory. Starts from scratch.
Wasted tokens. Wasted time. Every. Single. Time.

**agentgram is the long-term memory layer that fixes this.**

---

## What it does

**Records** every AI agent session at the operation level (reads, writes, execs).

**Distills** 47 raw operations → 8 reusable recipe steps (the critical path only).

**Remembers** with semantic search (TF-IDF + stack fingerprinting):

```bash
agentgram memory recall "set up JWT auth"
# → 87%  setup-jwt-auth    (6 steps, used 12×)
# → 62%  add-oauth-provider (8 steps)
# → 41%  secure-api-endpoints (4 steps)
```

**Composes** recipes like Unix pipes:

```bash
agentgram compose "Production Auth" setup-jwt-auth add-rate-limiting add-tests
# → 18-step pipeline, 23% step reduction via deduplication
```

**Shares** with a community registry (backed by GitHub, zero backend):

```bash
agentgram recipe search "nextjs auth"   # 154 community recipes
agentgram recipe pull setup-jwt-auth    # download
agentgram recipe share <session-id>     # publish yours
```

---

## The numbers

| Metric | Unguided agent | Recipe-guided |
|--------|----------------|---------------|
| Operations | 14 | 6 |
| Wasted ops | 8 | 0 |
| Efficiency | 43% | 100% |
| Cost | baseline | **↓ 57%** |

16,000 tokens saved per session. At scale (100 sessions/day) = $24/day saved.

---

## 7 non-obvious innovations

1. **Shadow worktree journaling** — micro-commits on a parallel git branch per operation. Replay any session with `git log`.

2. **Causal provenance graphs** — DAG connecting reads to the writes they caused. Exports as Mermaid/D3.js/DOT. "Why did the agent write auth.ts?" is now answerable.

3. **Codebase fingerprinting** — Detects language/framework/ORM/testFramework. TypeScript+Next.js+Prisma gets different recipe suggestions than Python+FastAPI+SQLAlchemy.

4. **Enriched recipes** — Every step gets `why`, `preconditions`, and `intent` from provenance. Not just WHAT — WHY.

5. **PR→Recipe reverse extraction** — Extract recipes from any git history. Pre-seeded 154 recipes from 24 top repos (Microsoft TypeScript 108K★, Google Gemini CLI 99K★).

6. **Recipe composition** — `pipe()`, `parallel()`, `branch()`, `repeat()`. Functional composition for agent workflows.

7. **Agent Memory + spaced repetition** — TF-IDF recall + 30-day recency decay. The more a recipe is used, the higher it surfaces. Agents compound over time.

---

## Zero-config for Claude Code users

```bash
npm install -g agentgram
agentgram hook install
# Every Claude Code session is now automatically recorded
```

MCP server for any other agent:
```json
{ "mcpServers": { "agentgram": { "command": "npx", "args": ["-y", "agentgram", "mcp"] } } }
```

---

## The vision

Recipes are the **interpretability layer** for AI agents — what they did, why they did it,
in verifiable human-readable form. Causal ancestry for every decision.

The flywheel: more sessions → more recipes → cheaper future sessions → more adoption → more recipes.
This is network effects applied to AI cognition.

---

## Links

- **GitHub**: https://github.com/eclaireai/agentgram
- **Registry**: https://github.com/eclaireai/agentgram-recipes (154 live recipes)
- **npm**: `npm install -g agentgram`

## What we want from HN

1. `npm install -g agentgram && agentgram hook install` — try it on your next Claude session
2. `agentgram recipe share <session-id>` — share a recipe that solved something hard  
3. Tell us: what's the #1 workflow you wish AI agents remembered?
