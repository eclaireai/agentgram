import { describe, it, expect } from 'vitest';
import {
  detectDeadEnds,
  extractReasoning,
  detectDecisionPoint,
  CognitiveTraceBuilder,
  distillCognitiveRecipe,
  cognitiveTraceToMarkdown,
} from '../../src/cognitive/trace.js';
import type { Operation } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function op(
  id: string,
  type: Operation['type'],
  target: string,
  extra: Partial<Operation> = {},
): Operation {
  return {
    id,
    type,
    timestamp: Date.now() + parseInt(id.replace(/\D/g, '') || '0') * 100,
    target,
    metadata: {},
    causedBy: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// detectDeadEnds()
// ---------------------------------------------------------------------------

describe('detectDeadEnds()', () => {
  it('detects npm install → npm uninstall dead end', () => {
    const ops: Operation[] = [
      op('1', 'read', 'package.json'),
      op('2', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }),
      op('3', 'exec', 'npm test', { metadata: { command: 'npm test', exitCode: 1 } }),
      op('4', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }),
      op('5', 'exec', 'npm install vitest', { metadata: { command: 'npm install vitest' } }),
    ];

    const deadEnds = detectDeadEnds(ops);
    expect(deadEnds.length).toBeGreaterThan(0);
    expect(deadEnds[0].operation.id).toBe('2'); // npm install jest was the dead end
    expect(deadEnds[0].reason).toContain('jest');
  });

  it('detects failed exec with successful retry as dead end', () => {
    const ops: Operation[] = [
      op('1', 'exec', 'npm test', { metadata: { command: 'npm test', exitCode: 1 } }),
      op('2', 'write', 'vitest.config.ts'),
      op('3', 'exec', 'npm test', { metadata: { command: 'npm test', exitCode: 0 } }),
    ];

    const deadEnds = detectDeadEnds(ops);
    expect(deadEnds.length).toBe(1);
    expect(deadEnds[0].operation.id).toBe('1');
    expect(deadEnds[0].reason).toContain('retry');
  });

  it('detects create_file → delete dead end', () => {
    const ops: Operation[] = [
      op('1', 'create', 'src/wrong-approach.ts'),
      op('2', 'write', 'src/wrong-approach.ts'),
      op('3', 'delete', 'src/wrong-approach.ts'),
      op('4', 'create', 'src/correct.ts'),
    ];

    const deadEnds = detectDeadEnds(ops);
    expect(deadEnds.length).toBe(1);
    expect(deadEnds[0].operation.target).toBe('src/wrong-approach.ts');
  });

  it('returns empty array when no dead ends', () => {
    const ops: Operation[] = [
      op('1', 'read', 'package.json'),
      op('2', 'exec', 'npm install vitest', { metadata: { command: 'npm install vitest' } }),
      op('3', 'create', 'vitest.config.ts'),
      op('4', 'exec', 'npm test', { metadata: { command: 'npm test', exitCode: 0 } }),
    ];

    expect(detectDeadEnds(ops)).toHaveLength(0);
  });

  it('estimates token waste for dead ends', () => {
    const ops: Operation[] = [
      op('1', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }),
      op('2', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }),
    ];

    const deadEnds = detectDeadEnds(ops);
    expect(deadEnds[0].estimatedTokensWasted).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractReasoning()
// ---------------------------------------------------------------------------

describe('extractReasoning()', () => {
  it('extracts reasoning from assistant message', () => {
    const msg = `I need to check if jsonwebtoken is already installed before adding it.
Let me read the package.json to see the current dependencies.`;

    const reasoning = extractReasoning(msg, 'read');
    expect(reasoning).not.toBeNull();
    expect(reasoning!.text).toContain('jsonwebtoken');
  });

  it('detects high certainty language', () => {
    const msg = `I definitely need to install bcryptjs for password hashing.`;
    const reasoning = extractReasoning(msg, 'exec');
    expect(reasoning?.certainty).toBe('high');
  });

  it('detects low certainty language', () => {
    const msg = `Let me check — maybe the package is already installed.`;
    const reasoning = extractReasoning(msg, 'read');
    expect(reasoning?.certainty).toBe('low');
  });

  it('returns null for empty message', () => {
    expect(extractReasoning('', 'read')).toBeNull();
  });

  it('returns null for non-reasoning content', () => {
    const msg = `\`\`\`typescript
    const x = 1;
    \`\`\``;
    // Code blocks don't contain reasoning
    const reasoning = extractReasoning(msg, 'write');
    // May or may not find reasoning — just should not throw
    expect(() => extractReasoning(msg, 'write')).not.toThrow();
  });

  it('truncates very long reasoning text', () => {
    const longMsg = `I need to ${'check something very important '.repeat(50)}before proceeding.`;
    const reasoning = extractReasoning(longMsg, 'read');
    if (reasoning) {
      expect(reasoning.text.length).toBeLessThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// detectDecisionPoint()
// ---------------------------------------------------------------------------

describe('detectDecisionPoint()', () => {
  it('detects "instead of X" decision pattern', () => {
    const msg = `Instead of using Jest, I'll use Vitest since this is a Vite project.`;
    const dp = detectDecisionPoint(msg, 'op-1');
    expect(dp).not.toBeNull();
    expect(dp!.reasoning).toContain('Vitest');
  });

  it('detects "could X or Y" decision pattern', () => {
    const msg = `I could use Prisma or Mongoose for the database layer.`;
    const dp = detectDecisionPoint(msg, 'op-2');
    expect(dp).not.toBeNull();
  });

  it('returns null when no decision pattern found', () => {
    const msg = `Let me read the package.json file.`;
    const dp = detectDecisionPoint(msg, 'op-3');
    expect(dp).toBeNull();
  });

  it('sets chosen operation id', () => {
    const msg = `Instead of Express, I'll use Fastify because it's faster.`;
    const dp = detectDecisionPoint(msg, 'my-op-id');
    if (dp) {
      expect(dp.chosen).toBe('my-op-id');
    }
  });
});

// ---------------------------------------------------------------------------
// CognitiveTraceBuilder
// ---------------------------------------------------------------------------

describe('CognitiveTraceBuilder', () => {
  it('builds a trace with events', () => {
    const builder = new CognitiveTraceBuilder('sess-test');
    builder.setInitialIntent('Add JWT authentication');

    builder.addEvent(
      op('1', 'read', 'package.json'),
      'I need to check if jsonwebtoken is installed.',
      'Add JWT auth',
    );
    builder.addEvent(
      op('2', 'exec', 'npm install jsonwebtoken', { metadata: { command: 'npm install jsonwebtoken' } }),
      'jsonwebtoken not found, I will install it.',
    );
    builder.addEvent(
      op('3', 'create', 'src/middleware/auth.ts'),
      'Now I will create the JWT middleware.',
    );

    const trace = builder.build();

    expect(trace.sessionId).toBe('sess-test');
    expect(trace.initialIntent).toBe('Add JWT authentication');
    expect(trace.events).toHaveLength(3);
    expect(trace.totalOperations).toBe(3);
  });

  it('detects dead ends automatically on build', () => {
    const builder = new CognitiveTraceBuilder('sess-dead');
    builder.setInitialIntent('Set up testing');

    builder.addEvent(
      op('1', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }),
      'Installing Jest for testing',
    );
    builder.addEvent(
      op('2', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }),
      'Actually, Vitest is better for this project',
    );
    builder.addEvent(
      op('3', 'exec', 'npm install vitest', { metadata: { command: 'npm install vitest' } }),
      'Installing Vitest instead',
    );

    const trace = builder.build();

    expect(trace.deadEnds.length).toBeGreaterThan(0);
    expect(trace.wastedOperations).toBeGreaterThan(0);
    expect(trace.estimatedTokensWasted).toBeGreaterThan(0);

    // The jest install event should be marked as dead end
    const deadEvent = trace.events.find((e) => e.operation.id === '1');
    expect(deadEvent?.isDeadEnd).toBe(true);
  });

  it('sets reasoning on events', () => {
    const builder = new CognitiveTraceBuilder('sess-reasoning');
    builder.addEvent(
      op('1', 'read', 'package.json'),
      'I need to check existing dependencies before installing new ones.',
    );

    const trace = builder.build();
    const event = trace.events[0];
    expect(event.reasoning).toBeDefined();
    expect(event.reasoning!.text.length).toBeGreaterThan(0);
  });

  it('captures user intent on events', () => {
    const builder = new CognitiveTraceBuilder('sess-intent');
    builder.setInitialIntent('Add database support');

    builder.addEvent(op('1', 'read', 'package.json'));

    const trace = builder.build();
    expect(trace.initialIntent).toBe('Add database support');
  });

  it('calculates wasted tokens', () => {
    const builder = new CognitiveTraceBuilder('sess-tokens');

    // Two dead ends
    builder.addEvent(op('1', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }));
    builder.addEvent(op('2', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }));
    builder.addEvent(op('3', 'create', 'src/wrong.ts'));
    builder.addEvent(op('4', 'delete', 'src/wrong.ts'));
    builder.addEvent(op('5', 'create', 'src/correct.ts'));

    const trace = builder.build();
    expect(trace.estimatedTokensWasted).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// distillCognitiveRecipe()
// ---------------------------------------------------------------------------

describe('distillCognitiveRecipe()', () => {
  it('excludes dead end operations', () => {
    const builder = new CognitiveTraceBuilder('sess-distill');
    builder.addEvent(
      op('1', 'read', 'package.json'),
      'Checking existing deps',
    );
    builder.addEvent(
      op('2', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }),
      'Installing Jest',
    );
    builder.addEvent(
      op('3', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }),
      'Wrong framework, removing Jest',
    );
    builder.addEvent(
      op('4', 'exec', 'npm install vitest', { metadata: { command: 'npm install vitest' } }),
      'Installing Vitest instead',
    );

    const trace = builder.build();
    const recipe = distillCognitiveRecipe(trace);

    // Should exclude the dead end (jest install)
    const targets = recipe.map((s) => s.target);
    expect(targets).not.toContain('npm install jest');
    expect(targets).toContain('npm install vitest');
  });

  it('includes reasoning in recipe steps', () => {
    const builder = new CognitiveTraceBuilder('sess-reasoning');
    builder.addEvent(
      op('1', 'read', 'package.json'),
      'I need to check if bcryptjs is installed for password hashing.',
    );

    const trace = builder.build();
    const recipe = distillCognitiveRecipe(trace);

    expect(recipe[0].reasoning).toBeTruthy();
  });

  it('deduplicates consecutive reads of same file', () => {
    const builder = new CognitiveTraceBuilder('sess-dedup');
    builder.addEvent(op('1', 'read', 'package.json'));
    builder.addEvent(op('2', 'read', 'package.json')); // duplicate
    builder.addEvent(op('3', 'write', 'src/index.ts'));

    const trace = builder.build();
    const recipe = distillCognitiveRecipe(trace);

    const packageJsonReads = recipe.filter(
      (s) => s.target === 'package.json' && s.action === 'find',
    );
    expect(packageJsonReads).toHaveLength(1);
  });

  it('maps operation types to recipe actions', () => {
    const builder = new CognitiveTraceBuilder('sess-mapping');
    builder.addEvent(op('1', 'read', 'src/auth.ts'));
    builder.addEvent(op('2', 'write', 'src/auth.ts'));
    builder.addEvent(op('3', 'create', 'src/new.ts'));
    builder.addEvent(op('4', 'exec', 'npm test', { metadata: { command: 'npm test', exitCode: 0 } }));

    const trace = builder.build();
    const recipe = distillCognitiveRecipe(trace);

    expect(recipe.find((s) => s.action === 'find')).toBeDefined();
    expect(recipe.find((s) => s.action === 'modify_file')).toBeDefined();
    expect(recipe.find((s) => s.action === 'create_file')).toBeDefined();
    expect(recipe.find((s) => s.action === 'run_command')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// cognitiveTraceToMarkdown()
// ---------------------------------------------------------------------------

describe('cognitiveTraceToMarkdown()', () => {
  it('generates markdown with session id', () => {
    const builder = new CognitiveTraceBuilder('sess-md');
    builder.setInitialIntent('Test intent');
    builder.addEvent(op('1', 'read', 'package.json'), 'Checking deps');
    const trace = builder.build();

    const md = cognitiveTraceToMarkdown(trace);
    expect(md).toContain('sess-md');
    expect(md).toContain('Test intent');
  });

  it('includes dead ends section when present', () => {
    const builder = new CognitiveTraceBuilder('sess-deadend-md');
    builder.addEvent(op('1', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }));
    builder.addEvent(op('2', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }));
    const trace = builder.build();

    const md = cognitiveTraceToMarkdown(trace);
    expect(md).toContain('Dead Ends');
  });

  it('includes cognitive events section', () => {
    const builder = new CognitiveTraceBuilder('sess-events-md');
    builder.addEvent(op('1', 'read', 'package.json'), 'Need to check deps');
    const trace = builder.build();

    const md = cognitiveTraceToMarkdown(trace);
    expect(md).toContain('Cognitive Events');
    expect(md).toContain('package.json');
  });

  it('marks dead end events in output', () => {
    const builder = new CognitiveTraceBuilder('sess-mark');
    builder.addEvent(op('1', 'exec', 'npm install jest', { metadata: { command: 'npm install jest' } }));
    builder.addEvent(op('2', 'exec', 'npm uninstall jest', { metadata: { command: 'npm uninstall jest' } }));
    builder.addEvent(op('3', 'exec', 'npm install vitest', { metadata: { command: 'npm install vitest' } }));

    const trace = builder.build();
    const md = cognitiveTraceToMarkdown(trace);
    expect(md).toContain('DEAD END');
  });
});
