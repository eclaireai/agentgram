import { describe, it, expect } from 'vitest';
import { generateDebuggerHtml } from '../../src/viz/html.js';
import type { Session, ProvenanceGraph, Recipe } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockSession: Session = {
  id: 'dbg-session-1',
  name: 'fix-auth-bug',
  state: 'stopped',
  startedAt: 1700000000000,
  stoppedAt: 1700000060000,
  operations: [
    {
      id: 'op-1',
      type: 'read',
      timestamp: 1700000010000,
      target: 'src/auth.ts',
      metadata: { contentHash: 'abc' },
      causedBy: [],
    },
    {
      id: 'op-2',
      type: 'write',
      timestamp: 1700000020000,
      target: 'src/auth.ts',
      metadata: { beforeHash: 'abc', afterHash: 'def', patch: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n' },
      causedBy: ['op-1'],
      reason: 'Fix token validation',
    },
    {
      id: 'op-3',
      type: 'exec',
      timestamp: 1700000030000,
      target: 'npm test',
      metadata: { command: 'npm test', exitCode: 0, output: 'PASS' },
      causedBy: [],
    },
    {
      id: 'op-4',
      type: 'create',
      timestamp: 1700000040000,
      target: 'src/auth-helper.ts',
      metadata: {},
      causedBy: ['op-2'],
    },
    {
      id: 'op-5',
      type: 'delete',
      timestamp: 1700000050000,
      target: 'src/old-auth.ts',
      metadata: {},
      causedBy: [],
    },
  ],
  branch: 'agentgram/fix-auth-bug-abc123',
  baseCommit: 'deadbeef',
  cwd: '/tmp/test-project',
};

const mockProvenance: ProvenanceGraph = {
  sessionId: 'dbg-session-1',
  nodes: mockSession.operations.map((op) => ({
    operationId: op.id,
    target: op.target,
    type: op.type,
    timestamp: op.timestamp,
  })),
  edges: [
    { from: 'op-1', to: 'op-2', relation: 'informed' },
    { from: 'op-2', to: 'op-3', relation: 'triggered' },
  ],
};

const mockRecipe: Recipe = {
  name: 'fix-auth-bug',
  description: 'Distilled from session dbg-session-1',
  sourceSessionId: 'dbg-session-1',
  steps: [
    { action: 'find', target: 'src/auth.ts', description: 'Read auth source' },
    { action: 'modify_file', target: 'src/auth.ts', description: 'Fix token validation' },
    { action: 'run_command', target: 'npm test', description: 'Run tests' },
  ],
  parameters: {},
  tags: ['auth', 'fix'],
  version: '1.0.0',
};

const mockTape = {
  sessionId: 'dbg-session-1',
  modelVersion: 'claude-3-5-sonnet-20241022',
  hash: 'a1b2c3d4e5f6g7h8',
  operations: mockSession.operations,
};

// Convenience wrapper — tape is optional so we omit it in some tests
function buildData(withTape = false) {
  return {
    session: mockSession,
    provenance: mockProvenance,
    recipe: mockRecipe,
    ...(withTape ? { tape: mockTape } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateDebuggerHtml', () => {
  // 1. Returns a non-empty string
  it('returns a non-empty string', () => {
    const html = generateDebuggerHtml(buildData());
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  // 2. Output contains 'time-travel' text
  it("output contains 'time-travel' text", () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('time-travel');
  });

  // 3. Output contains all operation types from the session
  it('output contains all operation types (read, write, exec, create, delete)', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('read');
    expect(html).toContain('write');
    expect(html).toContain('exec');
    expect(html).toContain('create');
    expect(html).toContain('delete');
  });

  // 4. Output contains session name
  it('output contains the session name', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('fix-auth-bug');
  });

  // 5. Output contains operation count
  it('output contains operation count', () => {
    const html = generateDebuggerHtml(buildData());
    // 5 operations embedded as number somewhere
    expect(html).toContain('5');
    expect(html).toContain('operations');
  });

  // 6. Output is valid HTML (has DOCTYPE, html, head, body)
  it('output is valid HTML with DOCTYPE, html, head, and body', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toMatch(/<html\b/i);
    expect(html).toMatch(/<head\b/i);
    expect(html).toMatch(/<body\b/i);
    expect(html).toMatch(/<\/html>/i);
  });

  // 7. Output contains embedded sessionJson
  it('output contains embedded sessionJson with session id', () => {
    const html = generateDebuggerHtml(buildData());
    // The session id must be JSON-serialised inside a <script> block
    expect(html).toContain('"id"');
    expect(html).toContain('dbg-session-1');
  });

  // 8. Output has timeline-panel element
  it('output has timeline-panel element', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('timeline-panel');
  });

  // 9. Output has file-panel element
  it('output has file-panel element', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('file-panel');
  });

  // 10. Output has transport controls
  it('output has transport controls', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('transport');
    // Play/Pause, step-forward / step-backward buttons
    expect(html).toContain('btn-play');
    expect(html).toContain('btn-next');
    expect(html).toContain('btn-prev');
    // Speed selector
    expect(html).toContain('0.5×');
    expect(html).toContain('4×');
  });

  // 11. generateDebuggerHtml with tape includes tapeHash
  it('with tape: includes tape hash in the output', () => {
    const html = generateDebuggerHtml(buildData(true));
    // The full hash or at least its first 8 chars should appear
    expect(html).toContain('a1b2c3d4');
    // Model version should also be present
    expect(html).toContain('claude-3-5-sonnet-20241022');
  });

  // 12. generateDebuggerHtml without tape still works (tape is optional)
  it('without tape: still generates valid HTML', () => {
    const html = generateDebuggerHtml(buildData(false));
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toContain('time-travel');
    // tapeHash badge should not appear / tape JSON should be null
    expect(html).toContain('null');   // tapeJson embedded as 'null'
  });

  // Bonus: operation IDs are embedded in the data
  it('embeds all operation IDs in the session JSON', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('op-1');
    expect(html).toContain('op-2');
    expect(html).toContain('op-3');
    expect(html).toContain('op-4');
    expect(html).toContain('op-5');
  });

  // Bonus: inspector-panel is present
  it('output has inspector-panel element', () => {
    const html = generateDebuggerHtml(buildData());
    expect(html).toContain('inspector-panel');
  });
});
