import { describe, it, expect } from 'vitest';
import { InvertibleLog } from '../../src/ops/invertible.js';

function makeLog(lines: string[]): InvertibleLog {
  const log = new InvertibleLog();
  log.load('file.ts', lines);
  return log;
}

describe('InvertibleLog — basic operations', () => {
  it('loads initial file state', () => {
    const log = makeLog(['a', 'b', 'c']);
    expect(log.getLines('file.ts')).toEqual(['a', 'b', 'c']);
  });

  it('applies an insert op', () => {
    const log = makeLog(['a', 'c']);
    log.insert('file.ts', 1, ['b']);
    expect(log.getLines('file.ts')).toEqual(['a', 'b', 'c']);
  });

  it('applies a delete op', () => {
    const log = makeLog(['a', 'b', 'c']);
    log.delete('file.ts', 1, 2);
    expect(log.getLines('file.ts')).toEqual(['a', 'c']);
  });

  it('applies a replace op', () => {
    const log = makeLog(['a', 'b', 'c']);
    log.replace('file.ts', 1, 2, ['B']);
    expect(log.getLines('file.ts')).toEqual(['a', 'B', 'c']);
  });

  it('getText returns newline-joined lines', () => {
    const log = makeLog(['hello', 'world']);
    expect(log.getText('file.ts')).toBe('hello\nworld');
  });

  it('returns empty array for unknown file', () => {
    const log = new InvertibleLog();
    expect(log.getLines('unknown.ts')).toEqual([]);
  });
});

