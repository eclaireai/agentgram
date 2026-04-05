import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { TapeEntry, ReplayTape, TapeStats } from './types.js';

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export class TapeRecorder {
  private tape: ReplayTape;
  private seenValues: Map<string, string>;   // key → last hash (for delta compression)
  private originalSizes: Map<string, number>; // key → last stored byte size (for stats)
  private seq: number;

  constructor(name: string, modelVersion?: string) {
    this.seenValues = new Map();
    this.originalSizes = new Map();
    this.seq = 0;

    this.tape = {
      version: '1',
      id: randomUUID(),
      name,
      modelVersion: modelVersion ?? 'unknown',
      startedAt: new Date().toISOString(),
      entries: [],
      tapeHash: '',
      totalValueBytes: 0,
      deduplicatedCount: 0,
    };
  }

  /**
   * Record the initial task prompt.
   * Always the first entry in any tape.
   */
  recordPrompt(prompt: string): TapeEntry {
    return this.addEntry('initial_prompt', 'prompt', prompt);
  }

  /**
   * Record a file read — the actual content at read-time.
   * Uses delta compression: if file unchanged since last read, entry is marked
   * delta=true and value is empty string.
   */
  recordFileRead(filePath: string, content: string): TapeEntry {
    const hash = sha256(content);
    const prevHash = this.seenValues.get(filePath);

    if (prevHash !== undefined && prevHash === hash) {
      // No change — store a delta entry (empty value, same hash)
      const entry: TapeEntry = {
        seq: this.seq++,
        timestamp: Date.now(),
        type: 'file_read',
        key: filePath,
        value: '',
        hash,
        delta: true,
      };
      this.tape.entries.push(entry);
      this.tape.deduplicatedCount += 1;
      // totalValueBytes unchanged (value is empty)
      return entry;
    }

    // New or changed content — store in full
    this.seenValues.set(filePath, hash);
    const byteSize = Buffer.byteLength(content, 'utf8');
    this.originalSizes.set(filePath, byteSize);
    return this.addEntry('file_read', filePath, content, hash);
  }

  /**
   * Record a command execution result.
   */
  recordExecOutput(command: string, output: string, exitCode?: number): TapeEntry {
    const fullOutput = exitCode !== undefined
      ? `exit:${exitCode}\n${output}`
      : output;
    return this.addEntry('exec_output', command, fullOutput);
  }

  /**
   * Record a tool result (for MCP/generic tool calls).
   */
  recordToolResult(toolName: string, result: string): TapeEntry {
    return this.addEntry('tool_result', toolName, result);
  }

  /**
   * Snapshot relevant env vars (NODE_VERSION, model identifiers — no secrets).
   */
  recordEnvSnapshot(): TapeEntry {
    const safe: Record<string, string> = {};
    const allowed = [
      'NODE_VERSION',
      'NODE',
      'npm_package_version',
      'ANTHROPIC_MODEL',
      'CLAUDE_MODEL',
      'MODEL_VERSION',
      'AGENTGRAM_MODEL',
      'CI',
      'TERM',
      'SHELL',
    ];
    for (const key of allowed) {
      const val = process.env[key];
      if (val !== undefined) {
        safe[key] = val;
      }
    }
    return this.addEntry('env_snapshot', 'env', JSON.stringify(safe));
  }

  /**
   * Finalize the tape: compute tapeHash, set endedAt, return the tape.
   */
  finalize(): ReplayTape {
    this.tape.endedAt = new Date().toISOString();

    // Chain hash: SHA-256 of all entry hashes concatenated in order
    const chain = this.tape.entries.map(e => e.hash).join('');
    this.tape.tapeHash = sha256(chain);

    return { ...this.tape, entries: [...this.tape.entries] };
  }

  /**
   * Get current tape stats.
   */
  stats(): TapeStats {
    const entries = this.tape.entries;
    const uniqueFiles = new Set(
      entries.filter(e => e.type === 'file_read').map(e => e.key)
    ).size;
    const uniqueCommands = new Set(
      entries.filter(e => e.type === 'exec_output').map(e => e.key)
    ).size;

    // Actual stored bytes (only non-delta entries have content)
    const totalBytes = entries.reduce((sum, e) => sum + Buffer.byteLength(e.value, 'utf8'), 0);

    // Estimated full size: for delta entries, use the last known full size for that key
    let estimatedFullSessionBytes = 0;
    for (const entry of entries) {
      if (!entry.delta) {
        estimatedFullSessionBytes += Buffer.byteLength(entry.value, 'utf8');
      } else {
        // Use last known size for this key
        const known = this.originalSizes.get(entry.key) ?? 0;
        estimatedFullSessionBytes += known;
      }
    }

    const compressionRatio = totalBytes === 0
      ? 1
      : estimatedFullSessionBytes / totalBytes;

    const startMs = new Date(this.tape.startedAt).getTime();
    const endMs = this.tape.endedAt
      ? new Date(this.tape.endedAt).getTime()
      : Date.now();

    return {
      entryCount: entries.length,
      totalBytes,
      uniqueFiles,
      uniqueCommands,
      estimatedFullSessionBytes,
      compressionRatio,
      durationMs: endMs - startMs,
    };
  }

  /** Serialize tape to JSON string */
  toJSON(): string {
    const tape = this.tape.tapeHash ? this.tape : this.finalize();
    return JSON.stringify(tape, null, 2);
  }

  /** Save tape to file */
  save(outputPath: string): void {
    writeFileSync(outputPath, this.toJSON(), 'utf8');
  }

  // ---- private helpers ----

  private addEntry(
    type: TapeEntry['type'],
    key: string,
    value: string,
    precomputedHash?: string,
  ): TapeEntry {
    const hash = precomputedHash ?? sha256(value);
    const entry: TapeEntry = {
      seq: this.seq++,
      timestamp: Date.now(),
      type,
      key,
      value,
      hash,
    };
    this.tape.entries.push(entry);
    this.tape.totalValueBytes += Buffer.byteLength(value, 'utf8');
    return entry;
  }
}
