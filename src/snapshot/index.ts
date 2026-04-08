/**
 * FS Overlay Snapshots — Copy-on-Write Filesystem Layers
 *
 * Each tool call (or explicit checkpoint) creates a new snapshot layer.
 * Each layer stores only the files that changed (copy-on-write delta).
 *
 * Mounting a historical snapshot reconstructs the full filesystem state
 * in O(depth) time by walking the CoW chain — no copying needed until write.
 *
 * Use cases:
 *  - Instantly restore the filesystem to any point before a destructive write
 *  - Diff two historical points (what changed between step 3 and step 7?)
 *  - Branch from any snapshot into a fork exploration
 *
 * This is a pure-JS in-memory simulation (not OS overlayfs).
 * For persistence, call snapshot.export() / SnapshotManager.import().
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single CoW layer — only stores files that changed in this layer */
export interface SnapshotLayer {
  /** Layer index (0 = initial state) */
  index: number;
  /** ISO timestamp */
  timestamp: string;
  /** Human-readable label (e.g., 'before tool call: Read src/app.ts') */
  label: string;
  /**
   * Files changed in this layer.
   * string = new content, null = deleted file
   */
  delta: Map<string, string | null>;
}

/** A snapshot layer as stored in JSON (delta as plain object) */
export interface SerializedLayer {
  index: number;
  timestamp: string;
  label: string;
  delta: Record<string, string | null>;
}

/** A virtual filesystem at a given snapshot index */
export interface VirtualFS {
  /** Snapshot index this VFS represents */
  snapshotIndex: number;
  /** All files visible at this snapshot */
  files: Map<string, string>;
  /** Total character count across all files */
  totalChars: number;
}

/** Diff between two snapshots */
export interface SnapshotDiff {
  from: number;
  to: number;
  /** Files added between from and to */
  added: string[];
  /** Files deleted between from and to */
  deleted: string[];
  /** Files modified between from and to */
  modified: string[];
  /** Files unchanged */
  unchanged: string[];
}

// ---------------------------------------------------------------------------
// SnapshotManager
// ---------------------------------------------------------------------------

export class SnapshotManager {
  private layers: SnapshotLayer[] = [];

  constructor() {}

  // ── snapshot creation ─────────────────────────────────────────────────────

  /**
   * Take a snapshot of the current virtual FS.
   * Only stores files that differ from the previous snapshot.
   *
   * @param currentFiles - All files currently in the working tree
   * @param label - Human-readable label for this checkpoint
   */
  snapshot(currentFiles: Map<string, string>, label: string = `snapshot-${this.layers.length}`): SnapshotLayer {
    const delta = new Map<string, string | null>();

    if (this.layers.length === 0) {
      // First layer — store everything
      for (const [path, content] of currentFiles) {
        delta.set(path, content);
      }
    } else {
      // Mount the last snapshot and diff
      const prev = this.mount(this.layers.length - 1);

      for (const [path, content] of currentFiles) {
        const prevContent = prev.files.get(path);
        if (prevContent !== content) {
          delta.set(path, content);
        }
      }

      // Track deletions
      for (const path of prev.files.keys()) {
        if (!currentFiles.has(path)) {
          delta.set(path, null);
        }
      }
    }

    const layer: SnapshotLayer = {
      index: this.layers.length,
      timestamp: new Date().toISOString(),
      label,
      delta,
    };

    this.layers.push(layer);
    return layer;
  }

  // ── mount ─────────────────────────────────────────────────────────────────

  /**
   * Mount a snapshot at a given index — reconstruct the full FS state.
   *
   * Walks the CoW chain from layer 0 to `index`, applying each delta.
   * Time: O(layers × avgDeltaSize), Space: O(total unique files)
   */
  mount(index: number): VirtualFS {
    if (index < 0 || index >= this.layers.length) {
      throw new RangeError(`Snapshot index ${index} out of range (0–${this.layers.length - 1})`);
    }

    const files = new Map<string, string>();

    // Walk forward through all layers up to and including `index`
    for (let i = 0; i <= index; i++) {
      const layer = this.layers[i]!;
      for (const [path, content] of layer.delta) {
        if (content === null) {
          files.delete(path);
        } else {
          files.set(path, content);
        }
      }
    }

    const totalChars = [...files.values()].reduce((s, c) => s + c.length, 0);
    return { snapshotIndex: index, files, totalChars };
  }