describe('InvertibleLog — undo', () => {
  it('undoes a simple replace', () => {
    const log = makeLog(['a', 'b', 'c']);
    const id = log.replace('file.ts', 1, 2, ['B']);
    expect(log.getLines('file.ts')).toEqual(['a', 'B', 'c']);

    const result = log.undo(id);
    expect(result.success).toBe(true);
    expect(log.getLines('file.ts')).toEqual(['a', 'b', 'c']);
  });

  it('undoes a simple insert', () => {
    const log = makeLog(['a', 'c']);
    const id = log.insert('file.ts', 1, ['b']);
    const result = log.undo(id);
    expect(result.success).toBe(true);
    expect(log.getLines('file.ts')).toEqual(['a', 'c']);
  });

  it('undoes a simple delete', () => {
    const log = makeLog(['a', 'b', 'c']);
    const id = log.delete('file.ts', 1, 2);
    const result = log.undo(id);
    expect(result.success).toBe(true);
    expect(log.getLines('file.ts')).toEqual(['a', 'b', 'c']);
  });

  it('selective undo: revert first op, keep second', () => {
    const log = makeLog(['a', 'b', 'c']);
    const id1 = log.replace('file.ts', 0, 1, ['A']); // 'a' → 'A'
    log.replace('file.ts', 2, 3, ['C']);              // 'c' → 'C'
    // State: ['A', 'b', 'C']

    const result = log.undo(id1); // Undo first op only
    expect(result.success).toBe(true);
    // State should be: ['a', 'b', 'C'] — first op reverted, second kept
    expect(log.getLines('file.ts')[0]).toBe('a');
    expect(log.getLines('file.ts')[2]).toBe('C');
  });

  it('selective undo: revert middle op', () => {
    const log = makeLog(['a', 'b', 'c', 'd']);
    log.replace('file.ts', 0, 1, ['A']);     // line 0: 'a' → 'A'
    const id2 = log.replace('file.ts', 1, 2, ['B']); // line 1: 'b' → 'B'
    log.replace('file.ts', 2, 3, ['C']);     // line 2: 'c' → 'C'
    // State: ['A', 'B', 'C', 'd']

    log.undo(id2); // Undo only middle op
    const lines = log.getLines('file.ts');
    expect(lines[0]).toBe('A');  // First op still applied
    expect(lines[1]).toBe('b');  // Middle op reverted
    expect(lines[2]).toBe('C');  // Last op still applied
  });

  it('returns error for unknown op id', () => {
    const log = makeLog(['a', 'b']);
    const result = log.undo('nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when undoing an already-undone op', () => {
    const log = makeLog(['a', 'b']);
    const id = log.replace('file.ts', 0, 1, ['A']);
    log.undo(id);
    const result = log.undo(id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already undone');
  });

  it('undoing an insert after a later insert', () => {
    const log = makeLog(['a', 'c', 'e']);
    const id1 = log.insert('file.ts', 1, ['b']); // ['a', 'b', 'c', 'e']
    log.insert('file.ts', 3, ['d']);              // ['a', 'b', 'c', 'd', 'e']

    log.undo(id1); // Remove 'b', keep 'd'
    const lines = log.getLines('file.ts');
    expect(lines).toContain('a');
    expect(lines).not.toContain('b');
    expect(lines).toContain('d');
    expect(lines).toContain('e');
  });
});

describe('InvertibleLog — redo', () => {
  it('redoes an undone op', () => {
    const log = makeLog(['a', 'b', 'c']);
    const id = log.replace('file.ts', 1, 2, ['B']);
    log.undo(id);
    expect(log.getLines('file.ts')).toEqual(['a', 'b', 'c']);

    const result = log.redo(id);
    expect(result.success).toBe(true);
    expect(log.getLines('file.ts')[1]).toBe('B');
  });

  it('returns error for redoing a non-undone op', () => {
    const log = makeLog(['a', 'b']);
    const id = log.replace('file.ts', 0, 1, ['A']);
    const result = log.redo(id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not undone');
  });
});

describe('InvertibleLog — queries', () => {
  it('getActiveOps returns only non-undone ops', () => {
    const log = makeLog(['a', 'b', 'c']);
    const id1 = log.replace('file.ts', 0, 1, ['A']);
    log.replace('file.ts', 1, 2, ['B']);
    log.undo(id1);

    const active = log.getActiveOps('file.ts');
    expect(active).toHaveLength(1);
    expect(active[0]!.new).toEqual(['B']);
  });

  it('getOps returns all ops including undone', () => {
    const log = makeLog(['a', 'b']);
    const id = log.replace('file.ts', 0, 1, ['A']);
    log.undo(id);
    expect(log.getOps()).toHaveLength(1);
    expect(log.getOps()[0]!.undone).toBe(true);
  });

  it('snapshot captures current state and seq', () => {
    const log = makeLog(['x', 'y']);
    log.replace('file.ts', 0, 1, ['X']);
    const snap = log.snapshot('file.ts');
    expect(snap.lines).toEqual(['X', 'y']);
    expect(snap.atSeq).toBeGreaterThanOrEqual(0);
  });
});

describe('InvertibleLog — export / import round-trip', () => {
  it('serialises and restores log state', () => {
    const log = makeLog(['a', 'b', 'c']);
    log.replace('file.ts', 0, 1, ['A']);
    log.insert('file.ts', 2, ['bb']);

    const exported = log.export();
    expect(exported.ops).toHaveLength(2);
    expect(exported.initialState['file.ts']).toEqual(['a', 'b', 'c']);

    const restored = InvertibleLog.import(exported);
    expect(restored.getLines('file.ts')).toEqual(log.getLines('file.ts'));
    expect(restored.getOps()).toHaveLength(2);
  });
});

describe('InvertibleLog — multiple files', () => {
  it('tracks state independently per file', () => {
    const log = new InvertibleLog();
    log.load('a.ts', ['line1']);
    log.load('b.ts', ['other']);

    log.replace('a.ts', 0, 1, ['modified']);
    expect(log.getLines('a.ts')).toEqual(['modified']);
    expect(log.getLines('b.ts')).toEqual(['other']);
  });

  it('undo on one file does not affect other', () => {
    const log = new InvertibleLog();
    log.load('a.ts', ['x']);
    log.load('b.ts', ['y']);

    const id = log.replace('a.ts', 0, 1, ['X']);
    log.replace('b.ts', 0, 1, ['Y']);
    log.undo(id);

    expect(log.getLines('a.ts')).toEqual(['x']);
    expect(log.getLines('b.ts')).toEqual(['Y']);
  });
});
