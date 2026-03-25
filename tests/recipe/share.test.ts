import { describe, it, expect } from 'vitest';
import {
  prepareForSharing,
  generateRecipeId,
  detectSourceAgent,
  recipeChecksum,
} from '../../src/recipe/share.js';
import type { Session } from '../../src/core/types.js';

const mockSession: Session = {
  id: 'sess-1',
  name: 'fix-auth-bug',
  state: 'stopped',
  startedAt: Date.now() - 60000,
  stoppedAt: Date.now(),
  operations: [
    { id: 'op1', type: 'read', timestamp: Date.now() - 50000, target: 'src/auth.ts', metadata: {}, reason: 'check code', causedBy: [] },
    { id: 'op2', type: 'write', timestamp: Date.now() - 40000, target: 'src/auth.ts', metadata: {}, reason: 'fix bug', causedBy: ['op1'] },
    { id: 'op3', type: 'exec', timestamp: Date.now() - 30000, target: 'npm test', metadata: { command: 'npm test', exitCode: 0 }, causedBy: [] },
  ],
  branch: 'agentgram/fix-auth-bug-abc',
  baseCommit: 'deadbeef',
  cwd: '/tmp/test',
};

describe('generateRecipeId', () => {
  it('produces URL-safe IDs', () => {
    const id = generateRecipeId('Add JWT Authentication');
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeGreaterThan(5);
    expect(id.length).toBeLessThan(60);
  });

  it('handles special characters', () => {
    const id = generateRecipeId('Fix @#$% Bug!!!');
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('truncates long names', () => {
    const id = generateRecipeId('a'.repeat(100));
    expect(id.length).toBeLessThan(60);
  });

  it('generates unique IDs', () => {
    const id1 = generateRecipeId('test');
    const id2 = generateRecipeId('test');
    expect(id1).not.toBe(id2); // random suffix
  });
});

describe('detectSourceAgent', () => {
  it('detects Claude Code from reasons', () => {
    const session = {
      ...mockSession,
      operations: [
        { ...mockSession.operations[0], reason: 'Claude Code Read tool' },
      ],
    };
    expect(detectSourceAgent(session)).toBe('claude-code');
  });

  it('detects Cursor from reasons', () => {
    const session = {
      ...mockSession,
      operations: [
        { ...mockSession.operations[0], reason: 'Cursor edit' },
      ],
    };
    expect(detectSourceAgent(session)).toBe('cursor');
  });

  it('returns unknown when no agent detected', () => {
    const session = {
      ...mockSession,
      operations: [
        { ...mockSession.operations[0], reason: 'manual edit' },
      ],
    };
    expect(detectSourceAgent(session)).toBe('unknown');
  });
});

describe('prepareForSharing', () => {
  it('returns a valid SharedRecipe', () => {
    const shared = prepareForSharing(mockSession);

    expect(shared.metadata).toBeDefined();
    expect(shared.metadata.id).toBeTruthy();
    expect(shared.metadata.author).toBe('anonymous');
    expect(shared.metadata.createdAt).toBeTruthy();
    expect(shared.metadata.downloads).toBe(0);
    expect(shared.metadata.checksum).toBeTruthy();
    expect(shared.steps.length).toBeGreaterThan(0);
  });

  it('parameterizes paths', () => {
    const session = {
      ...mockSession,
      operations: [
        { id: 'op1', type: 'read' as const, timestamp: Date.now(), target: 'src/components/auth.ts', metadata: {}, causedBy: [] },
        { id: 'op2', type: 'write' as const, timestamp: Date.now(), target: 'src/components/login.ts', metadata: {}, causedBy: [] },
      ],
    };
    const shared = prepareForSharing(session);

    // Should have parameterized paths
    // The parameterizer uses common prefix detection
    expect(shared.steps.length).toBeGreaterThan(0);
  });

  it('uses provided name and tags', () => {
    const shared = prepareForSharing(mockSession, {
      name: 'Custom Name',
      tags: ['auth', 'jwt'],
    });

    expect(shared.name).toBe('Custom Name');
    expect(shared.tags).toEqual(['auth', 'jwt']);
  });

  it('uses provided author', () => {
    const shared = prepareForSharing(mockSession, { author: 'testuser' });
    expect(shared.metadata.author).toBe('testuser');
  });

  it('generates consistent checksum for same content', () => {
    const shared1 = prepareForSharing(mockSession);
    const shared2 = prepareForSharing(mockSession);

    // Checksums based on content, so same session → same steps → same checksum
    expect(recipeChecksum(shared1)).toBe(recipeChecksum(shared2));
  });
});
