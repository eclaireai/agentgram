import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { TapeRecorder } from '../../src/replay/tape-recorder.js';
import { TapePlayer } from '../../src/replay/tape-player.js';
import { sessionToTape } from '../../src/replay/index.js';
import type { Session, Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSampleSession(overrides: Partial<Session> = {}): Session {
  const base: Session = {
    id: 'test-session-1',
    name: 'test session',
    state: 'stopped',
    startedAt: Date.now() - 5000,
    stoppedAt: Date.now(),
    branch: 'agentgram/test-session-abc123',
    baseCommit: 'abc123',
    cwd: '/tmp/test',
    operations: [],
  };
  return { ...base, ...overrides };
}

function makeReadOp(target: string, output?: string): Operation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'read',
    timestamp: Date.now(),
    target,
    metadata: { contentHash: 'aabbcc112233' },
    causedBy: [],
  };
}

function makeExecOp(command: string, output: string, exitCode = 0): Operation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'exec',
    timestamp: Date.now(),
    target: command,
    metadata: { command, output, exitCode },
    causedBy: [],
  };
}

function makeWriteOp(target: string): Operation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'write',
    timestamp: Date.now(),
    target,
    metadata: { afterHash: 'aabbcc112233' },
    causedBy: [],
  };
}

// ---------------------------------------------------------------------------
// 1. TapeRecorder creates tape with correct version='1'
// ---------------------------------------------------------------------------
describe('TapeRecorder', () => {
  it('creates tape with version="1"', () => {
    const rec = new TapeRecorder('my-session');
    const tape = rec.finalize();
    expect(tape.version).toBe('1');
  });

  // 2. recordPrompt creates entry with type='initial_prompt'
  it('recordPrompt creates entry with type=initial_prompt', () => {
    const rec = new TapeRecorder('s');
    const entry = rec.recordPrompt('do the thing');
    expect(entry.type).toBe('initial_prompt');
    expect(entry.key).toBe('prompt');
    expect(entry.value).toBe('do the thing');
    expect(entry.seq).toBe(0);
  });

  // 3. recordFileRead stores content and hash
  it('recordFileRead stores content and hash', () => {
    const rec = new TapeRecorder('s');
    const entry = rec.recordFileRead('/tmp/foo.ts', 'const x = 1;');
    expect(entry.type).toBe('file_read');
    expect(entry.key).toBe('/tmp/foo.ts');
    expect(entry.value).toBe('const x = 1;');
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.delta).toBeUndefined();
  });

  // 4. recordFileRead with same content creates delta=true entry
  it('recordFileRead with same content creates delta=true entry', () => {
    const rec = new TapeRecorder('s');
    rec.recordFileRead('/tmp/foo.ts', 'const x = 1;');
    const second = rec.recordFileRead('/tmp/foo.ts', 'const x = 1;');
    expect(second.delta).toBe(true);
    expect(second.value).toBe('');
    // hash must still be the same as first read
    const first = rec['tape'].entries[0];
    expect(second.hash).toBe(first.hash);
  });

  // 5. recordFileRead with changed content stores new content
  it('recordFileRead with changed content stores new full content', () => {
    const rec = new TapeRecorder('s');
    rec.recordFileRead('/tmp/foo.ts', 'const x = 1;');
    const updated = rec.recordFileRead('/tmp/foo.ts', 'const x = 2;');
    expect(updated.delta).toBeUndefined();
    expect(updated.value).toBe('const x = 2;');
  });

  // 6. recordExecOutput stores command and output
  it('recordExecOutput stores command and output', () => {
    const rec = new TapeRecorder('s');
    const entry = rec.recordExecOutput('npm test', 'all tests pass', 0);
    expect(entry.type).toBe('exec_output');
    expect(entry.key).toBe('npm test');
    expect(entry.value).toContain('all tests pass');
    expect(entry.value).toContain('exit:0');
  });

  // 7. finalize() computes non-empty tapeHash
  it('finalize() computes a non-empty tapeHash', () => {
    const rec = new TapeRecorder('s');
    rec.recordPrompt('hello');
    const tape = rec.finalize();
    expect(typeof tape.tapeHash).toBe('string');
    expect(tape.tapeHash.length).toBe(64); // SHA-256 hex
    expect(tape.tapeHash).not.toBe('');
  });

  // 8. finalize() sets endedAt
  it('finalize() sets endedAt', () => {
    const rec = new TapeRecorder('s');
    const tape = rec.finalize();
    expect(tape.endedAt).toBeDefined();
    expect(new Date(tape.endedAt!).getTime()).toBeGreaterThan(0);
  });

  // 9. stats() compressionRatio > 1 when delta entries present
  it('stats() compressionRatio > 1 when delta entries are present', () => {
    const rec = new TapeRecorder('s');
    const bigContent = 'x'.repeat(2000);
    rec.recordFileRead('/tmp/big.ts', bigContent);
    rec.recordFileRead('/tmp/big.ts', bigContent); // delta
    rec.recordFileRead('/tmp/big.ts', bigContent); // delta
    const s = rec.stats();
    expect(s.compressionRatio).toBeGreaterThan(1);
    expect(s.deduplicatedCount).toBeUndefined(); // stats doesn't expose this directly
  });

  // 10. stats() compressionRatio = 1 when no delta entries
  it('stats() compressionRatio = 1 when no delta entries', () => {
    const rec = new TapeRecorder('s');
    rec.recordFileRead('/tmp/a.ts', 'const a = 1;');
    rec.recordFileRead('/tmp/b.ts', 'const b = 2;');
    const s = rec.stats();
    // estimatedFull == totalBytes when no deltas
    expect(s.compressionRatio).toBeCloseTo(1, 5);
  });

  // 11. TapePlayer.fromJSON roundtrips tape
  it('TapePlayer.fromJSON roundtrips tape', () => {
    const rec = new TapeRecorder('roundtrip');
    rec.recordPrompt('test prompt');
    rec.recordFileRead('/a.ts', 'content');
    const tape = rec.finalize();
    const json = JSON.stringify(tape);
    const player = TapePlayer.fromJSON(json);
    expect(player.getPrompt()).toBe('test prompt');
    expect(player.getAllFrames().length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TapePlayer tests
// ---------------------------------------------------------------------------
describe('TapePlayer', () => {
  // 12. verify() returns valid=true for untampered tape
  it('verify() returns valid=true for untampered tape', () => {
    const rec = new TapeRecorder('integrity');
    rec.recordPrompt('hello');
    rec.recordFileRead('/src/index.ts', 'export default {}');
    rec.recordExecOutput('ls', 'index.ts', 0);
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    const result = player.verify();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 13. verify() returns valid=false when entry value tampered
  it('verify() returns valid=false when entry value tampered', () => {
    const rec = new TapeRecorder('tamper');
    rec.recordPrompt('original prompt');
    const tape = rec.finalize();

    // Tamper with an entry value
    const tampered = JSON.parse(JSON.stringify(tape));
    tampered.entries[0].value = 'TAMPERED VALUE';

    const player = new TapePlayer(tampered);
    const result = player.verify();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // 14. getFileAtSeq returns correct content
  it('getFileAtSeq returns correct content', () => {
    const rec = new TapeRecorder('frames');
    rec.recordFileRead('/src/app.ts', 'v1 content');
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    const content = player.getFileAtSeq('/src/app.ts', 0);
    expect(content).toBe('v1 content');
  });

  // 15. getFileAtSeq handles delta entries (returns prior content)
  it('getFileAtSeq handles delta entries by returning prior non-delta content', () => {
    const rec = new TapeRecorder('delta-play');
    rec.recordFileRead('/src/app.ts', 'original content');
    rec.recordFileRead('/src/app.ts', 'original content'); // delta at seq=1
    const tape = rec.finalize();
    const player = new TapePlayer(tape);

    // At seq=1 (delta entry), should walk back and find the original
    const content = player.getFileAtSeq('/src/app.ts', 1);
    expect(content).toBe('original content');
  });

  // 16. getFileAtSeq returns null for unknown file
  it('getFileAtSeq returns null for unknown file', () => {
    const rec = new TapeRecorder('null-check');
    rec.recordFileRead('/known.ts', 'data');
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    const result = player.getFileAtSeq('/unknown.ts', 0);
    expect(result).toBeNull();
  });

  // 17. getPrompt returns initial prompt
  it('getPrompt returns the initial prompt', () => {
    const rec = new TapeRecorder('prompt-test');
    rec.recordPrompt('build the system');
    rec.recordFileRead('/x.ts', 'x');
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    expect(player.getPrompt()).toBe('build the system');
  });

  // 18. toMarkdown includes all key sections
  it('toMarkdown includes all key sections', () => {
    const rec = new TapeRecorder('md-test');
    rec.recordPrompt('do the thing');
    rec.recordFileRead('/src/main.ts', 'const main = () => {}');
    rec.recordExecOutput('npm run build', 'build output', 0);
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    const md = player.toMarkdown();

    expect(md).toContain('# Replay Tape: md-test');
    expect(md).toContain('## Metadata');
    expect(md).toContain('## Stats');
    expect(md).toContain('## Initial Prompt');
    expect(md).toContain('do the thing');
    expect(md).toContain('## Files Read');
    expect(md).toContain('/src/main.ts');
    expect(md).toContain('## Commands Executed');
    expect(md).toContain('npm run build');
    expect(md).toContain('## Entry Log');
    expect(md).toContain(tape.tapeHash);
  });

  // 19. summary() returns correct sizeKb
  it('summary() returns a positive sizeKb', () => {
    const rec = new TapeRecorder('size-test');
    rec.recordPrompt('measure me');
    rec.recordFileRead('/big.ts', 'a'.repeat(10_000));
    const tape = rec.finalize();
    const player = new TapePlayer(tape);
    const s = player.summary();
    expect(s.sizeKb).toBeGreaterThan(0);
    expect(s.name).toBe('size-test');
    expect(s.entries).toBe(2);
    expect(s.uniqueFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 20. sessionToTape converts Session to tape correctly
// ---------------------------------------------------------------------------
describe('sessionToTape', () => {
  it('converts a Session with read and exec ops into a ReplayTape', () => {
    const session = makeSampleSession({
      operations: [
        makeReadOp('/src/index.ts'),
        makeExecOp('npm test', 'all pass', 0),
        makeWriteOp('/src/output.ts'), // should be skipped
        makeReadOp('/src/utils.ts'),
      ],
    });

    const resolver = (p: string): string | null => {
      if (p === '/src/index.ts') return 'export const index = 1;';
      if (p === '/src/utils.ts') return 'export const util = () => {};';
      return null;
    };

    const tape = sessionToTape(session, resolver);

    expect(tape.version).toBe('1');
    expect(tape.name).toBe('test session');

    const types = tape.entries.map(e => e.type);
    expect(types).toContain('file_read');
    expect(types).toContain('exec_output');

    // write op should be excluded
    const writeEntries = tape.entries.filter(e => e.key === '/src/output.ts');
    expect(writeEntries).toHaveLength(0);

    // Should have 3 entries: 2 reads + 1 exec
    expect(tape.entries).toHaveLength(3);

    // Verify file content was captured
    const indexEntry = tape.entries.find(e => e.key === '/src/index.ts');
    expect(indexEntry?.value).toBe('export const index = 1;');

    // tapeHash should be set
    expect(tape.tapeHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// TapeRecorder.stats() — additional coverage
// ---------------------------------------------------------------------------
describe('TapeRecorder stats deduplication tracking', () => {
  it('tape.deduplicatedCount increments on delta entries', () => {
    const rec = new TapeRecorder('dedup');
    rec.recordFileRead('/f.ts', 'hello');
    rec.recordFileRead('/f.ts', 'hello'); // delta
    rec.recordFileRead('/f.ts', 'hello'); // delta
    const tape = rec.finalize();
    expect(tape.deduplicatedCount).toBe(2);
  });

  it('stats() entryCount matches actual entries', () => {
    const rec = new TapeRecorder('count');
    rec.recordPrompt('p');
    rec.recordFileRead('/a.ts', 'a');
    rec.recordExecOutput('cmd', 'out');
    const s = rec.stats();
    expect(s.entryCount).toBe(3);
  });
});
