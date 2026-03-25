# agentgram

> **Record every move. Replay any moment. Distill the recipe.**

Shadow worktree journaling + causal provenance graphs + recipe distillation for AI coding agents. One lightweight npm package, zero config.

<p align="center">
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/v/agentgram?style=flat-square&color=cb3837" alt="npm version" /></a>
  <a href="https://github.com/metacogma/agentgram/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/metacogma/agentgram/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://codecov.io/gh/metacogma/agentgram"><img src="https://img.shields.io/codecov/c/github/metacogma/agentgram?style=flat-square" alt="Coverage" /></a>
  <a href="https://www.npmjs.com/package/agentgram"><img src="https://img.shields.io/npm/dm/agentgram?style=flat-square" alt="Downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node >= 18" />
</p>

---

## Why agentgram?

When an AI coding agent runs for 45 minutes touching 80 files, three things go wrong:

1. **No replay.** If something breaks, you can't step back through what happened.
2. **No causality.** You can't tell *why* a file was written — what read or exec triggered it.
3. **No recipe.** The session knowledge is locked inside one ephemeral run.

**agentgram** solves all three — without changing how your agent works.

---

## Quick Start

### Programmatic API (recommended)

```bash
npm install agentgram
```

```typescript
import { Agentrace } from 'agentgram';

// Start recording in any git repo
const session = await Agentrace.start(process.cwd(), 'fix-auth-bug');

// Track what your agent does
await session.read('src/auth.ts', { reason: 'understanding JWT flow' });
await session.write('src/auth.ts', { reason: 'fix token expiry check' });
await session.create('src/middleware/verify.ts', { reason: 'add auth middleware' });
await session.exec('npm test', { exitCode: 0, output: '14 passing' });

// Stop — saves session, provenance graph, and recipe to .agentgram/
const result = await session.stop();

console.log(result.recipe);       // distilled recipe
console.log(result.provenance);   // causal DAG
console.log(result.totalCommits); // micro-commits on shadow branch
```

### CLI

```bash
npx agentgram list                              # list all sessions
npx agentgram show <session-id>                 # full session details
npx agentgram log <session-id>                  # micro-commit history
npx agentgram diff <session-id>                 # file change summary
npx agentgram provenance <session-id>           # causal graph (mermaid)
npx agentgram provenance <session-id> --format dot  # graphviz DOT
npx agentgram recipe <session-id>               # recipe (yaml)
npx agentgram recipe <session-id> --format markdown  # human-readable
npx agentgram export <session-id> out.json      # full export
```

---

## Features

<table>
<tr>
<th align="center">Shadow Worktree</th>
<th align="center">Causal Provenance</th>
<th align="center">Recipe Distillation</th>
</tr>
<tr>
<td>

Records every file read, write, exec, create, and delete into a parallel git branch with micro-commits — without touching your working tree.

</td>
<td>

Builds a DAG connecting every operation to its causal predecessors. Infers causality from file patterns, config dependencies, and exec→write sequences.

</td>
<td>

Compresses a messy session into minimal, ordered, reproducible steps. Collapses reads, deduplicates writes, detects test-fix cycles.

</td>
</tr>
</table>

---

## Installation

```bash
npm install agentgram    # or pnpm add agentgram / yarn add agentgram
```

**Requirements:** Node.js >= 18, Git >= 2.5

---

## API Reference

### `Agentrace` (static factory)

```typescript
import { Agentrace } from 'agentgram';

// Start a new session
const session = await Agentrace.start(cwd, 'session-name', {
  dataDir: '.agentgram',        // where to store session data
  autoCommit: true,             // commit on every operation
  trackContent: true,           // include content hashes
  maxOperations: 10000,         // auto-archive threshold
  gitAuthor: { name: 'agentgram', email: 'agentgram@local' },
});

// Load a saved session
const loaded = await Agentrace.load(cwd, 'session-id');

// List all sessions
const sessions = await Agentrace.list(cwd);
```

