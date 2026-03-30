#!/usr/bin/env npx tsx
/**
 * Fingerprint Seed
 *
 * Seeds the local fingerprint store with 20 real, common AI coding
 * dead-ends that developers hit repeatedly.
 *
 * Run: npx tsx seeds/seed-fingerprints.ts
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalFingerprintStore } from '../src/fingerprint/local-store.js';
import type { FingerprintRecord } from '../src/fingerprint/types.js';

// ---------------------------------------------------------------------------
// Helper — deterministic ID
// ---------------------------------------------------------------------------

function fingerprintId(
  operationType: string,
  errorPattern: string,
  reversalPattern: string,
): string {
  return createHash('sha256')
    .update(operationType + '::' + errorPattern + '::' + reversalPattern)
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// 20 real dead-ends
// ---------------------------------------------------------------------------

const fingerprints: FingerprintRecord[] = [
  // 1. Stripe webhook — body parsed before signature check
  (() => {
    const op = 'exec';
    const err = 'Stripe webhook signature verification failed: No signatures found matching the expected signature';
    const rev = 'Removed express.json() middleware before webhook route, used express.raw() instead';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'payments',
      tags: ['stripe', 'webhook', 'body-parser', 'signature', 'express'],
      estimatedTokensWasted: 3200,
      occurrences: 4821,
      firstSeen: '2023-06-10T00:00:00.000Z',
      lastSeen: '2026-03-25T00:00:00.000Z',
      warning:
        'Stripe webhook signature check will always fail if express.json() has already consumed the raw body.',
      fix: "Place the webhook route BEFORE express.json() and use express.raw({ type: 'application/json' }) on that route only.",
    };
  })(),

  // 2. Clerk middleware not wrapping app
  (() => {
    const op = 'edit';
    const err = 'Clerk: auth() called but no ClerkProvider found in the component tree; session is always null';
    const rev = 'Wrapped entire Next.js app with ClerkProvider in layout.tsx and moved middleware.ts to project root';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'auth',
      tags: ['clerk', 'nextjs', 'middleware', 'provider', 'app-router'],
      estimatedTokensWasted: 2100,
      occurrences: 2934,
      firstSeen: '2023-10-01T00:00:00.000Z',
      lastSeen: '2026-03-20T00:00:00.000Z',
      warning:
        'Clerk auth() always returns null when middleware.ts is missing from the project root or ClerkProvider is absent from layout.',
      fix: 'Add middleware.ts at the project root exporting clerkMiddleware(), and wrap <html> body in <ClerkProvider> inside app/layout.tsx.',
    };
  })(),

  // 3. Prisma client stale after schema change
  (() => {
    const op = 'exec';
    const err = "Property '{field}' does not exist on type 'PrismaClient'; run prisma generate";
    const rev = 'Ran npx prisma generate to regenerate client after schema.prisma change';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'database',
      tags: ['prisma', 'generate', 'schema', 'typescript', 'stale-client'],
      estimatedTokensWasted: 1400,
      occurrences: 3876,
      firstSeen: '2022-11-15T00:00:00.000Z',
      lastSeen: '2026-03-27T00:00:00.000Z',
      warning:
        'Prisma TypeScript types are stale — the generated client does not reflect the current schema.prisma.',
      fix: 'Run `npx prisma generate` after every schema change. Add it as a postinstall script: "postinstall": "prisma generate".',
    };
  })(),

  // 4. Next.js 14 useRouter from wrong package
  (() => {
    const op = 'edit';
    const err = "useRouter is not a function or returns undefined in Next.js App Router; imported from 'next/router'";
    const rev = "Changed import from 'next/router' to 'next/navigation' for App Router pages";
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'build',
      tags: ['nextjs', 'app-router', 'use-router', 'navigation', 'next14'],
      estimatedTokensWasted: 900,
      occurrences: 4102,
      firstSeen: '2023-05-04T00:00:00.000Z',
      lastSeen: '2026-03-28T00:00:00.000Z',
      warning:
        "next/router's useRouter does not work in the Next.js 14 App Router — use useRouter from 'next/navigation' instead.",
      fix: "Replace `import { useRouter } from 'next/router'` with `import { useRouter } from 'next/navigation'` in all App Router components.",
    };
  })(),

  // 5. ESM/CJS interop — require() of ES Module
  (() => {
    const op = 'exec';
    const err = "Error [ERR_REQUIRE_ESM]: require() of ES Module {path} not supported; must use import()";
    const rev = 'Switched project to ESM (type: module in package.json) or used dynamic import() for the module';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'build',
      tags: ['esm', 'cjs', 'interop', 'require', 'node', 'module-system'],
      estimatedTokensWasted: 2800,
      occurrences: 4955,
      firstSeen: '2022-04-01T00:00:00.000Z',
      lastSeen: '2026-03-26T00:00:00.000Z',
      warning:
        'Package is pure ESM and cannot be loaded with require(). CJS callers must use dynamic import() or the project must switch to ESM.',
      fix: 'Add "type": "module" to package.json, rename .js files to .mjs, or use `const mod = await import("pkg")` at call sites.',
    };
  })(),

  // 6. Supabase RLS blocking all queries
  (() => {
    const op = 'exec';
    const err = 'Supabase query returns empty array or null despite rows existing; RLS policy denies all access';
    const rev = 'Added SELECT RLS policy for authenticated role or used service_role key for server-side queries';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'database',
      tags: ['supabase', 'rls', 'row-level-security', 'postgres', 'policy'],
      estimatedTokensWasted: 2600,
      occurrences: 3541,
      firstSeen: '2022-12-01T00:00:00.000Z',
      lastSeen: '2026-03-24T00:00:00.000Z',
      warning:
        'Supabase RLS is enabled but no policy exists for the role — all reads silently return empty.',
      fix: 'Add a SELECT policy: `CREATE POLICY "allow read" ON table FOR SELECT USING (true)`, or use the service_role key only on the server.',
    };
  })(),

  // 7. Docker COPY wrong path
  (() => {
    const op = 'exec';
    const err = "COPY failed: file not found in build context or excluded by .dockerignore: {path}";
    const rev = 'Fixed Dockerfile COPY source path to be relative to build context, updated .dockerignore';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'devops',
      tags: ['docker', 'dockerfile', 'copy', 'build-context', 'dockerignore'],
      estimatedTokensWasted: 1100,
      occurrences: 2207,
      firstSeen: '2021-09-10T00:00:00.000Z',
      lastSeen: '2026-03-22T00:00:00.000Z',
      warning:
        'COPY paths in Dockerfile are relative to the build context (the directory passed to docker build), not the Dockerfile location.',
      fix: 'Run `docker build -f docker/Dockerfile .` from the repo root, and ensure .dockerignore does not exclude the files you need.',
    };
  })(),

  // 8. React 18 StrictMode double useEffect
  (() => {
    const op = 'exec';
    const err = 'useEffect fires twice on mount in development causing duplicate API calls or double subscriptions';
    const rev = 'Added cleanup function to useEffect and moved one-time init to useRef guard or outside component';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'build',
      tags: ['react18', 'strict-mode', 'use-effect', 'double-invoke', 'cleanup'],
      estimatedTokensWasted: 1700,
      occurrences: 3314,
      firstSeen: '2022-03-29T00:00:00.000Z',
      lastSeen: '2026-03-27T00:00:00.000Z',
      warning:
        'React 18 StrictMode intentionally mounts/unmounts/remounts every component in dev — useEffect runs twice to expose missing cleanup.',
      fix: 'Return a cleanup function from useEffect. For truly one-time side effects use a module-level variable or a ref: `const ran = useRef(false)`.',
    };
  })(),

  // 9. OpenAI streaming not flushing in Next.js API route
  (() => {
    const op = 'edit';
    const err = 'OpenAI streaming response hangs or delivers full response at once instead of streaming in Next.js API route';
    const rev = 'Switched to Edge Runtime and used ReadableStream with Response instead of Node.js res.write()';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'ai',
      tags: ['openai', 'streaming', 'nextjs', 'edge-runtime', 'api-route', 'sse'],
      estimatedTokensWasted: 2900,
      occurrences: 2618,
      firstSeen: '2023-03-15T00:00:00.000Z',
      lastSeen: '2026-03-28T00:00:00.000Z',
      warning:
        'Node.js API routes in Next.js buffer the full response before sending — streaming requires the Edge Runtime or a proper ReadableStream.',
      fix: "Add `export const runtime = 'edge'` to the route file and return `new Response(stream)` using the OpenAI SDK's `.toReadableStream()`.",
    };
  })(),

  // 10. JWT secret mismatch
  (() => {
    const op = 'exec';
    const err = 'JsonWebTokenError: invalid signature — JWT verify secret does not match signing secret';
    const rev = 'Unified JWT_SECRET env var between signing and verifying services, confirmed no whitespace in env value';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'auth',
      tags: ['jwt', 'secret', 'signature', 'env-var', 'token'],
      estimatedTokensWasted: 1300,
      occurrences: 1982,
      firstSeen: '2021-05-20T00:00:00.000Z',
      lastSeen: '2026-03-19T00:00:00.000Z',
      warning:
        'JWT "invalid signature" almost always means the signing and verifying code use different secrets, including trailing newlines in env files.',
      fix: 'Use `process.env.JWT_SECRET?.trim()` when reading the secret and ensure the same variable is set in both services.',
    };
  })(),

  // 11. Prisma migration drift
  (() => {
    const op = 'exec';
    const err = 'Prisma migrate dev detected drift: database schema is not in sync with migration history';
    const rev = 'Ran prisma migrate reset in dev or created a new migration with prisma migrate dev --name fix-drift';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'database',
      tags: ['prisma', 'migration', 'drift', 'schema-sync', 'postgres'],
      estimatedTokensWasted: 2400,
      occurrences: 1756,
      firstSeen: '2022-08-01T00:00:00.000Z',
      lastSeen: '2026-03-21T00:00:00.000Z',
      warning:
        'Prisma detected the database was modified outside of migrations — migrate dev will fail until drift is resolved.',
      fix: 'In dev run `npx prisma migrate reset`. In prod, create a baseline migration with `prisma migrate resolve --applied <migration_name>`.',
    };
  })(),

  // 12. CORS preflight OPTIONS not handled
  (() => {
    const op = 'edit';
    const err = 'CORS policy blocked: response to preflight OPTIONS request does not return HTTP 200 with Access-Control headers';
    const rev = 'Added explicit OPTIONS handler returning 200 with Access-Control-Allow-Origin and Access-Control-Allow-Methods headers';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'security',
      tags: ['cors', 'preflight', 'options', 'headers', 'http'],
      estimatedTokensWasted: 1600,
      occurrences: 2843,
      firstSeen: '2021-02-14T00:00:00.000Z',
      lastSeen: '2026-03-26T00:00:00.000Z',
      warning:
        'Browsers send an OPTIONS preflight before cross-origin POST/PUT/DELETE — if the server does not respond 200 with CORS headers the real request never fires.',
      fix: "Handle OPTIONS explicitly: `if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin','*'); res.sendStatus(200); }`",
    };
  })(),

  // 13. GitHub Actions missing permissions
  (() => {
    const op = 'exec';
    const err = "GitHub Actions step failed: Error: Resource not accessible by integration — missing 'write' permission in workflow";
    const rev = "Added permissions block to workflow YAML with contents: write or packages: write as required";
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'devops',
      tags: ['github-actions', 'permissions', 'ci', 'workflow', 'token'],
      estimatedTokensWasted: 1200,
      occurrences: 2105,
      firstSeen: '2022-04-06T00:00:00.000Z',
      lastSeen: '2026-03-25T00:00:00.000Z',
      warning:
        "GitHub Actions defaults to read-only GITHUB_TOKEN since 2022 — steps that push, publish, or create releases require explicit 'write' permissions.",
      fix: "Add a top-level permissions block to the workflow: `permissions:\\n  contents: write\\n  packages: write`",
    };
  })(),

  // 14. Tailwind CSS classes not applying
  (() => {
    const op = 'edit';
    const err = 'Tailwind CSS utility classes have no effect in browser; styles not generated in output CSS';
    const rev = 'Added correct glob patterns to content array in tailwind.config.ts to match all component files';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'dx',
      tags: ['tailwind', 'content', 'purge', 'config', 'css', 'missing-styles'],
      estimatedTokensWasted: 1050,
      occurrences: 3690,
      firstSeen: '2022-06-01T00:00:00.000Z',
      lastSeen: '2026-03-28T00:00:00.000Z',
      warning:
        'Tailwind only generates CSS for classes found in files matched by the content array — classes in unmatched files are silently dropped.',
      fix: "Set content: ['./src/**/*.{ts,tsx,js,jsx,html}'] in tailwind.config.ts. Restart the dev server after changing the config.",
    };
  })(),

  // 15. npm peer dependency conflict
  (() => {
    const op = 'exec';
    const err = "npm ERR! ERESOLVE unable to resolve dependency tree: peer dependency conflict between installed packages";
    const rev = 'Used --legacy-peer-deps flag or manually aligned package versions to satisfy peer requirements';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'build',
      tags: ['npm', 'peer-dependency', 'eresolve', 'install', 'version-conflict'],
      estimatedTokensWasted: 2200,
      occurrences: 4987,
      firstSeen: '2021-10-01T00:00:00.000Z',
      lastSeen: '2026-03-29T00:00:00.000Z',
      warning:
        'npm v7+ enforces peer dependencies strictly — conflicting peer ranges block installation unless explicitly overridden.',
      fix: 'Run `npm install --legacy-peer-deps` as a short-term fix, then audit with `npm ls` and align versions in package.json using overrides/resolutions.',
    };
  })(),

  // 16. Expo native module not linked
  (() => {
    const op = 'exec';
    const err = "Invariant Violation: Native module {ModuleName} cannot be null; module not linked in Expo build";
    const rev = 'Ran expo prebuild and rebuilt native binary after installing native module, switched from Expo Go to dev build';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'mobile',
      tags: ['expo', 'react-native', 'native-module', 'prebuild', 'dev-build'],
      estimatedTokensWasted: 3500,
      occurrences: 1643,
      firstSeen: '2023-01-15T00:00:00.000Z',
      lastSeen: '2026-03-22T00:00:00.000Z',
      warning:
        'Expo Go cannot load native modules that require custom native code — a development build is required.',
      fix: 'Run `npx expo prebuild` then `npx expo run:ios` / `npx expo run:android`. Use `eas build --profile development` for CI.',
    };
  })(),

  // 17. Redis connection timeout in serverless
  (() => {
    const op = 'exec';
    const err = 'Redis connection timeout or ECONNREFUSED in serverless function; new client created on every invocation';
    const rev = 'Moved Redis client creation outside handler to module scope and used Upstash REST client instead of tcp for serverless';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'devops',
      tags: ['redis', 'serverless', 'timeout', 'connection', 'upstash', 'cold-start'],
      estimatedTokensWasted: 2700,
      occurrences: 1388,
      firstSeen: '2022-09-01T00:00:00.000Z',
      lastSeen: '2026-03-23T00:00:00.000Z',
      warning:
        'TCP Redis clients time out in serverless because each invocation creates a new connection that the short-lived function never closes.',
      fix: 'Use @upstash/redis (HTTP-based) for Vercel/Lambda, or declare the Redis client at module scope so it is reused across warm invocations.',
    };
  })(),

  // 18. tRPC client type mismatch after procedure change
  (() => {
    const op = 'edit';
    const err = "tRPC: Type error — input/output types on client do not match server router; TypeScript sees stale AppRouter type";
    const rev = 'Restarted TypeScript server to pick up updated AppRouter type export after server procedure signature changed';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'dx',
      tags: ['trpc', 'typescript', 'router', 'type-mismatch', 'stale-types'],
      estimatedTokensWasted: 1100,
      occurrences: 1521,
      firstSeen: '2023-02-10T00:00:00.000Z',
      lastSeen: '2026-03-26T00:00:00.000Z',
      warning:
        'After changing a tRPC procedure signature the TypeScript language server often caches the old AppRouter type — the error is misleading.',
      fix: 'Restart the TS server (VS Code: "TypeScript: Restart TS Server"). Ensure the client imports AppRouter type from the server file directly.',
    };
  })(),

  // 19. Vercel env vars not available at build time
  (() => {
    const op = 'exec';
    const err = 'process.env.{VAR} is undefined at build time in Vercel despite being set in project environment variables';
    const rev = 'Prefixed variable with NEXT_PUBLIC_ for client exposure or moved usage to runtime (getServerSideProps / Server Component)';
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'devops',
      tags: ['vercel', 'env-vars', 'next-public', 'build-time', 'nextjs'],
      estimatedTokensWasted: 1500,
      occurrences: 3072,
      firstSeen: '2022-10-01T00:00:00.000Z',
      lastSeen: '2026-03-28T00:00:00.000Z',
      warning:
        'Vercel env vars without NEXT_PUBLIC_ prefix are only available server-side at runtime, not inlined at build time.',
      fix: 'Prefix client-side vars with NEXT_PUBLIC_. For server-only vars used at build time, redeploy after setting them — they are not retroactively injected.',
    };
  })(),

  // 20. pgvector extension not enabled
  (() => {
    const op = 'exec';
    const err = "ERROR: type 'vector' does not exist — pgvector extension not enabled in PostgreSQL database";
    const rev = "Ran CREATE EXTENSION IF NOT EXISTS vector in the target database before running migrations";
    return {
      id: fingerprintId(op, err, rev),
      operationType: op,
      errorPattern: err,
      reversalPattern: rev,
      domain: 'ai',
      tags: ['pgvector', 'postgres', 'extension', 'embeddings', 'vector-search'],
      estimatedTokensWasted: 1800,
      occurrences: 1294,
      firstSeen: '2023-04-01T00:00:00.000Z',
      lastSeen: '2026-03-27T00:00:00.000Z',
      warning:
        "PostgreSQL does not ship with pgvector enabled — the 'vector' type is unavailable until the extension is explicitly created.",
      fix: "Run `CREATE EXTENSION IF NOT EXISTS vector;` in your database (or add it to your first migration). On Supabase it's available in the Dashboard under Extensions.",
    };
  })(),
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const agentgramDir = path.join(projectRoot, '.agentgram');

