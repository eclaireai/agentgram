/**
 * A tape entry records one external input — the raw data that crossed the
 * boundary between the world and the LLM.
 * Everything else (reasoning, decisions) is derived from these inputs.
 */
export interface TapeEntry {
  /** Monotonic sequence number */
  seq: number;
  /** Wall-clock timestamp */
  timestamp: number;
  /** Type of external input */
  type: 'file_read' | 'exec_output' | 'initial_prompt' | 'env_snapshot' | 'tool_result';
  /** For file_read: path. For exec: command. For prompt: task description */
  key: string;
  /** The raw external data — this is what we store */
  value: string;
  /** SHA-256 of value — for integrity checking */
  hash: string;
  /** Only store if content changed since last read of same key */
  delta?: boolean;
}

export interface ReplayTape {
  /** Tape format version */
  version: '1';
  /** Unique tape ID */
  id: string;
  /** Session name */
  name: string;
  /** Model that produced this session */
  modelVersion: string;
  /** When recording started */
  startedAt: string;
  /** When recording ended */
  endedAt?: string;
  /** The ordered list of external inputs */
  entries: TapeEntry[];
  /** SHA-256 of all entry hashes concatenated — tape integrity */
  tapeHash: string;
  /** Uncompressed size of all values in bytes */
  totalValueBytes: number;
  /** Number of deduplicated entries (delta compression) */
  deduplicatedCount: number;
}

export interface TapeStats {
  entryCount: number;
  totalBytes: number;
  uniqueFiles: number;
  uniqueCommands: number;
  estimatedFullSessionBytes: number;  // without delta compression
  compressionRatio: number;           // estimatedFull / totalBytes
  durationMs: number;
}

export interface ReplayFrame {
  seq: number;
  entry: TapeEntry;
  /** Cumulative state at this point (all file contents known so far) */
  fileState: Map<string, string>;
  /** All commands run up to this point with their outputs */
  commandHistory: Array<{ command: string; output: string; seq: number }>;
}
