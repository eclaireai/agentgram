# Show HN: Agentgram – Git-native session journaling for AI coding agents

**Title:** Show HN: Agentgram – Git micro-commits + causal provenance for AI coding agents

**URL:** https://github.com/metacogma/agentgram

---

**Post body:**

Hi HN,

I built Agentgram because every time Claude Code or Cursor finishes a 40-minute coding session touching 50+ files, I have no idea *why* any specific change was made — or how to reproduce just the good parts.

Agentgram solves three problems:

**1. Shadow Worktree Journaling** — Every file read, write, and shell command gets a micro-commit on a parallel git branch. Your working tree is untouched. After the agent finishes, `git log agentgram/fix-auth-bug` shows you the complete step-by-step history with full `git diff` and `git bisect` support.

**2. Causal Provenance Graph** — A DAG that connects "agent read auth.ts" → "agent wrote auth.ts" → "agent ran npm test". It infers causality automatically: same-file read→write = `informed`, config file read→any write = `depends_on`, exec→subsequent write = `triggered`. Export as Mermaid or Graphviz DOT.

**3. Recipe Distillation** — Compresses a messy 47-operation session into 8 clean steps: "read auth.ts, modify auth.ts, create auth.test.ts, run npm test". Collapses consecutive reads, deduplicates writes, detects test-fix cycles. Output as YAML, JSON, or Markdown.

The key insight: git is already the best journaling tool developers have. Instead of building yet another dashboard or JSONL log viewer, we record directly into git's native format. You already know `git log`, `git diff`, `git bisect` — those all just work.

```bash
npm install agentgram
```

```typescript
const session = await Agentgram.start(cwd, 'fix-auth-bug');
await session.read('src/auth.ts', { reason: 'check JWT logic' });
await session.write('src/auth.ts', { reason: 'fix token expiry' });
await session.exec('npm test', { exitCode: 0 });
const result = await session.stop();
// result.recipe → 3 clean steps
// result.provenance → causal DAG
// git log agentgram/fix-auth-bug → full micro-commit history
```

124 tests, TypeScript, ESM+CJS, zero config, MIT licensed. Works with any agent — Claude Code, Cursor, Aider, or your own.

I'd love feedback on the causal inference rules and recipe distillation algorithm. Both are deterministic and don't require an LLM call.

GitHub: https://github.com/metacogma/agentgram

---

## Hacker News tips for viral launch:

1. **Post time:** Tuesday-Thursday, 8-9 AM EST (best HN engagement)
2. **Title format:** "Show HN: X – Y" where Y is the unique value prop
3. **First comment:** Post a detailed comment explaining the technical decisions
4. **Reply to every comment** in the first 2 hours
5. **Cross-post** to Twitter/X, Reddit r/programming, r/MachineLearning, r/ChatGPT
6. **Discord communities:** Claude Code, Cursor, AI coding tools

## First comment (post immediately after submission):

> Creator here. Some technical decisions worth discussing:
>
> **Why git micro-commits instead of JSONL logs?** Every competitor (claude-replay, CASS, agent-sessions) stores sessions in custom formats. We use git because: (a) developers already know the tooling, (b) you get diff/bisect/blame for free, (c) it's distributed and tamper-evident, (d) the shadow branch is a real git branch you can push/share.
>
> **Causal inference without an LLM:** The provenance graph uses three rules: same-file read→write = "informed", config file read→any write = "depends_on", exec→subsequent write = "triggered". These run in O(ops × recent_reads) with a configurable time window (default 60s). No API calls needed.
>
> **Recipe compression:** The distiller groups operations into phases separated by exec boundaries, collapses consecutive reads, deduplicates writes to the same file, and detects test-fail→fix→test-pass cycles. A 47-operation session typically compresses to 6-10 steps.
>
> What I'd love feedback on: Is the 60-second causal window too aggressive? Should the provenance graph support cross-session edges? Would a recipe marketplace be useful?
