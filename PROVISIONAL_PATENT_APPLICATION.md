
UNITED STATES PATENT AND TRADEMARK OFFICE
PROVISIONAL PATENT APPLICATION

Filed: March 25, 2026

================================================================================

TITLE OF INVENTION

COGNITIVE TRACE CAPTURE AND REPLAY SYSTEM FOR AI CODING AGENTS WITH
RECIPE DISTILLATION AND ORGANIZATIONAL KNOWLEDGE ACCUMULATION

================================================================================

CROSS-REFERENCE TO RELATED APPLICATIONS

This application claims the benefit of priority under 35 U.S.C. § 119(e) as a
provisional patent application. No related applications are currently pending.
This application is filed pursuant to 35 U.S.C. § 111(b) and 37 C.F.R. § 1.53(c).

================================================================================

STATEMENT REGARDING FEDERALLY SPONSORED RESEARCH OR DEVELOPMENT

Not applicable.

================================================================================

FIELD OF THE INVENTION

The present invention relates generally to software development tooling and
artificial intelligence (AI) agent systems. More specifically, the invention
relates to systems and methods for capturing, storing, replaying, and distilling
the complete cognitive process—including reasoning chains, causal provenance,
and decision points—of AI coding agents operating on software repositories,
and for converting that captured cognitive process into reusable procedural
knowledge artifacts that can be retrieved, composed, and applied by subsequent
AI agent sessions.

================================================================================

BACKGROUND OF THE INVENTION

1. The Problem of Agent Amnesia

The proliferation of AI coding agents—including but not limited to systems such
as Claude Code, Cursor, Windsurf, GitHub Copilot, and related agentic coding
assistants—has introduced a fundamental architectural deficiency in modern
software development workflows: the complete loss of the agent's cognitive
process upon session termination. This deficiency shall hereinafter be referred
to as "agent amnesia."

Contemporary AI coding agents operate by accepting a user intent expressed in
natural language, decomposing that intent into a sequence of tool invocations
(file reads, file writes, command executions, searches), and producing a result
in the form of modified files, commits, or pull requests. The external artifact
of this process—the file diff, the commit hash, the pull request—is preserved
by existing version control systems. However, the cognitive substrate that
produced this artifact is entirely discarded. Specifically, the following
information is irretrievably lost at the conclusion of every AI coding session:

   (a) The sequence of reads by which the agent oriented itself within the
       codebase prior to making modifications;

   (b) The reasoning turns—the intermediate deliberative steps—by which the
       agent translated user intent into specific tool invocations;

   (c) The decision points at which the agent selected among competing
       approaches, together with the rationale for the selection;

   (d) The dead ends—exploratory operations that were attempted and subsequently
       reversed—which represent valuable negative knowledge about what does not
       work in the given codebase context;

   (e) The causal chain linking each file modification to the specific prior
       reads and reasoning that necessitated it; and

   (f) The complete temporal ordering and provenance of all operations within
       the session.

2. Deficiencies of Prior Art

2.1 Version Control Systems

Version control systems such as Git record the final state transitions of a
repository (commits, diffs, branches) but record no information about the
process by which those state transitions were generated. A Git commit message
may describe what was done, but cannot capture why the agent chose to read
certain files first, why certain intermediate approaches were abandoned, or how
the agent's reasoning evolved across the course of the session. Version control
systems are result-recording systems, not process-recording systems.

2.2 Code Review and Audit Logs

Code review platforms and audit logging systems similarly record outcomes and
human annotations after the fact, not the real-time cognitive process of the
agent. These systems require human interpretation of results and do not
automatically link file modifications back to the reasoning that caused them.

2.3 Session Recording and Replay Tools

Existing session recording tools (e.g., terminal recorders, screen capture
tools) record the visual or textual output of a session without semantic
understanding of the causal relationships between operations, without linking
operations to the conversational reasoning that caused them, and without the
ability to distill raw operational sequences into reusable procedural
abstractions.

2.4 AI Agent Memory Systems

Prior approaches to AI agent memory have focused on storing user preferences,
project summaries, or context documents (e.g., CLAUDE.md files, project
README files, system prompt injection). These approaches are static documents
that must be manually maintained, do not automatically accumulate knowledge
from completed sessions, and do not encode the procedural, step-by-step
workflows that future agents can execute against similar problems.

2.5 Knowledge Management Systems

Enterprise knowledge management systems (wikis, documentation platforms,
runbooks) require manual authoring, do not automatically capture the reasoning
process of AI agents, and are not structured for programmatic retrieval and
replay by subsequent AI agents.

2.6 Workflow Automation Systems

Robotic process automation (RPA) systems and general workflow automation
platforms record and replay human interactions with graphical interfaces but
are not designed for AI agent tool invocations operating on source code
repositories, do not implement causal provenance tracking, and do not support
recipe composition algebra for combining workflow fragments.

3. The Need in the Art

There exists a need for a system and method that: (a) automatically captures,
without requiring user configuration, the complete three-tiered operational
and cognitive trace of an AI coding agent session; (b) links each file
operation to the specific conversational reasoning turn that caused it;
(c) detects and marks exploratory dead ends for later exclusion from
distilled procedural summaries; (d) builds causal provenance graphs
representing the full dependency structure of operations within a session;
(e) distills raw operational traces into compact, parameterized, reusable
workflow recipes; (f) matches those recipes to future sessions based on
semantic similarity and codebase technology stack compatibility; (g) enables
compositional algebra over recipes for building complex workflows from
atomic proven components; and (h) accumulates an organizational knowledge
base from AI sessions that survives the termination of individual sessions
and is searchable by subsequent sessions and developers.

================================================================================

SUMMARY OF THE INVENTION

The present invention provides a cognitive trace capture and replay system
(hereinafter "the System") for AI coding agents. The System introduces a
three-tier architecture for capturing the complete operational and cognitive
record of an AI agent session, together with mechanisms for distilling,
storing, retrieving, composing, and replaying that record in future sessions.

In one aspect, the invention provides a method comprising: intercepting tool
invocations of an AI coding agent via a hook mechanism at the agent runtime
boundary; recording each intercepted tool invocation as an operation object
comprising an operation type, target, timestamp, content hash, and causal
pointer set; capturing the conversational reasoning turn of the AI agent that
preceded each tool invocation; linking each operation object to its causally
antecedent reasoning turn to produce a cognitive trace; persisting the
cognitive trace to a shadow branch in the version control repository of the
project being modified; and exposing the cognitive trace for replay,
distillation, and retrieval.

In another aspect, the invention provides a causal provenance graph
construction method comprising: maintaining a time-windowed buffer of recent
read and execution operations; upon recording each write operation, inferring
directed causal edges from prior reads and executions to the write operation
according to path identity rules, configuration dependency rules, and
temporal proximity rules; building a directed acyclic graph (DAG) wherein
nodes represent operations and edges represent causal relationships typed as
one of: "informed," "depends_on," "triggered," or "modified"; and exporting
the DAG in structured formats for visualization and downstream processing.

In another aspect, the invention provides a recipe distillation method
comprising: receiving the complete chronologically ordered operation sequence
of a completed AI coding session; segmenting the operation sequence into
execution-bounded phases; within each phase, applying dead-end detection to
identify and remove operation subsequences consisting of a failing execution,
intermediate exploratory operations, and a subsequent successful execution of
the same command; deduplicating consecutive write operations to the same
target; collapsing consecutive read operations into consolidated discovery
steps; and emitting a compressed, human-readable recipe comprising an ordered
list of parameterized procedural steps.

In another aspect, the invention provides a recipe composition algebra
comprising: a pipe operator that accepts a sequence of recipes and produces
a new recipe whose steps are the concatenation of the input recipe steps
with deduplication of read operations; a parallel operator that accepts a
set of independent recipes and produces a new recipe whose steps are
interleaved for concurrent execution; and a branch operator that accepts a
condition expression and two alternative recipes and produces a new recipe
that is resolved to one of the two alternatives at agent execution time
based on evaluation of the condition against the current codebase fingerprint.

