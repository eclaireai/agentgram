/**
 * Premium recipe economy layer.
 *
 * Provides:
 *  - PremiumRecipeMetadata — pricing, creator identity, drift tracking
 *  - detectRecipeDrift    — compare recipe's install steps against local package.json
 *  - formatEarningsReport — markdown earnings summary for a creator
 *  - formatMarketplaceListing — full marketplace card for a recipe
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SharedRecipe } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended metadata for a recipe sold in the agentgram marketplace */
export interface PremiumRecipeMetadata {
  id: string;
  name: string;
  /** Price in USD cents. 0 means free tier. */
  price: number;
  /** Creator handle, e.g. "@naresh" */
  creatorHandle: string;
  /** Ed25519 key ID — proves recipe authenticity */
  creatorKeyId: string;
  downloads: number;
  totalEarningsUsd: number;
  /** 0–5 star average */
  rating: number;
  ratingCount: number;
  /** Manually verified by the agentgram team */
  verifiedWorking: boolean;
  /** Package versions the recipe was verified against, e.g. ["next@15.1", "stripe@17.2"] */
  testedWith: string[];
  /** ISO date string of last verification run */
  lastTestedAt: string;
  /** Auto-detected version conflicts found at listing time */
  driftWarnings: string[];
}

export interface DriftWarning {
  package: string;
  /** Version string found in the recipe's install steps */
  recipeVersion: string;
  /** Version string found in the local package.json */
  installedVersion: string;
  severity: 'breaking' | 'minor' | 'patch';
  message: string;
}

export interface DriftReport {
  hasDrift: boolean;
  warnings: DriftWarning[];
  /** Versions the recipe was verified against (pass-through from testedWith) */
  testedWith: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a version string like "^1.2.3", "~15.1.0", ">=4.0.0", "4.1", "4"
 * and return { major, minor, patch } as numbers (missing parts default to 0).
 */
function parseVersion(raw: string): { major: number; minor: number; patch: number } | null {
  // Strip leading range operators / whitespace
  const cleaned = raw.replace(/^[\^~>=<\s]+/, '').trim();
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1] ?? '0', 10),
    minor: parseInt(match[2] ?? '0', 10),
    patch: parseInt(match[3] ?? '0', 10),
  };
}

function compareSemver(
  recipeRaw: string,
  installedRaw: string,
): 'breaking' | 'minor' | 'patch' | 'ok' {
  const rv = parseVersion(recipeRaw);
  const iv = parseVersion(installedRaw);
  if (!rv || !iv) return 'ok';

  if (rv.major !== iv.major) return 'breaking';
  if (rv.minor !== iv.minor) return 'minor';
  if (rv.patch !== iv.patch) return 'patch';
  return 'ok';
}

/**
 * Extract { packageName -> versionString } pairs from recipe steps that have
 * action === 'install' or action === 'add_dependency'.
 *
 * The step target is expected to hold space-separated tokens like:
 *   "stripe @stripe/stripe-js@4.1"       (inline @version notation)
 *   "next@15.1 react react-dom"
 *   "stripe"
 *
 * We also inspect the step description for package@version tokens as a
 * fallback so that loosely formatted recipes are still covered.
 */
function extractRecipePackages(recipe: SharedRecipe): Map<string, string> {
  const pkgs = new Map<string, string>();

  const TOKEN_RE = /(@?[a-zA-Z0-9_\-./]+)@([\d^~>=<.]+[\d])/g;

  for (const step of recipe.steps) {
    if ((step.action as string) !== 'install' && (step.action as string) !== 'add_dependency') continue;

    // Search target and description for package@version tokens
    const sources = [step.target ?? '', step.description ?? ''];
    for (const src of sources) {
      let m: RegExpExecArray | null;
      TOKEN_RE.lastIndex = 0;
      while ((m = TOKEN_RE.exec(src)) !== null) {
        const name = m[1];
        const ver = m[2];
        if (name && ver && !pkgs.has(name)) {
          pkgs.set(name, ver);
        }
      }
    }
  }

  return pkgs;
}

// ---------------------------------------------------------------------------
// detectRecipeDrift
// ---------------------------------------------------------------------------

/**
 * Compare package versions referenced in the recipe's install steps against
 * the versions installed in the local project's package.json.
 *
 * No external semver library is used — major/minor/patch comparison only.
 */
export function detectRecipeDrift(
  recipe: SharedRecipe,
  packageJsonPath?: string,
): DriftReport {
  const resolvedPath = packageJsonPath ?? path.join(process.cwd(), 'package.json');

  // Pull testedWith from metadata if present (duck-typed extension)
  const meta = (recipe as SharedRecipe & { premiumMeta?: PremiumRecipeMetadata }).premiumMeta;
  const testedWith: string[] = meta?.testedWith ?? [];

  // Try to read local package.json
  let localDeps: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    localDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
  } catch {
    // No package.json — return clean report
    return { hasDrift: false, warnings: [], testedWith };
  }

  const recipePackages = extractRecipePackages(recipe);
  const warnings: DriftWarning[] = [];

  for (const [pkgName, recipeVersion] of recipePackages) {
    const installedRaw = localDeps[pkgName];
    if (!installedRaw) continue; // not in local project — no comparison possible

    const severity = compareSemver(recipeVersion, installedRaw);
    if (severity === 'ok') continue;

    const installedVersion = installedRaw.replace(/^[\^~>=<\s]+/, '');
    const severityLabel =
      severity === 'breaking' ? 'breaking' : severity === 'minor' ? 'minor' : 'patch';

    warnings.push({
      package: pkgName,
      recipeVersion,
      installedVersion,
      severity,
      message: `${pkgName}: recipe tested with ${recipeVersion}, you have ${installedVersion} (${severityLabel})`,
    });
  }

  return {
    hasDrift: warnings.length > 0,
    warnings,
    testedWith,
  };
}

