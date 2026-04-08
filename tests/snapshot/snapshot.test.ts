import { describe, it, expect } from 'vitest';
import { SnapshotManager } from '../../src/snapshot/index.js';

function makeFiles(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('SnapshotManager — basic snapshot and mount', () => {
  it('takes a first snapshot and mounts it', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'hello', 'b.ts': 'world' }), 'init');

    const vfs = mgr.mount(0);
    expect(vfs.files.get('a.ts')).toBe('hello');
    expect(vfs.files.get('b.ts')).toBe('world');
    expect(vfs.snapshotIndex).toBe(0);
  });

  it('second snapshot only stores changed files', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'v1', 'b.ts': 'unchanged' }), 'init');
    mgr.snapshot(makeFiles({ 'a.ts': 'v2', 'b.ts': 'unchanged' }), 'update a');

    const layer1 = mgr.getLayer(1);
    expect(layer1.delta.has('a.ts')).toBe(true);
    expect(layer1.delta.has('b.ts')).toBe(false); // unchanged — not in delta
  });

  it('mounts historical snapshot correctly', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'f.ts': 'v1' }), 's0');
    mgr.snapshot(makeFiles({ 'f.ts': 'v2' }), 's1');
    mgr.snapshot(makeFiles({ 'f.ts': 'v3' }), 's2');

    expect(mgr.mount(0).files.get('f.ts')).toBe('v1');
    expect(mgr.mount(1).files.get('f.ts')).toBe('v2');
    expect(mgr.mount(2).files.get('f.ts')).toBe('v3');
  });

  it('tracks file deletion', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'exists', 'b.ts': 'also' }), 's0');
    mgr.snapshot(makeFiles({ 'b.ts': 'also' }), 's1 — a deleted');

    const vfs0 = mgr.mount(0);
    const vfs1 = mgr.mount(1);

    expect(vfs0.files.has('a.ts')).toBe(true);
    expect(vfs1.files.has('a.ts')).toBe(false);
    expect(vfs1.files.get('b.ts')).toBe('also');
  });

  it('throws for out-of-range mount', () => {
    const mgr = new SnapshotManager();
    expect(() => mgr.mount(0)).toThrow(RangeError);
  });
});

describe('SnapshotManager — getFile', () => {
  it('returns file content at a given snapshot', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'x.ts': 'initial' }), 's0');
    mgr.snapshot(makeFiles({ 'x.ts': 'modified' }), 's1');

    expect(mgr.getFile('x.ts', 0)).toBe('initial');
    expect(mgr.getFile('x.ts', 1)).toBe('modified');
  });

  it('returns null for file not present', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'x' }), 's0');
    expect(mgr.getFile('missing.ts', 0)).toBeNull();
  });

  it('returns null for deleted file at snapshot after deletion', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'del.ts': 'here' }), 's0');
    mgr.snapshot(makeFiles({}), 's1 — deleted');
    expect(mgr.getFile('del.ts', 1)).toBeNull();
  });
});

describe('SnapshotManager — diff', () => {
  it('reports added files', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'x' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'x', 'b.ts': 'new' }), 's1');

    const d = mgr.diff(0, 1);
    expect(d.added).toContain('b.ts');
    expect(d.unchanged).toContain('a.ts');
  });

  it('reports deleted files', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'x', 'b.ts': 'gone' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'x' }), 's1');

    const d = mgr.diff(0, 1);
    expect(d.deleted).toContain('b.ts');
  });

  it('reports modified files', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'old' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'new' }), 's1');

    const d = mgr.diff(0, 1);
    expect(d.modified).toContain('a.ts');
  });

  it('diff has correct from and to indices', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'f.ts': 'v0' }), 's0');
    mgr.snapshot(makeFiles({ 'f.ts': 'v1' }), 's1');
    mgr.snapshot(makeFiles({ 'f.ts': 'v2' }), 's2');

    const d = mgr.diff(0, 2);
    expect(d.from).toBe(0);
    expect(d.to).toBe(2);
  });
});

describe('SnapshotManager — branch', () => {
  it('creates an isolated fork at a given index', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'f.ts': 'v0' }), 's0');
    mgr.snapshot(makeFiles({ 'f.ts': 'v1' }), 's1');
    mgr.snapshot(makeFiles({ 'f.ts': 'v2' }), 's2');

    const fork = mgr.branch(1);
    expect(fork.length).toBe(2);
    expect(fork.mount(1).files.get('f.ts')).toBe('v1');
  });

  it('writing to fork does not affect parent', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'f.ts': 'original' }), 's0');

    const fork = mgr.branch(0);
    fork.snapshot(makeFiles({ 'f.ts': 'forked' }), 'fork-s1');

    expect(mgr.length).toBe(1);
    expect(mgr.mount(0).files.get('f.ts')).toBe('original');
  });
});

describe('SnapshotManager — findLastModified', () => {
  it('returns all layers where file was modified', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'v0' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'v1' }), 's1');
    mgr.snapshot(makeFiles({ 'a.ts': 'v1', 'b.ts': 'x' }), 's2'); // a unchanged
    mgr.snapshot(makeFiles({ 'a.ts': 'v2', 'b.ts': 'x' }), 's3');

    const indices = mgr.findLastModified('a.ts');
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    expect(indices).not.toContain(2);
    expect(indices).toContain(3);
  });
});

describe('SnapshotManager — stats', () => {
  it('reports correct layer count', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'x' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'y' }), 's1');
    expect(mgr.stats().layerCount).toBe(2);
  });

  it('reports non-negative compressionRatio', () => {
    const content = 'x'.repeat(1000);
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'big.ts': content }), 's0');
    mgr.snapshot(makeFiles({ 'big.ts': content, 'small.ts': 'x' }), 's1');
    const s = mgr.stats();
    expect(s.compressionRatio).toBeGreaterThanOrEqual(0);
  });

  it('reports zero layers for empty manager', () => {
    const mgr = new SnapshotManager();
    const s = mgr.stats();
    expect(s.layerCount).toBe(0);
    expect(s.totalDeltaFiles).toBe(0);
  });
});

describe('SnapshotManager — export/import', () => {
  it('serialises and restores all layers', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({ 'a.ts': 'v0' }), 's0');
    mgr.snapshot(makeFiles({ 'a.ts': 'v1', 'b.ts': 'new' }), 's1');

    const exported = mgr.export();
    const restored = SnapshotManager.import(exported);

    expect(restored.length).toBe(2);
    expect(restored.mount(0).files.get('a.ts')).toBe('v0');
    expect(restored.mount(1).files.get('b.ts')).toBe('new');
  });

  it('exported format contains label and timestamp', () => {
    const mgr = new SnapshotManager();
    mgr.snapshot(makeFiles({}), 'my-label');
    const [layer] = mgr.export();
    expect(layer!.label).toBe('my-label');
    expect(layer!.timestamp).toBeTruthy();
  });
});