In another aspect, the invention provides an agent memory system comprising:
a recipe store indexed by recipe name and tags; a TF-IDF cosine similarity
engine for computing text-based relevance scores between a query task
description and stored recipes; a codebase fingerprint matching component
that boosts relevance scores for recipes originating from codebases with
matching technology stack characteristics; a recency scoring component
implementing an exponential decay function with configurable half-life that
increases scores for recently used recipes; a frequency scoring component
that increases scores for recipes with high successful recall counts; and
a recall interface that accepts a task description and codebase fingerprint
and returns a ranked list of relevant recipes.

In another aspect, the invention provides a ticket-integrated knowledge
accumulation system comprising: a ticket URL parser that extracts structured
references from URLs of multiple issue tracking providers; a pre-work
suggestion component that, prior to the commencement of work on a ticket,
retrieves and presents relevant recipes based on the ticket's textual
content; and a post-work knowledge accumulation component that, upon
completion of a session associated with a ticket, distills the session into
a recipe, stores the recipe in the agent memory system, and associates the
recipe with the resolved ticket reference.

================================================================================

BRIEF DESCRIPTION OF THE FIGURES

The following figures are described for the purpose of illustrating the
preferred embodiments of the invention. Like reference numerals denote like
elements throughout. All figures are schematic representations intended to
illustrate structure and data flow and are not drawn to scale.

FIG. 1 — Three-Tier Trace Architecture Overview

FIG. 1 is a block diagram illustrating the three-tier hierarchical architecture
of session traces. Tier 1 (Result Trace) at the top shows the final git diff
and commit artifacts produced by the session. Tier 2 (Session Trace) in the
middle shows the sequence of operation objects (read, write, exec, create,
delete) with content hashes and causal pointers. Tier 3 (Cognitive Trace) at
the bottom shows the conversation turns, reasoning text, and decision points
that caused each Tier 2 operation. Arrows from Tier 3 to Tier 2 represent
cognitive-to-operational linkage. Arrows from Tier 2 to Tier 1 represent
operational-to-result linkage.

    ┌─────────────────────────────────────────────────────────┐
    │  TIER 1: RESULT TRACE (git diff / commit / PR)          │
    │  [already captured by existing version control]         │
    └───────────────────────┬─────────────────────────────────┘
                            │ produces
    ┌───────────────────────▼─────────────────────────────────┐
    │  TIER 2: SESSION TRACE (operation sequence)             │
    │  read(pkg.json) → write(auth.ts) → exec(npm test)       │
    │  [captured by shadow worktree journaling — NOVEL]       │
    └───────────────────────┬─────────────────────────────────┘
                            │ caused by
    ┌───────────────────────▼─────────────────────────────────┐
    │  TIER 3: COGNITIVE TRACE (reasoning + decision points)  │
    │  "I see no JWT dep. I'll add jose and create auth.ts."  │
    │  [THE KEY NOVEL INVENTION — links WHY to WHAT]          │
    └─────────────────────────────────────────────────────────┘

FIG. 2 — Shadow Worktree Journaling Architecture

FIG. 2 is a diagram showing the parallel branch structure of shadow worktree
journaling. The main working branch is shown on the left with its existing
commit history. The shadow branch, created at session start from the base
commit, is shown on the right receiving a series of micro-commits, one per
captured agent operation. The shadow branch tip and main branch tip diverge
as the session progresses. A merge point at session end shows where the
shadow branch is preserved for replay.

    main branch                   shadow branch
    (working)                     (agentgram/session-abc123)
         │                               │
    [base commit] ──────────────── [branch point]
         │                               │
    [developer                    [micro-commit: read(pkg.json)]
     commits]                           │
         │                        [micro-commit: write(auth.ts)]
         │                               │
         │                        [micro-commit: exec(npm test)]
         │                               │
         │                        [micro-commit: write(auth.ts)]
         │                               │
         │                        [session end — branch preserved]
         │                               │
         └──────── (can replay by walking shadow branch git log)

FIG. 3 — Causal Provenance Graph (DAG) Construction

FIG. 3 is a directed graph diagram illustrating the construction of a causal
provenance DAG for a representative agent session. Nodes are shown as labeled
boxes (read, write, exec) with operation IDs. Directed edges are labeled with
relation types (informed, depends_on, triggered, modified). The graph depicts
the example: read(package.json) --depends_on--> write(src/auth.ts) because
the agent discovered the absence of a JWT dependency, and
exec(npm install jose) --triggered--> write(src/auth.ts) because the
installation of the library preceded and caused the write.

    ┌──────────────────┐   informed    ┌──────────────────┐
    │ read             │──────────────►│ write            │
    │ package.json     │               │ src/auth.ts      │
    └──────────────────┘               └────────▲─────────┘
                                                │
    ┌──────────────────┐   informed    ┌────────┴─────────┐  triggered
    │ read             │──────────────►│ exec             │──────────────►
    │ src/user.ts      │               │ npm install jose  │
    └──────────────────┘               └──────────────────┘
           │
           │ depends_on
           ▼
    ┌──────────────────┐
    │ write            │
    │ src/types.ts     │
    └──────────────────┘

FIG. 4 — Cognitive Trace Linkage

FIG. 4 is a sequence diagram illustrating the linkage between a user intent
statement, an AI agent reasoning turn, a tool invocation, and the resulting
file operation. The diagram shows the data flow from conversation context
through the hook interception boundary into the operation record storage,
with the reasoning text attached as a field of the operation object.

    USER INTENT:          "Add JWT authentication to the user service"
          │
          │  (conversation context)
          ▼
    AGENT REASONING:      "I need to check if jose is installed.
    (cognitive turn)       package.json shows it is not.
                           I will install jose and create auth.ts."
          │
          │  (causes)
          ▼
    TOOL INVOCATIONS:     Read(package.json) [reason: "check JWT dep"]
                          Bash("npm install jose") [reason: "install dep"]
                          Write(src/auth.ts) [reason: "create auth module"]
          │
          │  (hook intercepts)
          ▼
    OPERATION RECORDS:    { id, type:"read", target:"package.json",
                            reason:"check JWT dep", causedBy:[] }
                          { id, type:"exec", target:"npm install jose",
                            reason:"install dep", causedBy:[read.id] }
                          { id, type:"write", target:"src/auth.ts",
                            reason:"create auth module",
                            causedBy:[read.id, exec.id] }

FIG. 5 — Recipe Distillation Pipeline

FIG. 5 is a flowchart showing the multi-stage recipe distillation pipeline.
The input is a raw operation sequence of N operations. The pipeline stages
are shown as labeled process boxes with arrows indicating data flow:
phase segmentation on exec boundaries, dead-end detection and compression,
write deduplication, read collapsing, step generation, adjacent step
deduplication, and parameterization. The output is a compact recipe of M
steps where M is significantly less than N.

    RAW SESSION TRACE (47 operations)
          │
          ▼
    ┌─────────────────────────┐
    │  Phase Segmentation     │   Split on exec boundaries
    │  (groupByPhase)         │   → 8 phases
    └───────────┬─────────────┘
                │
                ▼
    ┌─────────────────────────┐
    │  Dead-End Detection     │   exec(fail) + [ops] + exec(pass)
    │  (compressExecCycles)   │   → compress to exec(pass) only
    └───────────┬─────────────┘
                │
                ▼
    ┌─────────────────────────┐
    │  Write Deduplication    │   N writes to same target
    │  (deduplicateWrites)    │   → keep last (or create if new)
    └───────────┬─────────────┘
                │
                ▼
    ┌─────────────────────────┐
    │  Read Collapsing        │   consecutive reads
    │  (collapseReads)        │   → single "find" step
    └───────────┬─────────────┘
                │
                ▼
    ┌─────────────────────────┐
    │  Step Generation        │   operation → RecipeStep
    │                         │   with action/target/description
    └───────────┬─────────────┘
                │
                ▼
    ┌─────────────────────────┐
    │  Parameterization       │   concrete paths → {variables}
    │  (parameterize)         │
    └───────────┬─────────────┘
                │
                ▼
    DISTILLED RECIPE (8 steps)

