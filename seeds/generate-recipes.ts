#!/usr/bin/env npx tsx
/**
 * Recipe Seed Generator
 *
 * Creates real, useful recipes by simulating common agent sessions
 * and distilling them through the full agentgram pipeline.
 *
 * Run: npx tsx seeds/generate-recipes.ts
 *
 * These are the "starter pack" — the recipes that make developers
 * go "oh, this is actually useful" and start sharing their own.
 */

import fs from 'node:fs';
import path from 'node:path';
import { RecipeDistiller } from '../src/recipe/distill.js';
import { prepareForSharing } from '../src/recipe/share.js';
import type { Session, Operation } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let opCounter = 0;
function op(type: Operation['type'], target: string, reason: string, meta: Record<string, unknown> = {}): Operation {
  opCounter++;
  return {
    id: `op-${opCounter}`,
    type,
    timestamp: Date.now() - (1000 - opCounter) * 1000,
    target,
    metadata: meta,
    reason,
    causedBy: [],
  };
}

function session(name: string, operations: Operation[]): Session {
  return {
    id: `seed-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    state: 'stopped',
    startedAt: operations[0]?.timestamp ?? Date.now(),
    stoppedAt: operations[operations.length - 1]?.timestamp ?? Date.now(),
    operations,
    branch: '',
    baseCommit: '',
    cwd: '/project',
  };
}

// ---------------------------------------------------------------------------
// Recipe definitions — each simulates a real agent coding session
// ---------------------------------------------------------------------------

const recipeSessions: { session: Session; tags: string[]; description: string }[] = [
  // 1. Add Vitest to a project
  {
    description: 'Set up Vitest testing framework with TypeScript support, coverage, and a sample test',
    tags: ['testing', 'vitest', 'typescript', 'setup'],
    session: session('Setup Vitest Testing', [
      op('read', 'package.json', 'check existing test framework'),
      op('read', 'tsconfig.json', 'check TypeScript config'),
      op('exec', 'npm install -D vitest @vitest/coverage-v8', 'install vitest', { exitCode: 0 }),
      op('create', 'vitest.config.ts', 'create vitest config with TypeScript and coverage'),
      op('write', 'package.json', 'add test scripts: test, test:watch, test:coverage'),
      op('create', 'tests/example.test.ts', 'create sample test file'),
      op('exec', 'npm test', 'verify tests pass', { exitCode: 0 }),
    ]),
  },

  // 2. Add ESLint + Prettier
  {
    description: 'Configure ESLint with TypeScript support and Prettier integration for consistent code style',
    tags: ['linting', 'eslint', 'prettier', 'typescript', 'code-quality'],
    session: session('Setup ESLint and Prettier', [
      op('read', 'package.json', 'check existing linting setup'),
      op('read', 'tsconfig.json', 'check TypeScript settings'),
      op('exec', 'npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier', 'install linting deps', { exitCode: 0 }),
      op('create', 'eslint.config.js', 'create flat config ESLint setup'),
      op('create', '.prettierrc', 'create Prettier config'),
      op('create', '.prettierignore', 'ignore dist and node_modules'),
      op('write', 'package.json', 'add lint and format scripts'),
      op('exec', 'npm run lint', 'verify linting passes', { exitCode: 0 }),
    ]),
  },

  // 3. Add GitHub Actions CI
  {
    description: 'Set up GitHub Actions CI pipeline with Node.js matrix testing, caching, and status badges',
    tags: ['ci', 'github-actions', 'devops', 'automation'],
    session: session('Setup GitHub Actions CI', [
      op('read', 'package.json', 'check test and build scripts'),
      op('read', 'tsconfig.json', 'check if TypeScript project'),
      op('create', '.github/workflows/ci.yml', 'create CI workflow with Node matrix [18,20,22]'),
      op('write', 'README.md', 'add CI status badge'),
      op('exec', 'git add -A && git commit -m "ci: add GitHub Actions"', 'commit CI config', { exitCode: 0 }),
    ]),
  },

  // 4. Add JWT Authentication to Express
  {
    description: 'Add JWT-based authentication to an Express API with middleware, token refresh, and tests',
    tags: ['auth', 'jwt', 'express', 'nodejs', 'security', 'api'],
    session: session('Add JWT Authentication', [
      op('read', 'src/app.ts', 'understand Express app structure'),
      op('read', 'src/routes/index.ts', 'check existing routes'),
      op('read', 'package.json', 'check dependencies'),
      op('exec', 'npm install jsonwebtoken bcryptjs', 'install auth deps', { exitCode: 0 }),
      op('exec', 'npm install -D @types/jsonwebtoken @types/bcryptjs', 'install type defs', { exitCode: 0 }),
      op('create', 'src/middleware/auth.ts', 'create JWT verification middleware'),
      op('create', 'src/routes/auth.ts', 'create login and register routes'),
      op('create', 'src/utils/tokens.ts', 'create token generation and refresh helpers'),
      op('write', 'src/routes/index.ts', 'protect API routes with auth middleware'),
      op('write', 'src/app.ts', 'register auth routes'),
      op('create', 'tests/auth.test.ts', 'add auth flow tests'),
      op('exec', 'npm test', 'verify all tests pass', { exitCode: 0 }),
    ]),
  },

  // 5. Add Docker + Docker Compose
  {
    description: 'Containerize a Node.js app with multi-stage Dockerfile, docker-compose for dev, and .dockerignore',
    tags: ['docker', 'containerization', 'devops', 'nodejs'],
    session: session('Add Docker Support', [
      op('read', 'package.json', 'check Node version and scripts'),
      op('read', 'tsconfig.json', 'check build output directory'),
      op('create', 'Dockerfile', 'multi-stage build: deps → build → runtime'),
      op('create', '.dockerignore', 'ignore node_modules, dist, .git, tests'),
      op('create', 'docker-compose.yml', 'dev setup with hot reload and volume mounts'),
      op('create', 'docker-compose.prod.yml', 'production setup with health checks'),
      op('exec', 'docker build -t app .', 'verify build succeeds', { exitCode: 0 }),
    ]),
  },

  // 6. Add Error Handling and Logging
  {
    description: 'Add structured error handling with custom error classes, global handler, and request logging',
    tags: ['error-handling', 'logging', 'express', 'nodejs', 'observability'],
    session: session('Add Error Handling and Logging', [
      op('read', 'src/app.ts', 'understand app structure'),
      op('read', 'src/routes/index.ts', 'check existing error handling'),
      op('exec', 'npm install pino pino-http', 'install structured logger', { exitCode: 0 }),
      op('create', 'src/utils/logger.ts', 'create Pino logger with request ID'),
      op('create', 'src/errors/AppError.ts', 'create custom error classes: NotFound, Validation, Auth'),
      op('create', 'src/middleware/error-handler.ts', 'create global error handler middleware'),
      op('create', 'src/middleware/request-logger.ts', 'create request logging middleware'),
      op('write', 'src/app.ts', 'register logger and error handler middleware'),
      op('create', 'tests/errors.test.ts', 'test error handling'),
      op('exec', 'npm test', 'verify tests pass', { exitCode: 0 }),
    ]),
  },

  // 7. Add Database with Prisma
  {
    description: 'Set up Prisma ORM with PostgreSQL, initial schema, migrations, and seed script',
    tags: ['database', 'prisma', 'postgresql', 'orm', 'nodejs'],
    session: session('Setup Prisma Database', [
      op('read', 'package.json', 'check existing deps'),
      op('exec', 'npm install prisma @prisma/client', 'install Prisma', { exitCode: 0 }),
      op('exec', 'npx prisma init', 'initialize Prisma with PostgreSQL', { exitCode: 0 }),
      op('write', 'prisma/schema.prisma', 'define User and Post models'),
      op('create', '.env', 'add DATABASE_URL'),
      op('write', '.gitignore', 'add .env to gitignore'),
      op('exec', 'npx prisma migrate dev --name init', 'run initial migration', { exitCode: 0 }),
      op('create', 'prisma/seed.ts', 'create seed script with sample data'),
      op('write', 'package.json', 'add prisma seed and db scripts'),
      op('exec', 'npx prisma db seed', 'run seed', { exitCode: 0 }),
    ]),
  },

  // 8. Add Rate Limiting and Security Headers
  {
    description: 'Add rate limiting, CORS, helmet security headers, and request validation to Express API',
    tags: ['security', 'rate-limiting', 'express', 'api', 'cors', 'helmet'],
    session: session('Add API Security', [
      op('read', 'src/app.ts', 'check existing middleware'),
      op('read', 'package.json', 'check deps'),
      op('exec', 'npm install helmet cors express-rate-limit', 'install security deps', { exitCode: 0 }),
      op('create', 'src/middleware/rate-limiter.ts', 'configure rate limiter: 100 req/15min'),
      op('write', 'src/app.ts', 'add helmet, cors, rate limiter middleware'),
      op('create', 'src/config/cors.ts', 'CORS whitelist configuration'),
      op('create', 'tests/security.test.ts', 'test rate limiting and headers'),
      op('exec', 'npm test', 'verify security tests pass', { exitCode: 0 }),
    ]),
  },

  // 9. Add OpenAPI/Swagger Documentation
  {
    description: 'Generate OpenAPI 3.0 spec from Express routes with Swagger UI and auto-validation',
    tags: ['documentation', 'openapi', 'swagger', 'api', 'express'],
    session: session('Add OpenAPI Documentation', [
      op('read', 'src/app.ts', 'understand route structure'),
      op('read', 'src/routes/index.ts', 'catalog all endpoints'),
      op('exec', 'npm install swagger-ui-express swagger-jsdoc', 'install Swagger deps', { exitCode: 0 }),
      op('create', 'src/config/swagger.ts', 'OpenAPI 3.0 spec with info, servers, security'),
      op('write', 'src/routes/index.ts', 'add JSDoc annotations to routes'),
      op('write', 'src/app.ts', 'mount Swagger UI at /api-docs'),
      op('exec', 'npm run dev', 'verify Swagger UI loads', { exitCode: 0 }),
    ]),
  },

  // 10. Convert JavaScript to TypeScript
  {
    description: 'Migrate a JavaScript project to TypeScript with strict mode, path aliases, and updated build',
    tags: ['typescript', 'migration', 'refactoring', 'javascript'],
    session: session('Migrate to TypeScript', [
      op('read', 'package.json', 'check build tools'),
      op('read', 'src/index.js', 'understand entry point'),
      op('exec', 'npm install -D typescript @types/node', 'install TypeScript', { exitCode: 0 }),
      op('create', 'tsconfig.json', 'create strict tsconfig with path aliases'),
      op('exec', 'find src -name "*.js" -exec bash -c \'mv "$0" "${0%.js}.ts"\' {} \\;', 'rename .js to .ts', { exitCode: 0 }),
      op('write', 'src/index.ts', 'add type annotations to entry point'),
      op('write', 'package.json', 'update scripts: build with tsc, add typecheck'),
      op('exec', 'npm run typecheck', 'fix type errors', { exitCode: 1 }),
      op('write', 'src/index.ts', 'fix remaining type errors'),
      op('exec', 'npm run typecheck', 'verify zero type errors', { exitCode: 0 }),
      op('exec', 'npm run build', 'verify build succeeds', { exitCode: 0 }),
    ]),
  },
];

// ---------------------------------------------------------------------------
// Generate and save
// ---------------------------------------------------------------------------

async function main() {
  const outputDir = path.resolve('seeds/output');
  fs.mkdirSync(outputDir, { recursive: true });

  console.log('\n🌱 Generating seed recipes...\n');

  const indexEntries: unknown[] = [];

  for (const { session: sess, tags, description } of recipeSessions) {
    opCounter = 0; // reset for clean IDs

    // Override description
    const prepared = prepareForSharing(
      { ...sess, operations: sess.operations.map((o, i) => ({ ...o, id: `op-${i + 1}`, timestamp: sess.startedAt + i * 5000 })) },
      {
        name: sess.name,
        tags,
        author: 'eclaireai',
        sourceAgent: 'claude-code',
      },
    );

    // Override description to be more useful
    prepared.description = description;

    // Save recipe file
    const filename = `${prepared.metadata.id}.json`;
    fs.writeFileSync(
      path.join(outputDir, filename),
      JSON.stringify(prepared, null, 2),
    );

    // Build index entry
    indexEntries.push({
      id: prepared.metadata.id,
      name: prepared.name,
      description: prepared.description,
      author: prepared.metadata.author,
      tags: prepared.tags,
      sourceAgent: prepared.metadata.sourceAgent,
      downloads: 0,
      rating: 0,
      createdAt: prepared.metadata.createdAt,
      stepCount: prepared.steps.length,
    });

    const distiller = new RecipeDistiller();
    console.log(`  ✔ ${prepared.name}`);
    console.log(`    ${prepared.steps.length} steps (from ${sess.operations.length} ops)`);
    console.log(`    Tags: ${tags.join(', ')}`);
    console.log(`    ID: ${prepared.metadata.id}`);
    console.log();
  }

  // Save index
  const index = {
    version: '1',
    updatedAt: new Date().toISOString(),
    recipes: indexEntries,
  };
  fs.writeFileSync(
    path.join(outputDir, 'index.json'),
    JSON.stringify(index, null, 2),
  );

  console.log(`✅ Generated ${recipeSessions.length} recipes in ${outputDir}`);
  console.log(`   Index: ${outputDir}/index.json`);
  console.log(`\n   To publish to registry:`);
  console.log(`   cp ${outputDir}/*.json /path/to/agentgram-recipes/recipes/`);
  console.log(`   cp ${outputDir}/index.json /path/to/agentgram-recipes/`);
}

main().catch(console.error);
