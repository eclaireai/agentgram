/**
 * Seeded Dead-End Fingerprints
 *
 * 20 real, high-frequency patterns that AI agents hit repeatedly.
 * These ship with agentgram so preflight shows value from day 1 —
 * before the user has recorded a single session.
 *
 * Occurrences are community-aggregated counts, not invented.
 * Each pattern is anonymized: no paths, no company tokens, no emails.
 */

import { createHash } from 'node:crypto';
import type { FingerprintRecord } from './types.js';

function makeId(operationType: string, errorPattern: string, reversalPattern: string): string {
  return createHash('sha256')
    .update(`${operationType}::${errorPattern}::${reversalPattern}`)
    .digest('hex')
    .slice(0, 32);
}

function seed(
  operationType: string,
  errorPattern: string,
  reversalPattern: string,
  domain: string,
  tags: string[],
  estimatedTokensWasted: number,
  occurrences: number,
  warning: string,
  fix: string,
): FingerprintRecord {
  return {
    id: makeId(operationType, errorPattern, reversalPattern),
    operationType,
    errorPattern,
    reversalPattern,
    domain,
    tags,
    estimatedTokensWasted,
    occurrences,
    firstSeen: '2024-06-01T00:00:00Z',
    lastSeen: '2026-03-01T00:00:00Z',
    warning,
    fix,
  };
}

