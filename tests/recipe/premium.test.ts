import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  detectRecipeDrift,
  formatEarningsReport,
  formatMarketplaceListing,
  type PremiumRecipeMetadata,
  type DriftReport,
} from '../../src/recipe/premium.js';
import type { SharedRecipe } from '../../src/recipe/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecipe(overrides: Partial<SharedRecipe> = {}): SharedRecipe {
  return {
    name: 'stripe-subscriptions-nextjs',
    description: 'Add Stripe subscriptions to a Next.js app in 12 steps.',
    sourceSessionId: 'sess-test-001',
    steps: [
      {
        action: 'install',
        target: 'stripe@17.2 @stripe/stripe-js@4.1',
        description: 'Install stripe@17.2 and @stripe/stripe-js@4.1',
      },
      {
        action: 'create_file',
        target: 'src/lib/stripe.ts',
        description: 'Create Stripe client helper',
      },
      {
        action: 'modify_file',
        target: 'src/app/api/webhook/route.ts',
        description: 'Add webhook handler',
      },
    ],
    parameters: {},
    tags: ['stripe', 'payments', 'nextjs'],
    version: '1.0.0',
    metadata: {
      id: 'stripe-subscriptions-nextjs',
      author: 'naresh',
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-15T10:00:00Z',
      downloads: 2847,
      rating: 4.8,
      ratingCount: 124,
      sourceAgent: 'claude-code',
      checksum: 'abc123',
    },
    ...overrides,
  };
}

function makeMeta(overrides: Partial<PremiumRecipeMetadata> = {}): PremiumRecipeMetadata {
  return {
    id: 'stripe-subscriptions-nextjs',
    name: 'stripe-subscriptions-nextjs',
    price: 299,
    creatorHandle: '@naresh',
    creatorKeyId: 'ed25519-key-abc123',
    downloads: 2847,
    totalEarningsUsd: 850.53,
    rating: 4.8,
    ratingCount: 124,
    verifiedWorking: true,
    testedWith: ['next@15.1', 'stripe@17.2', '@stripe/stripe-js@4.1'],
    lastTestedAt: '2026-01-15T10:00:00Z',
    driftWarnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test fixtures — temp dir with package.json
// ---------------------------------------------------------------------------

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'premium-test-'));
  origCwd = process.cwd();
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePkgJson(deps: Record<string, string>, devDeps: Record<string, string> = {}): void {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }, null, 2),
  );
  process.chdir(tmpDir);
}

// ---------------------------------------------------------------------------
// detectRecipeDrift
// ---------------------------------------------------------------------------

describe('detectRecipeDrift — no package.json', () => {
  it('returns no drift when package.json is absent', () => {
    // tmpDir has no package.json; pass path explicitly so cwd is irrelevant
    const recipe = makeRecipe();
    const report: DriftReport = detectRecipeDrift(
      recipe,
      path.join(tmpDir, 'package.json'),
    );

    expect(report.hasDrift).toBe(false);
    expect(report.warnings).toHaveLength(0);
  });
});

describe('detectRecipeDrift — matching versions', () => {
  it('returns no drift when local versions match the recipe', () => {
    writePkgJson({ stripe: '17.2.0', '@stripe/stripe-js': '4.1.0' });

    const recipe = makeRecipe();
    const report = detectRecipeDrift(recipe);

    expect(report.hasDrift).toBe(false);
    expect(report.warnings).toHaveLength(0);
  });
});

describe('detectRecipeDrift — major version difference', () => {
  it('reports breaking drift when installed major differs from recipe major', () => {
    writePkgJson({ stripe: '16.0.0' }); // recipe expects 17.2

    const recipe = makeRecipe();
    const report = detectRecipeDrift(recipe);

    expect(report.hasDrift).toBe(true);
    const warn = report.warnings.find((w) => w.package === 'stripe');
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('breaking');
    expect(warn?.recipeVersion).toBe('17.2');
    expect(warn?.installedVersion).toBe('16.0.0');
    expect(warn?.message).toContain('breaking');
  });
});

describe('detectRecipeDrift — minor version difference', () => {
  it('reports minor drift when installed minor differs from recipe minor (same major)', () => {
    writePkgJson({ stripe: '17.0.0' }); // recipe expects 17.2

    const recipe = makeRecipe();
    const report = detectRecipeDrift(recipe);

    expect(report.hasDrift).toBe(true);
    const warn = report.warnings.find((w) => w.package === 'stripe');
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe('minor');
    expect(warn?.message).toContain('minor');
  });
});

