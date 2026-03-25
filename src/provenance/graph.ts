/**
 * Causal Provenance Graph module for agentgram.
 * Tracks which file reads influenced which file writes, building a causal DAG.
 */

import type {
  Operation,
  OperationId,
  ProvenanceEdge,
  ProvenanceGraph,
  ProvenanceNode,
  SessionId,
} from '../core/types.js';

/** Config names for files commonly treated as "config" */
const CONFIG_PATTERNS = [
  /package\.json$/,
  /tsconfig.*\.json$/,
  /\.env(\..+)?$/,
  /\.config\.[jt]s$/,
  /\.rc(\.[jt]s)?$/,
  /vitest\.config\.[jt]s$/,
  /eslint\.config\.[jt]s$/,
  /\.yaml$/,
  /\.yml$/,
  /\.toml$/,
  /\.ini$/,
];

/** Returns true if the path looks like a config file */
function isConfigFile(target: string): boolean {
  return CONFIG_PATTERNS.some((re) => re.test(target));
}

/** Normalise a file path so that minor differences don't prevent matching */
function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Serializable form of a ProvenanceTracker */
interface SerializedTracker {
  sessionId: SessionId;
  causalWindowMs: number;
  graph: ProvenanceGraph;
  /** Recent reads stored as [opId, timestamp, target] triples */
  recentReads: [OperationId, number, string][];
  /** Recent execs stored as [opId, timestamp] pairs */
  recentExecs: [OperationId, number][];
}

export class ProvenanceTracker {
  private graph: ProvenanceGraph;
  private causalWindowMs: number;

  /**
   * recent reads: kept so that causal links can be formed when a write arrives.
   * Entries older than causalWindowMs are discarded on each addWrite call.
   */
  private recentReads: Map<OperationId, { timestamp: number; target: string }> = new Map();

  /**
   * recent execs: used to create "triggered" edges when a write follows shortly
   * after an exec (e.g. npm install creates node_modules files).
   */
  private recentExecs: Map<OperationId, { timestamp: number }> = new Map();