FIG. 6 — Recipe Composition Algebra

FIG. 6 is a diagram illustrating the three primary composition operators.
The pipe operator is shown as a linear chain of recipe nodes connected by
forward arrows with a deduplication annotation. The parallel operator is
shown as a fork-join structure with multiple recipe nodes between a start
node and an end node. The branch operator is shown as a diamond decision
node with condition text, with two recipe nodes on alternative edges labeled
"if condition" and "else."

    PIPE:
    [Recipe A] ──────► [Recipe B] ──────► [Recipe C]
       steps1     dedup   steps2    dedup   steps3
                          ↓
                    [Composed Recipe]
                    steps = steps1 + unique(steps2) + unique(steps3)

    PARALLEL:
              ┌──► [Recipe A] ──┐
    [START] ──┼──► [Recipe B] ──┼──► [END]
              └──► [Recipe C] ──┘
                    (interleaved round-robin)

    BRANCH:
                 ┌── [if: has:prisma] ──► [Prisma Auth Recipe]
    [CONDITION?]─┤
                 └── [else] ──────────► [Mongoose Auth Recipe]

FIG. 7 — Agent Memory Retrieval Scoring

FIG. 7 is a diagram showing the multi-factor scoring algorithm used in the
agent memory recall system. A query task description and optional codebase
fingerprint enter the scoring function. Five scoring components are shown
in parallel: TF-IDF text similarity (weight 0.50), tag overlap (weight 0.20),
codebase fingerprint stack match (weight 0.20), recency exponential decay
(weight 0.05), and frequency boost (weight 0.05). The components are summed
to produce a final relevance score. Recipes are ranked and the top N returned.

    QUERY: "add JWT auth to Next.js app"
    FINGERPRINT: { language: typescript, framework: nextjs, orm: prisma }
          │
          ├──► TF-IDF cosine similarity  ×0.50 ─────────────────┐
          │                                                       │
          ├──► Tag overlap score         ×0.20 ─────────────────┤
          │                                                       ▼
          ├──► Stack fingerprint match   ×0.20 ──────► [SUM] = final score
          │                                                       │
          ├──► Recency decay score       ×0.05 ─────────────────┤
          │    exp(-daysSince / 30)                               │
          │                                                       │
          └──► Frequency boost           ×0.05 ─────────────────┘
               min(recallCount/10, 1)
                          │
                          ▼
                   RANKED RECIPE LIST (top N)

FIG. 8 — Ticket-Integrated Knowledge Accumulation Workflow

FIG. 8 is a sequence diagram showing the full lifecycle of ticket-integrated
knowledge accumulation. The actors are: Developer, agentgram System, AI Coding
Agent, and Ticket System (GitHub/Jira/Linear). The sequence shows: ticket URL
parsing, pre-work recipe suggestion, session recording during agent work,
post-work session distillation into recipe, recipe storage in memory,
and optional posting of recipe reference to the original ticket.

    DEVELOPER         AGENTGRAM           AI AGENT          TICKET SYSTEM
        │                 │                   │                    │
        │ ticket URL      │                   │                    │
        │────────────────►│                   │                    │
        │                 │ parse + extract   │                    │
        │                 │ keywords          │                    │
        │                 │                   │                    │
        │ suggested       │ recall() from     │                    │
        │◄────────────────│ memory store      │                    │
        │ recipes         │                   │                    │
        │                 │                   │                    │
        │ start work      │                   │                    │
        │────────────────►│ start session     │                    │
        │                 │──────────────────►│                    │
        │                 │                   │                    │
        │                 │ hook events       │  tool calls        │
        │                 │◄──────────────────│ (Read/Write/Exec)  │
        │                 │                   │                    │
        │ stop session    │                   │                    │
        │────────────────►│                   │                    │
        │                 │ distill → recipe  │                    │
        │                 │ remember()        │                    │
        │                 │                   │                    │
        │                 │ post recipe card  │                    │
        │                 │────────────────────────────────────────►
        │                 │                   │          PR comment │

================================================================================

DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS

The following detailed description sets forth the preferred embodiments of the
invention. The description refers to the accompanying figures by reference
numeral. The embodiments described are illustrative and not limiting. Persons
of ordinary skill in the art will recognize that modifications and variations
are possible within the scope of the invention as defined by the appended claims.

1. SYSTEM OVERVIEW

The System comprises a software library and runtime component, hereinafter
referred to as "agentgram," that operates alongside AI coding agent sessions
to capture, store, distill, and retrieve the cognitive and operational trace
of those sessions. The System is implemented in TypeScript and executes within
a Node.js runtime, though the inventive principles are not limited to any
particular programming language or runtime environment.

The System integrates with AI coding agents via two complementary interfaces:
(a) a hook-based interface that intercepts post-tool-use events emitted by
compatible AI coding agents (hereinafter "the Hook Interface"), and (b) a
Model Context Protocol (MCP) server that provides a universal integration
interface for AI coding agents that support the MCP standard (hereinafter
"the MCP Interface"). Both interfaces feed captured events into the same
underlying data structures and algorithms.

2. THE THREE-TIER TRACE ARCHITECTURE

As illustrated in FIG. 1, the System introduces a three-tier hierarchical
architecture for representing the complete record of an AI coding agent session.

2.1 Tier 1: Result Trace

The Result Trace comprises the final file state transitions produced by the
session: the git diff, the commit hash, the pull request. This tier is already
captured by existing version control systems and is not novel to the present
invention. It is described here to provide context for the novel contributions
of Tiers 2 and 3.

2.2 Tier 2: Session Trace

The Session Trace comprises the complete chronologically ordered sequence of
every file system and command execution operation performed by the AI agent
during the session. Each operation is represented as an Operation object
having the following fields:

   - id: a universally unique identifier (UUID or equivalent) for this
     specific operation instance
   - type: one of "read," "write," "exec," "create," or "delete"
   - timestamp: Unix millisecond timestamp at which the operation was
     performed
   - target: the file path (for read/write/create/delete operations) or
     command string (for exec operations) that was the subject of the
     operation
   - metadata: an OperationMetadata object containing:
       - beforeHash: SHA-256 content hash of the file prior to
         modification (for write/delete operations)
       - afterHash: SHA-256 content hash of the file after modification
         (for write/create operations)
       - contentHash: SHA-256 content hash at time of read
         (for read operations)
       - linesRead: optional tuple [start, end] indicating the line
         range read (for partial reads)
       - command: the full command string (for exec operations)
       - exitCode: the process exit code (for exec operations)
       - output: the combined stdout/stderr output, truncated to a
         configurable maximum (for exec operations)
       - patch: a unified diff patch string (for write operations)
   - reason: a human-readable string, populated from the cognitive trace
     linkage described in Section 4, explaining why this operation was
     performed
   - causedBy: an ordered array of operation IDs representing the
     operations that causally preceded and influenced this operation

The Session Trace is persisted both as an in-memory ordered array for fast
access during the active session and as a newline-delimited JSON (JSONL) file
on disk for durability and offline processing.

2.3 Tier 3: Cognitive Trace

The Cognitive Trace is the primary novel contribution of the present invention.
The Cognitive Trace captures the conversational reasoning—the "why"—that caused
each Tier 2 operation. Specifically, for each tool invocation by the AI agent,
the Cognitive Trace records: the text of the conversational turn in which the
AI agent stated its reasoning before issuing the tool call; the decision point
context (if the agent expressed a choice between alternatives); and whether
the operation is marked as a "dead end" (i.e., a subsequent operation of the
same type reversed or superseded the effect of this operation).

The Cognitive Trace linkage is accomplished through the hook interception
mechanism described in Section 5. When a compatible AI agent (e.g., Claude Code)
issues a PostToolUse hook event, the event payload contains not only the tool
name and parameters but also the conversation context that preceded the tool
call. The System extracts the most recent assistant reasoning turn from this
context and stores it in the "reason" field of the corresponding Operation object.

