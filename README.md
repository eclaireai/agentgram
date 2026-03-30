# agentgram

**Stop letting your AI agent figure out the same dead ends twice.**

<p align="center">
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/v/agentgram?style=flat-square&color=cb3837" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/dm/agentgram?style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/eclaireai/agentgram/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eclaireai/agentgram/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/eclaireai/agentgram"><img src="https://img.shields.io/github/stars/eclaireai/agentgram?style=flat-square" alt="stars" /></a>
</p>

---

## The problem

Every AI agent hits the same walls:

- Stripe webhook signature verification fails because `express.json()` ran first
- NextAuth crashes in production because `NEXTAUTH_SECRET` is missing
- Prisma queries break because `migrate dev` ran without `generate`
- Tailwind classes disappear in production because they were built dynamically
- React `useEffect` fires twice in dev and creates duplicate records

**Each of these has been figured out thousands of times.** Your agent doesn't know that. It figures it out from scratch. Every time.

agentgram fixes this.

---

## How it works

**Before you start:**
```
$ agentgram preflight "add stripe subscriptions with webhooks"

⚠  3 known dead ends for this task

  1  Stripe webhook body parsing conflict                          seen 1,847×
     express.json() parses the body before stripe.webhooks.constructEvent()
     sees raw bytes — signature verification always fails.
     → fix: app.use('/webhook', express.raw({type:'application/json'}), handler)

  2  Silent failure on missing STRIPE_WEBHOOK_SECRET               seen 983×
     constructEvent() throws with no early warning if the env var is undefined.
     → fix: assert process.env.STRIPE_WEBHOOK_SECRET at startup

  3  Test webhooks not received in local dev                       seen 762×
     Stripe doesn't deliver test events to localhost automatically.
     → fix: add stripe listen --forward-to localhost:3000/api/webhook to dev script

  Checked 20 patterns in 2ms  ·  agentgram.dev
```

**After a session:**
```
$ agentgram recipe abc123 --format markdown
# Recipe: Add Stripe Subscriptions

## Steps
1. Install: stripe @stripe/stripe-js
2. Create webhook endpoint with raw body middleware
3. Add STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to .env
...

💡 Share this recipe?
   agentgram share abc123 --name "stripe-subscriptions-nextjs"
   Others can pull it with: agentgram pull <recipe-id>
```

**Others pull it. Nobody repeats your work.**
```
$ agentgram search "stripe nextjs"
  stripe-subscriptions-nextjs   12 steps  ↓ 847  ★ 4.8
  stripe-one-time-payment       8 steps   ↓ 412  ★ 4.6

$ agentgram pull stripe-subscriptions-nextjs
  ✔  Pulled: Add Stripe Subscriptions to Next.js
     Steps: 12  ·  Saved: .agentgram/recipes/
```

---

## Install

```bash
npm install -g agentgram
agentgram hook install    # auto-record all Claude Code sessions
```

Works with Claude Code, Cursor, and any MCP-compatible agent.

---

## Commands

```bash
# Run before starting any task — checks 20+ known dead-end patterns
agentgram preflight "your task description"

# Search 39+ curated community recipes
agentgram search "clerk auth"
agentgram search "docker nextjs production"

# Pull a recipe into your local store
agentgram pull clerk-nextjs-auth

# Distill a session into a recipe
agentgram recipe <session-id>
agentgram recipe <session-id> --format markdown

# Share so others skip your dead ends
agentgram share <session-id> --name "my-recipe" --tags "auth,clerk"

# Session history
agentgram list
agentgram show <session-id>
agentgram log <session-id>    # full operation log with causal links

# Compliance (SOC2, HIPAA, FedRAMP)
agentgram tracevault export   # Ed25519-signed, Merkle-chained audit bundle
agentgram tracevault verify   # verify bundle integrity
```

---

## The network effect

Every session you record contributes anonymized dead-end patterns to the shared database. File paths, variable names, and company tokens are stripped — only structural patterns (error type + recovery path) are kept.

When you run `agentgram preflight`, you get warnings based on what everyone who ran the same task ran into. The more sessions recorded, the smarter the warnings.

**The dead-end database is the moat.** It compounds with every user. The first 100 users make it useful. The next 10,000 make it indispensable.

---

## Recipe registry

39 curated recipes for the things developers actually build in 2026:

| Category | Recipes |
|----------|---------|
| AI / LLM | Vercel AI SDK chat, RAG with pgvector, MCP server, n8n automation |
| Auth | Clerk + Next.js, NextAuth v5, Better Auth |
| Payments | Stripe subscriptions, Stripe webhooks |
| Realtime | Supabase Realtime, WebSockets, Inngest |
| DevOps | Docker production, Terraform AWS, Turborepo monorepo |
| Security | OWASP API Top 10, Dependabot, CSP headers |
| Mobile | Expo EAS, React Native auth |

**[Browse all recipes →](https://github.com/eclaireai/agentgram-recipes)**

---

## How sessions are recorded

```
  Claude Code runs              agentgram records
  ─────────────────             ─────────────────
  read  src/auth.ts   ──────►   event: read(src/auth.ts)
  write src/auth.ts   ──────►   event: write(src/auth.ts)  ← informed by read
  exec  npm test      ──────►   event: exec(npm test)      ← triggered by write

  ProvenanceTracker builds a causal DAG
  RecipeDistiller compresses the trace into parameterized steps
  Dead-end patterns are anonymized and contributed to the shared DB
```

Sessions stored in `.agentgram/`. Nothing leaves your machine unless you run `agentgram share`.

---

## MCP server

```json
{
  "mcpServers": {
    "agentgram": {
      "command": "npx",
      "args": ["agentgram", "mcp"],
      "type": "stdio"
    }
  }
}
```

Exposes `preflight`, `recipe`, `search`, and `pull` as MCP tools — your agent can check for dead ends and pull relevant recipes autonomously.

---

## Compliance (TraceVault)

For teams that need audit trails:

- **Ed25519-signed** — every session cryptographically signed with your key
- **Merkle-chained** — deletion or tampering is mathematically detectable
- **WORM-compatible** — export bundles work with immutable storage
- Satisfies: SOC2 Type II, HIPAA audit controls, FedRAMP AU-2/AU-3, ISO 27001 A.12.4

```bash
agentgram tracevault export --output ./audit-bundle
agentgram tracevault verify ./audit-bundle
```

---

## Contributing recipes

The best recipes come from real sessions that solved real problems.

```bash
# 1. Run a Claude Code session
# 2. Distill and review
agentgram recipe <session-id> --format markdown

# 3. Share
agentgram share <session-id> --name "descriptive-name" --tags "relevant,tags"
```

Good recipe names are specific: *"Add Stripe webhooks to Next.js App Router with raw body middleware"* — not *"set up payments"*.

---

## Requirements

Node.js ≥ 18, Git ≥ 2.5

---

## License

[MIT](./LICENSE) · Built by [eclaireai](https://github.com/eclaireai)