  constructor(sessionId: SessionId, causalWindowMs = 60_000) {
    this.causalWindowMs = causalWindowMs;
    this.graph = { sessionId, nodes: [], edges: [] };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private addNode(op: Operation): ProvenanceNode {
    const existing = this.graph.nodes.find((n) => n.operationId === op.id);
    if (existing) return existing;

    const node: ProvenanceNode = {
      operationId: op.id,
      target: op.target,
      type: op.type,
      timestamp: op.timestamp,
    };
    this.graph.nodes.push(node);
    return node;
  }

  private addEdge(from: OperationId, to: OperationId, relation: ProvenanceEdge['relation']): void {
    const duplicate = this.graph.edges.some((e) => e.from === from && e.to === to && e.relation === relation);
    if (!duplicate) {
      this.graph.edges.push({ from, to, relation });
    }
  }

  /** Purge reads older than causalWindowMs relative to `now` */
  private purgeOldReads(now: number): void {
    for (const [id, entry] of this.recentReads) {
      if (now - entry.timestamp > this.causalWindowMs) {
        this.recentReads.delete(id);
      }
    }
  }

  /** Purge execs older than causalWindowMs relative to `now` */
  private purgeOldExecs(now: number): void {
    for (const [id, entry] of this.recentExecs) {
      if (now - entry.timestamp > this.causalWindowMs) {
        this.recentExecs.delete(id);
      }
    }
  }

  /**
   * Determine what causal edges exist between a read target and a write target.
   * Returns the relation type, or null if no causal link.
   */
  private inferRelation(
    readTarget: string,
    writeTarget: string,
  ): ProvenanceEdge['relation'] | null {
    const r = normalisePath(readTarget);
    const w = normalisePath(writeTarget);

    // Rule 1: same file → "informed"
    if (r === w) return 'informed';

    // Rule 2: read is a config file that the written file likely depends on → "depends_on"
    if (isConfigFile(r)) return 'depends_on';

    return null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Record a read operation.
   * Adds a node and remembers the read for future causal linking.
   */
  addRead(op: Operation): ProvenanceNode {
    const node = this.addNode(op);
    this.recentReads.set(op.id, { timestamp: op.timestamp, target: op.target });
    return node;
  }

  /**
   * Record a write (or create/delete) operation.
   * Adds a node and creates edges from any recent reads that causally influenced it.
   */
  addWrite(op: Operation): ProvenanceNode {
    this.purgeOldReads(op.timestamp);
    this.purgeOldExecs(op.timestamp);

    const node = this.addNode(op);

    // Explicit causedBy links take highest priority
    if (op.causedBy && op.causedBy.length > 0) {
      for (const sourceId of op.causedBy) {
        // Determine relation by looking at the source node's type
        const sourceNode = this.graph.nodes.find((n) => n.operationId === sourceId);
        if (sourceNode) {
          const relation = sourceNode.type === 'exec' ? 'triggered' : 'informed';
          this.addEdge(sourceId, op.id, relation);
        } else {
          // Source not yet in graph — add a generic "informed" edge
          this.addEdge(sourceId, op.id, 'informed');
        }
      }
      return node;
    }

    // Infer edges from recent reads
    for (const [readId, readEntry] of this.recentReads) {
      const relation = this.inferRelation(readEntry.target, op.target);
      if (relation !== null) {
        this.addEdge(readId, op.id, relation);
      }
    }

    // Rule 3: write after exec → "triggered" edge
    for (const [execId] of this.recentExecs) {
      this.addEdge(execId, op.id, 'triggered');
    }

    return node;
  }

  /**
   * Record an exec operation.
   * Adds a node, links to reads that informed the command, and remembers the exec
   * for future "triggered" edges on subsequent writes.
   */
  addExec(op: Operation): ProvenanceNode {
    this.purgeOldReads(op.timestamp);

    const node = this.addNode(op);

    if (op.causedBy && op.causedBy.length > 0) {
      for (const sourceId of op.causedBy) {
        this.addEdge(sourceId, op.id, 'informed');
      }
    } else {
      // Link reads that informed this exec
      for (const [readId] of this.recentReads) {
        this.addEdge(readId, op.id, 'informed');
      }
    }

    this.recentExecs.set(op.id, { timestamp: op.timestamp });
    return node;
  }

  // ---------------------------------------------------------------------------
  // Graph queries
  // ---------------------------------------------------------------------------

  /** Return the full provenance graph. */
  getProvenance(): ProvenanceGraph {
    return this.graph;
  }

  /**
   * BFS backwards through edges to collect all operations that transitively
   * influenced the given operation.
   */
  getAncestors(opId: OperationId): ProvenanceNode[] {
    const visited = new Set<OperationId>();
    const queue: OperationId[] = [opId];
    const result: ProvenanceNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Walk edges backwards: find edges where `to === current`
      for (const edge of this.graph.edges) {
        if (edge.to === current && !visited.has(edge.from)) {
          queue.push(edge.from);
          const node = this.graph.nodes.find((n) => n.operationId === edge.from);
          if (node) result.push(node);
        }
      }
    }

    return result;
  }

  /**
   * BFS forward through edges to collect all operations that were transitively
   * influenced by the given operation.
   */
  getDescendants(opId: OperationId): ProvenanceNode[] {
    const visited = new Set<OperationId>();
    const queue: OperationId[] = [opId];
    const result: ProvenanceNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const edge of this.graph.edges) {
        if (edge.from === current && !visited.has(edge.to)) {
          queue.push(edge.to);
          const node = this.graph.nodes.find((n) => n.operationId === edge.to);
          if (node) result.push(node);
        }
      }
    }

