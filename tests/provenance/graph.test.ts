import { describe, it, expect, beforeEach } from 'vitest';
import { ProvenanceTracker } from '../../src/provenance/graph.js';
import type { Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function makeOp(
  overrides: Partial<Operation> & { type: Operation['type']; target: string },
): Operation {
  _seq++;
  return {
    id: `op-${_seq}`,
    type: overrides.type,
    timestamp: overrides.timestamp ?? Date.now() + _seq,
    target: overrides.target,
    metadata: overrides.metadata ?? {},
    reason: overrides.reason,
    causedBy: overrides.causedBy ?? [],
  };
}

beforeEach(() => {
  _seq = 0;
});

// ---------------------------------------------------------------------------
// Basic node creation
// ---------------------------------------------------------------------------

describe('ProvenanceTracker.addRead()', () => {
  it('creates a node for the read operation', () => {
    const tracker = new ProvenanceTracker('session-1');
    const op = makeOp({ type: 'read', target: 'src/index.ts' });
    const node = tracker.addRead(op);

    expect(node.operationId).toBe(op.id);
    expect(node.target).toBe('src/index.ts');
    expect(node.type).toBe('read');
    expect(node.timestamp).toBe(op.timestamp);

    const graph = tracker.getProvenance();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toEqual(node);
  });

  it('does not add duplicate nodes for the same operation', () => {
    const tracker = new ProvenanceTracker('session-1');
    const op = makeOp({ type: 'read', target: 'src/index.ts' });
    tracker.addRead(op);
    tracker.addRead(op);

    expect(tracker.getProvenance().nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Write creates node + edges
// ---------------------------------------------------------------------------

describe('ProvenanceTracker.addWrite()', () => {
  it('creates a node for the write operation', () => {
    const tracker = new ProvenanceTracker('session-1');
    const writeOp = makeOp({ type: 'write', target: 'src/output.ts' });
    const node = tracker.addWrite(writeOp);

    expect(node.operationId).toBe(writeOp.id);
    expect(node.type).toBe('write');
    const graph = tracker.getProvenance();
    expect(graph.nodes).toHaveLength(1);
  });

  it('creates no edges when there are no prior reads', () => {
    const tracker = new ProvenanceTracker('session-1');
    const writeOp = makeOp({ type: 'write', target: 'src/output.ts' });
    tracker.addWrite(writeOp);

    expect(tracker.getProvenance().edges).toHaveLength(0);
  });

  it('creates an edge from a prior read to a write of a different file', () => {
    const now = 1_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const readOp = makeOp({ type: 'read', target: 'package.json', timestamp: now });
    const writeOp = makeOp({ type: 'write', target: 'src/index.ts', timestamp: now + 1000 });

    tracker.addRead(readOp);
    tracker.addWrite(writeOp);

    const graph = tracker.getProvenance();
    // package.json is a config file → "depends_on" edge
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe(readOp.id);
    expect(graph.edges[0].to).toBe(writeOp.id);
    expect(graph.edges[0].relation).toBe('depends_on');
  });
});

// ---------------------------------------------------------------------------
// Causal inference: informed edge
// ---------------------------------------------------------------------------

describe('causal inference – informed edge', () => {
  it('a write to X after reading X creates an "informed" edge', () => {
    const now = 2_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const readOp = makeOp({ type: 'read', target: 'src/utils.ts', timestamp: now });
    const writeOp = makeOp({ type: 'write', target: 'src/utils.ts', timestamp: now + 500 });

    tracker.addRead(readOp);
    tracker.addWrite(writeOp);

    const graph = tracker.getProvenance();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relation).toBe('informed');
    expect(graph.edges[0].from).toBe(readOp.id);
    expect(graph.edges[0].to).toBe(writeOp.id);
  });
});

// ---------------------------------------------------------------------------
// Causal inference: depends_on edge for config files
// ---------------------------------------------------------------------------

describe('causal inference – depends_on edge', () => {
  it.each([
    ['package.json'],
    ['tsconfig.json'],
    ['.env'],
    ['vitest.config.ts'],
    ['eslint.config.js'],
    ['config.yaml'],
    ['settings.yml'],
    ['app.toml'],
  ])('a write after reading config file "%s" creates a "depends_on" edge', (configFile) => {
    const now = 3_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const readOp = makeOp({ type: 'read', target: configFile, timestamp: now });
    const writeOp = makeOp({ type: 'write', target: 'src/app.ts', timestamp: now + 1000 });

    tracker.addRead(readOp);
    tracker.addWrite(writeOp);

    const graph = tracker.getProvenance();
    expect(graph.edges.some((e) => e.relation === 'depends_on')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getProvenance
// ---------------------------------------------------------------------------

describe('getProvenance()', () => {
  it('returns the full graph with sessionId, nodes, and edges', () => {
    const tracker = new ProvenanceTracker('my-session');
    const now = 4_000_000;

    const r1 = makeOp({ type: 'read', target: 'a.ts', timestamp: now });
    const w1 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 100 });

    tracker.addRead(r1);
    tracker.addWrite(w1);

    const graph = tracker.getProvenance();
    expect(graph.sessionId).toBe('my-session');
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getAncestors
// ---------------------------------------------------------------------------

describe('getAncestors(opId)', () => {
  it('returns all operations that causally influenced a given operation', () => {
    const now = 5_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'a.ts', timestamp: now });
    const r2 = makeOp({ type: 'read', target: 'b.ts', timestamp: now + 100 });
    const w1 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 200 });
    const w2 = makeOp({ type: 'write', target: 'b.ts', timestamp: now + 300 });

    tracker.addRead(r1);
    tracker.addRead(r2);
    tracker.addWrite(w1); // r1 informs w1 (same file), r2 has no relation to a.ts
    tracker.addWrite(w2); // r2 informs w2 (same file), r1 has no relation to b.ts

    const ancestorsOfW1 = tracker.getAncestors(w1.id);
    const ids = ancestorsOfW1.map((n) => n.operationId);
    expect(ids).toContain(r1.id);
    expect(ids).not.toContain(r2.id);
  });

  it('returns transitive ancestors through a chain', () => {
    const now = 5_500_000;
    const tracker = new ProvenanceTracker('session-1');

    // r1 → w1 (as read+write of same file)
    const r1 = makeOp({ type: 'read', target: 'a.ts', timestamp: now });
    tracker.addRead(r1);

    const w1 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 100 });
    tracker.addWrite(w1); // r1 → w1 (informed)

    // Now read the file we just wrote, then write something else
    const r2 = makeOp({ type: 'read', target: 'a.ts', timestamp: now + 200 });
    tracker.addRead(r2);

    const w2 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 300 });
    tracker.addWrite(w2); // r2 → w2 (informed)

    const ancestors = tracker.getAncestors(w2.id);
    const ids = ancestors.map((n) => n.operationId);

    // r2 is a direct ancestor
    expect(ids).toContain(r2.id);
    // w1 and r1 are transitive ancestors (via r2 which read a.ts written by w1)
    // Note: r1 is also in recentReads at the time of w2 since we didn't advance time past window
    expect(ids).toContain(r1.id);
  });

  it('returns empty array for a node with no ancestors', () => {
    const tracker = new ProvenanceTracker('session-1');
    const op = makeOp({ type: 'read', target: 'standalone.ts' });
    tracker.addRead(op);

    expect(tracker.getAncestors(op.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDescendants
// ---------------------------------------------------------------------------

describe('getDescendants(opId)', () => {
  it('returns all operations influenced by a given operation', () => {
    const now = 6_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'a.ts', timestamp: now });
    const w1 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 100 });
    const w2 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 200 });

    tracker.addRead(r1);
    tracker.addWrite(w1);

    // r1 is still in window; w2 will also have r1 as ancestor (same file)
    tracker.addRead(makeOp({ type: 'read', target: 'a.ts', timestamp: now + 150 }));
    tracker.addWrite(w2);

    const descendants = tracker.getDescendants(r1.id);
    const ids = descendants.map((n) => n.operationId);
    expect(ids).toContain(w1.id);
  });

  it('returns empty array for a node with no descendants', () => {
    const tracker = new ProvenanceTracker('session-1');
    const op = makeOp({ type: 'write', target: 'standalone.ts' });
    tracker.addWrite(op);

    expect(tracker.getDescendants(op.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toDot
// ---------------------------------------------------------------------------

describe('toDot()', () => {
  it('exports the graph in Graphviz DOT format', () => {
    const now = 7_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'src/a.ts', timestamp: now });
    const w1 = makeOp({ type: 'write', target: 'src/a.ts', timestamp: now + 100 });

    tracker.addRead(r1);
    tracker.addWrite(w1);

    const dot = tracker.toDot();
    expect(dot).toContain('digraph provenance');
    expect(dot).toContain(r1.id);
    expect(dot).toContain(w1.id);
    expect(dot).toContain('informed');
    expect(dot).toContain('->');
    // Should end with closing brace
    expect(dot.trimEnd()).toMatch(/\}$/);
  });

  it('uses ellipse shape for exec nodes', () => {
    const now = 7_100_000;
    const tracker = new ProvenanceTracker('session-1');
    const execOp = makeOp({ type: 'exec', target: 'npm install', timestamp: now });
    tracker.addExec(execOp);

    const dot = tracker.toDot();
    expect(dot).toContain('ellipse');
  });
});

// ---------------------------------------------------------------------------
// toMermaid
// ---------------------------------------------------------------------------

describe('toMermaid()', () => {
  it('exports the graph in Mermaid diagram format', () => {
    const now = 8_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'src/b.ts', timestamp: now });
    const w1 = makeOp({ type: 'write', target: 'src/b.ts', timestamp: now + 100 });

    tracker.addRead(r1);
    tracker.addWrite(w1);

    const mermaid = tracker.toMermaid();
    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('informed');
    expect(mermaid).toContain('-->');
  });
});

// ---------------------------------------------------------------------------
// toJSON / fromJSON
// ---------------------------------------------------------------------------

describe('toJSON() / fromJSON()', () => {
  it('serializes and deserializes cleanly, preserving graph', () => {
    const now = 9_000_000;
    const tracker = new ProvenanceTracker('session-json', 30_000);

    const r1 = makeOp({ type: 'read', target: 'src/x.ts', timestamp: now });
    const w1 = makeOp({ type: 'write', target: 'src/x.ts', timestamp: now + 100 });

    tracker.addRead(r1);
    tracker.addWrite(w1);

    const json = tracker.toJSON();
    const serialized = JSON.stringify(json);
    const parsed = JSON.parse(serialized);
    const restored = ProvenanceTracker.fromJSON(parsed);

    const graph = restored.getProvenance();
    expect(graph.sessionId).toBe('session-json');
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relation).toBe('informed');
  });

  it('preserves the causalWindowMs setting through round-trip', () => {
    const tracker = new ProvenanceTracker('s1', 5_000);
    const json = tracker.toJSON();
    expect(json.causalWindowMs).toBe(5_000);

    const restored = ProvenanceTracker.fromJSON(json);
    const restoredJson = restored.toJSON();
    expect(restoredJson.causalWindowMs).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Time window based causal inference
// ---------------------------------------------------------------------------

describe('time-window based causal inference', () => {
  it('ignores reads that fall outside the causal window', () => {
    const tracker = new ProvenanceTracker('session-1', 1_000); // 1 second window
    const base = 10_000_000;

    const oldRead = makeOp({ type: 'read', target: 'src/old.ts', timestamp: base });
    const recentWrite = makeOp({
      type: 'write',
      target: 'src/old.ts',
      // 2 seconds after the read – outside the 1s window
      timestamp: base + 2_000,
    });

    tracker.addRead(oldRead);
    tracker.addWrite(recentWrite);

    const graph = tracker.getProvenance();
    expect(graph.edges).toHaveLength(0);
  });

  it('includes reads within the causal window', () => {
    const tracker = new ProvenanceTracker('session-1', 10_000); // 10 second window
    const base = 11_000_000;

    const recentRead = makeOp({ type: 'read', target: 'src/recent.ts', timestamp: base });
    const write = makeOp({
      type: 'write',
      target: 'src/recent.ts',
      timestamp: base + 5_000, // 5 seconds later – within window
    });

    tracker.addRead(recentRead);
    tracker.addWrite(write);

    const graph = tracker.getProvenance();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relation).toBe('informed');
  });
});

// ---------------------------------------------------------------------------
// getImpactedFiles
// ---------------------------------------------------------------------------

describe('getImpactedFiles(opId)', () => {
  it('returns all files transitively affected by an operation', () => {
    const now = 12_000_000;
    const tracker = new ProvenanceTracker('session-1');

    // r1 → w1 (src/a.ts)
    const r1 = makeOp({ type: 'read', target: 'src/a.ts', timestamp: now });
    tracker.addRead(r1);

    const w1 = makeOp({ type: 'write', target: 'src/a.ts', timestamp: now + 100 });
    tracker.addWrite(w1);

    // w2 explicitly depends on w1 (e.g. agent wrote b.ts after writing a.ts as a consequence)
    // causedBy links w2 back to w1, forming: r1 → w1 → w2
    const w2 = makeOp({
      type: 'write',
      target: 'src/b.ts',
      timestamp: now + 300,
      causedBy: [w1.id],
    });
    tracker.addWrite(w2);

    const impacted = tracker.getImpactedFiles(r1.id);
    expect(impacted).toContain('src/a.ts');
    // src/b.ts is transitively affected via the r1→w1→w2 chain
    expect(impacted).toContain('src/b.ts');
  });

  it('excludes exec nodes from impacted files', () => {
    const now = 12_500_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'package.json', timestamp: now });
    tracker.addRead(r1);

    const execOp = makeOp({ type: 'exec', target: 'npm install', timestamp: now + 100 });
    tracker.addExec(execOp);

    const impacted = tracker.getImpactedFiles(r1.id);
    expect(impacted).not.toContain('npm install');
  });
});

// ---------------------------------------------------------------------------
// Complex scenario: 10+ operations
// ---------------------------------------------------------------------------

describe('complex scenario with 10+ operations', () => {
  it('creates the correct provenance chain', () => {
    const tracker = new ProvenanceTracker('complex-session');
    const base = 20_000_000;

    // 1. Read config files
    const readPkg = makeOp({ type: 'read', target: 'package.json', timestamp: base });
    const readTsconfig = makeOp({ type: 'read', target: 'tsconfig.json', timestamp: base + 100 });
    tracker.addRead(readPkg);
    tracker.addRead(readTsconfig);

    // 2. Read source files
    const readA = makeOp({ type: 'read', target: 'src/core/a.ts', timestamp: base + 200 });
    const readB = makeOp({ type: 'read', target: 'src/core/b.ts', timestamp: base + 300 });
    tracker.addRead(readA);
    tracker.addRead(readB);

    // 3. Write modified source files
    const writeA = makeOp({ type: 'write', target: 'src/core/a.ts', timestamp: base + 400 });
    tracker.addWrite(writeA); // informed by readA; depends_on pkg/tsconfig

    const writeB = makeOp({ type: 'write', target: 'src/core/b.ts', timestamp: base + 500 });
    tracker.addWrite(writeB); // informed by readB; depends_on pkg/tsconfig

    // 4. Read the written files to create an index
    const readA2 = makeOp({ type: 'read', target: 'src/core/a.ts', timestamp: base + 600 });
    const readB2 = makeOp({ type: 'read', target: 'src/core/b.ts', timestamp: base + 700 });
    tracker.addRead(readA2);
    tracker.addRead(readB2);

    // 5. Write index file
    const writeIndex = makeOp({ type: 'write', target: 'src/index.ts', timestamp: base + 800 });
    tracker.addWrite(writeIndex);

    // 6. Exec: run build
    const execBuild = makeOp({ type: 'exec', target: 'npm run build', timestamp: base + 900 });
    tracker.addExec(execBuild);

    // 7. Write dist output (triggered by exec)
    const writeDist = makeOp({ type: 'write', target: 'dist/index.js', timestamp: base + 1000 });
    tracker.addWrite(writeDist);

    // 8. Read test file, write test results
    const readTest = makeOp({ type: 'read', target: 'tests/a.test.ts', timestamp: base + 1100 });
    tracker.addRead(readTest);

    const writeResult = makeOp({ type: 'write', target: 'test-results.json', timestamp: base + 1200 });
    tracker.addWrite(writeResult);

    const graph = tracker.getProvenance();

    // Verify node count (13 ops total)
    expect(graph.nodes).toHaveLength(13);

    // Verify there are edges
    expect(graph.edges.length).toBeGreaterThan(0);

    // Verify that writeA has an "informed" edge from readA
    expect(
      graph.edges.some((e) => e.from === readA.id && e.to === writeA.id && e.relation === 'informed'),
    ).toBe(true);

    // Verify depends_on from config reads to source writes
    expect(
      graph.edges.some((e) => e.from === readPkg.id && e.to === writeA.id && e.relation === 'depends_on'),
    ).toBe(true);

    // Verify triggered edge from exec to dist write
    expect(
      graph.edges.some((e) => e.from === execBuild.id && e.to === writeDist.id && e.relation === 'triggered'),
    ).toBe(true);

    // getAncestors of writeA should include readA and config reads
    const ancestorsOfWriteA = tracker.getAncestors(writeA.id).map((n) => n.operationId);
    expect(ancestorsOfWriteA).toContain(readA.id);
    expect(ancestorsOfWriteA).toContain(readPkg.id);

    // getDescendants of readPkg should include writeA (and other writes in window)
    const descOfPkg = tracker.getDescendants(readPkg.id).map((n) => n.operationId);
    expect(descOfPkg).toContain(writeA.id);

    // getImpactedFiles starting from readPkg
    const impacted = tracker.getImpactedFiles(readPkg.id);
    expect(impacted).toContain('src/core/a.ts');
  });
});

// ---------------------------------------------------------------------------
// addExec
// ---------------------------------------------------------------------------

describe('ProvenanceTracker.addExec()', () => {
  it('creates a node for the exec operation', () => {
    const tracker = new ProvenanceTracker('session-1');
    const execOp = makeOp({ type: 'exec', target: 'npm run build' });
    const node = tracker.addExec(execOp);

    expect(node.operationId).toBe(execOp.id);
    expect(node.type).toBe('exec');
    expect(tracker.getProvenance().nodes).toHaveLength(1);
  });

  it('links to reads that informed the exec command', () => {
    const now = 13_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const readPkg = makeOp({ type: 'read', target: 'package.json', timestamp: now });
    tracker.addRead(readPkg);

    const execOp = makeOp({ type: 'exec', target: 'npm install', timestamp: now + 500 });
    tracker.addExec(execOp);

    const graph = tracker.getProvenance();
    expect(graph.edges.some((e) => e.from === readPkg.id && e.to === execOp.id)).toBe(true);
  });

  it('creates a "triggered" edge from exec to a subsequent write', () => {
    const now = 14_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const execOp = makeOp({ type: 'exec', target: 'npm install', timestamp: now });
    tracker.addExec(execOp);

    const writeOp = makeOp({ type: 'write', target: 'node_modules/.package-lock.json', timestamp: now + 500 });
    tracker.addWrite(writeOp);

    const graph = tracker.getProvenance();
    expect(
      graph.edges.some(
        (e) => e.from === execOp.id && e.to === writeOp.id && e.relation === 'triggered',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// explicit causedBy
// ---------------------------------------------------------------------------

describe('explicit causedBy links', () => {
  it('uses causedBy rather than inferring when causedBy is set', () => {
    const now = 15_000_000;
    const tracker = new ProvenanceTracker('session-1');

    const r1 = makeOp({ type: 'read', target: 'unrelated.ts', timestamp: now });
    tracker.addRead(r1);

    const r2 = makeOp({ type: 'read', target: 'also-unrelated.ts', timestamp: now + 100 });
    tracker.addRead(r2);

    // explicitly says it was caused by r1 only
    const w1 = makeOp({
      type: 'write',
      target: 'output.ts',
      timestamp: now + 200,
      causedBy: [r1.id],
    });
    tracker.addWrite(w1);

    const graph = tracker.getProvenance();
    const edgesToW1 = graph.edges.filter((e) => e.to === w1.id);
    expect(edgesToW1).toHaveLength(1);
    expect(edgesToW1[0].from).toBe(r1.id);
    expect(edgesToW1[0].relation).toBe('informed');
  });
});

// ---------------------------------------------------------------------------
// getCriticalPath
// ---------------------------------------------------------------------------

describe('getCriticalPath()', () => {
  it('returns the longest chain of causal operations', () => {
    const now = 16_000_000;
    const tracker = new ProvenanceTracker('session-1');

    // Build a linear chain: r1 → w1 → r2 → w2
    const r1 = makeOp({ type: 'read', target: 'a.ts', timestamp: now });
    tracker.addRead(r1);

    const w1 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 100 });
    tracker.addWrite(w1);

    const r2 = makeOp({ type: 'read', target: 'a.ts', timestamp: now + 200 });
    tracker.addRead(r2);

    const w2 = makeOp({ type: 'write', target: 'a.ts', timestamp: now + 300 });
    tracker.addWrite(w2);

    const path = tracker.getCriticalPath();
    expect(path.length).toBeGreaterThanOrEqual(2);

    // The path should include r1 as it's the ultimate source
    const pathIds = path.map((n) => n.operationId);
    expect(pathIds[0]).toBe(r1.id);
  });

  it('returns empty array for an empty graph', () => {
    const tracker = new ProvenanceTracker('session-1');
    expect(tracker.getCriticalPath()).toEqual([]);
  });

  it('returns single node for a graph with no edges', () => {
    const tracker = new ProvenanceTracker('session-1');
    const op = makeOp({ type: 'read', target: 'x.ts' });
    tracker.addRead(op);

    const path = tracker.getCriticalPath();
    expect(path).toHaveLength(1);
    expect(path[0].operationId).toBe(op.id);
  });
});