### `AgentraceSession`

Returned by `Agentrace.start()`. Extends `EventEmitter`.

```typescript
// Track operations
await session.read('path/to/file', { reason: 'why', causedBy: ['op-id'] });
await session.write('path/to/file', { reason: 'why', causedBy: ['op-id'] });
await session.create('path/to/file', { reason: 'why' });
await session.delete('path/to/file', { reason: 'why' });
await session.exec('npm test', { exitCode: 0, output: '...' }, { reason: 'why' });

// Inspect mid-session
const recipe = session.distill();           // current recipe without stopping
const graph = session.getProvenance();      // current provenance graph
const ops = session.getOperations();        // all operations so far

// Stop and persist
const result = await session.stop();
// result: { session, operations, provenance, recipe, branch, baseCommit, totalCommits }

// Events
session.on('operation', (e) => console.log(e.operation));
session.on('session_start', (e) => console.log(e.sessionId));
session.on('session_stop', (e) => console.log(e.sessionId));
```

### `ShadowWorktree` (low-level)

```typescript
import { ShadowWorktree } from 'agentgram';

const worktree = await ShadowWorktree.create(cwd, 'my-session');

await worktree.trackRead('src/index.ts', { reason: 'check exports' });
await worktree.trackWrite('src/index.ts', { reason: 'add new export' });
await worktree.trackExec('npm test', { exitCode: 0 });
await worktree.trackCreate('src/new-file.ts', { reason: 'scaffold' });
await worktree.trackDelete('src/old-file.ts', { reason: 'cleanup' });

const summary = await worktree.stop();
// summary: { session, operations, totalCommits, branchName, baseCommit }
```

### `ProvenanceTracker`

```typescript
import { ProvenanceTracker } from 'agentgram';

const tracker = new ProvenanceTracker('session-id', 60_000); // 60s causal window

// Add operations — edges are inferred automatically
tracker.addRead(readOp);    // remembers for causal linking
tracker.addWrite(writeOp);  // links to recent reads of same/config files
tracker.addExec(execOp);    // links to recent reads, remembered for triggered edges

// Query the graph
const ancestors = tracker.getAncestors('op-id');     // what caused this?
const descendants = tracker.getDescendants('op-id');  // what did this affect?
const impacted = tracker.getImpactedFiles('op-id');   // which files were affected?
const critical = tracker.getCriticalPath();            // longest causal chain

// Export
tracker.toDot();       // Graphviz DOT
tracker.toMermaid();   // Mermaid diagram
tracker.toJSON();      // serializable JSON
ProvenanceTracker.fromJSON(data);  // restore
```

**Causal inference rules:**
- Same-file read→write: `informed`
- Config file read→any write: `depends_on`
- Exec→subsequent write: `triggered`
- Explicit `causedBy`: overrides inference

### `RecipeDistiller`

```typescript
import { RecipeDistiller } from 'agentgram';

const distiller = new RecipeDistiller();

// Distill a session into a recipe
const recipe = distiller.distill(session);

// Parameterize for reuse
const parameterized = distiller.parameterize(recipe);

// Serialize
distiller.toYAML(recipe);       // YAML string
distiller.fromYAML(yamlStr);    // Recipe from YAML
distiller.toJSON(recipe);       // JSON string
distiller.fromJSON(jsonStr);    // Recipe from JSON
distiller.toMarkdown(recipe);   // human-readable markdown

// Merge multiple recipes
const merged = RecipeDistiller.merge([recipe1, recipe2]);
```

**Compression strategies:**
- Consecutive reads → single `find` step
- Duplicate writes to same file → keep last
- Create + writes → keep create
- Failed test→fix→pass cycles → collapsed
- Adjacent identical steps → deduplicated

### Core Types

