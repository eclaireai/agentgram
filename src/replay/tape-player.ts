import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ReplayTape, ReplayFrame } from './types.js';

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export class TapePlayer {
  private tape: ReplayTape;
  private frames: ReplayFrame[];

  constructor(tape: ReplayTape) {
    this.tape = tape;
    this.frames = this.buildFrames();
  }

  /**
   * Load tape from file.
   */
  static fromFile(tapePath: string): TapePlayer {
    const raw = readFileSync(tapePath, 'utf8');
    return TapePlayer.fromJSON(raw);
  }

  /**
   * Load tape from JSON string.
   */
  static fromJSON(json: string): TapePlayer {
    const tape = JSON.parse(json) as ReplayTape;
    return new TapePlayer(tape);
  }

  /**
   * Verify tape integrity — recompute tapeHash and compare.
   */
  verify(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Verify individual entry hashes
    for (const entry of this.tape.entries) {
      const expected = sha256(entry.value);
      if (entry.hash !== expected) {
        errors.push(
          `Entry seq=${entry.seq} hash mismatch: stored=${entry.hash} computed=${expected}`
        );
      }
    }

    // Verify tape chain hash
    const chain = this.tape.entries.map(e => e.hash).join('');
    const computedTapeHash = sha256(chain);
    if (this.tape.tapeHash !== computedTapeHash) {
      errors.push(
        `tapeHash mismatch: stored=${this.tape.tapeHash} computed=${computedTapeHash}`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get the frame at a given sequence number.
   */
  getFrame(seq: number): ReplayFrame {
    const frame = this.frames[seq];
    if (!frame) {
      throw new RangeError(`No frame at seq=${seq}. Tape has ${this.frames.length} entries.`);
    }
    return frame;
  }

  /**
   * Get all frames (for full replay).
   */
  getAllFrames(): ReplayFrame[] {
    return this.frames;
  }

  /**
   * Get file content at a specific point in the session.
   * Uses delta decompression — walks back through entries to find last full value.
   */
  getFileAtSeq(filePath: string, seq: number): string | null {
    // Walk backwards from seq to find the most recent non-delta entry for this file
    for (let i = seq; i >= 0; i--) {
      const entry = this.tape.entries[i];
      if (!entry) continue;
      if (entry.type === 'file_read' && entry.key === filePath && !entry.delta) {
        return entry.value;
      }
    }
    return null;
  }

  /**
   * Get the initial prompt.
   */
  getPrompt(): string | null {
    const entry = this.tape.entries.find(e => e.type === 'initial_prompt');
    return entry?.value ?? null;
  }

  /**
   * Get a summary of what the tape contains.
   */
  summary(): {
    name: string;
    model: string;
    duration: string;
    entries: number;
    uniqueFiles: number;
    commands: string[];
    sizeKb: number;
  } {
    const entries = this.tape.entries;

    const uniqueFiles = new Set(
      entries.filter(e => e.type === 'file_read').map(e => e.key)
    ).size;

    const commands = [
      ...new Set(
        entries.filter(e => e.type === 'exec_output').map(e => e.key)
      ),
    ];

    // Duration
    let duration = 'unknown';
    if (this.tape.startedAt && this.tape.endedAt) {
      const ms = new Date(this.tape.endedAt).getTime() - new Date(this.tape.startedAt).getTime();
      duration = ms < 60_000
        ? `${ms}ms`
        : `${Math.round(ms / 1000)}s`;
    }

    // Size in KB: approximate from serialized JSON
    const sizeBytes = Buffer.byteLength(JSON.stringify(this.tape), 'utf8');
    const sizeKb = Math.round((sizeBytes / 1024) * 100) / 100;

    return {
      name: this.tape.name,
      model: this.tape.modelVersion,
      duration,
      entries: entries.length,
      uniqueFiles,
      commands,
      sizeKb,
    };
  }

  /**
   * Export tape as a human-readable Markdown document.
   */
  toMarkdown(): string {
    const { name, model, duration, entries, uniqueFiles, commands, sizeKb } = this.summary();
    const lines: string[] = [];

    lines.push(`# Replay Tape: ${name}`);
    lines.push('');
    lines.push('## Metadata');
    lines.push('');
    lines.push(`- **Tape ID:** ${this.tape.id}`);
    lines.push(`- **Model:** ${model}`);
    lines.push(`- **Started:** ${this.tape.startedAt}`);
    if (this.tape.endedAt) {
      lines.push(`- **Ended:** ${this.tape.endedAt}`);
    }
    lines.push(`- **Duration:** ${duration}`);
    lines.push(`- **Size:** ${sizeKb} KB`);
    lines.push(`- **Tape Hash:** \`${this.tape.tapeHash}\``);
    lines.push('');

    lines.push('## Stats');
    lines.push('');
    lines.push(`- **Total entries:** ${entries}`);
    lines.push(`- **Unique files read:** ${uniqueFiles}`);
    lines.push(`- **Commands run:** ${commands.length}`);
    lines.push(`- **Deduplicated (delta) entries:** ${this.tape.deduplicatedCount}`);
    lines.push('');

    // Initial prompt
    const prompt = this.getPrompt();
    if (prompt !== null) {
      lines.push('## Initial Prompt');
      lines.push('');
      lines.push('```');
      lines.push(prompt);
      lines.push('```');
      lines.push('');
    }

    // Files read
    const fileEntries = this.tape.entries.filter(e => e.type === 'file_read');
    if (fileEntries.length > 0) {
      lines.push('## Files Read');
      lines.push('');
      const seen = new Set<string>();
      for (const entry of fileEntries) {
        if (!seen.has(entry.key)) {
          seen.add(entry.key);
          const readCount = fileEntries.filter(e => e.key === entry.key).length;
          lines.push(`- \`${entry.key}\` (read ${readCount}x)`);
        }
      }
      lines.push('');
    }

    // Commands
    if (commands.length > 0) {
      lines.push('## Commands Executed');
      lines.push('');
      for (const cmd of commands) {
        lines.push(`- \`${cmd}\``);
      }
      lines.push('');
    }

    // Entry log
    lines.push('## Entry Log');
    lines.push('');
    lines.push('| seq | type | key | delta | hash |');
    lines.push('|-----|------|-----|-------|------|');
    for (const entry of this.tape.entries) {
      const keyShort = entry.key.length > 40 ? `...${entry.key.slice(-37)}` : entry.key;
      const hashShort = entry.hash.slice(0, 12);
      lines.push(
        `| ${entry.seq} | ${entry.type} | \`${keyShort}\` | ${entry.delta ? 'yes' : 'no'} | \`${hashShort}\` |`
      );
    }
    lines.push('');

    return lines.join('\n');
  }

  // ---- private helpers ----

  private buildFrames(): ReplayFrame[] {
    const frames: ReplayFrame[] = [];
    const fileState = new Map<string, string>();
    const commandHistory: Array<{ command: string; output: string; seq: number }> = [];

    for (const entry of this.tape.entries) {
      // Update cumulative state
      if (entry.type === 'file_read' && !entry.delta) {
        fileState.set(entry.key, entry.value);
      } else if (entry.type === 'file_read' && entry.delta) {
        // Delta: file state is already in the map from a previous entry
        // (no update needed — the current value remains)
      } else if (entry.type === 'exec_output') {
        commandHistory.push({
          command: entry.key,
          output: entry.value,
          seq: entry.seq,
        });
      }

      frames.push({
        seq: entry.seq,
        entry,
        // Snapshot immutable copies
        fileState: new Map(fileState),
        commandHistory: [...commandHistory],
      });
    }

    return frames;
  }
}