    return result;
  }

  /**
   * Returns all unique file targets reachable (as descendants) from the given op.
   * Useful for impact analysis: "if I change X, which files will be affected?"
   */
  getImpactedFiles(opId: OperationId): string[] {
    const descendants = this.getDescendants(opId);
    const files = new Set<string>();
    for (const node of descendants) {
      if (node.type !== 'exec') {
        files.add(node.target);
      }
    }
    return Array.from(files);
  }

  // ---------------------------------------------------------------------------
  // Export formats
  // ---------------------------------------------------------------------------

  /** Export the graph as a Graphviz DOT string. */
  toDot(): string {
    const lines: string[] = [];
    lines.push('digraph provenance {');
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, fontname="monospace"];');
    lines.push('');

    for (const node of this.graph.nodes) {
      const label = `${node.type}\\n${escapeForDot(node.target)}`;
      const shape = node.type === 'exec' ? 'ellipse' : 'box';
      lines.push(`  "${node.operationId}" [label="${label}", shape=${shape}];`);
    }

    lines.push('');

    for (const edge of this.graph.edges) {
      const style = edgeDotStyle(edge.relation);
      lines.push(
        `  "${edge.from}" -> "${edge.to}" [label="${edge.relation}"${style}];`,
      );
    }

    lines.push('}');
    return lines.join('\n');
  }

  /** Export the graph as a Mermaid diagram string. */
  toMermaid(): string {
    const lines: string[] = [];
    lines.push('graph LR');

    for (const node of this.graph.nodes) {
      const label = `${node.type}: ${node.target}`;
      const safeId = safeMermaidId(node.operationId);
      lines.push(`  ${safeId}["${escapeMermaid(label)}"]`);
    }

    for (const edge of this.graph.edges) {
      const from = safeMermaidId(edge.from);
      const to = safeMermaidId(edge.to);
      lines.push(`  ${from} -->|"${edge.relation}"| ${to}`);
    }

    return lines.join('\n');
  }

  /** Serialize to a plain JSON-compatible object. */
  toJSON(): SerializedTracker {
    const recentReads: [OperationId, number, string][] = Array.from(
      this.recentReads.entries(),
    ).map(([id, e]) => [id, e.timestamp, e.target]);

    const recentExecs: [OperationId, number][] = Array.from(
      this.recentExecs.entries(),
    ).map(([id, e]) => [id, e.timestamp]);

    return {
      sessionId: this.graph.sessionId,
      causalWindowMs: this.causalWindowMs,
      graph: this.graph,
      recentReads,
      recentExecs,
    };
  }

  /** Deserialize from a plain JSON-compatible object. */
  static fromJSON(data: SerializedTracker): ProvenanceTracker {
    const tracker = new ProvenanceTracker(data.sessionId, data.causalWindowMs);
    tracker.graph = data.graph;

    for (const [id, timestamp, target] of data.recentReads) {
      tracker.recentReads.set(id, { timestamp, target });
    }

    for (const [id, timestamp] of data.recentExecs) {
      tracker.recentExecs.set(id, { timestamp });
    }

    return tracker;
  }

  // ---------------------------------------------------------------------------
  // Advanced analysis
  // ---------------------------------------------------------------------------

  /**
   * Find the longest chain of causal operations (critical path).
   * Uses dynamic programming on the DAG.
   */
  getCriticalPath(): ProvenanceNode[] {
    const nodes = this.graph.nodes;
    if (nodes.length === 0) return [];

    // Build adjacency: nodeId → list of successor nodeIds
    const successors = new Map<OperationId, OperationId[]>();
    for (const node of nodes) {
      successors.set(node.operationId, []);
    }
    for (const edge of this.graph.edges) {
      successors.get(edge.from)?.push(edge.to);
    }

    // Memoised DFS to compute longest path length from each node
    const memo = new Map<OperationId, number>();
    const next = new Map<OperationId, OperationId | null>();

    const dfs = (id: OperationId): number => {
      if (memo.has(id)) return memo.get(id)!;
      const succs = successors.get(id) ?? [];
      if (succs.length === 0) {
        memo.set(id, 0);
        next.set(id, null);
        return 0;
      }
      let best = -1;
      let bestSucc: OperationId | null = null;
      for (const s of succs) {
        const len = 1 + dfs(s);
        if (len > best) {
          best = len;
          bestSucc = s;
        }
      }
      memo.set(id, best);
      next.set(id, bestSucc);
      return best;
    };

    for (const node of nodes) {
      dfs(node.operationId);
    }

    // Find node with maximum path length
    let startId = nodes[0].operationId;
    let maxLen = memo.get(startId) ?? 0;
    for (const node of nodes) {
      const len = memo.get(node.operationId) ?? 0;
      if (len > maxLen) {
        maxLen = len;
        startId = node.operationId;
      }
    }

    // Reconstruct path
    const path: ProvenanceNode[] = [];
    let current: OperationId | null | undefined = startId;
    while (current != null) {
      const node = nodes.find((n) => n.operationId === current);
      if (node) path.push(node);
      current = next.get(current);
    }

    return path;
  }
}

// ---------------------------------------------------------------------------
// String-escaping helpers
// ---------------------------------------------------------------------------

function escapeForDot(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function edgeDotStyle(relation: ProvenanceEdge['relation']): string {
  switch (relation) {
    case 'informed':
      return ', style=solid';
    case 'depends_on':
      return ', style=dashed';
    case 'triggered':
      return ', style=dotted';
    case 'modified':
      return ', style=bold';
    default:
      return '';
  }
}

function safeMermaidId(id: string): string {
  // Mermaid node IDs must not contain hyphens or special chars in bare form.
  // We prefix with an underscore and replace unsafe chars.
  return '_' + id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeMermaid(s: string): string {
  return s.replace(/"/g, "'");
}