// ---------------------------------------------------------------------------
// formatEarningsReport
// ---------------------------------------------------------------------------

/**
 * Return a markdown table summarising earnings across multiple recipes for a
 * creator.  Totals line is appended at the bottom.
 */
export function formatEarningsReport(metadata: PremiumRecipeMetadata[]): string {
  if (metadata.length === 0) {
    return '# Earnings Report\n\nNo recipes found.\n';
  }

  const rows: string[] = [];
  rows.push('# Earnings Report\n');
  rows.push('| Recipe | Downloads | Earnings |');
  rows.push('|--------|-----------|----------|');

  let totalDownloads = 0;
  let totalEarnings = 0;

  for (const m of metadata) {
    const earningsStr = `$${m.totalEarningsUsd.toFixed(2)}`;
    rows.push(`| ${m.name} | ${m.downloads.toLocaleString()} | ${earningsStr} |`);
    totalDownloads += m.downloads;
    totalEarnings += m.totalEarningsUsd;
  }

  rows.push('|--------|-----------|----------|');
  rows.push(
    `| **Total** | **${totalDownloads.toLocaleString()}** | **$${totalEarnings.toFixed(2)}** |`,
  );

  return rows.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// formatMarketplaceListing
// ---------------------------------------------------------------------------

/**
 * Generate a full marketplace listing card in markdown for a recipe.
 */
export function formatMarketplaceListing(
  recipe: SharedRecipe,
  metadata: PremiumRecipeMetadata,
): string {
  const lines: string[] = [];

  // ---- Header ----------------------------------------------------------------
  const verifiedBadge = metadata.verifiedWorking ? '✅ Verified' : '⚠ Unverified';
  const ratingStr = metadata.rating.toFixed(1);
  const downloadsStr = metadata.downloads.toLocaleString();
  lines.push(`# ${recipe.metadata.id}`);
  lines.push(
    `**by ${metadata.creatorHandle}** · ${verifiedBadge} · ⭐ ${ratingStr} (${metadata.ratingCount} ratings) · ↓ ${downloadsStr} downloads`,
  );
  lines.push('');

  // ---- Tested with -----------------------------------------------------------
  if (metadata.testedWith.length > 0) {
    lines.push(`Tested with: ${metadata.testedWith.join(', ')}`);
    lines.push('');
  }

  // ---- Description -----------------------------------------------------------
  lines.push('## What it does');
  lines.push(recipe.description);
  lines.push('');

  // ---- Steps -----------------------------------------------------------------
  lines.push(`## Steps (${recipe.steps.length})`);
  recipe.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step.action}: ${step.target}`);
  });
  lines.push('');

  // ---- Version compatibility table ------------------------------------------
  // Build a map of package -> { testedVersion, installedVersion } from testedWith
  // and from a drift check if possible.
  const testedMap = new Map<string, string>();
  for (const entry of metadata.testedWith) {
    // entry looks like "next@15.1" or "@stripe/stripe-js@4.1"
    const atIdx = entry.lastIndexOf('@');
    if (atIdx > 0) {
      const pkgName = entry.slice(0, atIdx);
      const ver = entry.slice(atIdx + 1);
      testedMap.set(pkgName, ver);
    }
  }

  // Try a live drift check (best-effort; silently ignored if no package.json)
  let driftReport: DriftReport | null = null;
  try {
    driftReport = detectRecipeDrift(recipe);
  } catch {
    // ignore
  }

  if (testedMap.size > 0) {
    lines.push('## Version compatibility');
    lines.push('| Package | Tested | Your version | Status |');
    lines.push('|---------|--------|--------------|--------|');

    for (const [pkg, testedVer] of testedMap) {
      let installedVer = '—';
      let status = '—';

      if (driftReport) {
        const w = driftReport.warnings.find((x) => x.package === pkg);
        if (w) {
          installedVer = w.installedVersion;
          status = w.severity === 'breaking' ? '🔴 Breaking' : '⚠ Minor diff';
        } else {
          // Try to read from local package.json directly for OK packages
          try {
            const pkgJsonPath = path.join(process.cwd(), 'package.json');
            const raw = fs.readFileSync(pkgJsonPath, 'utf8');
            const pkgJson = JSON.parse(raw) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            const allDeps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
            if (allDeps[pkg]) {
              installedVer = allDeps[pkg].replace(/^[\^~>=<\s]+/, '');
              status = '✅ OK';
            }
          } catch {
            // no package.json — leave defaults
          }
        }
      }

      lines.push(`| ${pkg} | ${testedVer} | ${installedVer} | ${status} |`);
    }
    lines.push('');
  }

  // ---- Drift warnings --------------------------------------------------------
  const allWarnings =
    driftReport && driftReport.warnings.length > 0
      ? driftReport.warnings
      : metadata.driftWarnings.length > 0
        ? metadata.driftWarnings.map((w) => ({ message: w } as Pick<DriftWarning, 'message'>))
        : [];

  if (allWarnings.length > 0) {
    lines.push('## Drift warnings');
    for (const w of allWarnings) {
      lines.push(`- ${w.message}`);
    }
    lines.push('');
  }

  // ---- Price / install CTA ---------------------------------------------------
  const priceStr = metadata.price === 0 ? 'Free' : `$${(metadata.price / 100).toFixed(2)}`;
  lines.push(`${priceStr} · agentgram pull ${recipe.metadata.id}`);

  return lines.join('\n') + '\n';
}
