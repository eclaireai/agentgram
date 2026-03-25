# agentgram Recipe Registry

> 26 curated, battle-tested workflows for AI coding agents.
> Every recipe is a proven path — not a suggestion.

## What is this?

When an AI agent sets up JWT auth for the 100th time, it shouldn't have to figure it out from scratch. These recipes are the exact steps, in the exact order, that work. Distilled from thousands of real sessions.

**Use them with agentgram:**

```bash
npm install -g agentgram
agentgram recipe search "jwt auth"
agentgram recipe pull jwt-authentication
agentgram memory import  # load all recipes into agent memory
```

## Recipes (26 total)

### 🔐 Auth
Authentication and authorization — JWT, OAuth, API keys

  - [**JWT Authentication**](./auth/jwt-authentication/) — Stateless auth with access + refresh tokens and bcrypt password hashing
  - [**NextAuth.js Setup**](./auth/nextauth-setup/) — Drop-in auth for Next.js: Google, GitHub, email/password, session management
  - [**API Key Authentication**](./auth/api-key-auth/) — Secure machine-to-machine auth with hashed keys, scopes, and rate limiting

### 🗄️ Database
Database setup and ORM configuration

  - [**Prisma + PostgreSQL**](./database/prisma-postgresql/) — Type-safe ORM with schema-first migrations, seed data, and connection pooling
  - [**Mongoose + MongoDB**](./database/mongoose-mongodb/) — Document database with schema validation, indexes, and connection management
  - [**Redis Caching Layer**](./database/redis-caching/) — Response caching with Redis — automatic invalidation, TTL, and cache-aside pattern
  - [**Drizzle ORM + SQLite**](./database/drizzle-sqlite/) — Lightweight SQL with Drizzle — perfect for edge functions, Cloudflare Workers, Bun

### 🧪 Testing
Unit, integration, and end-to-end testing frameworks

  - [**Vitest Testing Framework**](./testing/vitest-setup/) — Blazing fast unit tests with TypeScript, coverage, and watch mode
  - [**Jest Testing Framework**](./testing/jest-setup/) — Battle-tested unit testing with TypeScript, mocks, and Istanbul coverage
  - [**Playwright End-to-End Tests**](./testing/playwright-e2e/) — Cross-browser E2E testing with Playwright: Chrome, Firefox, Safari
  - [**Pytest Setup**](./testing/pytest-setup/) — Python testing with pytest, fixtures, coverage, and async support

### 🚀 Devops
CI/CD, containerization, and deployment

  - [**GitHub Actions CI**](./devops/github-actions-ci/) — Lint + test + build on every push, Node 18/20/22 matrix, cache npm deps
  - [**Docker + Docker Compose**](./devops/docker-compose/) — Containerize any Node.js app with multi-stage builds and compose for local dev
  - [**Vercel Deployment**](./devops/vercel-deployment/) — Zero-config deploy to Vercel with preview URLs, environment variables, and edge config

### ✨ Quality
Code quality tools — linting, formatting, type safety

  - [**ESLint + Prettier**](./quality/eslint-prettier/) — Consistent code style enforced at commit time — no more style debates in PRs
  - [**Husky + lint-staged**](./quality/husky-lint-staged/) — Pre-commit hooks: only lint and format files you actually changed
  - [**TypeScript Strict Mode**](./quality/typescript-strict/) — Enable strictest TypeScript settings and fix every resulting error

### 🔌 Api
API design — docs, validation, rate limiting

  - [**OpenAPI / Swagger Docs**](./api/openapi-swagger/) — Auto-generated, interactive API docs from your TypeScript types
  - [**API Rate Limiting**](./api/rate-limiting/) — Per-IP and per-user rate limiting with Redis-backed sliding window
  - [**Request Validation with Zod**](./api/zod-validation/) — Type-safe request parsing — runtime validation from your TypeScript types

### 🛡️ Security
Security hardening — headers, CORS, env validation

  - [**Security Headers with Helmet**](./security/helmet-security-headers/) — Add 15 security headers in one line — CSP, HSTS, XSS protection, and more
  - [**Environment Variable Validation**](./security/env-validation/) — Crash at startup if required env vars are missing — not at 2am in production
  - [**CORS Configuration**](./security/cors-config/) — Precise CORS setup that works in dev, staging, and production without wildcards

### 📊 Monitoring
Observability — logging, health checks, error tracking

  - [**Structured Logging with Pino**](./monitoring/structured-logging/) — JSON logs with request IDs, levels, and millisecond timestamps — ready for Datadog/CloudWatch
  - [**Health Check Endpoint**](./monitoring/health-check-endpoint/) — /health returns DB status, uptime, version — works with Kubernetes liveness probes
  - [**Sentry Error Tracking**](./monitoring/sentry-error-tracking/) — Catch every unhandled error in production with full stack traces and context

## Structure

Each recipe folder contains:
- **`recipe.json`** — machine-readable steps, parameters, and metadata
- **`README.md`** — human-readable description, WHY it exists, and step-by-step breakdown

## Contributing

Found a workflow that saved you hours? Share it:

```bash
agentgram recipe share <your-session-id>
```

---

Built with [agentgram](https://github.com/eclaireai/agentgram) · 26 recipes · 8 categories
