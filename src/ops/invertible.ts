/**
 * Invertible Operation Log
 *
 * Records every file mutation as a reversible transform (OT-style).
 * Supports selective undo: revert any op without undoing subsequent ops.
 * Subsequent ops are rebased — their line positions shift to account for
 * the undone edit, just like a CRDT merge.
 *
 * Usage:
 *   const log = new InvertibleLog();
 *   log.load('src/app.ts', ['line 1', 'line 2', 'line 3']);
 *   const id = log.append('src/app.ts', 'replace', [1, 2], ['line 2'], ['updated line 2']);
 *   log.undo(id);   // restore 'line 2', rebasing later ops
 */

import { randomBytes } from 'node:crypto';
import type { InvertibleOp, UndoResult, FileSnapshot } from './types.js';

export type { InvertibleOp, UndoResult, FileSnapshot };

function newId(): string {
  return randomBytes(6).toString('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Apply a single op against a lines array
// ---------------------------------------------------------------------------

function applyOp(lines: string[], op: InvertibleOp): string[] {
  const [start, end] = op.range;
  const result = [...lines];
  result.splice(start, end - start, ...op.new);
  return result;
}

// ---------------------------------------------------------------------------
// InvertibleLog
// ---------------------------------------------------------------------------

export class InvertibleLog {
  private ops: InvertibleOp[] = [];
  private fileState = new Map<string, string[]>();
  /** Immutable initial state — used as the replay base in _rebuildState */
  private initialState = new Map<string, string[]>();
  private seq = 0;

  // ── load initial file content ──────────────────────────────────────────────

  load(file: string, lines: string[]): void {
    const copy = [...lines];
    this.fileState.set(file, copy);
    this.initialState.set(file, copy);
  }

  loadText(file: string, text: string): void {
    this.load(file, text.split('\n'));
  }

  // ── append a new op ────────────────────────────────────────────────────────

  /**
   * Record a new operation and apply it to the in-memory file state.
   * Returns the new op's ID.
   */
  append(
    file: string,
    type: InvertibleOp['type'],
    range: [number, number],
    oldLines: string[],
    newLines: string[],
  ): string {
    const id = newId();
    const op: InvertibleOp = {
      id,
      file,
      type,
      range,
      old: oldLines,
      new: newLines,
      seq: this.seq++,
      timestamp: nowIso(),
      undone: false,
    };

    this.ops.push(op);

    // Apply to live state
    const lines = this.fileState.get(file) ?? [];
    this.fileState.set(file, applyOp(lines, op));

    return id;
  }

  /**
   * Convenience: record a replace op by computing old from current state.
   */
  replace(file: string, startLine: number, endLine: number, newLines: string[]): string {
    const lines = this.fileState.get(file) ?? [];
    const oldLines = lines.slice(startLine, endLine);
    return this.append(file, 'replace', [startLine, endLine], oldLines, newLines);
  }

  /**
   * Convenience: insert lines at a position.
   */
  insert(file: string, atLine: number, newLines: string[]): string {
    return this.append(file, 'insert', [atLine, atLine], [], newLines);
  }

  /**
   * Convenience: delete a range of lines.
   */
  delete(file: string, startLine: number, endLine: number): string {
    const lines = this.fileState.get(file) ?? [];
    const oldLines = lines.slice(startLine, endLine);
    return this.append(file, 'delete', [startLine, endLine], oldLines, []);
  }

  // ── selective undo ─────────────────────────────────────────────────────────

  /**
   * Undo a specific op — without undoing anything that came after it.
   *
   * Algorithm:
   * 1. Find the target op and validate it.
   * 2. Mark it as undone.
   * 3. Rebuild file state by replaying all non-undone ops via OT-shifted ranges.
   *    _rebuildState adjusts each op's range for skipped (undone) ops automatically.
   * 4. Return the conceptual inverse op for auditing.
   */
  undo(opId: string): UndoResult {
    const targetIdx = this.ops.findIndex((o) => o.id === opId);
    if (targetIdx === -1) {
      return { success: false, opId, error: `Op ${opId} not found` };
    }

    const target = this.ops[targetIdx]!;
    if (target.undone) {
      return { success: false, opId, error: `Op ${opId} is already undone` };
    }

    // Mark original op as undone
    this.ops[targetIdx] = { ...target, undone: true };

    // Rebuild file state — _rebuildState applies OT range shifts for skipped ops
    this._rebuildState(target.file);

    // Build conceptual inverse op for the return value (informational)
    const inverseOp: InvertibleOp = {
      id: `inv-${target.id}`,
      file: target.file,
      type: target.type === 'insert' ? 'delete' : target.type === 'delete' ? 'insert' : 'replace',
      range: target.range,
      old: target.new,
      new: target.old,
      seq: this.seq++,
      timestamp: nowIso(),
      undone: false,
    };

    return { success: true, opId, inverseOp };
  }

  /**
   * Re-apply an undone op.
   */
  redo(opId: string): UndoResult {
    const targetIdx = this.ops.findIndex((o) => o.id === opId);
    if (targetIdx === -1) {
      return { success: false, opId, error: `Op ${opId} not found` };
    }

    const target = this.ops[targetIdx]!;
    if (!target.undone) {
      return { success: false, opId, error: `Op ${opId} is not undone` };
    }

    this.ops[targetIdx] = { ...target, undone: false };

    // Rebuild from scratch for correctness
    this._rebuildState(target.file);

    // Return a conceptual "redo op" for the caller
    const redoOp: InvertibleOp = {
      ...target,
      id: `redo-${target.id}`,
      seq: this.seq++,
      timestamp: nowIso(),
    };

    return { success: true, opId, inverseOp: redoOp };
  }

  // ── queries ────────────────────────────────────────────────────────────────

  /** Get current in-memory lines for a file */
  getLines(file: string): string[] {
    return [...(this.fileState.get(file) ?? [])];
  }

  /** Get current text for a file */
  getText(file: string): string {
    return this.getLines(file).join('\n');
  }

  /** Get all ops in order */
  getOps(): InvertibleOp[] {
    return [...this.ops];
  }

  /** Get all non-undone ops for a file */
  getActiveOps(file: string): InvertibleOp[] {
    return this.ops.filter((o) => o.file === file && !o.undone);
  }

  /** Snapshot the current state of a file */
  snapshot(file: string): FileSnapshot {
    const activeOps = this.getActiveOps(file);
    return {
      file,
      lines: this.getLines(file),
      atSeq: activeOps.length > 0 ? activeOps[activeOps.length - 1]!.seq : -1,
    };
  }

  /** Get file state as it was after a specific op was applied */
  getStateAtOp(file: string, afterOpId: string): string[] | null {
    const target = this.ops.find((o) => o.id === afterOpId);
    if (!target) return null;

    const initial = this.initialState.get(file) ?? [];
    let lines = [...initial];

    for (const op of this.ops) {
      if (op.file !== file || op.undone) continue;
      lines = applyOp(lines, op);
      if (op.id === afterOpId) break;
    }

    return lines;
  }

  /** Full log — for serialisation/persistence */
  export(): { ops: InvertibleOp[]; initialState: Record<string, string[]> } {
    const initial: Record<string, string[]> = {};
    for (const [k, v] of this.initialState) {
      initial[k] = v;
    }
    return { ops: [...this.ops], initialState: initial };
  }

  /** Restore from a serialised export */
  static import(data: { ops: InvertibleOp[]; initialState: Record<string, string[]> }): InvertibleLog {
    const log = new InvertibleLog();
    log.ops = data.ops.map((o) => ({ ...o }));
    for (const [k, v] of Object.entries(data.initialState)) {
      const copy = [...v];
      log.initialState.set(k, copy);
      // Rebuild current state from initial + non-undone ops
    }
    log.seq = data.ops.length > 0 ? Math.max(...data.ops.map((o) => o.seq)) + 1 : 0;
    // Rebuild all file states
    for (const file of Object.keys(data.initialState)) {
      log._rebuildState(file);
    }
    return log;
  }

  // ── private ────────────────────────────────────────────────────────────────

  /**
   * Rebuild the in-memory state for a file.
   *
   * Replays all non-undone ops in sequence order from the initial state.
   * Each op's range was stored relative to the world where all preceding ops
   * (including those now undone) had been applied. When an op is skipped
   * (undone), its line delta is subtracted from all subsequent ops' ranges
   * — this is the OT (Operational Transform) step that makes selective undo work.
   */
  private _rebuildState(file: string): void {
    const initial = this.initialState.get(file) ?? [];
    let lines = [...initial];

    // Sorted by original seq so we apply in order
    const fileOps = this.ops
      .filter((o) => o.file === file)
      .sort((a, b) => a.seq - b.seq);

    // cumulativeSkippedDelta: total line delta of ops we have NOT applied.
    // Subtract this from each applied op's stored range to get its effective position.
    let cumulativeSkippedDelta = 0;

    for (const op of fileOps) {
      if (op.undone) {
        // This op's line change was assumed by all later ops. Since we're
        // skipping it, cancel its effect on subsequent ranges.
        cumulativeSkippedDelta += op.new.length - op.old.length;
        continue;
      }

      // Shift range down by the total delta of skipped ops before this one
      const shiftedRange: [number, number] = [
        Math.max(0, op.range[0] - cumulativeSkippedDelta),
        Math.max(0, op.range[1] - cumulativeSkippedDelta),
      ];

      const adjustedOp = { ...op, range: shiftedRange };
      lines = applyOp(lines, adjustedOp);
    }

    this.fileState.set(file, lines);
  }
}
