/**
 * Codebase Fingerprinter
 *
 * Scans a project directory and produces a fingerprint vector describing
 * the tech stack. Used to match recipes to compatible codebases.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodebaseFingerprint {
  language: string;
  framework: string;
  orm: string;
  testFramework: string;
  packageManager: string;
  hasDocker: boolean;
  hasCI: boolean;
  isMonorepo: boolean;
}

async function exists(filepath: string): Promise<boolean> {
  try { await fs.access(filepath); return true; } catch { return false; }
}

async function readJson(filepath: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await fs.readFile(filepath, 'utf8')); } catch { return null; }
}

async function readText(filepath: string): Promise<string | null> {
  try { return await fs.readFile(filepath, 'utf8'); } catch { return null; }
}

function hasDep(pkg: Record<string, unknown> | null, name: string): boolean {
  if (!pkg) return false;
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  return name in deps || name in devDeps;
}

function textContains(text: string | null, term: string): boolean {
  return text !== null && text.toLowerCase().includes(term.toLowerCase());
}

export async function fingerprint(cwd: string): Promise<CodebaseFingerprint> {
  const pkg = await readJson(path.join(cwd, 'package.json'));
  const requirements = await readText(path.join(cwd, 'requirements.txt'));
  const pyproject = await readText(path.join(cwd, 'pyproject.toml'));
  const hasTsConfig = await exists(path.join(cwd, 'tsconfig.json'));

  // Language
  let language = 'unknown';
  if (hasTsConfig) language = 'typescript';
  else if (pkg) language = 'javascript';
  else if (requirements || pyproject) language = 'python';

  // Framework
  let framework = 'none';
  if (pkg) {
    if (hasDep(pkg, 'next')) framework = 'nextjs';
    else if (hasDep(pkg, 'nuxt')) framework = 'nuxt';
    else if (hasDep(pkg, 'express')) framework = 'express';
    else if (hasDep(pkg, 'fastify')) framework = 'fastify';
    else if (hasDep(pkg, 'hono')) framework = 'hono';
    else if (hasDep(pkg, 'react')) framework = 'react';
    else if (hasDep(pkg, 'vue')) framework = 'vue';
    else if (hasDep(pkg, 'svelte')) framework = 'svelte';
  }
  if (framework === 'none') {
    if (textContains(requirements, 'fastapi')) framework = 'fastapi';
    else if (textContains(requirements, 'django')) framework = 'django';
    else if (textContains(requirements, 'flask')) framework = 'flask';
    else if (textContains(pyproject, 'fastapi')) framework = 'fastapi';
    else if (textContains(pyproject, 'django')) framework = 'django';
  }

  // ORM
  let orm = 'none';
  if (pkg) {
    if (hasDep(pkg, '@prisma/client') || hasDep(pkg, 'prisma')) orm = 'prisma';
    else if (hasDep(pkg, 'typeorm')) orm = 'typeorm';
    else if (hasDep(pkg, 'drizzle-orm')) orm = 'drizzle';
    else if (hasDep(pkg, 'mongoose')) orm = 'mongoose';
    else if (hasDep(pkg, 'sequelize')) orm = 'sequelize';
    else if (hasDep(pkg, 'knex')) orm = 'knex';
  }
  if (orm === 'none') {
    if (textContains(requirements, 'sqlalchemy') || textContains(pyproject, 'sqlalchemy')) orm = 'sqlalchemy';
    else if (textContains(requirements, 'django')) orm = 'django-orm';
    else if (textContains(requirements, 'tortoise-orm')) orm = 'tortoise';
  }

  // Test framework
  let testFramework = 'none';
  if (pkg) {
    if (hasDep(pkg, 'vitest')) testFramework = 'vitest';
    else if (hasDep(pkg, 'jest')) testFramework = 'jest';
    else if (hasDep(pkg, 'mocha')) testFramework = 'mocha';
    else if (hasDep(pkg, 'ava')) testFramework = 'ava';
  }
  if (testFramework === 'none') {
    if (textContains(requirements, 'pytest') || textContains(pyproject, 'pytest')) testFramework = 'pytest';
    else if (textContains(requirements, 'unittest')) testFramework = 'unittest';
  }

  // Package manager
  let packageManager = 'unknown';
  if (await exists(path.join(cwd, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (await exists(path.join(cwd, 'yarn.lock'))) packageManager = 'yarn';
  else if (await exists(path.join(cwd, 'bun.lockb'))) packageManager = 'bun';
  else if (await exists(path.join(cwd, 'package-lock.json'))) packageManager = 'npm';
  else if (requirements || pyproject) packageManager = 'pip';

  // Infrastructure
  const hasDocker = await exists(path.join(cwd, 'Dockerfile'));
  const hasCI =
    await exists(path.join(cwd, '.github', 'workflows')) ||
    await exists(path.join(cwd, '.gitlab-ci.yml')) ||
    await exists(path.join(cwd, '.circleci'));

  // Monorepo
  let isMonorepo = false;
  if (pkg) {
    isMonorepo = Array.isArray((pkg as Record<string, unknown>).workspaces);
  }
  if (!isMonorepo) {
    isMonorepo = await exists(path.join(cwd, 'pnpm-workspace.yaml')) ||
      await exists(path.join(cwd, 'lerna.json'));
  }

  return { language, framework, orm, testFramework, packageManager, hasDocker, hasCI, isMonorepo };
}
