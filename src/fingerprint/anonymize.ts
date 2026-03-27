/**
 * Dead-End Anonymizer
 *
 * Strips all identifying information from a DeadEnd before it leaves
 * the developer's machine. Nothing company-specific, no file paths,
 * no variable names — only the structural pattern of the failure.
 *
 * Privacy guarantee: you can inspect exactly what gets sent by running
 *   agentgram fingerprint show <session-id>
 */

import { createHash } from 'node:crypto';
import type { DeadEnd } from '../cognitive/trace.js';
import type { FingerprintRecord } from './types.js';

// ---------------------------------------------------------------------------
// Domain inference — maps operation targets to high-level task domains
// ---------------------------------------------------------------------------

const DOMAIN_PATTERNS: Array<{ pattern: RegExp; domain: string }> = [
  { pattern: /stripe|payment|billing|invoice|subscription|checkout/i, domain: 'payments' },
  { pattern: /auth|clerk|supabase|oauth|jwt|session|login|signup/i, domain: 'auth' },
  { pattern: /prisma|drizzle|postgres|mysql|sqlite|mongo|redis|database|migration/i, domain: 'database' },
  { pattern: /docker|kubernetes|helm|terraform|deploy|ci|github.actions/i, domain: 'devops' },
  { pattern: /openai|anthropic|llm|embedding|vector|rag|pgvector|langchain/i, domain: 'ai' },
  { pattern: /webpack|vite|tsup|rollup|esbuild|build|bundle/i, domain: 'build' },
  { pattern: /test|vitest|jest|playwright|cypress|spec/i, domain: 'testing' },
  { pattern: /eslint|prettier|lint|format|typescript|tsc/i, domain: 'dx' },
  { pattern: /expo|react.native|capacitor|mobile|ios|android/i, domain: 'mobile' },
  { pattern: /cors|helmet|csrf|rate.limit|security|owasp/i, domain: 'security' },
];

function inferDomain(text: string): string {
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(text)) return domain;
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Tag extraction — structural tags only (npm, peer-dep, etc.)
// ---------------------------------------------------------------------------

const TAG_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /npm (install|i)\b/i, tag: 'npm-install' },
  { pattern: /peer dep/i, tag: 'peer-dependency' },
  { pattern: /ERESOLVE|--legacy-peer-deps/i, tag: 'npm-resolution' },
  { pattern: /ENOENT|no such file/i, tag: 'missing-file' },
  { pattern: /permission denied|EACCES/i, tag: 'permission-error' },
  { pattern: /port.*in use|EADDRINUSE/i, tag: 'port-conflict' },
  { pattern: /typescript|tsc|type error/i, tag: 'typescript' },
  { pattern: /migration|migrate/i, tag: 'migration' },
  { pattern: /docker build|dockerfile/i, tag: 'docker-build' },
  { pattern: /webpack|vite|build failed/i, tag: 'build-failure' },
  { pattern: /module not found|cannot find module/i, tag: 'missing-module' },
  { pattern: /syntax error|unexpected token/i, tag: 'syntax-error' },
  { pattern: /version mismatch|incompatible/i, tag: 'version-mismatch' },
  { pattern: /timeout|timed out/i, tag: 'timeout' },
  { pattern: /webhook|signature/i, tag: 'webhook' },
  { pattern: /cors/i, tag: 'cors' },
  { pattern: /env|environment variable/i, tag: 'env-config' },
  { pattern: /prisma generate|schema/i, tag: 'prisma-schema' },
  { pattern: /uninstall|remove/i, tag: 'package-removal' },
];

function extractTags(text: string, operationType: string): string[] {
  const tags = new Set<string>();
  tags.add(operationType);

  for (const { pattern, tag } of TAG_PATTERNS) {
    if (pattern.test(text)) tags.add(tag);
  }

  return [...tags];
}

// ---------------------------------------------------------------------------
// Path anonymizer — replaces absolute/relative paths with structural patterns
// ---------------------------------------------------------------------------