This linkage—[user intent] → [assistant reasoning] → [tool call] → [file
operation]—is the complete cognitive trace chain. It enables a reader of the
trace to understand, for any file modification: what the user originally asked
for, what the agent was thinking when it decided to perform this specific
operation, and what causal chain of prior operations led to this point.

3. SHADOW WORKTREE JOURNALING

As illustrated in FIG. 2, the System implements shadow worktree journaling
to provide an instantly replayable, git-native record of every agent operation.

Upon session creation, the System:
   (a) reads the current HEAD commit hash of the repository (the "base commit");
   (b) creates a new git branch named according to the convention
       "agentgram/session-{name}-{timestamp}-{random}" (the "shadow branch");
   (c) switches the git working tree to the shadow branch; and
   (d) records the name of the original branch so the working tree can be
       restored upon session stop.

For each file write, create, or delete operation captured during the session,
the System performs a "micro-commit" on the shadow branch:
   (a) stages the modified file using git add;
   (b) creates a commit with a machine-generated message of the form
       "[agentgram] {type}({target}): {reason_or_default_description}"; and
   (c) returns the new commit hash for inclusion in the operation record.

For exec operations, the System:
   (a) writes a JSON log file to a designated exec-log directory within
       the project's agentgram data directory;
   (b) stages the log file; and
   (c) creates a micro-commit recording the command, exit code, and output.

The result is that the shadow branch accumulates one commit per significant
agent operation, forming a complete replay-capable history of the session.
This history can be traversed using standard git commands (git log, git show,
git diff) without any specialized tooling, providing universal accessibility
of the recorded trace.

Upon session stop, the System:
   (a) marks the session state as "stopped";
   (b) records the session end timestamp;
   (c) switches the working tree back to the original branch; and
   (d) returns a SessionSummary object comprising the session metadata,
       the complete operations array, the total micro-commit count, the
       shadow branch name, and the base commit hash.

The shadow branch is preserved indefinitely and is not merged into the main
working branch. It serves as a read-only replay artifact.

4. CAUSAL PROVENANCE GRAPH CONSTRUCTION

As illustrated in FIG. 3, the System constructs a causal provenance directed
acyclic graph (DAG) representing the dependency relationships among all
operations within a session. The graph is managed by a ProvenanceTracker
object that maintains the graph structure and incrementally extends it as
each new operation is recorded.

4.1 Graph Data Model

The graph comprises:

   Nodes (ProvenanceNode): one node per operation, having fields:
   - operationId: the unique identifier of the corresponding Operation object
   - target: the file path or command of the operation
   - type: the operation type (read/write/exec/create/delete)
   - timestamp: the Unix millisecond timestamp of the operation

   Edges (ProvenanceEdge): directed edges from source operation to
   dependent operation, having fields:
   - from: operationId of the source (causal) operation
   - to: operationId of the dependent (caused) operation
   - relation: one of:
       - "informed": the read of a file directly informed the subsequent
         modification of that file or a related file
       - "depends_on": a configuration file read (package.json, tsconfig,
         .env, .yaml, etc.) influenced a subsequent file modification
       - "triggered": an exec operation caused a subsequent file write
         (e.g., npm install caused the creation of lock files or source
         file modifications)
       - "modified": a write operation modified the state that another
         write operation subsequently relied upon

4.2 Causal Window

The ProvenanceTracker maintains two time-windowed buffers:
   (a) recentReads: a map from operation ID to {timestamp, target} for
       all read operations within the configurable causal window
       (default: 60,000 milliseconds); and
   (b) recentExecs: a map from operation ID to {timestamp} for all exec
       operations within the causal window.

Entries older than the causal window are purged upon each addWrite invocation
via a linear scan of the buffer entries.

4.3 Edge Inference Rules

When addWrite is invoked with a new write operation, the System applies
the following edge inference rules in priority order:

   Priority 1 — Explicit causedBy: If the write operation's causedBy array
   is non-empty (populated from hook context via cognitive trace linkage),
   explicit edges are created from each listed source operation to the write
   operation, with relation type "triggered" if the source is an exec
   operation and "informed" otherwise.

   Priority 2 — Path identity rule: For each recent read in the causal
   window, if the normalized path of the read target equals the normalized
   path of the write target, an "informed" edge is created.

   Priority 3 — Configuration dependency rule: For each recent read in the
   causal window, if the read target matches any of the configuration file
   patterns (package.json, tsconfig*.json, .env*, *.config.{js,ts},
   *.rc, *.yaml, *.yml, *.toml, *.ini), a "depends_on" edge is created
   to the write operation.

   Priority 4 — Exec trigger rule: For each recent exec in the causal
   window, a "triggered" edge is created from the exec to the write
   operation.

4.4 Graph Algorithms

