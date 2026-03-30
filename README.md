# agentgram

**Your AI agent shouldn't figure out the same thing twice.**

<p align="center">
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/v/agentgram?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/eclaireai/agentgram/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eclaireai/agentgram/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/dm/agentgram?style=flat-square" alt="Downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

---

## What it does

**1. Records AI agent sessions as cognitive traces.**
Every file read, write, and command your agent runs — captured with causal provenance. Know not just *what* happened, but *why*.

**2. Distills sessions into reusable recipes.**
A messy 45-minute Claude Code session becomes a clean, parameterized playbook. Share it. Others pull it and skip straight to the part that works.

**3. Warns you before you start.**
`agentgram preflight` checks your task against 847 known dead-end patterns before your agent wastes 20 minutes on a path that fails every time.

```
$ agentgram preflight "add stripe subscriptions with webhooks"

⚠  3 known issues found:

1. Stripe webhook verification fails if body is parsed before verification
   → seen 847 times · fix: use raw body middleware before express.json()

2. webhook.construct() silently returns null on missing STRIPE_WEBHOOK_SECRET
   → seen 312 times · fix: assert env var at startup

3. Test mode webhooks require stripe listen --forward-to localhost
   → seen 201 times · fix: add to dev script
```

---

## The commands

```bash
# Install
npm install -g agentgram

# Before you start — check known dead ends
agentgram preflight "add stripe subscriptions with webhooks"

# Search community recipes
agentgram search "clerk auth nextjs"

# Pull and use a recipe
agentgram pull clerk-nextjs

# After a Claude Code session — distill it
agentgram recipe <session-id>

# Share it so others don't repeat your work
agentgram share <session-id> --name "Clerk Auth for Next.js"
```

---

## Why agentgram

AI agents are fast. They're also consistently bad at the same things — Stripe webhook body parsing, Prisma migration order, NextAuth session scoping. Every team hits these walls. Every agent figures them out from scratch.

**The dead-end database is the moat.** Every session you record makes the preflight checker smarter for everyone. The more people use agentgram, the fewer dead ends any agent walks into.

This isn't observability for its own sake. It's a compounding knowledge layer that sits between your agent and wasted time.

---

## Get started

```bash
npm install -g agentgram
agentgram hook install          # auto-records all Claude Code sessions
agentgram preflight "your task" # check before you start
agentgram search "your task"    # find community recipes
```

Zero config. Works with Claude Code, Cursor, and any agent using the MCP protocol.

---

## Recipe registry

39 curated recipes, organized by category. Stripe, Clerk, Prisma, NextAuth, Vercel, tRPC, and more.

**[github.com/eclaireai/agentgram-recipes](https://github.com/eclaireai/agentgram-recipes)**

---

## Contributing recipes

Run a Claude Code session that solves something real. Distill it. Share it.

```bash
# After your session
agentgram recipe <session-id> --format markdown

# Review the output, then share it
agentgram share <session-id> --name "descriptive-name"
```

Good recipes are specific. "Add Stripe webhooks to Next.js App Router with raw body middleware" is a recipe. "Set up payments" is not.

Open a PR to [agentgram-recipes](https://github.com/eclaireai/agentgram-recipes) with your distilled recipe. The only requirement: it solved a real problem in a real session.

---

## How it works

```
  Your agent runs                Shadow branch records
  ─────────────────              ─────────────────────
  read  src/auth.ts    ──────►   (remembered for causal linking)
  write src/auth.ts    ──────►   micro-commit: "write(src/auth.ts)"
  exec  npm test       ──────►   micro-commit: "exec(npm test)"

  ProvenanceTracker builds a causal DAG:

    read:src/auth.ts ──informed──► write:src/auth.ts
                                          │
                                 triggered──► exec:npm test

  RecipeDistiller compresses the trace into:

    steps:
      - find: src/auth.ts
      - modify_file: src/auth.ts
      - run_command: npm test
```

Sessions are stored in `.agentgram/`. Nothing leaves your machine unless you explicitly run `agentgram share`.

---

## MCP support

Works with any agent that supports MCP. Add to `.claude/.mcp.json`:

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

---

## Requirements

Node.js >= 18, Git >= 2.5

---

## License

[MIT](./LICENSE)