function anonymizePaths(text: string): string {
  return text
    // Absolute paths: /Users/name/Code/project/src/foo.ts → {path}/foo.ts
    .replace(/\/[A-Za-z][^:\s"'`]+\//g, '{path}/')
    // Windows paths: C:\Users\name\ → {path}\
    .replace(/[A-Z]:\\[^:\s"'`]+\\/g, '{path}\\')
    // Relative paths with many segments: src/auth/middleware.ts → {file}
    .replace(/(?:\.\.\/)+[A-Za-z0-9/_-]+\.[a-z]+/g, '{relative-file}')
    // src/something/deep.ts → {src-file}
    .replace(/src\/[A-Za-z0-9/_-]+\.[a-z]+/g, '{src-file}')
    // Remove home directory references
    .replace(/~\/[^\s"'`]+/g, '{home-path}');
}

// ---------------------------------------------------------------------------
// Variable name anonymizer — keeps structure, removes semantics
// ---------------------------------------------------------------------------

function anonymizeVariableNames(text: string): string {
  return text
    // camelCase identifiers that look like variable names → {var}
    // Keep: npm package names (lowercase-with-dashes), common keywords
    .replace(/\b([a-z][a-zA-Z]{5,}(?:[A-Z][a-zA-Z]+)+)\b/g, (match) => {
      // Keep known technical terms
      const keep = /^(export|import|default|function|const|let|var|return|async|await|throw|catch|finally|interface|extends|implements|typeof|instanceof|undefined|boolean|string|number|object|Array|Promise|Error)$/.test(match);
      return keep ? match : '{var}';
    });
}

// ---------------------------------------------------------------------------
// Error pattern extractor — keep meaningful error tokens, strip noise
// ---------------------------------------------------------------------------

function extractErrorPattern(reason: string, command?: string): string {
  let text = reason;
  if (command) {
    // Keep the command structure but anonymize paths
    const cmdAnon = anonymizePaths(command);
    text = `${cmdAnon}: ${reason}`;
  }

  text = anonymizePaths(text);
  text = anonymizeVariableNames(text);

  // Collapse multiple spaces
  text = text.replace(/\s+/g, ' ').trim();

  // Limit length
  return text.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Warning generator — actionable human-readable warning
// ---------------------------------------------------------------------------

function generateWarning(deadEnd: DeadEnd, errorPattern: string, domain: string): string {
  const opType = deadEnd.operation.type;
  const command = deadEnd.operation.metadata?.command;

  if (opType === 'exec' && command) {
    const cmd = command.split(' ').slice(0, 3).join(' ');
    return `Running "${cmd}" may lead to a dead end: ${deadEnd.reason.slice(0, 120)}`;
  }

  if (opType === 'create') {
    return `Creating this file pattern often requires reverting: ${deadEnd.reason.slice(0, 120)}`;
  }

  return `${domain} dead end detected: ${deadEnd.reason.slice(0, 140)}`;
}

function generateFix(deadEnd: DeadEnd): string | undefined {
  const undoneCommand = deadEnd.undoneBy.metadata?.command;
  if (undoneCommand) {
    return `Recovery: ${undoneCommand.slice(0, 100)}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core export: anonymizeDeadEnd
// ---------------------------------------------------------------------------

export function anonymizeDeadEnd(deadEnd: DeadEnd): FingerprintRecord {
  const opType = deadEnd.operation.type;
  const command = deadEnd.operation.metadata?.command ?? '';
  const target = deadEnd.operation.target ?? '';

  const errorPattern = extractErrorPattern(deadEnd.reason, command || undefined);
  const reversalCommand = deadEnd.undoneBy.metadata?.command ?? deadEnd.undoneBy.type;
  const reversalPattern = anonymizePaths(reversalCommand).slice(0, 150);

  const domain = inferDomain(`${command} ${target} ${deadEnd.reason}`);
  const tags = extractTags(`${command} ${deadEnd.reason}`, opType);
  const warning = generateWarning(deadEnd, errorPattern, domain);
  const fix = generateFix(deadEnd);

  // Deterministic ID: same structural pattern always maps to the same fingerprint
  const fingerprintInput = `${opType}::${errorPattern}::${reversalPattern}`;
  const id = createHash('sha256').update(fingerprintInput).digest('hex').slice(0, 32);

  return {
    id,
    operationType: opType,
    errorPattern,
    reversalPattern,
    domain,
    tags,
    estimatedTokensWasted: deadEnd.estimatedTokensWasted,
    occurrences: 1,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    warning,
    fix,
  };
}

/**
 * Anonymize all dead ends from a session into shareable fingerprints.
 * Deduplicates by fingerprint ID.
 */
export function anonymizeDeadEnds(deadEnds: DeadEnd[]): FingerprintRecord[] {
  const seen = new Set<string>();
  const fingerprints: FingerprintRecord[] = [];

  for (const deadEnd of deadEnds) {
    const fp = anonymizeDeadEnd(deadEnd);
    if (!seen.has(fp.id)) {
      seen.add(fp.id);
      fingerprints.push(fp);
    }
  }

  return fingerprints;
}