The ProvenanceTracker exposes the following graph algorithms:

   getAncestors(opId): Performs a backwards breadth-first traversal from
   the given operation node, returning all operations that transitively
   influenced it. Used for impact analysis ("what chain of reasoning and
   operations led to this file being written?").

   getDescendants(opId): Performs a forward breadth-first traversal from
   the given operation node, returning all operations that were transitively
   influenced by it. Used for change impact analysis ("if I change this
   file, what downstream operations are affected?").

   getImpactedFiles(opId): Returns the set of all file targets reachable
   as descendants from the given operation, excluding exec nodes. Used
   for change impact reporting.

   getCriticalPath(): Uses memoized depth-first search with dynamic
   programming to find the longest chain of causally linked operations in
   the DAG, representing the minimum critical sequence of operations that
   produced the session's outcome. This critical path is the basis for
   recipe distillation.

4.5 Export Formats

The graph may be exported as:
   - DOT format (Graphviz): structured text for rendering with graph
     visualization tools
   - Mermaid diagram: inline-renderable format for GitHub, Notion, etc.
   - JSON: serialized graph data for programmatic processing
   - D3.js-compatible data structure: for interactive browser visualization

5. HOOK INTERCEPTION MECHANISM

The System captures agent operations via an event-driven hook architecture
that requires zero changes to agent source code and zero user configuration
beyond a one-time installation step.

5.1 Hook Architecture

The System supports two hook mechanisms:

   (a) PostToolUse Hook (Claude Code compatible): The System registers a
       shell command as a PostToolUse hook in the AI agent's settings file
       (settings.json). After each tool invocation by the agent, the agent
       runtime invokes the registered command, passing a JSON payload via
       stdin containing: the session ID, the hook event name, the tool name,
       the tool input parameters, the tool response, the tool use ID, and
       the current working directory.

   (b) SessionStart Hook (Claude Code compatible): The System registers a
       shell command as a SessionStart hook. When a new agent session begins,
       the agent runtime invokes this hook, enabling the System to create
       a new session record and initialize the shadow worktree branch.

5.2 Event Extraction

The hook handler extracts AgentgramEvent objects from HookInput payloads
according to the following tool-specific extraction rules:

   Read tool: event type = "read"; target = file_path from tool input;
   metadata includes offset and limit for partial reads.

   Write tool: event type = "write"; target = file_path from tool input;
   metadata includes content length.

   Edit tool: event type = "write"; target = file_path from tool input;
   metadata includes old_string prefix (first 100 characters) and
   replace_all flag, enabling before/after reconstruction.

   Bash tool: event type = "exec"; target = command string from tool input;
   metadata includes exit code (derived from success flag) and output
   character count.

   Grep tool: event type = "read"; target = search_path/pattern composite;
   metadata includes pattern and path.

   Glob tool: event type = "read"; target = path/pattern composite;
   metadata includes pattern and path.

5.3 Session State Persistence

The hook handler maintains a session state file in the project's agentgram
data directory. This file records the agentgram session ID, the AI agent's
own session ID, session start time, working directory, and running event
count. The session state file enables correlation of multiple hook invocations
(which execute as separate process instances) back to the same logical session
without requiring a persistent daemon process.

Captured events are persisted in JSONL format (one JSON object per line)
to a session-specific events file, enabling efficient streaming replay
and late-binding analysis.

5.4 MCP Server Interface

For AI coding agents that support the Model Context Protocol (MCP), the
System provides an MCP server running over stdio transport. The MCP server
exposes the same capture and session management operations as the hook
interface, enabling universal integration with any MCP-compatible agent
without requiring that agent to support a specific hook mechanism.

6. RECIPE DISTILLATION

As illustrated in FIG. 5, the System implements a multi-stage pipeline for
distilling raw operation sequences into compact, reusable recipes.

6.1 Overview

The distillation pipeline is implemented by the RecipeDistiller class and
accepts as input a Session object (containing the complete operations array)
and produces as output a Recipe object. A Recipe comprises: name, description,
sourceSessionId, an ordered array of RecipeStep objects, a parameters
dictionary, a tags array, and a version string.

Each RecipeStep comprises: action (one of the operation types or the
higher-level actions "find," "add_dependency," "create_file," "modify_file,"
"run_command"), target (the file path or command), description (human-readable
explanation drawn from the operation's reason field), pattern (for
parameterized multi-file steps), and expect (optional expected outcome).

6.2 Phase Segmentation

The distillation pipeline begins by sorting all operations by timestamp
and segmenting the sequence into phases at exec operation boundaries.
Each exec operation forms a phase by itself (a single-element array). The
non-exec operations between consecutive exec operations form additional
phases. This segmentation reflects the natural structure of agent work:
a "read-think-write" phase followed by a "run command" phase followed by
another "read-think-write" phase.

6.3 Dead-End Detection and Compression

Dead-end detection is the process of identifying and removing from the
distilled recipe the exploratory operations that represent failed attempts.
The specific pattern detected is:

   [exec(command, exitCode≠0)] + [read/write operations] + [exec(same_command, exitCode=0)]

This pattern represents a test-fix cycle: the agent ran a test or build
command, it failed, the agent made modifications, and then ran the same
command again successfully. The failing exec and all intermediate exploratory
operations are compressed to the final successful exec alone, since the
distilled recipe should represent only the minimal path to success, not
the exploration process.

Additionally, consecutive exec phases with the same command are merged
by keeping only the last one, since repeated commands represent retries
that can be compressed to a single successful invocation.

6.4 Write Deduplication

Within each non-exec phase, write deduplication proceeds in two passes:

   Pass 1 (consecutive same-target merge): Consecutive write and create
   operations targeting the same file are merged into a single operation.
   If the original was a "create" operation and subsequent operations were
   "write" operations (modifications to the newly created file within the
   same phase), the merged result retains the "create" type with the most
   descriptive reason text.

   Pass 2 (create-dominance): After pass 1, a second pass eliminates any
   "write" operation targeting a file that was created (by a "create"
   operation) earlier within the same phase. The create operation subsumes
   all subsequent writes to the same file within the phase.

6.5 Read Collapsing

Consecutive read operations within a phase are collapsed into a single
synthetic "find" step. The find step's target is set to the common path
prefix of all collapsed read targets (if multiple), or the single read
target (if only one). The find step preserves the reason text of the
first collapsed read and records all individual targets in a pattern field
for reference.

6.6 Step Generation

Each remaining operation after deduplication and collapsing is converted
to a RecipeStep:
   - exec operations become "run_command" steps with the command as target
   - find synthetic steps become "find" steps
   - create operations become "create_file" steps
   - write operations become "modify_file" steps
   - delete operations become "delete" steps

Description text for each step is derived from the operation's reason
field if populated (from cognitive trace linkage), or generated from a
template based on action type and target if no reason is available.

A final deduplication pass removes any adjacent steps with identical
(action, target) pairs, retaining the step with the richer description.

6.7 Parameterization

The RecipeDistiller exposes a parameterize() method that replaces
concrete file path prefixes with variable references (e.g., {src_dir},
{test_dir}) to produce a reusable template. The parameters dictionary
maps variable names to their concrete values in the source session, enabling
recipe consumers to substitute values appropriate for their project structure.

7. RECIPE COMPOSITION ALGEBRA

As illustrated in FIG. 6, the System implements a composition algebra
for combining atomic recipes into compound workflows.

7.1 Motivation

Individual recipes represent atomic, proven workflows for specific subtasks
(e.g., "add Prisma to a Next.js project," "add JWT authentication," "set up
Vitest"). Complex software tasks require combining multiple subtasks. The
composition algebra enables developers and agents to build complex,
multi-phase workflows from proven atomic recipes without copy-paste, enabling
recipe reuse with version tracking and deduplication.

7.2 Pipe Operator

The pipe(name, ...recipes) operator performs sequential composition:
   Input: A name string and an ordered list of Recipe objects
   Output: A ComposedRecipe object
   Algorithm: The steps of each input recipe are concatenated in order.
   "Find" and "read" steps targeting a file already encountered in a prior
   recipe's steps are deduplicated (omitted) to avoid redundant reads.
   Parameters and tags are merged across all input recipes. An overlapFactor
   field records the ratio of the composed step count to the total raw step
   count, quantifying the deduplication savings.

7.3 Parallel Operator

The parallel(name, ...recipes) operator performs concurrent composition:
   Input: A name string and a set of independent Recipe objects
   Output: A ComposedRecipe object
   Algorithm: The steps of all input recipes are interleaved in round-robin
   order (step 0 of recipe 0, step 0 of recipe 1, ..., step 1 of recipe 0,
   step 1 of recipe 1, ...) to model concurrent execution within the
   composed recipe. This interleaving signals to an executing agent that
   these recipe branches may be executed concurrently. No deduplication is
   applied, as parallel recipes are assumed to operate on independent state.

7.4 Branch Operator

The branch(name, condition, ifRecipe, elseRecipe?) operator performs
conditional composition:
   Input: A name string, a condition expression string, a "true branch"
   Recipe, and an optional "false branch" Recipe
   Output: A ComposedRecipe object
   Algorithm: The steps of both branches are included in the composed recipe,
   each annotated with their branch context in the description field.
   The condition expression is evaluated at agent execution time by the
   executing agent based on the current codebase fingerprint or other runtime
   context. This enables recipes to adapt to the specific technology stack
   of the target project (e.g., "if has:prisma use PrismaAuthRecipe else use
   MongooseAuthRecipe").

7.5 Repeat Operator

The repeat(name, recipe, times) operator performs loop composition:
   Input: A name string, a Recipe, and a repetition count
   Output: A ComposedRecipe object
   Algorithm: The steps of the input recipe are replicated `times` times,
   with each repetition annotated with its iteration index. Useful for
   tasks that require applying the same workflow multiple times with different
   parameters.

7.6 Composition Visualization

All composed recipes support rendering to:
   - Mermaid flowchart (for documentation and PR comments)
   - Markdown with step list and statistics (for human review)
   - JSON (for programmatic processing)

8. CODEBASE FINGERPRINTING

The System implements a codebase fingerprinting component that scans a
project directory and produces a structured CodebaseFingerprint object
characterizing the project's technology stack.

8.1 Fingerprint Fields

The CodebaseFingerprint object comprises the following fields:
   - language: "typescript" | "javascript" | "python" | "unknown"
   - framework: "nextjs" | "nuxt" | "express" | "fastify" | "hono" |
                "react" | "vue" | "svelte" | "fastapi" | "django" |
                "flask" | "none"
   - orm: "prisma" | "typeorm" | "drizzle" | "mongoose" | "sequelize" |
          "knex" | "sqlalchemy" | "django-orm" | "tortoise" | "none"
   - testFramework: "vitest" | "jest" | "mocha" | "ava" | "pytest" |
                    "unittest" | "none"
   - packageManager: "pnpm" | "yarn" | "bun" | "npm" | "pip" | "unknown"
   - hasDocker: boolean (presence of Dockerfile)
   - hasCI: boolean (presence of .github/workflows/, .gitlab-ci.yml, .circleci/)
   - isMonorepo: boolean (presence of workspaces field in package.json,
                          pnpm-workspace.yaml, or lerna.json)

8.2 Detection Logic

Language detection: checks for tsconfig.json (TypeScript), package.json
without tsconfig (JavaScript), or requirements.txt/pyproject.toml (Python).

Framework detection: reads package.json dependency fields and checks for
the presence of framework-specific packages (next, nuxt, express, fastify,
hono, react, vue, svelte). For Python, reads requirements.txt or pyproject.toml
and checks for framework name substrings.

ORM detection: reads package.json dependency fields and checks for ORM-
specific packages (@prisma/client, prisma, typeorm, drizzle-orm, mongoose,
sequelize, knex). For Python, checks pyproject.toml and requirements.txt
for sqlalchemy, django-orm, tortoise-orm.

Package manager detection: checks for the presence of lock files in
priority order (pnpm-lock.yaml → yarn.lock → bun.lockb → package-lock.json).

Infrastructure detection: checks for Dockerfile and CI configuration directories.

9. AGENT MEMORY SYSTEM

As illustrated in FIG. 7, the System implements an agent memory system
providing persistent, semantically searchable storage of distilled recipes
with multi-factor relevance scoring for recall.

9.1 Memory Entry Model

Each memory entry comprises: a unique ID (recipe name), the Recipe object,
a learnedAt timestamp, a recallCount integer, a lastUsedAt timestamp, an
optional codebase fingerprint (from the session in which the recipe was
learned), and a runtime-only score field populated during recall.

9.2 Persistence

Memory entries are stored as a JSON array in a designated memory directory
within the project's agentgram data directory. An in-memory cache (Map) is
maintained and loaded lazily on first access. The cache is invalidated and
the index file is rewritten on every mutation (remember, forget, reinforce)
to ensure durability.

9.3 TF-IDF Similarity Computation

The System implements TF-IDF cosine similarity without external dependencies:

   Tokenization: Input text is lowercased, stripped of non-alphanumeric
   characters, split on whitespace, filtered to tokens of length > 2, and
   filtered against a stopword set comprising common English function words
   and domain-generic action words ("add," "run," "use," "set," etc.).

   Term frequency: For a given token list, the frequency of each term is
   computed as count(term) / max(count(any_term)), producing a normalized
   frequency vector in [0, 1].

   Cosine similarity: Given two TF vectors A and B, similarity is computed
   as (A · B) / (||A|| × ||B||). If either vector has zero magnitude, the
   similarity is defined as 0.

   Recipe text representation: A recipe is converted to a single text
   string comprising: the recipe name, description, tags joined with spaces,
   and for each step: the action, target, and description joined with spaces.

9.4 Multi-Factor Relevance Scoring

The recall() method computes a final relevance score for each memory entry
as a weighted sum of five components:

   Component 1 — Text similarity (weight 0.50): TF-IDF cosine similarity
   between the query task description and the recipe's text representation.

   Component 2 — Tag overlap (weight 0.20): The fraction of the recipe's
   tags that appear as tokens in the query, scaled to [0, 1] by dividing
   by the recipe's tag count.

   Component 3 — Fingerprint stack match (weight 0.20): The fraction of
   the four primary fingerprint dimensions (language, framework, orm,
   testFramework) that match between the query fingerprint and the recipe's
   stored fingerprint, scaled to [0, 1].

   Component 4 — Recency decay (weight 0.05): The function
   exp(-daysSince / 30), where daysSince is the number of days since the
   recipe was last used (lastUsedAt). This implements a 30-day exponential
   decay analogous to the forgetting curve used in spaced repetition
   learning systems, giving recently used recipes a boost without hard
   recency cutoffs.

   Component 5 — Frequency boost (weight 0.05): The function
   min(recallCount / 10, 1), where recallCount is the number of times the
   recipe has been successfully recalled. This gives a modest boost to
   well-proven recipes while capping the boost at 100% of the component
   weight.

Entries with a final score below the configurable minScore threshold
(default: 0.1) are excluded. The remaining entries are sorted by final
score in descending order, and the top N (default: 5) are returned.

9.5 Memory Reinforcement

The reinforce(id) method increments the recallCount and updates lastUsedAt
for a specified memory entry. This method is called after an agent
successfully completes a task using a recalled recipe, strengthening the
association between the task type and the recipe in a manner analogous
to spaced repetition reinforcement.

9.6 Community Registry Pre-Warming

The importRecipes() method enables bulk import of recipes from an external
registry (e.g., a community-maintained collection of recipes organized by
category: auth, database, testing, devops, quality, api, security, monitoring)
into the local memory store. This pre-warming operation enables a new
installation of the System to immediately provide relevant recipe suggestions
without requiring the accumulation of locally recorded sessions.

10. TICKET-INTEGRATED KNOWLEDGE ACCUMULATION

As illustrated in FIG. 8, the System implements a complete lifecycle for
linking AI coding sessions to the issues or tickets that motivated them,
enabling the accumulation of a searchable organizational knowledge base.

10.1 Ticket URL Parsing

The parseTicketUrl() function accepts any URL string and returns a structured
TicketRef object. Supported providers and their URL patterns:

   GitHub: https://github.com/{owner}/{repo}/issues/{id}
           https://github.com/{owner}/{repo}/pull/{id}
   Jira:   https://{company}.atlassian.net/browse/{PROJECT-ID}
   Linear: https://linear.app/{team}/issue/{TEAM-ID}
   Generic: any URL (stored as opaque reference with trailing path segment as ID)

The extracted TicketRef comprises: provider, url, id, and provider-specific
fields (owner, repo for GitHub; project key for Jira; team for Linear).

10.2 Keyword Extraction

The extractTicketKeywords() function extracts meaningful terms from a ticket
URL or title by: stripping URL components, splitting camelCase identifiers,
normalizing hyphens/underscores/slashes to spaces, lowercasing, and filtering
against a domain-specific stopword set that removes common software engineering
action words ("add," "fix," "feat," "feature," "implement," "update,"
"refactor") that would not discriminate between recipes.

10.3 Pre-Work Recipe Suggestion

The suggestRecipesForTicket() function implements the pre-work knowledge
retrieval moment: before a developer begins work on a ticket, the System
is invoked with the ticket text and the collection of available recipes,
and returns a ranked list of relevant recipe suggestions.

Scoring for pre-work suggestion uses three sub-components:
   - Recipe name keyword overlap with ticket keywords (weight 0.50)
   - Recipe tag overlap with ticket keywords (weight 0.35)
   - Recipe description keyword overlap with ticket keywords (weight 0.15)

Suggestions below a configurable confidence threshold (default: 0.10) are
excluded. The top N suggestions (default: 5) are returned, each accompanied
by a human-readable reason string explaining which keywords triggered the match.

10.4 Post-Work Knowledge Accumulation

Upon session completion, the System performs the following automatic
knowledge accumulation steps:
   (a) distills the session into a Recipe via the RecipeDistiller;
   (b) stores the recipe in the AgentMemory store via remember(), along
       with the project's codebase fingerprint;
   (c) creates a TicketRecipe association record linking the recipe to
       the originating ticket reference, the session ID, the resolution
       timestamp, and optional metadata (outcome summary, PR URL,
       duration, token count); and
   (d) optionally posts a formatted recipe card as a comment on the
       originating ticket (GitHub issue/PR comment) via the ticket
       provider's API.

10.5 Recipe Card Format

The recipe card posted to the ticket is a formatted Markdown block
comprising: recipe name, step count, time taken, outcome summary (if provided),
a preview of up to six recipe steps with action icons, and a command-line
snippet showing how to retrieve and apply the recipe in a future session.
This creates a permanent, searchable record in the ticket tracker linking
the resolution to the specific procedure the AI agent used to achieve it.

11. RECIPE STORE AND COMMUNITY REGISTRY

The System implements a recipe store for local persistence and a community
registry interface for sharing recipes across teams and organizations.

11.1 Local Recipe Store

The RecipeStore class persists Recipe objects as individual YAML or JSON files
within the project's agentgram data directory, organized by recipe name.
A metadata index file enables fast listing and filtering without loading
all recipe bodies. The store supports CRUD operations (save, load, list,
delete) and tag-based filtering.

11.2 Community Registry Protocol

The community registry uses a git repository as its backend (requiring no
custom server infrastructure). The registry protocol defines:
   - A root index.json file listing all published recipes with name, tags,
     category, description, and download URL
   - Category subdirectories (auth/, database/, testing/, devops/, quality/,
     api/, security/, monitoring/) containing individual recipe files
   - Client-side caching with a five-minute TTL for offline operation
   - A publishing API that creates or updates recipe files in the registry
     repository via the GitHub API

11.3 Recipe Sharing and Import

The share() method publishes a local recipe to the community registry.
The pull() method retrieves a named recipe from the registry and imports it
into the local recipe store and memory system. The search() method performs
client-side full-text search against the registry index.

12. IMPLEMENTATION DETAILS

12.1 Configuration

The System is configured via an AgentraceConfig object with the following fields:
   - dataDir: path to the agentgram data directory (default: ".agentgram")
   - autoCommit: whether to create micro-commits on each operation (default: true)
   - trackContent: whether to include file content hashes in metadata (default: true)
   - maxOperations: maximum operations per session before auto-archiving (default: 10000)
   - gitAuthor: name and email to use as the author of micro-commits

12.2 Performance Characteristics

The hook interception mechanism adds sub-millisecond overhead to each
tool invocation (JSON parsing, file append, counter increment). Micro-commit
creation adds approximately 50-200 milliseconds per write/exec operation,
depending on repository size and storage speed. The TF-IDF recall computation
operates in O(N × M) time where N is the number of memory entries and M is
the average recipe text length; for typical deployments with up to several
hundred recipes, recall completes in under 10 milliseconds.

12.3 Hash Functions

Content hashing uses SHA-256 applied to file content as a Buffer, producing
a 64-character hexadecimal digest. Operation IDs are generated as
{timestamp_base36}-{4_random_chars}, providing collision resistance across
concurrent operations within the same session.

================================================================================

CLAIMS

What is claimed is:

1. A computer-implemented method for capturing and preserving the cognitive
process of an artificial intelligence (AI) coding agent operating on a software
repository, the method comprising:
   intercepting, by a hook module, a post-tool-use event emitted by an AI
   coding agent after each tool invocation, wherein the post-tool-use event
   includes a tool name, tool input parameters, tool response, and a session
   identifier;
   extracting, from the intercepted post-tool-use event, an operation record
   comprising an operation type, a target, a timestamp, and content metadata;
   extracting, from a conversational context buffer maintained by the AI
   coding agent session, a reasoning text comprising the agent's stated
   rationale for the tool invocation;
   linking the extracted reasoning text to the operation record by storing
   the reasoning text as a reason field of the operation record;
   persisting the linked operation record to a session trace store; and
   upon session completion, exposing the session trace store for distillation
   into a reusable workflow recipe.

2. A computer-implemented method for constructing a causal provenance directed
acyclic graph (DAG) of operations performed by an AI coding agent session,
the method comprising:
   maintaining a time-windowed buffer of recent read operations, each entry
   comprising an operation identifier, a file path target, and a timestamp;
   maintaining a time-windowed buffer of recent execution operations, each
   entry comprising an operation identifier and a timestamp;
   upon receiving a write operation, purging buffer entries older than a
   configurable causal window from both buffers;
   inferring directed causal edges from buffered read operations to the write
   operation according to a plurality of inference rules including at least:
      a path identity rule creating an "informed" edge when the read target
      equals the write target,
      a configuration dependency rule creating a "depends_on" edge when the
      read target matches a configuration file pattern, and
      an execution trigger rule creating a "triggered" edge from any buffered
      execution operation to the write operation;
   adding the inferred edges and corresponding nodes to the causal provenance
   DAG; and
   exposing the causal provenance DAG for visualization and for identification
   of the critical path of operations for recipe distillation.

3. A computer-implemented method for distilling a raw AI coding agent session
trace into a compact reusable workflow recipe, the method comprising:
   receiving a chronologically ordered sequence of operation records representing
   all file and command operations performed by an AI coding agent during a
   session;
   segmenting the operation sequence into phases at execution operation
   boundaries;
   detecting dead-end operation subsequences within the segmented phases,
   wherein a dead-end subsequence consists of a first execution operation
   having a non-zero exit code, followed by one or more non-execution
   operations, followed by a second execution operation having a zero exit
   code and the same command as the first execution operation;
   removing the first execution operation and all intervening non-execution
   operations from the distilled sequence while retaining the second execution
   operation;
   deduplicating write operations targeting the same file within each phase
   to retain only the final write operation or the creation operation;
   collapsing consecutive read operations within each phase into a single
   consolidated discovery step; and
   generating a recipe object comprising an ordered list of parameterized
   procedural steps derived from the remaining operations.

4. A computer-implemented system for accumulating organizational knowledge
from AI coding agent sessions, the system comprising:
   one or more processors; and
   one or more non-transitory computer-readable storage media storing
   instructions that, when executed by the one or more processors, cause
   the system to:
      receive a ticket reference identifying a software development task;
      extract keywords from the ticket reference text;
      retrieve, from an agent memory store, one or more recipes having
      semantic similarity to the extracted keywords as measured by a
      multi-factor relevance score comprising a text similarity component,
      a tag overlap component, a codebase technology stack compatibility
      component, a recency decay component, and a frequency boost component;
      present the retrieved recipes to a developer prior to commencement
      of work on the software development task;
      upon completion of an AI coding agent session that addresses the
      software development task, distill the session into a new recipe;
      store the new recipe in the agent memory store with the codebase
      fingerprint of the project as a metadata annotation; and
      associate the new recipe with the ticket reference in a ticket-recipe
      linkage store.

5. The method of claim 1, wherein persisting the linked operation record
further comprises:
   staging any modified file to a shadow git branch dedicated to the current
   session and named according to a convention identifying the session; and
   creating a micro-commit on the shadow git branch with a machine-generated
   commit message encoding the operation type, target, and reason.

6. The method of claim 5, wherein the shadow git branch is created at
session initialization by branching from the current HEAD commit of the
working repository, and wherein the shadow git branch is preserved upon
session completion without being merged into the working branch.

7. The method of claim 1, wherein the operation type is one of: read, write,
exec, create, and delete; and wherein the content metadata comprises, for
read operations, a content hash of the file at time of reading; for write
and create operations, a content hash of the file before and after
modification; and for exec operations, a command string, an exit code,
and a truncated output string.

8. The method of claim 1, further comprising:
   maintaining a causedBy field in each operation record as an ordered array
   of operation identifiers; and
   populating the causedBy field with the identifiers of all operations in
   the session trace store that the conversational context indicates
   causally preceded the current tool invocation.

9. The method of claim 2, wherein the configurable causal window has a
default value of sixty thousand milliseconds, and wherein entries older
than the causal window are purged upon each invocation of the write
operation recording function.

10. The method of claim 2, further comprising computing a critical path
through the causal provenance DAG by:
   constructing a successor adjacency list for each node;
   computing, for each node, the length of the longest directed path
   from that node to any sink node using memoized depth-first search;
   identifying the source node with the maximum longest-path length; and
   reconstructing the critical path by following the maximum-length
   successor from the identified source node.

11. The method of claim 3, wherein generating the recipe object further
comprises:
   identifying, for each file path appearing as a target across multiple
   steps, the longest common path prefix of all such file paths; and
   replacing concrete path prefixes in step target fields with named
   parameter references formatted as {parameter_name}, wherein the
   parameter name is derived from the relative path segment following
   the common prefix.

12. The method of claim 3, further comprising:
   detecting consecutive execution operations commanding the same command
   string and merging them by retaining only the last such execution
   operation.

13. A computer-implemented system for composing AI coding agent workflow
recipes using algebraic operators, the system comprising:
   a pipe operator configured to receive an ordered list of recipe objects
   and produce a composed recipe object whose step list is the ordered
   concatenation of the input recipe step lists with deduplication of
   read steps targeting files already encountered in a prior input recipe;
   a parallel operator configured to receive an unordered set of recipe
   objects and produce a composed recipe object whose step list interleaves
   the steps of all input recipes in round-robin order;
   a branch operator configured to receive a condition expression string,
   a first recipe object, and an optional second recipe object, and produce
   a composed recipe object whose step list includes the steps of both input
   recipes annotated with their respective branch condition, wherein the
   condition expression is evaluated at execution time based on a codebase
   fingerprint of the target repository; and
   an overlap factor metric computed as the ratio of the composed step count
   to the total raw step count across all input recipes, quantifying
   deduplication efficiency.

14. The system of claim 13, wherein the condition expression in the branch
operator is evaluated against the codebase fingerprint by testing for the
presence or absence of a specific technology stack component identified by
a has:{component} predicate, wherein the component is one of: a language,
a framework, an ORM, a test framework, a package manager, or a
configuration artifact.

15. The method of claim 4, wherein the multi-factor relevance score is
computed as:
   score = (textSimilarity × 0.50) + (tagOverlap × 0.20) +
           (stackMatch × 0.20) + (recencyDecay × 0.05) +
           (frequencyBoost × 0.05)
wherein:
   textSimilarity is the TF-IDF cosine similarity between the tokenized
   query task description and a text representation of the recipe
   comprising its name, description, tags, and step descriptions;
   tagOverlap is the fraction of the recipe's tags that appear as tokens
   in the tokenized query;
   stackMatch is the fraction of the four primary technology stack dimensions
   (language, framework, ORM, test framework) that match between the query
   codebase fingerprint and the recipe's stored origin codebase fingerprint;
   recencyDecay is the function exp(-d/30) where d is the number of days
   since the recipe was last used; and
   frequencyBoost is the function min(recallCount / 10, 1) where recallCount
   is the number of times the recipe has been successfully applied.

16. The method of claim 4, further comprising:
   parsing a ticket URL to extract a structured ticket reference comprising
   a provider identifier, a ticket identifier, and provider-specific
   attributes; and
   upon storing the new recipe in the agent memory store, posting a
   formatted recipe card as a comment on the ticket identified by the
   structured ticket reference via the ticket provider's API, wherein
   the recipe card includes the recipe name, step count, a preview of the
   recipe steps, and a command-line invocation for retrieving the recipe
   in a subsequent session.

17. A computer-implemented method for fingerprinting a software project
repository for use in AI workflow recipe matching, the method comprising:
   reading one or more project descriptor files including at least one of:
   package.json, requirements.txt, pyproject.toml, tsconfig.json, and
   lock files;
   classifying the primary programming language of the project as one of
   TypeScript, JavaScript, Python, or unknown based on the presence and
   contents of the project descriptor files;
   classifying the primary web framework, database ORM, and test framework
   of the project by testing for the presence of specific named dependencies
   within the project descriptor files;
   detecting the package manager by testing for the presence of package
   manager-specific lock files in a defined priority order;
   detecting infrastructure characteristics including Docker and continuous
   integration configurations; and
   producing a structured codebase fingerprint vector comprising the
   classified attributes for use in scoring recipe relevance.

18. The method of claim 1, wherein extracting the reasoning text comprises
reading the tool_use_id field and session_id field from the hook event
payload and retrieving the corresponding conversational turn from the
AI agent's in-process conversation context buffer that immediately preceded
the tool invocation identified by the tool_use_id.

19. A non-transitory computer-readable storage medium storing instructions
that, when executed by one or more processors, implement an AI coding agent
session memory system, the instructions causing the processors to:
   maintain a persistent index of recipe memory entries, each entry
   comprising a recipe object, a formation timestamp, a recall count
   integer, and a last-used timestamp;
   upon being invoked with a task description string and an optional
   codebase fingerprint, compute a multi-factor relevance score for each
   memory entry;
   return a ranked list of the top N memory entries by relevance score;
   upon successful application of a retrieved recipe, increment the recall
   count and update the last-used timestamp of the retrieved recipe entry;
   upon receiving a new recipe from a completed AI coding session,
   store the recipe as a new memory entry or, if an entry with the same
   recipe name exists, increment its recall count and update its
   codebase fingerprint; and
   upon invocation of a bulk import function, store a plurality of provided
   recipe objects as memory entries without incrementing any recall count,
   enabling pre-warming of the memory system from a community registry.

20. The system of claim 13, further comprising:
   a visualization renderer that converts a composed recipe object to a
   Mermaid flowchart diagram, wherein pipe-mode compositions are rendered
   as linear node chains, parallel-mode compositions are rendered as
   fork-join structures, and branch-mode compositions are rendered as
   diamond decision nodes with labeled conditional edges; and
   a statistics reporter that computes and reports the total step count,
   the number of component recipes, and the deduplication savings percentage
   for a composed recipe.

21. The method of claim 3, further comprising:
   exposing a merge() class method that accepts a plurality of recipe
   objects and produces a merged recipe whose steps are the ordered union
   of all input recipe steps with deduplication by (action, target) key pair;
   and serializing the recipe object to one or more of: YAML format, JSON
   format, and Markdown format with section headings for parameters and steps.

22. The method of claim 2, wherein the causal provenance DAG is exported
in one or more of:
   Graphviz DOT format, wherein each node is rendered with a shape
   indicating operation type and each edge is rendered with a label
   indicating relation type and a line style indicating relation semantics;
   Mermaid diagram format, wherein node identifiers are sanitized for
   Mermaid syntax compatibility; and
   JSON format, comprising a sessionId field, a nodes array, and an edges
   array, suitable for client-side rendering with interactive graph
   visualization libraries.

================================================================================

ABSTRACT

A cognitive trace capture and replay system for AI coding agents implements
a three-tier architecture comprising a result trace (file diffs), a session
trace (per-operation records), and a cognitive trace (conversational reasoning
linked to each operation). A shadow worktree journaling subsystem creates a
parallel git branch receiving one micro-commit per agent operation, enabling
replay through standard git tooling. A causal provenance graph module
constructs a directed acyclic graph linking each file write to the prior reads
and executions that caused it via typed edges (informed, depends_on, triggered,
modified). A recipe distillation pipeline compresses raw operation sequences
into compact reusable workflows by detecting and removing dead-end test-fix
cycles, deduplicating writes, and collapsing read sequences into discovery
steps. A recipe composition algebra provides pipe, parallel, and branch
operators for combining atomic recipes into compound workflows. An agent memory
system implements multi-factor relevance scoring combining TF-IDF semantic
similarity, codebase technology stack fingerprint matching, and spaced-
repetition-inspired recency and frequency scoring. A ticket integration
subsystem provides pre-work recipe suggestion from ticket text and post-work
automatic knowledge accumulation that links completed sessions to originating
tickets and persists the distilled procedure in a searchable organizational
memory store.

================================================================================

END OF PROVISIONAL PATENT APPLICATION

================================================================================

DECLARATION AND CERTIFICATION

I hereby declare that the information disclosed herein has not been published,
is not in public use, and has not been on sale or otherwise available to the
public prior to the filing of this application, to the best of my knowledge
and belief.

Filing Date: March 25, 2026
Applicant: [INVENTOR NAME(S) — TO BE COMPLETED BEFORE FILING]
Address: [INVENTOR ADDRESS — TO BE COMPLETED BEFORE FILING]

NOTE TO FILER: This provisional patent application must be completed with
inventor full legal names, mailing addresses, citizenship, and the
"Oath or Declaration" (Form PTO/AIA/01 or equivalent) before actual USPTO
submission. A non-provisional application claiming priority to this
provisional must be filed within twelve (12) months of the provisional
filing date (35 U.S.C. § 119(e)(3)). The filing fee for a provisional
application is due at time of submission (see current USPTO fee schedule
at https://www.uspto.gov/learning-and-resources/fees-and-payment).

================================================================================