  /**
   * Get the content of a single file at a snapshot index.
   * More efficient than mounting the full FS when you only need one file.
   */
  getFile(filePath: string, snapshotIndex: number): string | null {
    let result: string | null | undefined = undefined;

    for (let i = 0; i <= snapshotIndex; i++) {
      const layer = this.layers[i]!;
      if (layer.delta.has(filePath)) {
        result = layer.delta.get(filePath)!;
      }
    }

    return result === undefined ? null : result;
  }

  // ── diff ──────────────────────────────────────────────────────────────────

  /**
   * Compute the diff between two snapshots.
   */
  diff(fromIndex: number, toIndex: number): SnapshotDiff {
    const fromFS = this.mount(fromIndex);
    const toFS = this.mount(toIndex);

    const added: string[] = [];
    const deleted: string[] = [];
    const modified: string[] = [];
    const unchanged: string[] = [];

    for (const [path, content] of toFS.files) {
      if (!fromFS.files.has(path)) {
        added.push(path);
      } else if (fromFS.files.get(path) !== content) {
        modified.push(path);
      } else {
        unchanged.push(path);
      }
    }

    for (const path of fromFS.files.keys()) {
      if (!toFS.files.has(path)) {
        deleted.push(path);
      }
    }

    return { from: fromIndex, to: toIndex, added, deleted, modified, unchanged };
  }

  // ── branch ────────────────────────────────────────────────────────────────

  /**
   * Fork this manager at a given snapshot index.
   * The fork contains layers 0 through `index` only.
   * Writing to the fork does not affect this manager.
   */
  branch(fromIndex: number): SnapshotManager {
    const fork = new SnapshotManager();
    fork.layers = this.layers.slice(0, fromIndex + 1).map((layer) => ({
      ...layer,
      delta: new Map(layer.delta),
    }));
    return fork;
  }

  // ── queries ────────────────────────────────────────────────────────────────

  get length(): number {
    return this.layers.length;
  }

  getLayers(): SnapshotLayer[] {
    return [...this.layers];
  }

  getLayer(index: number): SnapshotLayer {
    const layer = this.layers[index];
    if (!layer) throw new RangeError(`No layer at index ${index}`);
    return layer;
  }

  /**
   * Find the snapshot(s) where a file was last modified.
   */
  findLastModified(filePath: string): number[] {
    return this.layers
      .filter((l) => l.delta.has(filePath))
      .map((l) => l.index);
  }

  /**
   * Summarise the CoW chain: total data stored vs. total data represented.
   */
  stats(): {
    layerCount: number;
    totalDeltaFiles: number;
    totalDeltaChars: number;
    mountedChars: number;
    compressionRatio: number;
  } {
    let totalDeltaFiles = 0;
    let totalDeltaChars = 0;

    for (const layer of this.layers) {
      for (const content of layer.delta.values()) {
        totalDeltaFiles++;
        if (content) totalDeltaChars += content.length;
      }
    }

    const mounted = this.layers.length > 0 ? this.mount(this.layers.length - 1) : null;
    const mountedChars = mounted?.totalChars ?? 0;

    return {
      layerCount: this.layers.length,
      totalDeltaFiles,
      totalDeltaChars,
      mountedChars,
      compressionRatio:
        mountedChars > 0
          ? Math.round((1 - totalDeltaChars / (mountedChars * this.layers.length)) * 100) / 100
          : 0,
    };
  }

  // ── serialisation ─────────────────────────────────────────────────────────

  export(): SerializedLayer[] {
    return this.layers.map((layer) => ({
      index: layer.index,
      timestamp: layer.timestamp,
      label: layer.label,
      delta: Object.fromEntries(layer.delta),
    }));
  }

  static import(data: SerializedLayer[]): SnapshotManager {
    const mgr = new SnapshotManager();
    mgr.layers = data.map((s) => ({
      index: s.index,
      timestamp: s.timestamp,
      label: s.label,
      delta: new Map(Object.entries(s.delta)),
    }));
    return mgr;
  }
}