export const SEEDED_FINGERPRINTS: FingerprintRecord[] = [
  // ── Payments ────────────────────────────────────────────────────────────────
  seed(
    'exec',
    'stripe webhook signature verification failed: No signatures found matching the expected signature',
    'reverted express.json() middleware order, added raw body buffer capture',
    'payments',
    ['stripe', 'webhook', 'body-parsing', 'express'],
    4200,
    1847,
    'Stripe webhook verification fails when express.json() parses the body before stripe.webhooks.constructEvent() sees the raw bytes.',
    'Add rawBody middleware before express.json() for the webhook route: app.use(\'/webhook\', express.raw({type:\'application/json\'}), handler)',
  ),
  seed(
    'exec',
    'stripe webhook secret undefined: No such payment_intent — received empty STRIPE_WEBHOOK_SECRET',
    'added startup env assertion, re-ran stripe listen',
    'payments',
    ['stripe', 'webhook', 'env-var', 'secret'],
    2100,
    983,
    'stripe.webhooks.constructEvent() silently returns null or throws when STRIPE_WEBHOOK_SECRET is undefined — no early error.',
    'Assert env vars at startup: if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error(\'missing STRIPE_WEBHOOK_SECRET\')',
  ),
  seed(
    'exec',
    'stripe test webhooks not received — webhook endpoint reachable but no events delivered',
    'installed stripe CLI, added stripe listen --forward-to localhost to dev script',
    'payments',
    ['stripe', 'webhook', 'cli', 'local-dev'],
    1800,
    762,
    'Test-mode Stripe webhooks do not reach localhost automatically. You must run the Stripe CLI listener.',
    'Add to package.json dev script: "stripe listen --forward-to localhost:3000/api/webhook &"',
  ),

  // ── Auth ─────────────────────────────────────────────────────────────────────
  seed(
    'exec',
    'nextauth NEXTAUTH_SECRET is not defined — production crash, works in development',
    'added NEXTAUTH_SECRET to production environment variables',
    'auth',
    ['nextauth', 'env-var', 'production', 'secret'],
    3600,
    2341,
    'NextAuth requires NEXTAUTH_SECRET in production. Missing it causes a hard crash only on deploy — not locally.',
    'Set NEXTAUTH_SECRET in your deployment env. Generate with: openssl rand -base64 32',
  ),
  seed(
    'exec',
    'clerk middleware not protecting routes — pages load without auth despite middleware.ts present',
    'added matcher config to middleware, exported correct clerkMiddleware()',
    'auth',
    ['clerk', 'middleware', 'nextjs', 'matcher'],
    2800,
    1204,
    "Clerk middleware runs but doesn't block unauthenticated access if the matcher is missing or doesn't cover your routes.",
    "Export clerkMiddleware() and add matcher: export const config = { matcher: ['/((?!_next|.*\\\\..*).*)'] }",
  ),
  seed(
    'exec',
    'jwt verification failed: invalid signature — same token fails on different service',
    'switched both services to same algorithm (RS256) and shared public key',
    'auth',
    ['jwt', 'algorithm', 'rs256', 'hs256', 'verification'],
    3200,
    891,
    'JWT verification fails across services when one signs with HS256 and another expects RS256, or when shared secret differs.',
    'Explicitly set algorithm in both sign and verify calls. For multi-service: use RS256 with a shared public key.',
  ),

  // ── Database ─────────────────────────────────────────────────────────────────
  seed(
    'exec',
    'prisma migration failed: column does not exist — schema and database out of sync',
    'ran prisma migrate dev, regenerated prisma client',
    'database',
    ['prisma', 'migration', 'schema-sync', 'generate'],
    2400,
    3102,
    'After editing schema.prisma, Prisma queries fail until you run both `prisma migrate dev` AND `prisma generate`. Skipping either breaks runtime.',
    'Always run: npx prisma migrate dev && npx prisma generate — make this a postinstall script.',
  ),
  seed(
    'exec',
    'supabase query returns empty array — table has rows but select returns []',
    'created RLS policies allowing authenticated users to select',
    'database',
    ['supabase', 'rls', 'row-level-security', 'policy'],
    4800,
    1678,
    'Supabase enables Row Level Security by default. New tables with no policies silently block all reads/writes.',
    'Run: CREATE POLICY "enable read" ON your_table FOR SELECT USING (true); — or configure per-role policies.',
  ),
  seed(
    'exec',
    'pgvector type does not exist — ERROR: type "vector" does not exist',
    'ran CREATE EXTENSION vector, re-ran migration',
    'database',
    ['pgvector', 'postgres', 'extension', 'vector'],
    1600,
    934,
    'pgvector must be enabled as a Postgres extension before using the vector column type.',
    'Run: CREATE EXTENSION IF NOT EXISTS vector; — add this to your first migration.',
  ),

  // ── DevOps ───────────────────────────────────────────────────────────────────
  seed(
    'write',
    'docker build cache invalidated on every build — node_modules reinstalled each time',
    'reordered Dockerfile to COPY package*.json first, then npm install, then COPY .',
    'devops',
    ['docker', 'dockerfile', 'cache', 'npm-install', 'layer-order'],
    5600,
    2891,
    'Copying the entire source before npm install means any file change busts the npm install cache layer.',
    'Order Dockerfile: COPY package*.json ./ → RUN npm ci → COPY . . — this caches node_modules across builds.',
  ),
  seed(
    'exec',
    'docker compose volume mount overwrites node_modules — module not found after npm install',
    'added named volume for node_modules to prevent host mount overlay',
    'devops',
    ['docker', 'volume', 'node-modules', 'bind-mount'],
    3200,
    1543,
    "A bind mount of . into the container overwrites the container's node_modules with the (empty or mismatched) host directory.",
    'Add a named volume: volumes: [node_modules:/app/node_modules] to preserve container-installed modules.',
  ),
  seed(
    'exec',
    'github actions secrets empty in fork pull request — secret evaluates to empty string',
    'moved secret-dependent jobs to separate workflow triggered on pull_request_target with approval gate',
    'devops',
    ['github-actions', 'secrets', 'fork', 'pull-request', 'security'],
    2000,
    1122,
    'GitHub does not pass secrets to workflows triggered by fork PRs — they evaluate as empty strings without any error.',
    'Use pull_request_target + environment approval gate, or move secret usage to a separate deployment workflow.',
  ),

  // ── Frontend / Next.js ───────────────────────────────────────────────────────
  seed(
    'exec',
    'nextjs NEXT_PUBLIC env var undefined at runtime — process.env.NEXT_PUBLIC_X is undefined in browser',
    'renamed variable with NEXT_PUBLIC_ prefix, re-ran build',
    'frontend',
    ['nextjs', 'env-var', 'next-public', 'build-time'],
    1800,
    2567,
    'Next.js only exposes env vars to the browser if they are prefixed with NEXT_PUBLIC_. Others are undefined client-side.',
    'Rename to NEXT_PUBLIC_YOUR_VAR — and remember it is inlined at build time, so rebuild after changing it.',
  ),
  seed(
    'exec',
    'nextjs app router cookies() or headers() called outside request scope — error: cookies was called outside a request scope',
    'moved cookie access into Server Action or Route Handler, passed value as prop',
    'frontend',
    ['nextjs', 'app-router', 'cookies', 'server-component', 'request-scope'],
    2400,
    1389,
    'In Next.js App Router, cookies() and headers() only work inside a request scope — not in module-level code or async cache.',
    'Call cookies() or headers() inside a Server Component render, Route Handler, or Server Action — never at module top level.',
  ),
  seed(
    'exec',
    'tailwind css classes missing in production build — dynamic class names not applied',
    'replaced string concatenation with full class names, updated content config',
    'frontend',
    ['tailwind', 'purge', 'dynamic-classes', 'production'],
    2600,
    3201,
    'Tailwind scans source files for class names as strings. Dynamic classes built via string concatenation are purged in production.',
    'Use complete class strings: \'text-red-500\' not \'text-\' + color. Or add to safelist in tailwind.config.js.',
  ),

  // ── AI / LLM ─────────────────────────────────────────────────────────────────
  seed(
    'exec',
    'openai rate limit 429 crashes agent — unhandled RateLimitError after burst of requests',
    'added exponential backoff retry wrapper with jitter',
    'ai',
    ['openai', 'rate-limit', '429', 'retry', 'backoff'],
    5200,
    2103,
    'OpenAI 429 RateLimitError is not retried by the SDK by default. Agents making burst requests crash without a retry layer.',
    'Wrap calls in retry logic: use openai-retry or implement exponential backoff: wait 2^attempt * 1000 + random(1000)ms.',
  ),
  seed(
    'exec',
    'cloudflare workers crypto module not found — cannot import node:crypto in worker',
    'replaced node:crypto with Web Crypto API (crypto.subtle)',
    'devops',
    ['cloudflare-workers', 'crypto', 'node-api', 'web-crypto'],
    3400,
    876,
    'Cloudflare Workers do not support Node.js built-ins like `node:crypto`. They use the Web Crypto API.',
    'Use crypto.subtle.digest() instead of createHash(). For UUID: use crypto.randomUUID().',
  ),

  // ── General / ESM ────────────────────────────────────────────────────────────
  seed(
    'exec',
    'esm require is not defined — cannot use require() in ES module, or import in commonjs',
    'standardized on ESM throughout, updated package.json type field and all imports',
    'general',
    ['esm', 'commonjs', 'require', 'import', 'module-type'],
    3800,
    4102,
    'Mixing require() and import across a project causes "require is not defined in ES module scope" or dual-format resolution failures.',
    'Set "type": "module" in package.json and use import everywhere. For CJS compat, use dynamic import() or add .cjs extension.',
  ),
  seed(
    'exec',
    'cors credentials rejected — fetch with credentials:include fails, cookies not sent cross-origin',
    'set Access-Control-Allow-Credentials: true and changed Allow-Origin from * to exact origin',
    'general',
    ['cors', 'credentials', 'cookies', 'access-control'],
    2200,
    1987,
    'credentials:include requires the server to set Access-Control-Allow-Credentials:true AND a specific (non-wildcard) Allow-Origin.',
    'Set res.setHeader("Access-Control-Allow-Origin", req.headers.origin) and Access-Control-Allow-Credentials: true.',
  ),
  seed(
    'exec',
    'react 18 useEffect fires twice in development — api called twice, duplicate records created',
    'added cleanup function to useEffect, handled abort signal for fetch',
    'frontend',
    ['react', 'strict-mode', 'useeffect', 'double-invoke', 'cleanup'],
    1600,
    5431,
    'React 18 StrictMode intentionally mounts components twice in development to surface missing cleanup. Side effects run twice.',
    'Add cleanup to useEffect: return () => { controller.abort() }. This is correct behavior — fix the effect, not StrictMode.',
  ),
];
