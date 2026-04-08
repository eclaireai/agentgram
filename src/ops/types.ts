/**
 * Invertible Operation Log — Types
 *
 * Every file mutation is stored as a reversible transform.
 * Operations can be selectively undone via OT-style rebase —
 * revert op #3 while keeping ops #4–#15 applied correctly.
 */

export type OpType = 'insert' | 'delete' | 'replace';

/**
 * A single invertible edit to a file.
 * Range is line-based (0-indexed, [start, end) exclusive end).
 */
export interface InvertibleOp {
  /** Unique operation ID */
  id: string;
  /** File path this op applies to */
  file: string;
  /** Operation type */
  type: OpType;
  /**
   * Line range the op affects [startLine, endLine).
   * - insert: range start = insertion point, end = start (0 lines selected)
   * - delete/replace: range = lines being removed/replaced
   */
  range: [number, number];
  /** Lines before the op (empty array for insert) */
  old: string[];
  /** Lines after the op (empty array for delete) */
  new: string[];
  /** Monotonic sequence number — order of application */
  seq: number;
  /** ISO timestamp */
  timestamp: string;
  /** Whether this op has been undone */
  undone: boolean;
}

/** A log entry that wraps an op with its current effective position */
export interface LogEntry {
  op: InvertibleOp;
  /** Effective range after all preceding non-undone ops are considered */
  effectiveRange: [number, number];
}

/** Result of an undo or redo */
export interface UndoResult {
  success: boolean;
  opId: string;
  /** The inverse op that was applied to restore the previous state */
  inverseOp?: InvertibleOp;
  /** Error message if not successful */
  error?: string;
}

/** Snapshot of a single file's line content */
export interface FileSnapshot {
  file: string;
  lines: string[];
  /** Sequence number of the last op applied */
  atSeq: number;
}
