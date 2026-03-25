#!/usr/bin/env npx tsx
/**
 * agentgram demo — creates a real session, then shows CLI output.
 * Run: npx tsx demo/demo.ts
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEMO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-demo-'));

function run(cmd: string, cwd = DEMO_DIR) {
  console.log(`\n\x1b[90m$ ${cmd}\x1b[0m`);
  const out = execSync(cmd, { cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1' } });
  if (out.trim()) console.log(out.trim());
  return out;
}

async function main() {
  console.log('\x1b[1m\x1b[36m');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         agentgram — live demo                ║');
  console.log('  ║  Shadow worktree · Provenance · Recipes      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // Setup a demo git repo
  console.log('\x1b[1m▸ Setting up demo project...\x1b[0m');
  run('git init');
  run('git config user.name "demo"');
  run('git config user.email "demo@example.com"');
  fs.writeFileSync(path.join(DEMO_DIR, 'src', 'auth.ts'), '', { recursive: true } as any);
  fs.mkdirSync(path.join(DEMO_DIR, 'src'), { recursive: true });
  fs.writeFileSync(path.join(DEMO_DIR, 'src', 'auth.ts'), 'export function checkToken(t: string) { return true; }\n');
  fs.writeFileSync(path.join(DEMO_DIR, 'package.json'), '{ "name": "demo-app", "version": "1.0.0" }\n');
  run('git add -A && git commit -m "initial commit"');

  // Record a session using the programmatic API
  console.log('\n\x1b[1m▸ Recording an agent session...\x1b[0m');

  const script = `
    const { Agentrace } = require('${path.resolve('dist/index.cjs')}');
    const fs = require('fs');
    const path = require('path');

    async function main() {
      const session = await Agentrace.start('${DEMO_DIR}', 'fix-auth-bug');

      // Agent reads the auth file
      await session.read('src/auth.ts', { reason: 'understand JWT validation logic' });

      // Agent reads config
      await session.read('package.json', { reason: 'check dependencies' });

      // Agent writes a fix
      fs.writeFileSync(path.join('${DEMO_DIR}', 'src', 'auth.ts'),
        'import jwt from "jsonwebtoken";\\n\\nexport function checkToken(t: string) {\\n  try {\\n    return jwt.verify(t, process.env.JWT_SECRET);\\n  } catch {\\n    return false;\\n  }\\n}\\n'
      );
      await session.write('src/auth.ts', { reason: 'fix token validation with proper JWT verify' });

      // Agent creates a test file
      fs.mkdirSync(path.join('${DEMO_DIR}', 'tests'), { recursive: true });
      fs.writeFileSync(path.join('${DEMO_DIR}', 'tests', 'auth.test.ts'),
        'import { checkToken } from "../src/auth";\\ntest("rejects invalid token", () => expect(checkToken("bad")).toBe(false));\\n'
      );
      await session.create('tests/auth.test.ts', { reason: 'add auth test coverage' });

      // Agent runs tests
      await session.exec('npm test', { exitCode: 0, output: '1 passing (42ms)' }, { reason: 'verify fix' });

      const result = await session.stop();
      console.log(JSON.stringify({ id: result.session.id, ops: result.operations.length, commits: result.totalCommits }));
    }
    main().catch(console.error);
  `;

  const result = run(`node -e '${script.replace(/'/g, "'\\''")}'`);
  const info = JSON.parse(result.split('\n').pop()!.trim());
  const sessionId = info.id;

  console.log(`\n\x1b[32m✔ Session recorded: ${sessionId}\x1b[0m`);
  console.log(`  ${info.ops} operations, ${info.commits} micro-commits\n`);

  // Now demo the CLI commands
  const cli = path.resolve('dist/cli.js');

  console.log('\x1b[1m▸ agentgram list\x1b[0m');
  run(`node ${cli} list`);

  console.log('\n\x1b[1m▸ agentgram show\x1b[0m');
  run(`node ${cli} show ${sessionId}`);

  console.log('\n\x1b[1m▸ agentgram diff\x1b[0m');
  run(`node ${cli} diff ${sessionId}`);

  console.log('\n\x1b[1m▸ agentgram provenance (mermaid)\x1b[0m');
  run(`node ${cli} provenance ${sessionId}`);

  console.log('\n\x1b[1m▸ agentgram recipe (yaml)\x1b[0m');
  run(`node ${cli} recipe ${sessionId}`);

  // Cleanup
  fs.rmSync(DEMO_DIR, { recursive: true, force: true });

  console.log('\n\x1b[1m\x1b[32m✔ Demo complete!\x1b[0m');
  console.log('\x1b[90mInstall: npm install agentgram\x1b[0m');
  console.log('\x1b[90mGitHub:  https://github.com/metacogma/agentgram\x1b[0m\n');
}

main().catch(console.error);