```typescript
import type {
  Session, Operation, OperationType, OperationMetadata,
  ProvenanceGraph, ProvenanceNode, ProvenanceEdge,
  Recipe, RecipeStep,
  AgentraceConfig, SessionState, SessionEvent,
  SessionId, OperationId,
} from 'agentgram';
```

### Utilities

```typescript
import { contentHash, generateId, sessionBranchName } from 'agentgram';
import { isGitRepo, createGit } from 'agentgram';

contentHash('file content');          // SHA-256 (first 12 hex chars)
generateId();                          // timestamp-based unique ID
sessionBranchName('my-session');      // 'agentgram/my-session-{id}'

await isGitRepo('/path/to/dir');      // boolean
const ctx = createGit('/path/to/repo'); // { git: SimpleGit, cwd: string }
```

---

## CLI Reference

```
agentgram <command> [options]
```

| Command | Description |
|---|---|
| `list` | List all recorded sessions |
| `show <session-id>` | Show full details of a session |
| `log <session-id>` | Show micro-commit history |
| `diff <session-id>` | Summarize file changes |
| `provenance <session-id>` | Output causal graph (`--format dot\|mermaid`) |
| `recipe <session-id>` | Output distilled recipe (`--format yaml\|markdown\|json`) |
| `export <session-id> <outfile>` | Export full session to JSON file |

**Global flags:** `-v, --version` · `-h, --help`

---

## Integrating with AI Agents

agentgram wraps existing agent tool calls with zero friction:

```typescript
import { Agentrace } from 'agentgram';

const session = await Agentrace.start(process.cwd(), 'agent-run');

// Wrap your existing tools
const originalReadFile = tools.readFile;
tools.readFile = async (path) => {
  const content = await originalReadFile(path);
  await session.read(path, { reason: 'agent tool call' });
  return content;
};

const originalWriteFile = tools.writeFile;
tools.writeFile = async (path, content) => {
  await originalWriteFile(path, content);
  await session.write(path, { reason: 'agent tool call' });
};

// When the agent finishes
const result = await session.stop();
console.log(`Recorded ${result.totalCommits} micro-commits on ${result.branch}`);
console.log(`Recipe: ${result.recipe.steps.length} steps`);
```

---

## How It Works

```
  Your agent runs                Shadow branch records
  ─────────────────              ─────────────────────
  read  src/auth.ts    ──────►   (remembered for causal linking)
  write src/auth.ts    ──────►   micro-commit: "[agentgram] write(src/auth.ts): ..."
  exec  npm test       ──────►   micro-commit: "[agentgram] exec(npm test): ..."

         │
         │  ProvenanceTracker builds a DAG:
         │
         │   read:src/auth.ts ──informed──► write:src/auth.ts
         │                                        │
         │                              triggered──► exec:npm test
         │
         ▼
  RecipeDistiller compresses the trace:

  steps:
    - action: find
      target: src/auth.ts
    - action: modify_file
      target: src/auth.ts
    - action: run_command
      target: npm test
```

---

## Configuration

Pass config to `Agentrace.start()`:

```typescript
await Agentrace.start(cwd, 'session-name', {
  dataDir: '.agentgram',        // default: '.agentgram'
  autoCommit: true,             // default: true
  trackContent: true,           // default: true
  maxOperations: 10000,         // default: 10000
  gitAuthor: {
    name: 'agentgram',          // default: 'agentgram'
    email: 'agentgram@local',   // default: 'agentgram@local'
  },
});
```

Sessions are stored in `<cwd>/.agentgram/sessions/<id>.json`.

---

## Development

```bash
git clone https://github.com/metacogma/agentgram
cd agentgram
npm install
npm run dev           # watch mode
npm test              # run tests (vitest)
npm run test:coverage # with coverage
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run ci            # typecheck + lint + test:coverage + build
```

**Before submitting a PR:**

- All tests must pass: `npm test`
- No type errors: `npm run typecheck`
- No lint errors: `npm run lint`
- New features need tests

---

## License

[MIT](./LICENSE)
