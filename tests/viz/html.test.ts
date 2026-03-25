import { describe, it, expect } from 'vitest';
import { generateVizHtml } from '../../src/viz/html.js';
import type { Session, ProvenanceGraph, Recipe } from '../../src/core/types.js';

describe('Interactive Visualizer', () => {
  const mockSession: Session = {
    id: 'test-session-1',
    name: 'fix-auth-bug',
    state: 'stopped',
    startedAt: Date.now() - 60000,
    stoppedAt: Date.now(),
    operations: [
      { id: 'op-1', type: 'read', timestamp: Date.now() - 50000, target: 'src/auth.ts', metadata: {}, causedBy: [] },
      { id: 'op-2', type: 'write', timestamp: Date.now() - 40000, target: 'src/auth.ts', metadata: {}, causedBy: ['op-1'] },
      { id: 'op-3', type: 'exec', timestamp: Date.now() - 30000, target: 'npm test', metadata: { command: 'npm test', exitCode: 0 }, causedBy: [] },
    ],
    branch: 'agentgram/fix-auth-bug-abc123',
    baseCommit: 'deadbeef',
    cwd: '/tmp/test',
  };

  const mockProvenance: ProvenanceGraph = {
    sessionId: 'test-session-1',
    nodes: [
      { operationId: 'op-1', target: 'src/auth.ts', type: 'read', timestamp: Date.now() - 50000 },
      { operationId: 'op-2', target: 'src/auth.ts', type: 'write', timestamp: Date.now() - 40000 },
      { operationId: 'op-3', target: 'npm test', type: 'exec', timestamp: Date.now() - 30000 },
    ],
    edges: [
      { from: 'op-1', to: 'op-2', relation: 'informed' },
      { from: 'op-2', to: 'op-3', relation: 'triggered' },
    ],
  };

  const mockRecipe: Recipe = {
    name: 'fix-auth-bug',
    description: 'Distilled from session test-session-1',
    sourceSessionId: 'test-session-1',
    steps: [
      { action: 'find', target: 'src/auth.ts', description: 'Read src/auth.ts' },
      { action: 'modify_file', target: 'src/auth.ts', description: 'Fix token validation' },
      { action: 'run_command', target: 'npm test', description: 'Run tests' },
    ],
    parameters: {},
    tags: [],
    version: '1.0.0',
  };

  it('generates valid HTML document', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('agentgram');
  });

  it('includes session name in title', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('fix-auth-bug');
  });

  it('embeds provenance nodes as JSON', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('op-1');
    expect(html).toContain('op-2');
    expect(html).toContain('op-3');
    expect(html).toContain('src/auth.ts');
  });

  it('embeds edges with relation types', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('informed');
    expect(html).toContain('triggered');
  });

  it('includes D3.js script tag', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('d3js.org');
    expect(html).toContain('d3.v7.min.js');
  });

  it('includes recipe steps in sidebar', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('recipe');
    expect(html).toContain('find');
    expect(html).toContain('modify_file');
    expect(html).toContain('run_command');
  });

  it('includes legend with operation type colors', () => {
    const html = generateVizHtml({
      session: mockSession,
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    expect(html).toContain('read');
    expect(html).toContain('write');
    expect(html).toContain('create');
    expect(html).toContain('exec');
  });

  it('escapes HTML in session name', () => {
    const html = generateVizHtml({
      session: { ...mockSession, name: '<script>alert("xss")</script>' },
      provenance: mockProvenance,
      recipe: mockRecipe,
    });

    // The title should have the escaped version
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    // The raw input should not appear unescaped in the title tag
    expect(html).not.toContain('<title>agentgram — <script>');
  });

  it('handles empty provenance graph', () => {
    const html = generateVizHtml({
      session: { ...mockSession, operations: [] },
      provenance: { sessionId: 'test', nodes: [], edges: [] },
      recipe: { ...mockRecipe, steps: [] },
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('const nodes = []');
    expect(html).toContain('const edges = []');
  });
});