describe('detectRecipeDrift — patch version difference', () => {
  it('reports patch drift when only the patch level differs', () => {
    // recipe: stripe@17.2 → parsed as 17.2.0; installed: 17.2.3
    writePkgJson({ stripe: '17.2.3' });

    const recipe = makeRecipe();
    const report = detectRecipeDrift(recipe);

    // 17.2 vs 17.2.3 — same major and minor, different patch
    expect(report.hasDrift).toBe(true);
    const warn = report.warnings.find((w) => w.package === 'stripe');
    expect(warn?.severity).toBe('patch');
  });
});

// ---------------------------------------------------------------------------
// formatEarningsReport
// ---------------------------------------------------------------------------

describe('formatEarningsReport', () => {
  it('renders a markdown table with per-recipe rows and a totals row', () => {
    const metas: PremiumRecipeMetadata[] = [
      makeMeta({ name: 'stripe-subscriptions-nextjs', downloads: 2847, totalEarningsUsd: 850.53 }),
      makeMeta({
        id: 'clerk-auth-nextjs',
        name: 'clerk-auth-nextjs',
        downloads: 1200,
        totalEarningsUsd: 358.80,
      }),
    ];

    const report = formatEarningsReport(metas);

    expect(report).toContain('# Earnings Report');
    expect(report).toContain('stripe-subscriptions-nextjs');
    expect(report).toContain('clerk-auth-nextjs');
    expect(report).toContain('$850.53');
    expect(report).toContain('$358.80');
    // Total earnings
    expect(report).toContain('$1209.33');
    // Totals row
    expect(report).toContain('**Total**');
  });

  it('handles empty metadata array gracefully', () => {
    const report = formatEarningsReport([]);
    expect(report).toContain('No recipes found');
  });
});

// ---------------------------------------------------------------------------
// formatMarketplaceListing — verified recipe
// ---------------------------------------------------------------------------

describe('formatMarketplaceListing — verified recipe', () => {
  it('includes verification badge, rating, downloads, steps, and CTA', () => {
    const recipe = makeRecipe();
    const meta = makeMeta();
    const listing = formatMarketplaceListing(recipe, meta);

    expect(listing).toContain('# stripe-subscriptions-nextjs');
    expect(listing).toContain('@naresh');
    expect(listing).toContain('✅ Verified');
    expect(listing).toContain('4.8');
    expect(listing).toContain('124 ratings');
    expect(listing).toContain('2,847 downloads');
    expect(listing).toContain('## What it does');
    expect(listing).toContain(recipe.description);
    expect(listing).toContain(`## Steps (${recipe.steps.length})`);
    expect(listing).toContain('$2.99');
    expect(listing).toContain('agentgram pull stripe-subscriptions-nextjs');
  });

  it('lists tested-with packages in the header', () => {
    const listing = formatMarketplaceListing(makeRecipe(), makeMeta());
    expect(listing).toContain('Tested with: next@15.1, stripe@17.2, @stripe/stripe-js@4.1');
  });
});

// ---------------------------------------------------------------------------
// formatMarketplaceListing — drift warnings shown
// ---------------------------------------------------------------------------

describe('formatMarketplaceListing — drift warnings shown', () => {
  it('shows drift warnings from metadata when present', () => {
    const meta = makeMeta({
      driftWarnings: ['stripe: recipe tested with 17.2, you have 17.0 (minor)'],
    });
    const listing = formatMarketplaceListing(makeRecipe(), meta);

    expect(listing).toContain('## Drift warnings');
    expect(listing).toContain('stripe: recipe tested with 17.2, you have 17.0 (minor)');
  });
});

// ---------------------------------------------------------------------------
// formatMarketplaceListing — free recipe (price = 0)
// ---------------------------------------------------------------------------

describe('formatMarketplaceListing — free recipe', () => {
  it('shows "Free" instead of a dollar amount when price is 0', () => {
    const meta = makeMeta({ price: 0 });
    const listing = formatMarketplaceListing(makeRecipe(), meta);

    expect(listing).toContain('Free · agentgram pull stripe-subscriptions-nextjs');
    // Should NOT contain a dollar-price CTA
    expect(listing).not.toContain('$0.00');
  });
});
