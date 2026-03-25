import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseEventsFile,
  eventToOperation,
  ingestHookSession,
  ingestAndSave,
} from '../../src/hooks/ingest.js';

describe('Hook Ingestion Pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-ingest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleEvents = [
    { timestamp: 1000, claudeSessionId: 'cs-1', toolUseId: 'tu-1', event: 'read', tool: 'Read', target: 'src/auth.ts', metadata: {} },
    { timestamp: 2000, claudeSessionId: 'cs-1', toolUseId: 'tu-2', event: 'read', tool: 'Read', target: 'package.json', metadata: {} },
    { timestamp: 3000, claudeSessionId: 'cs-1', toolUseId: 'tu-3', event: 'write', tool: 'Edit', target: 'src/auth.ts', metadata: { oldString: 'return true' } },
    { timestamp: 4000, claudeSessionId: 'cs-1', toolUseId: 'tu-4', event: 'write', tool: 'Write', target: 'tests/auth.test.ts', metadata: { contentLength: 150 } },
    { timestamp: 5000, claudeSessionId: 'cs-1', toolUseId: 'tu-5', event: 'exec', tool: 'Bash', target: 'npm test', metadata: { exitCode: 0, outputLength: 500 } },
  ];

  function writeEventsFile(events: unknown[], filename = 'test-session.jsonl') {
    const dir = path.join(tmpDir, '.agentgram', 'hook-events');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return filePath;
  }

  describe('parseEventsFile', () => {
    it('parses JSONL events file', () => {
      const filePath = writeEventsFile(sampleEvents);
      const events = parseEventsFile(filePath);
      expect(events).toHaveLength(5);
      expect(events[0].event).toBe('read');
      expect(events[0].target).toBe('src/auth.ts');
      expect(events[4].event).toBe('exec');
    });

    it('handles empty lines', () => {
      const dir = path.join(tmpDir, '.agentgram', 'hook-events');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, 'test.jsonl');
      fs.writeFileSync(filePath, JSON.stringify(sampleEvents[0]) + '\n\n' + JSON.stringify(sampleEvents[1]) + '\n');
      const events = parseEventsFile(filePath);
      expect(events).toHaveLength(2);
    });
  });

  describe('eventToOperation', () => {
    it('converts read events', () => {
      const op = eventToOperation(sampleEvents[0]);
      expect(op.type).toBe('read');
      expect(op.target).toBe('src/auth.ts');
      expect(op.id).toBe('tu-1');
      expect(op.timestamp).toBe(1000);
    });

    it('converts write events', () => {
      const op = eventToOperation(sampleEvents[2]);
      expect(op.type).toBe('write');
      expect(op.target).toBe('src/auth.ts');
    });

    it('converts exec events', () => {
      const op = eventToOperation(sampleEvents[4]);
      expect(op.type).toBe('exec');
      expect(op.target).toBe('npm test');
      expect(op.metadata.command).toBe('npm test');
      expect(op.metadata.exitCode).toBe(0);
    });

    it('generates ID when toolUseId is missing', () => {
      const event = { ...sampleEvents[0], toolUseId: undefined };
      const op = eventToOperation(event);
      expect(op.id).toBeTruthy();
      expect(op.id).not.toBe('undefined');
    });
  });

  describe('ingestHookSession', () => {
    it('produces a complete session with provenance and recipe', () => {
      const state = {
        sessionId: 'hook-test-123',
        claudeSessionId: 'cs-1',
        startedAt: 1000,
        cwd: tmpDir,
        eventCount: 5,
      };

      const result = ingestHookSession(tmpDir, state, sampleEvents);

      // Session
      expect(result.session.id).toBe('hook-test-123');
      expect(result.session.state).toBe('stopped');
      expect(result.session.operations).toHaveLength(5);

      // Provenance
      expect(result.provenance.nodes.length).toBeGreaterThan(0);
      expect(result.provenance.edges.length).toBeGreaterThan(0);

      // Verify causal edges exist
      // read(auth.ts) -> write(auth.ts) should create "informed" edge
      const informedEdge = result.provenance.edges.find(
        (e) => e.relation === 'informed',
      );
      expect(informedEdge).toBeDefined();

      // read(package.json) -> write(auth.ts) should create "depends_on" edge (config file)
      const dependsEdge = result.provenance.edges.find(
        (e) => e.relation === 'depends_on',
      );
      expect(dependsEdge).toBeDefined();

      // Recipe
      expect(result.recipe.steps.length).toBeGreaterThan(0);
      expect(result.recipe.steps.length).toBeLessThanOrEqual(5); // compressed
      expect(result.recipe.sourceSessionId).toBe('hook-test-123');
    });

    it('handles empty events', () => {
      const state = {
        sessionId: 'empty',
        claudeSessionId: 'cs-1',
        startedAt: Date.now(),
        cwd: tmpDir,
        eventCount: 0,
      };

      const result = ingestHookSession(tmpDir, state, []);
      expect(result.session.operations).toHaveLength(0);
      expect(result.recipe.steps).toHaveLength(0);
    });
  });

  describe('ingestAndSave', () => {
    it('ingests JSONL files and saves as standard sessions', () => {
      writeEventsFile(sampleEvents, 'session-abc.jsonl');

      const savedIds = ingestAndSave(tmpDir);
      expect(savedIds).toHaveLength(1);
      expect(savedIds[0]).toBe('session-abc');

      // Verify session file was written
      const sessionPath = path.join(tmpDir, '.agentgram', 'sessions', 'session-abc.json');
      expect(fs.existsSync(sessionPath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      expect(data.session).toBeDefined();
      expect(data.provenance).toBeDefined();
      expect(data.recipe).toBeDefined();
      expect(data.session.operations).toHaveLength(5);
    });

    it('handles multiple session files', () => {
      writeEventsFile(sampleEvents.slice(0, 2), 'session-1.jsonl');
      writeEventsFile(sampleEvents.slice(2), 'session-2.jsonl');

      const savedIds = ingestAndSave(tmpDir);
      expect(savedIds).toHaveLength(2);
    });

    it('skips empty event files', () => {
      const dir = path.join(tmpDir, '.agentgram', 'hook-events');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'empty.jsonl'), '');

      const savedIds = ingestAndSave(tmpDir);
      expect(savedIds).toHaveLength(0);
    });

    it('returns empty array when no hook-events directory', () => {
      const savedIds = ingestAndSave(tmpDir);
      expect(savedIds).toHaveLength(0);
    });
  });

  describe('Full pipeline: hook capture → ingest → provenance + recipe', () => {
    it('simulates a real Claude Code session end-to-end', () => {
      // Step 1: Simulate what the hook captures during a real Claude Code session
      const hookEvents = [
        // Agent reads the file it needs to fix
        { timestamp: 1710000001000, claudeSessionId: 'real-session', toolUseId: 'toolu_read1', event: 'read', tool: 'Read', target: 'src/auth.ts', metadata: {} },
        // Agent reads the config to understand deps
        { timestamp: 1710000002000, claudeSessionId: 'real-session', toolUseId: 'toolu_read2', event: 'read', tool: 'Read', target: 'tsconfig.json', metadata: {} },
        // Agent reads related test
        { timestamp: 1710000003000, claudeSessionId: 'real-session', toolUseId: 'toolu_read3', event: 'read', tool: 'Read', target: 'tests/auth.test.ts', metadata: {} },
        // Agent edits the source file
        { timestamp: 1710000010000, claudeSessionId: 'real-session', toolUseId: 'toolu_edit1', event: 'write', tool: 'Edit', target: 'src/auth.ts', metadata: { oldString: 'return true' } },
        // Agent runs tests — they fail
        { timestamp: 1710000015000, claudeSessionId: 'real-session', toolUseId: 'toolu_bash1', event: 'exec', tool: 'Bash', target: 'npm test', metadata: { exitCode: 1, outputLength: 200 } },
        // Agent edits again to fix
        { timestamp: 1710000020000, claudeSessionId: 'real-session', toolUseId: 'toolu_edit2', event: 'write', tool: 'Edit', target: 'src/auth.ts', metadata: { oldString: 'verify(' } },
        // Agent updates test
        { timestamp: 1710000025000, claudeSessionId: 'real-session', toolUseId: 'toolu_edit3', event: 'write', tool: 'Edit', target: 'tests/auth.test.ts', metadata: { oldString: 'expect(true)' } },
        // Agent runs tests — they pass
        { timestamp: 1710000030000, claudeSessionId: 'real-session', toolUseId: 'toolu_bash2', event: 'exec', tool: 'Bash', target: 'npm test', metadata: { exitCode: 0, outputLength: 150 } },
      ];

      writeEventsFile(hookEvents, 'hook-real-session.jsonl');

      // Step 2: Ingest
      const savedIds = ingestAndSave(tmpDir);
      expect(savedIds).toHaveLength(1);

      // Step 3: Load and verify the ingested session
      const sessionPath = path.join(tmpDir, '.agentgram', 'sessions', 'hook-real-session.json');
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

      // Verify session
      expect(data.session.operations).toHaveLength(8);

      // Verify provenance has meaningful causal edges
      const provenance = data.provenance;
      expect(provenance.nodes.length).toBe(8);
      expect(provenance.edges.length).toBeGreaterThan(0);

      // Check: read(auth.ts) → write(auth.ts) has "informed" edge
      const authReadId = 'toolu_read1';
      const authWriteId = 'toolu_edit1';
      const informedEdge = provenance.edges.find(
        (e: { from: string; to: string; relation: string }) =>
          e.from === authReadId && e.to === authWriteId && e.relation === 'informed',
      );
      expect(informedEdge).toBeDefined();

      // Check: read(tsconfig.json) → write(auth.ts) has "depends_on" edge
      const configReadId = 'toolu_read2';
      const dependsEdge = provenance.edges.find(
        (e: { from: string; to: string; relation: string }) =>
          e.from === configReadId && e.to === authWriteId && e.relation === 'depends_on',
      );
      expect(dependsEdge).toBeDefined();

      // Verify recipe is compressed (8 ops → fewer steps)
      const recipe = data.recipe;
      expect(recipe.steps.length).toBeLessThan(8);
      expect(recipe.steps.length).toBeGreaterThan(0);

      // Verify recipe has the right action types
      const actions = recipe.steps.map((s: { action: string }) => s.action);
      expect(actions).toContain('find'); // collapsed reads
      expect(actions).toContain('run_command'); // npm test
    });
  });
});
