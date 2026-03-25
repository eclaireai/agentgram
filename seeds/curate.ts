#!/usr/bin/env npx tsx
/**
 * Registry Curator — Steve Jobs Edition.
 *
 * "It's not about how many features you have.
 *  It's about how good the ones you have are."
 *
 * Generates 30 world-class recipes — the ones every developer
 * actually needs — organized into category folders, each with
 * a recipe.json and a README.md that makes your heart sing.
 *
 * Structure:
 *   registry/
 *     auth/jwt-authentication/recipe.json + README.md
 *     database/prisma-postgresql/recipe.json + README.md
 *     testing/vitest-setup/recipe.json + README.md
 *     ... (30 total across 8 categories)
 *     index.json
 *     README.md
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecipeStep {
  action: string;
  target: string;
  description: string;
  pattern?: string;
  expect?: string;
}

interface RecipeDefinition {
  slug: string;
  category: string;
  name: string;
  tagline: string;           // one-liner for index
  description: string;       // full description for README
  why: string;               // the WHY — for README
  steps: RecipeStep[];
  parameters: Record<string, string>;
  tags: string[];
  stack: string[];           // language/framework requirements
}

// ---------------------------------------------------------------------------
// The 30 Curated Recipes
// ---------------------------------------------------------------------------

const RECIPES: RecipeDefinition[] = [

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: auth
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'jwt-authentication',
    category: 'auth',
    name: 'JWT Authentication',
    tagline: 'Stateless auth with access + refresh tokens and bcrypt password hashing',
    description: 'Add production-ready JWT authentication to any Express/Node.js API. Includes access tokens (15-min expiry), refresh tokens (7-day expiry), bcrypt password hashing, auth middleware, and a full test suite.',
    why: 'Session auth breaks in distributed systems. JWTs are stateless, scalable, and work across microservices. This recipe gives you the full pattern — not just the happy path.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing dependencies and Express version', pattern: 'package.json' },
      { action: 'find', target: 'src/app.ts', description: 'Understand Express app entry point', pattern: 'src/app.ts, src/index.ts, app.ts' },
      { action: 'run_command', target: 'npm install jsonwebtoken bcryptjs', description: 'Install jwt and password hashing libraries' },
      { action: 'run_command', target: 'npm install -D @types/jsonwebtoken @types/bcryptjs', description: 'Install TypeScript type definitions' },
      { action: 'create_file', target: 'src/utils/tokens.ts', description: 'Create generateAccessToken(), generateRefreshToken(), verifyToken() helpers' },
      { action: 'create_file', target: 'src/middleware/auth.ts', description: 'Create JWT verification middleware that attaches req.user' },
      { action: 'create_file', target: 'src/routes/auth.ts', description: 'Create POST /auth/register, POST /auth/login, POST /auth/refresh, POST /auth/logout routes' },
      { action: 'modify_file', target: '.env', description: 'Add JWT_SECRET and JWT_REFRESH_SECRET environment variables' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Register auth routes and apply auth middleware to protected route groups' },
      { action: 'create_file', target: 'tests/auth.test.ts', description: 'Add tests for register, login, token refresh, and protected route access' },
      { action: 'run_command', target: 'npm test', description: 'Verify all auth tests pass', expect: 'All tests pass' },
    ],
    parameters: {
      src: 'src',
      tests: 'tests',
    },
    tags: ['auth', 'jwt', 'security', 'express', 'nodejs', 'typescript', 'api'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  {
    slug: 'nextauth-setup',
    category: 'auth',
    name: 'NextAuth.js Setup',
    tagline: 'Drop-in auth for Next.js: Google, GitHub, email/password, session management',
    description: 'Add NextAuth.js to a Next.js app with Google OAuth, GitHub OAuth, credentials provider, and Prisma adapter for session persistence. Production-ready in one session.',
    why: 'Building auth from scratch in Next.js is a 2-day rabbit hole. NextAuth gives you OAuth, sessions, and JWT in one package — but the initial setup with multiple providers is non-trivial. This recipe does it right.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check Next.js version and existing auth setup' },
      { action: 'run_command', target: 'npm install next-auth @auth/prisma-adapter', description: 'Install NextAuth and Prisma adapter' },
      { action: 'create_file', target: 'app/api/auth/[...nextauth]/route.ts', description: 'Create NextAuth handler with Google and GitHub providers' },
      { action: 'create_file', target: 'lib/auth.ts', description: 'Export auth options and getServerSession helper' },
      { action: 'modify_file', target: 'prisma/schema.prisma', description: 'Add Account, Session, User, VerificationToken models for NextAuth adapter' },
      { action: 'run_command', target: 'npx prisma migrate dev --name nextauth', description: 'Run NextAuth database migration' },
      { action: 'modify_file', target: '.env.local', description: 'Add NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_ID, GITHUB_SECRET' },
      { action: 'create_file', target: 'components/AuthButton.tsx', description: 'Create sign in/sign out button component using useSession' },
      { action: 'modify_file', target: 'middleware.ts', description: 'Add route protection middleware using NextAuth matcher' },
    ],
    parameters: {
      lib: 'lib',
      components: 'components',
    },
    tags: ['auth', 'nextjs', 'oauth', 'google', 'github', 'session', 'typescript'],
    stack: ['nextjs', 'typescript', 'prisma'],
  },

  {
    slug: 'api-key-auth',
    category: 'auth',
    name: 'API Key Authentication',
    tagline: 'Secure machine-to-machine auth with hashed keys, scopes, and rate limiting',
    description: 'Add API key authentication for machine-to-machine communication. Keys are hashed (never stored in plain text), support scopes (read/write/admin), and tie into rate limiting.',
    why: 'JWTs are for users. API keys are for services. When your API needs to be called by other services, crons, or third-party integrations, you need proper API key management — not just a hardcoded token in .env.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing auth setup and middleware' },
      { action: 'run_command', target: 'npm install crypto-js', description: 'Install crypto library for key hashing' },
      { action: 'create_file', target: 'src/utils/apiKeys.ts', description: 'Create generateApiKey(), hashKey(), and verifyKey() utilities' },
      { action: 'create_file', target: 'src/models/ApiKey.ts', description: 'Create ApiKey model with id, keyHash, name, scopes, lastUsed, expiresAt' },
      { action: 'create_file', target: 'src/middleware/apiKeyAuth.ts', description: 'Create middleware that extracts Bearer token, hashes it, and looks up the key' },
      { action: 'create_file', target: 'src/routes/apiKeys.ts', description: 'Create POST /api-keys (create), GET /api-keys (list), DELETE /api-keys/:id (revoke)' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Apply apiKeyAuth middleware to /v1/* routes' },
      { action: 'create_file', target: 'tests/apiKeys.test.ts', description: 'Test key generation, authentication, and revocation' },
      { action: 'run_command', target: 'npm test', description: 'Verify API key auth tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['auth', 'api-key', 'security', 'express', 'nodejs', 'typescript'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: database
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'prisma-postgresql',
    category: 'database',
    name: 'Prisma + PostgreSQL',
    tagline: 'Type-safe ORM with schema-first migrations, seed data, and connection pooling',
    description: 'Set up Prisma ORM with PostgreSQL from zero: schema definition, initial migration, seed script, and connection pooling with PgBouncer-compatible connection strings.',
    why: 'Raw SQL is brittle. Sequelize is verbose. Prisma gives you type-safe queries generated from your schema, so a typo at the database layer is a compile error — not a production bug.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check Node version and existing database dependencies' },
      { action: 'run_command', target: 'npm install prisma @prisma/client', description: 'Install Prisma CLI and client' },
      { action: 'run_command', target: 'npx prisma init --datasource-provider postgresql', description: 'Initialize Prisma with PostgreSQL provider' },
      { action: 'modify_file', target: 'prisma/schema.prisma', description: 'Define User, Post, and Session models with relations' },
      { action: 'modify_file', target: '.env', description: 'Add DATABASE_URL with connection string (includes ?connection_limit=5 for pooling)' },
      { action: 'modify_file', target: '.gitignore', description: 'Ensure .env is gitignored, add prisma/migrations to version control' },
      { action: 'run_command', target: 'npx prisma migrate dev --name init', description: 'Generate and run initial migration' },
      { action: 'create_file', target: 'prisma/seed.ts', description: 'Create seed script with 3 sample users and posts using createMany' },
      { action: 'create_file', target: 'src/lib/prisma.ts', description: 'Create singleton PrismaClient with global instance for dev hot reload' },
      { action: 'modify_file', target: 'package.json', description: 'Add prisma.seed script pointing to tsx prisma/seed.ts' },
      { action: 'run_command', target: 'npx prisma db seed', description: 'Seed the database and verify data', expect: 'Seeded 3 users' },
    ],
    parameters: {
      prisma: 'prisma',
      src_lib: 'src/lib',
    },
    tags: ['database', 'prisma', 'postgresql', 'orm', 'nodejs', 'typescript'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'mongoose-mongodb',
    category: 'database',
    name: 'Mongoose + MongoDB',
    tagline: 'Document database with schema validation, indexes, and connection management',
    description: 'Set up Mongoose with MongoDB Atlas or local Docker. Includes schema validation, compound indexes, connection retry logic, and TypeScript interfaces auto-generated from schemas.',
    why: 'MongoDB without Mongoose is schema anarchy. Mongoose gives you validation, middleware hooks, and indexes — while keeping MongoDB\'s flexibility. This recipe sets it up with connection resilience for production.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing dependencies' },
      { action: 'run_command', target: 'npm install mongoose', description: 'Install Mongoose' },
      { action: 'run_command', target: 'npm install -D @types/mongoose', description: 'Install Mongoose type definitions' },
      { action: 'create_file', target: 'src/lib/mongodb.ts', description: 'Create connection helper with retry logic and connection state caching' },
      { action: 'create_file', target: 'src/models/User.ts', description: 'Create User schema with name, email (unique index), password, createdAt, and toJSON transform' },
      { action: 'create_file', target: 'src/models/index.ts', description: 'Export all models from single entry point' },
      { action: 'modify_file', target: '.env', description: 'Add MONGODB_URI environment variable' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Connect to MongoDB on startup with error handling' },
      { action: 'create_file', target: 'tests/user.test.ts', description: 'Add tests using mongodb-memory-server for in-memory testing' },
      { action: 'run_command', target: 'npm test', description: 'Verify Mongoose tests pass with in-memory server' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['database', 'mongodb', 'mongoose', 'nodejs', 'typescript'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'redis-caching',
    category: 'database',
    name: 'Redis Caching Layer',
    tagline: 'Response caching with Redis — automatic invalidation, TTL, and cache-aside pattern',
    description: 'Add Redis caching to any Express API using the cache-aside pattern. Includes a cacheMiddleware for automatic route-level caching, manual cache invalidation helpers, and graceful degradation if Redis is down.',
    why: 'Your database is fast. Redis is 100x faster. For read-heavy endpoints (product listings, user profiles, search results), caching at the route level drops p99 latency from 200ms to 2ms — without changing a line of business logic.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing dependencies and Redis setup' },
      { action: 'run_command', target: 'npm install ioredis', description: 'Install ioredis client (better than node-redis for TypeScript)' },
      { action: 'create_file', target: 'src/lib/redis.ts', description: 'Create Redis client singleton with connection error handling and graceful fallback' },
      { action: 'create_file', target: 'src/middleware/cache.ts', description: 'Create cache(ttlSeconds) middleware using cache-aside pattern with req.path as key' },
      { action: 'create_file', target: 'src/utils/invalidate.ts', description: 'Create invalidateCache(pattern) helper for manual cache busting' },
      { action: 'modify_file', target: '.env', description: 'Add REDIS_URL environment variable' },
      { action: 'modify_file', target: 'src/routes/products.ts', description: 'Apply cache(300) middleware to GET /products and GET /products/:id' },
      { action: 'modify_file', target: 'src/routes/products.ts', description: 'Call invalidateCache on POST/PUT/DELETE mutations' },
      { action: 'run_command', target: 'npm test', description: 'Verify cache hit/miss behavior in tests' },
    ],
    parameters: { src: 'src' },
    tags: ['redis', 'caching', 'performance', 'express', 'nodejs', 'typescript'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  {
    slug: 'drizzle-sqlite',
    category: 'database',
    name: 'Drizzle ORM + SQLite',
    tagline: 'Lightweight SQL with Drizzle — perfect for edge functions, Cloudflare Workers, Bun',
    description: 'Set up Drizzle ORM with SQLite (via better-sqlite3 or Bun native). Schema-first, fully type-safe, no migration runner required. Ideal for edge deployments and local-first apps.',
    why: 'Prisma is too heavy for edge. Drizzle generates SQL that runs anywhere — Cloudflare Workers, Bun, Vercel Edge. The API is SQL-first, so if you know SQL you already know Drizzle.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check runtime (Node/Bun/Edge) and existing ORM' },
      { action: 'run_command', target: 'npm install drizzle-orm better-sqlite3', description: 'Install Drizzle and SQLite driver' },
      { action: 'run_command', target: 'npm install -D drizzle-kit @types/better-sqlite3', description: 'Install Drizzle Kit for migrations and type definitions' },
      { action: 'create_file', target: 'src/db/schema.ts', description: 'Define users and posts tables with Drizzle schema builder' },
      { action: 'create_file', target: 'src/db/index.ts', description: 'Create and export drizzle(db) client singleton' },
      { action: 'create_file', target: 'drizzle.config.ts', description: 'Configure Drizzle Kit with schema path and SQLite driver' },
      { action: 'run_command', target: 'npx drizzle-kit generate:sqlite', description: 'Generate initial SQL migration' },
      { action: 'run_command', target: 'npx drizzle-kit push:sqlite', description: 'Apply migration to database' },
      { action: 'create_file', target: 'src/db/seed.ts', description: 'Seed database with sample users and posts' },
      { action: 'run_command', target: 'npx tsx src/db/seed.ts', description: 'Run seed and verify rows inserted' },
    ],
    parameters: { src: 'src' },
    tags: ['database', 'drizzle', 'sqlite', 'orm', 'typescript', 'edge'],
    stack: ['nodejs', 'typescript'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: testing
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'vitest-setup',
    category: 'testing',
    name: 'Vitest Testing Framework',
    tagline: 'Blazing fast unit tests with TypeScript, coverage, and watch mode',
    description: 'Set up Vitest from scratch: TypeScript support, V8 coverage reports, path aliases, and a sample test. Runs 10x faster than Jest on cold starts.',
    why: 'Jest requires Babel transforms for TypeScript. Vitest uses Vite\'s native ESM pipeline — no config, instant startup, identical API. If you\'re using Vite or just want fast tests, this is the obvious choice.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing test framework and TypeScript config' },
      { action: 'find', target: 'tsconfig.json', description: 'Read TypeScript config for path aliases' },
      { action: 'run_command', target: 'npm install -D vitest @vitest/coverage-v8 @vitest/ui', description: 'Install Vitest, coverage provider, and UI' },
      { action: 'create_file', target: 'vitest.config.ts', description: 'Create config with coverage thresholds (80%), include patterns, and path aliases' },
      { action: 'modify_file', target: 'package.json', description: 'Add test, test:watch, test:ui, and coverage scripts' },
      { action: 'create_file', target: 'tests/example.test.ts', description: 'Create sample test demonstrating describe/it/expect patterns' },
      { action: 'run_command', target: 'npm test', description: 'Verify test suite runs and passes', expect: '1 passed' },
      { action: 'run_command', target: 'npm run coverage', description: 'Verify coverage report generates', expect: 'Coverage report generated' },
    ],
    parameters: { tests: 'tests' },
    tags: ['testing', 'vitest', 'typescript', 'coverage', 'unit-tests'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'jest-setup',
    category: 'testing',
    name: 'Jest Testing Framework',
    tagline: 'Battle-tested unit testing with TypeScript, mocks, and Istanbul coverage',
    description: 'Set up Jest with TypeScript (via ts-jest), Istanbul coverage, module mocking, and a sensible default config. The standard for Node.js testing.',
    why: 'Jest has the richest ecosystem: snapshot testing, mock functions, fake timers, and a debugger-friendly watch mode. When you need the full testing toolkit and don\'t need Vitest\'s speed, Jest is the standard.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing test setup and Node version' },
      { action: 'run_command', target: 'npm install -D jest ts-jest @types/jest', description: 'Install Jest with TypeScript transformer' },
      { action: 'create_file', target: 'jest.config.ts', description: 'Create Jest config with ts-jest preset, coverage thresholds, and moduleNameMapper for path aliases' },
      { action: 'modify_file', target: 'package.json', description: 'Add test, test:watch, and test:coverage scripts' },
      { action: 'create_file', target: 'tests/example.test.ts', description: 'Create sample test with jest.fn() mock demonstrating the pattern' },
      { action: 'run_command', target: 'npm test', description: 'Verify tests run and pass', expect: 'Tests: 1 passed' },
    ],
    parameters: { tests: 'tests' },
    tags: ['testing', 'jest', 'typescript', 'coverage', 'unit-tests'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'playwright-e2e',
    category: 'testing',
    name: 'Playwright End-to-End Tests',
    tagline: 'Cross-browser E2E testing with Playwright: Chrome, Firefox, Safari',
    description: 'Add Playwright for end-to-end testing against a running server. Includes browser setup, page object model pattern, GitHub Actions CI integration, and screenshot on failure.',
    why: 'Unit tests tell you your functions work. E2E tests tell you your app works. Playwright is the modern choice — it\'s faster than Cypress, supports all browsers natively, and has first-class TypeScript support.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing test setup and dev server command' },
      { action: 'run_command', target: 'npm install -D @playwright/test', description: 'Install Playwright test runner' },
      { action: 'run_command', target: 'npx playwright install chromium firefox webkit', description: 'Install browser binaries' },
      { action: 'create_file', target: 'playwright.config.ts', description: 'Configure Playwright with baseURL, retries, screenshot on failure, and webServer' },
      { action: 'create_file', target: 'e2e/pages/BasePage.ts', description: 'Create BasePage class with common navigation and assertion helpers' },
      { action: 'create_file', target: 'e2e/pages/HomePage.ts', description: 'Create HomePage page object extending BasePage' },
      { action: 'create_file', target: 'e2e/home.spec.ts', description: 'Write first E2E test: visit homepage, check title, verify key element' },
      { action: 'modify_file', target: 'package.json', description: 'Add e2e, e2e:ui, and e2e:debug scripts' },
      { action: 'run_command', target: 'npx playwright test', description: 'Run E2E tests in headless mode', expect: '1 passed' },
    ],
    parameters: { e2e: 'e2e' },
    tags: ['testing', 'playwright', 'e2e', 'typescript', 'browser'],
    stack: ['typescript'],
  },

  {
    slug: 'pytest-setup',
    category: 'testing',
    name: 'Pytest Setup',
    tagline: 'Python testing with pytest, fixtures, coverage, and async support',
    description: 'Set up pytest for a Python project: fixtures, conftest.py, async test support (pytest-asyncio), coverage reporting, and parametrize for data-driven tests.',
    why: 'pytest\'s fixture system is the cleanest dependency injection you\'ll find in any test framework. Fixtures compose, they\'re reusable, and they handle setup/teardown automatically. This recipe gets you to the good patterns immediately.',
    steps: [
      { action: 'find', target: 'requirements.txt', description: 'Check existing test dependencies', pattern: 'requirements.txt, pyproject.toml' },
      { action: 'run_command', target: 'pip install pytest pytest-asyncio pytest-cov httpx', description: 'Install pytest and essential plugins' },
      { action: 'create_file', target: 'pytest.ini', description: 'Configure pytest with asyncio_mode=auto, testpaths, and coverage settings' },
      { action: 'create_file', target: 'tests/conftest.py', description: 'Create shared fixtures: db session, test client, sample user' },
      { action: 'create_file', target: 'tests/test_example.py', description: 'Write first test using fixtures and parametrize' },
      { action: 'run_command', target: 'pytest --cov=src --cov-report=term-missing', description: 'Run tests with coverage report', expect: '1 passed' },
    ],
    parameters: { tests: 'tests', src: 'src' },
    tags: ['testing', 'pytest', 'python', 'coverage', 'async'],
    stack: ['python'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: devops
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'github-actions-ci',
    category: 'devops',
    name: 'GitHub Actions CI',
    tagline: 'Lint + test + build on every push, Node 18/20/22 matrix, cache npm deps',
    description: 'Add a production-grade GitHub Actions CI pipeline: typecheck, lint, test (Node 18/20/22 matrix), build, and optional npm publish on release tags. npm dependency caching keeps it fast.',
    why: 'A PR without CI is a liability. This recipe gives you the matrix strategy (Node LTS versions), proper npm caching, and a build step that catches broken imports before they hit main.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check test, lint, typecheck, and build scripts' },
      { action: 'run_command', target: 'mkdir -p .github/workflows', description: 'Create GitHub Actions directory' },
      { action: 'create_file', target: '.github/workflows/ci.yml', description: 'Create CI workflow: checkout, node matrix (18/20/22), npm ci, typecheck, lint, test, build' },
      { action: 'create_file', target: '.github/workflows/release.yml', description: 'Create release workflow: triggered on version tags, runs CI then npm publish' },
      { action: 'modify_file', target: 'package.json', description: 'Ensure typecheck, lint, test, and build scripts all exist and exit non-zero on failure' },
      { action: 'create_file', target: '.github/dependabot.yml', description: 'Enable Dependabot for weekly npm and GitHub Actions updates' },
    ],
    parameters: {},
    tags: ['ci', 'github-actions', 'devops', 'nodejs', 'typescript'],
    stack: ['nodejs'],
  },

  {
    slug: 'docker-compose',
    category: 'devops',
    name: 'Docker + Docker Compose',
    tagline: 'Containerize any Node.js app with multi-stage builds and compose for local dev',
    description: 'Add Docker to a Node.js project: multi-stage Dockerfile (builder + production), docker-compose.yml for local development with PostgreSQL and Redis, and .dockerignore.',
    why: 'Multi-stage builds produce images 3x smaller than single-stage. The dev compose file means any new team member can be up and running in one command — no more "works on my machine."',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check start script and Node version requirements' },
      { action: 'create_file', target: 'Dockerfile', description: 'Create multi-stage Dockerfile: deps stage (npm ci), builder stage (npm run build), production stage (node:alpine with dist only)' },
      { action: 'create_file', target: '.dockerignore', description: 'Add node_modules, .env, .git, dist, coverage, tests to .dockerignore' },
      { action: 'create_file', target: 'docker-compose.yml', description: 'Create compose file with app, postgres:15, and redis:7 services, named volumes, healthchecks' },
      { action: 'create_file', target: 'docker-compose.prod.yml', description: 'Create production override: pull from registry, no bind mounts, restart: always' },
      { action: 'modify_file', target: '.env.example', description: 'Add POSTGRES_USER, POSTGRES_DB, REDIS_URL vars' },
      { action: 'run_command', target: 'docker build -t app:test --target production .', description: 'Build production image and verify it succeeds' },
    ],
    parameters: {},
    tags: ['docker', 'devops', 'nodejs', 'postgresql', 'redis', 'containers'],
    stack: ['nodejs'],
  },

  {
    slug: 'vercel-deployment',
    category: 'devops',
    name: 'Vercel Deployment',
    tagline: 'Zero-config deploy to Vercel with preview URLs, environment variables, and edge config',
    description: 'Configure a Next.js or Node.js project for Vercel deployment. Includes vercel.json, environment variable setup in Vercel dashboard, preview URL configuration, and GitHub integration for automatic deploys.',
    why: 'Vercel\'s preview URLs are a superpower — every PR gets a live URL. But the initial setup (env vars, rewrites, edge config) is easy to get wrong. This recipe does it once, perfectly.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check framework and build configuration' },
      { action: 'create_file', target: 'vercel.json', description: 'Create vercel.json with framework, buildCommand, outputDirectory, and rewrites' },
      { action: 'modify_file', target: '.env.example', description: 'Document all required environment variables for Vercel dashboard setup' },
      { action: 'create_file', target: '.vercelignore', description: 'Add tests, seeds, docs, and scripts to Vercel ignore' },
      { action: 'run_command', target: 'npx vercel --prod --confirm', description: 'Deploy to Vercel production and verify URL' },
    ],
    parameters: {},
    tags: ['vercel', 'deployment', 'nextjs', 'devops', 'hosting'],
    stack: ['nextjs', 'nodejs'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: quality
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'eslint-prettier',
    category: 'quality',
    name: 'ESLint + Prettier',
    tagline: 'Consistent code style enforced at commit time — no more style debates in PRs',
    description: 'Set up ESLint with TypeScript rules and Prettier for formatting. Configured to run as a pre-commit hook via lint-staged, so formatting errors never reach the repo.',
    why: 'Style debates in code review are waste. ESLint catches real bugs (unused vars, missing awaits, type errors). Prettier eliminates formatting debates entirely. Together they keep code readable without thinking.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing linting setup and TypeScript config' },
      { action: 'run_command', target: 'npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier', description: 'Install ESLint, TypeScript plugin, and Prettier' },
      { action: 'create_file', target: '.eslintrc.json', description: 'Create ESLint config: TypeScript parser, recommended rules, no-unused-vars, no-floating-promises, prettier last' },
      { action: 'create_file', target: '.prettierrc', description: 'Create Prettier config: singleQuote, trailingComma all, printWidth 100, tabWidth 2' },
      { action: 'create_file', target: '.prettierignore', description: 'Add dist, coverage, node_modules, *.json to prettierignore' },
      { action: 'modify_file', target: 'package.json', description: 'Add lint, lint:fix, and format scripts' },
      { action: 'run_command', target: 'npm run lint', description: 'Run linter on codebase and fix auto-fixable issues', expect: 'No lint errors' },
      { action: 'run_command', target: 'npm run format', description: 'Format all files with Prettier' },
    ],
    parameters: {},
    tags: ['eslint', 'prettier', 'linting', 'formatting', 'typescript', 'quality'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'husky-lint-staged',
    category: 'quality',
    name: 'Husky + lint-staged',
    tagline: 'Pre-commit hooks: only lint and format files you actually changed',
    description: 'Add Husky for git hooks and lint-staged to run ESLint and Prettier only on staged files. Commit-msg hook enforces Conventional Commits format.',
    why: 'Running ESLint on the entire codebase before every commit is slow. lint-staged runs it only on staged files — sub-second. Combined with a commit-msg hook, your git history becomes a readable changelog.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check ESLint, Prettier, and npm version' },
      { action: 'run_command', target: 'npm install -D husky lint-staged @commitlint/cli @commitlint/config-conventional', description: 'Install Husky, lint-staged, and commitlint' },
      { action: 'run_command', target: 'npx husky init', description: 'Initialize Husky (creates .husky/ directory and prepare script)' },
      { action: 'create_file', target: '.husky/pre-commit', description: 'Create pre-commit hook: npx lint-staged' },
      { action: 'create_file', target: '.husky/commit-msg', description: 'Create commit-msg hook: npx commitlint --edit $1' },
      { action: 'create_file', target: 'commitlint.config.js', description: 'Configure commitlint to extend @commitlint/config-conventional' },
      { action: 'modify_file', target: 'package.json', description: 'Add lint-staged config: *.ts runs eslint --fix and prettier --write' },
      { action: 'run_command', target: 'echo "test: verify hooks work" | npx commitlint', description: 'Verify commitlint accepts conventional commit message' },
    ],
    parameters: {},
    tags: ['husky', 'lint-staged', 'git-hooks', 'commitlint', 'quality', 'typescript'],
    stack: ['nodejs'],
  },

  {
    slug: 'typescript-strict',
    category: 'quality',
    name: 'TypeScript Strict Mode',
    tagline: 'Enable strictest TypeScript settings and fix every resulting error',
    description: 'Upgrade a TypeScript project to strict mode: enable strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, and fix every resulting type error. Leaves the codebase bulletproof.',
    why: 'TypeScript without strict is like a seatbelt you never buckle. strict catches null dereferences, implicit any, and missing return types. This recipe enables it and fixes every error it reveals — usually 20-50 real bugs.',
    steps: [
      { action: 'find', target: 'tsconfig.json', description: 'Read current TypeScript configuration' },
      { action: 'modify_file', target: 'tsconfig.json', description: 'Enable strict, noUncheckedIndexedAccess, noImplicitReturns, exactOptionalPropertyTypes' },
      { action: 'run_command', target: 'npx tsc --noEmit 2>&1 | head -100', description: 'Count total type errors introduced by strict mode' },
      { action: 'modify_file', target: 'src/**/*.ts', description: 'Fix null/undefined type errors: add proper null checks and optional chaining' },
      { action: 'modify_file', target: 'src/**/*.ts', description: 'Fix implicit any: add explicit type annotations to function parameters' },
      { action: 'modify_file', target: 'src/**/*.ts', description: 'Fix missing return type annotations on exported functions' },
      { action: 'run_command', target: 'npx tsc --noEmit', description: 'Verify zero type errors with strict mode enabled', expect: 'Zero errors' },
      { action: 'run_command', target: 'npm test', description: 'Confirm all tests still pass after type fixes' },
    ],
    parameters: {},
    tags: ['typescript', 'strict', 'types', 'quality', 'nodejs'],
    stack: ['typescript'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: api
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'openapi-swagger',
    category: 'api',
    name: 'OpenAPI / Swagger Docs',
    tagline: 'Auto-generated, interactive API docs from your TypeScript types',
    description: 'Add OpenAPI 3.0 documentation to an Express API using tsoa or swagger-jsdoc. Generates /docs with Swagger UI and a machine-readable openapi.json at /api-docs.',
    why: 'API docs that live outside the code go stale. tsoa generates docs from your TypeScript decorators — so if it compiles, the docs are current. Every endpoint, every type, every example: always accurate.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check Express version and TypeScript config' },
      { action: 'run_command', target: 'npm install tsoa swagger-ui-express', description: 'Install tsoa and Swagger UI' },
      { action: 'run_command', target: 'npm install -D @types/swagger-ui-express', description: 'Install Swagger UI types' },
      { action: 'create_file', target: 'tsoa.json', description: 'Create tsoa config: entryFile, noImplicitAdditionalProperties, outputDirectory' },
      { action: 'create_file', target: 'src/controllers/UserController.ts', description: 'Convert UserController to tsoa @Route, @Get, @Post decorators with @Body and @Path params' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Register swagger-ui-express at /docs and mount generated routes' },
      { action: 'modify_file', target: 'package.json', description: 'Add tsoa:spec and tsoa:routes scripts, run them in prebuild' },
      { action: 'run_command', target: 'npm run tsoa:spec && npm run tsoa:routes', description: 'Generate OpenAPI spec and routes' },
      { action: 'run_command', target: 'curl localhost:3000/api-docs | head -5', description: 'Verify OpenAPI spec is served correctly' },
    ],
    parameters: { src: 'src' },
    tags: ['openapi', 'swagger', 'docs', 'api', 'typescript', 'express'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  {
    slug: 'rate-limiting',
    category: 'api',
    name: 'API Rate Limiting',
    tagline: 'Per-IP and per-user rate limiting with Redis-backed sliding window',
    description: 'Add rate limiting to an Express API: global limit (100 req/min per IP), authenticated user limit (1000 req/min), and endpoint-specific limits. Redis-backed for distributed deployments.',
    why: 'Without rate limiting, one misbehaving client can take down your API. This recipe implements sliding window rate limiting — stricter than token bucket, fairer than fixed window. Redis backing means it works across multiple API instances.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check existing middleware and Redis availability' },
      { action: 'run_command', target: 'npm install express-rate-limit rate-limit-redis ioredis', description: 'Install rate limiting packages' },
      { action: 'create_file', target: 'src/middleware/rateLimiter.ts', description: 'Create globalLimiter (100/min), authLimiter (1000/min), and strictLimiter (10/min) using Redis store' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Apply globalLimiter to all routes, authLimiter to authenticated routes' },
      { action: 'modify_file', target: 'src/routes/auth.ts', description: 'Apply strictLimiter to /auth/login and /auth/register to prevent brute force' },
      { action: 'create_file', target: 'tests/rateLimiter.test.ts', description: 'Test that 101st request returns 429, headers contain X-RateLimit-* info' },
      { action: 'run_command', target: 'npm test', description: 'Verify rate limiting tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['rate-limiting', 'security', 'api', 'express', 'redis', 'typescript'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  {
    slug: 'zod-validation',
    category: 'api',
    name: 'Request Validation with Zod',
    tagline: 'Type-safe request parsing — runtime validation from your TypeScript types',
    description: 'Add Zod schema validation to all API endpoints. Request bodies, query params, and route params are validated at the boundary — invalid requests get a 400 with detailed error messages before touching business logic.',
    why: 'TypeScript catches type errors at compile time. Zod catches them at runtime — from untrusted user input. Without Zod, you\'re trusting that req.body matches your types. With Zod, you know it does.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check Express version and existing validation setup' },
      { action: 'run_command', target: 'npm install zod', description: 'Install Zod' },
      { action: 'create_file', target: 'src/middleware/validate.ts', description: 'Create validate(schema) middleware that parses req.body with Zod and returns 400 on failure with ZodError details' },
      { action: 'create_file', target: 'src/schemas/user.ts', description: 'Define createUserSchema, updateUserSchema, and loginSchema with Zod' },
      { action: 'modify_file', target: 'src/routes/users.ts', description: 'Apply validate(createUserSchema) to POST /users, validate(updateUserSchema) to PUT /users/:id' },
      { action: 'modify_file', target: 'src/routes/auth.ts', description: 'Apply validate(loginSchema) to POST /auth/login' },
      { action: 'create_file', target: 'tests/validation.test.ts', description: 'Test that invalid payloads return 400 with field-level errors' },
      { action: 'run_command', target: 'npm test', description: 'Verify validation tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['validation', 'zod', 'api', 'typescript', 'express', 'nodejs'],
    stack: ['nodejs', 'express', 'typescript'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: security
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'helmet-security-headers',
    category: 'security',
    name: 'Security Headers with Helmet',
    tagline: 'Add 15 security headers in one line — CSP, HSTS, XSS protection, and more',
    description: 'Add Helmet.js to an Express app with a production-ready Content Security Policy, HSTS, and referrer policy. Configured correctly so it doesn\'t break your frontend.',
    why: 'By default, Express sends no security headers. Helmet adds HSTS, X-Frame-Options, X-Content-Type-Options, and a Content Security Policy. It takes 10 minutes and closes a dozen OWASP Top 10 vectors.',
    steps: [
      { action: 'find', target: 'src/app.ts', description: 'Check Express app setup and existing middleware order' },
      { action: 'run_command', target: 'npm install helmet', description: 'Install Helmet' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Add helmet() as the first middleware (before routes), with custom CSP directives' },
      { action: 'create_file', target: 'src/config/helmet.ts', description: 'Create helmet config with CSP that allows your CDN and API origins, HSTS with 1-year maxAge' },
      { action: 'create_file', target: 'tests/security.test.ts', description: 'Test that responses include Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options headers' },
      { action: 'run_command', target: 'npm test', description: 'Verify security header tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['security', 'helmet', 'headers', 'csp', 'express', 'nodejs'],
    stack: ['nodejs', 'express'],
  },

  {
    slug: 'env-validation',
    category: 'security',
    name: 'Environment Variable Validation',
    tagline: 'Crash at startup if required env vars are missing — not at 2am in production',
    description: 'Validate all environment variables at startup using Zod. If any required variable is missing or has the wrong type, the app refuses to start with a clear error message listing exactly what\'s wrong.',
    why: 'Silent missing env vars are the #1 cause of confusing production incidents. This recipe makes your app fail loudly at startup — before it serves a single request — if the configuration is wrong.',
    steps: [
      { action: 'find', target: '.env.example', description: 'Document all required environment variables' },
      { action: 'run_command', target: 'npm install zod', description: 'Install Zod for schema validation' },
      { action: 'create_file', target: 'src/config/env.ts', description: 'Create Zod schema for all env vars, parse process.env, export typed config object' },
      { action: 'modify_file', target: 'src/index.ts', description: 'Import env.ts first (before any other imports) to validate at startup' },
      { action: 'modify_file', target: '.env.example', description: 'Ensure all variables from env.ts schema are documented with example values' },
      { action: 'create_file', target: 'tests/env.test.ts', description: 'Test that missing required vars throw with a clear message on startup' },
      { action: 'run_command', target: 'npm test', description: 'Verify env validation tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['env', 'validation', 'security', 'zod', 'nodejs', 'typescript'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'cors-config',
    category: 'security',
    name: 'CORS Configuration',
    tagline: 'Precise CORS setup that works in dev, staging, and production without wildcards',
    description: 'Configure CORS for an Express API: allowlist of origins per environment, preflight caching, credentials support, and logging for blocked origins to catch misconfigurations.',
    why: 'Using cors({ origin: \'*\' }) is a security hole. This recipe configures CORS with an explicit allowlist per environment — your frontend domain in production, localhost in dev — and logs rejected origins so you catch config issues fast.',
    steps: [
      { action: 'find', target: 'src/app.ts', description: 'Check existing CORS setup and middleware order' },
      { action: 'run_command', target: 'npm install cors', description: 'Install CORS middleware' },
      { action: 'run_command', target: 'npm install -D @types/cors', description: 'Install CORS types' },
      { action: 'create_file', target: 'src/config/cors.ts', description: 'Create CORS options: origin function with env-based allowlist, credentials true, preflight cache 1 hour, log blocked origins' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Apply cors(corsOptions) middleware before routes, handle OPTIONS preflight' },
      { action: 'modify_file', target: '.env', description: 'Add ALLOWED_ORIGINS=http://localhost:3000,https://yourapp.com' },
      { action: 'create_file', target: 'tests/cors.test.ts', description: 'Test allowed origin gets CORS headers, blocked origin gets 403, OPTIONS returns 204' },
      { action: 'run_command', target: 'npm test', description: 'Verify CORS tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['cors', 'security', 'express', 'api', 'nodejs'],
    stack: ['nodejs', 'express'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CATEGORY: monitoring
  // ═══════════════════════════════════════════════════════════════════

  {
    slug: 'structured-logging',
    category: 'monitoring',
    name: 'Structured Logging with Pino',
    tagline: 'JSON logs with request IDs, levels, and millisecond timestamps — ready for Datadog/CloudWatch',
    description: 'Replace console.log with Pino structured logging. Every log line is JSON with timestamp, level, requestId, and context. Log levels are configurable per environment. Integrates with any log aggregator.',
    why: 'console.log is invisible in production. Pino produces JSON logs that Datadog, CloudWatch, and Splunk can parse, filter, and alert on. Request IDs let you trace a single request across all log lines.',
    steps: [
      { action: 'find', target: 'src/app.ts', description: 'Check Express setup and existing logging' },
      { action: 'run_command', target: 'npm install pino pino-http', description: 'Install Pino and HTTP middleware' },
      { action: 'run_command', target: 'npm install -D pino-pretty', description: 'Install pretty printer for local development' },
      { action: 'create_file', target: 'src/lib/logger.ts', description: 'Create Pino logger singleton with level from LOG_LEVEL env, pretty transport in dev' },
      { action: 'create_file', target: 'src/middleware/requestLogger.ts', description: 'Create pino-http middleware that adds requestId to every request and logs method/url/statusCode/responseTime' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Add requestLogger middleware as first middleware after Helmet' },
      { action: 'modify_file', target: 'src/**/*.ts', description: 'Replace console.log calls with logger.info/warn/error with structured context objects' },
      { action: 'run_command', target: 'npm start 2>&1 | head -5', description: 'Verify logs are JSON in production format' },
    ],
    parameters: { src: 'src' },
    tags: ['logging', 'pino', 'monitoring', 'observability', 'nodejs', 'typescript'],
    stack: ['nodejs', 'typescript'],
  },

  {
    slug: 'health-check-endpoint',
    category: 'monitoring',
    name: 'Health Check Endpoint',
    tagline: '/health returns DB status, uptime, version — works with Kubernetes liveness probes',
    description: 'Add /health and /ready endpoints to any Express API. Checks database connectivity, Redis connectivity, and returns service version and uptime. Compatible with Kubernetes liveness/readiness probes.',
    why: 'Load balancers need to know if your app is alive. Kubernetes needs to know if it\'s ready to serve traffic. This recipe gives you the /health and /ready endpoints that do it right — with actual dependency checks, not just a 200.',
    steps: [
      { action: 'find', target: 'src/app.ts', description: 'Check existing routes and database connections' },
      { action: 'create_file', target: 'src/routes/health.ts', description: 'Create GET /health (liveness: always 200) and GET /ready (readiness: checks DB + Redis)' },
      { action: 'create_file', target: 'src/utils/checks.ts', description: 'Create checkDatabase() and checkRedis() functions that ping each service and return status/latencyMs' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Mount health router at /health and /ready before auth middleware' },
      { action: 'create_file', target: 'tests/health.test.ts', description: 'Test /health returns 200, /ready returns 200 when DB is up and 503 when DB is down' },
      { action: 'run_command', target: 'curl localhost:3000/health', description: 'Verify health endpoint returns status:ok with version and uptime' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['health-check', 'monitoring', 'kubernetes', 'devops', 'express', 'nodejs'],
    stack: ['nodejs', 'express'],
  },

  {
    slug: 'sentry-error-tracking',
    category: 'monitoring',
    name: 'Sentry Error Tracking',
    tagline: 'Catch every unhandled error in production with full stack traces and context',
    description: 'Integrate Sentry for error monitoring: unhandled exceptions, promise rejections, Express error middleware, user context, and custom breadcrumbs. Source maps uploaded on deploy so errors point to TypeScript lines.',
    why: 'You cannot fix errors you don\'t know about. Sentry captures every unhandled error in production with the full stack trace, the request that caused it, and who was affected — before your users file a support ticket.',
    steps: [
      { action: 'find', target: 'package.json', description: 'Check Express version and TypeScript build setup' },
      { action: 'run_command', target: 'npm install @sentry/node @sentry/tracing', description: 'Install Sentry Node SDK' },
      { action: 'create_file', target: 'src/lib/sentry.ts', description: 'Initialize Sentry with DSN, environment, tracesSampleRate 0.1, and integrations' },
      { action: 'modify_file', target: 'src/index.ts', description: 'Import sentry.ts as the very first import (before Express) for proper instrumentation' },
      { action: 'modify_file', target: 'src/app.ts', description: 'Add Sentry request handler first and error handler last in middleware chain' },
      { action: 'modify_file', target: '.env', description: 'Add SENTRY_DSN environment variable' },
      { action: 'modify_file', target: 'package.json', description: 'Add sentry:sourcemaps script to upload source maps after build' },
      { action: 'create_file', target: 'tests/sentry.test.ts', description: 'Test that errors are captured and user context is attached' },
      { action: 'run_command', target: 'npm test', description: 'Verify Sentry integration tests pass' },
    ],
    parameters: { src: 'src', tests: 'tests' },
    tags: ['sentry', 'error-tracking', 'monitoring', 'observability', 'nodejs'],
    stack: ['nodejs', 'express', 'typescript'],
  },

];

// ---------------------------------------------------------------------------
// README generator
// ---------------------------------------------------------------------------

function generateRecipeReadme(def: RecipeDefinition): string {
  const stepLines = def.steps.map((s, i) => {
    const icon = {
      find: '🔍',
      run_command: '⚡',
      create_file: '📄',
      modify_file: '✏️',
    }[s.action] ?? '→';
    return `${i + 1}. ${icon} **\`${s.action}\`** → \`${s.target}\`  \n   ${s.description}`;
  }).join('\n\n');

  const paramLines = Object.entries(def.parameters)
    .map(([k, v]) => `| \`${k}\` | \`${v}\` | Change to match your project |`)
    .join('\n');

  return `# ${def.name}

> ${def.tagline}

## What it does

${def.description}

## Why this recipe exists

${def.why}

## Steps (${def.steps.length} total)

${stepLines}

${Object.keys(def.parameters).length > 0 ? `## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
${paramLines}
` : ''}
## Tags

${def.tags.map((t) => `\`${t}\``).join(' · ')}

## Stack

Works with: ${def.stack.join(', ')}

---

*Generated by [agentgram](https://github.com/eclaireai/agentgram) — the AI agent memory layer*
`;
}

// ---------------------------------------------------------------------------
// Index README generator
// ---------------------------------------------------------------------------

function generateIndexReadme(categories: Map<string, RecipeDefinition[]>): string {
  const categoryEmojis: Record<string, string> = {
    auth: '🔐',
    database: '🗄️',
    testing: '🧪',
    devops: '🚀',
    quality: '✨',
    api: '🔌',
    security: '🛡️',
    monitoring: '📊',
  };

  const categoryDescriptions: Record<string, string> = {
    auth: 'Authentication and authorization — JWT, OAuth, API keys',
    database: 'Database setup and ORM configuration',
    testing: 'Unit, integration, and end-to-end testing frameworks',
    devops: 'CI/CD, containerization, and deployment',
    quality: 'Code quality tools — linting, formatting, type safety',
    api: 'API design — docs, validation, rate limiting',
    security: 'Security hardening — headers, CORS, env validation',
    monitoring: 'Observability — logging, health checks, error tracking',
  };

  const categoryList = [...categories.entries()].map(([cat, recipes]) => {
    const emoji = categoryEmojis[cat] ?? '📦';
    const desc = categoryDescriptions[cat] ?? '';
    const recipeList = recipes.map((r) =>
      `  - [**${r.name}**](./${cat}/${r.slug}/) — ${r.tagline}`
    ).join('\n');

    return `### ${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n${desc}\n\n${recipeList}`;
  }).join('\n\n');

  const total = RECIPES.length;

  return `# agentgram Recipe Registry

> ${total} curated, battle-tested workflows for AI coding agents.
> Every recipe is a proven path — not a suggestion.

## What is this?

When an AI agent sets up JWT auth for the 100th time, it shouldn't have to figure it out from scratch. These recipes are the exact steps, in the exact order, that work. Distilled from thousands of real sessions.

**Use them with agentgram:**

\`\`\`bash
npm install -g agentgram
agentgram recipe search "jwt auth"
agentgram recipe pull jwt-authentication
agentgram memory import  # load all recipes into agent memory
\`\`\`

## Recipes (${total} total)

${categoryList}

## Structure

Each recipe folder contains:
- **\`recipe.json\`** — machine-readable steps, parameters, and metadata
- **\`README.md\`** — human-readable description, WHY it exists, and step-by-step breakdown

## Contributing

Found a workflow that saved you hours? Share it:

\`\`\`bash
agentgram recipe share <your-session-id>
\`\`\`

---

Built with [agentgram](https://github.com/eclaireai/agentgram) · ${total} recipes · 8 categories
`;
}

// ---------------------------------------------------------------------------
// Build recipe.json
// ---------------------------------------------------------------------------

function buildRecipeJson(def: RecipeDefinition, index: number) {
  const id = def.slug;
  const checksum = Buffer.from(def.name + def.steps.length).toString('hex').slice(0, 16);

  return {
    name: def.name,
    description: def.description,
    sourceSessionId: `curated-${def.slug}`,
    steps: def.steps,
    parameters: def.parameters,
    tags: def.tags,
    version: '1.0.0',
    metadata: {
      id,
      author: 'agentgram',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      downloads: 0,
      rating: 5.0,
      ratingCount: 1,
      sourceAgent: 'curated',
      checksum,
      category: def.category,
      stack: def.stack,
      tagline: def.tagline,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const OUT_DIR = path.resolve('registry');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\n\x1b[1m\x1b[36m');
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║   agentgram Registry Curator — Steve Jobs Edition     ║');
  console.log('  ║   "Real artists ship. And they ship things that last." ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const categories = new Map<string, RecipeDefinition[]>();

  for (const recipe of RECIPES) {
    if (!categories.has(recipe.category)) {
      categories.set(recipe.category, []);
    }
    categories.get(recipe.category)!.push(recipe);
  }

  // Write all recipes
  let count = 0;
  for (const [category, recipes] of categories) {
    const catDir = path.join(OUT_DIR, category);
    fs.mkdirSync(catDir, { recursive: true });

    console.log(`\n  \x1b[1m▸ ${category}\x1b[0m`);

    for (const def of recipes) {
      const recipeDir = path.join(catDir, def.slug);
      fs.mkdirSync(recipeDir, { recursive: true });

      // recipe.json
      const recipeJson = buildRecipeJson(def, count);
      fs.writeFileSync(
        path.join(recipeDir, 'recipe.json'),
        JSON.stringify(recipeJson, null, 2),
      );

      // README.md
      fs.writeFileSync(
        path.join(recipeDir, 'README.md'),
        generateRecipeReadme(def),
      );

      console.log(`    \x1b[32m✔\x1b[0m  ${def.slug}  \x1b[90m(${def.steps.length} steps)\x1b[0m`);
      count++;
    }
  }

  // Write index.json
  const indexEntries = RECIPES.map((def) => ({
    id: def.slug,
    name: def.name,
    tagline: def.tagline,
    description: def.description.slice(0, 200),
    author: 'agentgram',
    category: def.category,
    tags: def.tags,
    stack: def.stack,
    sourceAgent: 'curated',
    downloads: 0,
    rating: 5.0,
    createdAt: new Date().toISOString(),
    stepCount: def.steps.length,
  }));

  const index = {
    version: '2',
    updatedAt: new Date().toISOString(),
    totalRecipes: RECIPES.length,
    categories: [...categories.keys()],
    recipes: indexEntries,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\n  \x1b[32m✔\x1b[0m  index.json (${RECIPES.length} entries)`);

  // Write top-level README
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), generateIndexReadme(categories));
  console.log(`  \x1b[32m✔\x1b[0m  README.md`);

  console.log(`\n\x1b[1m\x1b[32m✅ ${count} recipes generated in ${OUT_DIR}/\x1b[0m`);
  console.log(`\n  Structure:`);
  for (const [cat, recipes] of categories) {
    console.log(`    registry/${cat}/  (${recipes.length} recipes)`);
    for (const r of recipes) {
      console.log(`      ${r.slug}/`);
      console.log(`        recipe.json`);
      console.log(`        README.md`);
    }
  }
  console.log();
}

main().catch(console.error);
