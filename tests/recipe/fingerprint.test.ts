import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fingerprint } from '../../src/recipe/fingerprint.js';

describe('Codebase Fingerprinter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-fp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string) {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  describe('language detection', () => {
    it('detects TypeScript from tsconfig.json', async () => {
      writeFile('tsconfig.json', '{}');
      writeFile('package.json', '{}');
      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('typescript');
    });

    it('detects JavaScript when no tsconfig', async () => {
      writeFile('package.json', '{}');
      writeFile('src/index.js', '');
      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('javascript');
    });

    it('detects Python from requirements.txt', async () => {
      writeFile('requirements.txt', 'flask');
      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('python');
    });

    it('detects Python from pyproject.toml', async () => {
      writeFile('pyproject.toml', '[project]');
      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('python');
    });
  });

  describe('framework detection', () => {
    it('detects Next.js', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.framework).toBe('nextjs');
    });

    it('detects Express', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: { express: '^4.18.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.framework).toBe('express');
    });

    it('detects React (not Next)', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.framework).toBe('react');
    });

    it('detects FastAPI', async () => {
      writeFile('requirements.txt', 'fastapi\nuvicorn');
      const fp = await fingerprint(tmpDir);
      expect(fp.framework).toBe('fastapi');
    });

    it('returns none when no framework detected', async () => {
      writeFile('package.json', '{}');
      const fp = await fingerprint(tmpDir);
      expect(fp.framework).toBe('none');
    });
  });

  describe('ORM detection', () => {
    it('detects Prisma', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: { '@prisma/client': '^5.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.orm).toBe('prisma');
    });

    it('detects Mongoose', async () => {
      writeFile('package.json', JSON.stringify({ dependencies: { mongoose: '^7.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.orm).toBe('mongoose');
    });

    it('detects SQLAlchemy', async () => {
      writeFile('requirements.txt', 'sqlalchemy\nflask');
      const fp = await fingerprint(tmpDir);
      expect(fp.orm).toBe('sqlalchemy');
    });
  });

  describe('test framework detection', () => {
    it('detects Vitest', async () => {
      writeFile('package.json', JSON.stringify({ devDependencies: { vitest: '^1.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.testFramework).toBe('vitest');
    });

    it('detects Jest', async () => {
      writeFile('package.json', JSON.stringify({ devDependencies: { jest: '^29.0' } }));
      const fp = await fingerprint(tmpDir);
      expect(fp.testFramework).toBe('jest');
    });

    it('detects Pytest', async () => {
      writeFile('requirements.txt', 'pytest\nflask');
      const fp = await fingerprint(tmpDir);
      expect(fp.testFramework).toBe('pytest');
    });
  });

  describe('infrastructure detection', () => {
    it('detects Docker', async () => {
      writeFile('Dockerfile', 'FROM node:20');
      writeFile('package.json', '{}');
      const fp = await fingerprint(tmpDir);
      expect(fp.hasDocker).toBe(true);
    });

    it('detects CI', async () => {
      writeFile('.github/workflows/ci.yml', 'name: CI');
      writeFile('package.json', '{}');
      const fp = await fingerprint(tmpDir);
      expect(fp.hasCI).toBe(true);
    });

    it('detects monorepo', async () => {
      writeFile('packages/a/package.json', '{}');
      writeFile('packages/b/package.json', '{}');
      writeFile('package.json', JSON.stringify({ workspaces: ['packages/*'] }));
      const fp = await fingerprint(tmpDir);
      expect(fp.isMonorepo).toBe(true);
    });
  });

  describe('fingerprint vector', () => {
    it('produces a complete fingerprint', async () => {
      writeFile('package.json', JSON.stringify({
        dependencies: { next: '^14', '@prisma/client': '^5' },
        devDependencies: { vitest: '^1', typescript: '^5' },
      }));
      writeFile('tsconfig.json', '{}');
      writeFile('Dockerfile', 'FROM node:20');
      writeFile('.github/workflows/ci.yml', 'name: CI');

      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('typescript');
      expect(fp.framework).toBe('nextjs');
      expect(fp.orm).toBe('prisma');
      expect(fp.testFramework).toBe('vitest');
      expect(fp.hasDocker).toBe(true);
      expect(fp.hasCI).toBe(true);
    });

    it('returns sensible defaults for empty project', async () => {
      fs.mkdirSync(tmpDir, { recursive: true });
      const fp = await fingerprint(tmpDir);
      expect(fp.language).toBe('unknown');
      expect(fp.framework).toBe('none');
      expect(fp.orm).toBe('none');
      expect(fp.testFramework).toBe('none');
      expect(fp.hasDocker).toBe(false);
      expect(fp.hasCI).toBe(false);
      expect(fp.isMonorepo).toBe(false);
    });
  });
});