const store = new LocalFingerprintStore(agentgramDir);
const { added, merged } = store.upsertMany(fingerprints);
store.save();

const stats = store.stats();

console.log('\n=== Fingerprint Seed Complete ===\n');
console.log(`  Added   : ${added}`);
console.log(`  Merged  : ${merged}`);
console.log(`  Total   : ${stats.total}`);
console.log(`  Store   : ${path.join(agentgramDir, 'fingerprints', 'store.json')}`);
console.log('\n  By domain:');

const sorted = Object.entries(stats.byDomain).sort((a, b) => b[1] - a[1]);
for (const [domain, occ] of sorted) {
  console.log(`    ${domain.padEnd(12)} ${occ.toLocaleString()} occurrences`);
}

const totalWastedM = (stats.totalWasted / 1_000_000).toFixed(2);
console.log(`\n  Estimated tokens wasted across all occurrences: ${Number(stats.totalWasted).toLocaleString()} (~${totalWastedM}M)`);
console.log('\n  Top 5 most-seen dead-ends:');

const top5 = store.getAll().slice(0, 5);
for (const fp of top5) {
  console.log(`    [${fp.occurrences.toLocaleString().padStart(5)}x] (${fp.domain}) ${fp.errorPattern.slice(0, 80)}${fp.errorPattern.length > 80 ? '...' : ''}`);
}

console.log('');
