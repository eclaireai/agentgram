import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  handleSessionStart,
  handleCapture,
  installHooks,
  uninstallHooks,
  generateHookConfig,
} from '../../src/hooks/claude-code.js';

describe('Claude Code Hooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-hook-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateHookConfig', () => {
    it('returns valid hook config structure', () => {
      const config = generateHookConfig();
      expect(config.hooks).toBeDefined();
      expect(config.hooks.PostToolUse).toHaveLength(1);
      expect(config.hooks.SessionStart).toHaveLength(1);
      expect(config.hooks.PostToolUse[0].matcher).toBe('Read|Write|Edit|Bash|Grep|Glob');
    });
  });

  describe('handleSessionStart', () => {
    it('creates a new session state file', () => {
      const input = {
        session_id: 'test-session-123',
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
        source: 'startup',
      };

      const output = handleSessionStart(input);
      const parsed = JSON.parse(output);

      expect(parsed.hookSpecificOutput.additionalContext).toContain('[agentgram]');
      expect(parsed.hookSpecificOutput.additionalContext).toContain('Recording session');

      // Check session file was created
      const sessionFile = path.join(tmpDir, '.agentgram', 'active-hook-session.json');
      expect(fs.existsSync(sessionFile)).toBe(true);

      const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      expect(state.claudeSessionId).toBe('test-session-123');
      expect(state.cwd).toBe(tmpDir);
      expect(state.eventCount).toBe(0);
    });

    it('resumes existing session for same Claude session', () => {
      const input = {
        session_id: 'test-session-123',
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
      };

      // First call creates
      handleSessionStart(input);

      // Second call resumes
      const output = handleSessionStart(input);
      const parsed = JSON.parse(output);
      expect(parsed.hookSpecificOutput.additionalContext).toContain('Resuming');
    });

    it('creates new session for different Claude session', () => {
      handleSessionStart({
        session_id: 'session-1',
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
      });

      const output = handleSessionStart({
        session_id: 'session-2',
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
      });

      const parsed = JSON.parse(output);
      expect(parsed.hookSpecificOutput.additionalContext).toContain('Recording session');
    });
  });

  describe('handleCapture', () => {
    it('captures Read tool events', () => {
      // Start a session first
      handleSessionStart({
        session_id: 'test-session',
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
      });

      // Capture a read
      const output = handleCapture({
        session_id: 'test-session',
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/src/index.ts' },
        cwd: tmpDir,
      });

      expect(output).toBe('');

      // Verify event was written
      const sessionState = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.agentgram', 'active-hook-session.json'), 'utf8'),
      );
      expect(sessionState.eventCount).toBe(1);

      const eventsDir = path.join(tmpDir, '.agentgram', 'hook-events');
      const files = fs.readdirSync(eventsDir);
      expect(files).toHaveLength(1);

      const events = fs.readFileSync(path.join(eventsDir, files[0]), 'utf8').trim().split('\n');
      const event = JSON.parse(events[0]);
      expect(event.event).toBe('read');
      expect(event.target).toBe('/src/index.ts');
    });

    it('captures Write tool events', () => {
      handleSessionStart({ session_id: 'test', hook_event_name: 'SessionStart', cwd: tmpDir });

      handleCapture({
        session_id: 'test',
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/src/app.ts', content: 'hello world' },
        cwd: tmpDir,
      });

      const sessionState = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.agentgram', 'active-hook-session.json'), 'utf8'),
      );
      expect(sessionState.eventCount).toBe(1);
    });

    it('captures Bash tool events', () => {
      handleSessionStart({ session_id: 'test', hook_event_name: 'SessionStart', cwd: tmpDir });

      handleCapture({
        session_id: 'test',
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { success: true, output: 'all tests pass' },
        cwd: tmpDir,
      });

      const sessionState = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.agentgram', 'active-hook-session.json'), 'utf8'),
      );
      expect(sessionState.eventCount).toBe(1);
    });

    it('silently skips when no active session', () => {
      const output = handleCapture({
        session_id: 'test',
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/src/index.ts' },
        cwd: tmpDir,
      });

      expect(output).toBe('');
    });

    it('captures multiple events in sequence', () => {
      handleSessionStart({ session_id: 'test', hook_event_name: 'SessionStart', cwd: tmpDir });

      // Read, then write, then exec
      handleCapture({ session_id: 'test', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'a.ts' }, cwd: tmpDir });
      handleCapture({ session_id: 'test', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'a.ts', content: 'x' }, cwd: tmpDir });
      handleCapture({ session_id: 'test', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: tmpDir });

      const sessionState = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.agentgram', 'active-hook-session.json'), 'utf8'),
      );
      expect(sessionState.eventCount).toBe(3);
    });
  });

  describe('installHooks / uninstallHooks', () => {
    it('installs hooks to a settings file', () => {
      const result = installHooks('project', tmpDir);
      expect(result.created).toBe(true);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.PostToolUse).toHaveLength(1);
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('does not duplicate hooks on repeated install', () => {
      installHooks('project', tmpDir);
      installHooks('project', tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks.PostToolUse).toHaveLength(1);
    });

    it('uninstalls hooks', () => {
      installHooks('project', tmpDir);
      const removed = uninstallHooks('project', tmpDir);
      expect(removed).toBe(true);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      // Hooks should be empty
      expect(Object.keys(settings.hooks)).toHaveLength(0);
    });
  });
});
