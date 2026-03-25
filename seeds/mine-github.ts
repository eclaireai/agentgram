#!/usr/bin/env npx tsx
/**
 * GitHub Recipe Miner — Solves the cold-start problem.
 *
 * Clones top-starred repos, extracts recipes from their git history,
 * deduplicates, filters for quality, and outputs to the registry format.
 *
 * Run: npx tsx seeds/mine-github.ts
 *
 * This produces hundreds of real, battle-tested recipes from the
 * most popular open-source projects — without a single user needing
 * to share anything.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractRecipesFromRepo } from '../src/recipe/extractor.js';
import { fingerprint } from '../src/recipe/fingerprint.js';
import { prepareForSharing } from '../src/recipe/share.js';
import type { Recipe } from '../src/core/types.js';
import type { SharedRecipe, RecipeIndexEntry } from '../src/recipe/types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOPICS = [
  'typescript',
  'nextjs',
  'express',
  'react',
  'nodejs',
  'api',
  'cli',
  'devtools',
];

const REPOS_PER_TOPIC = 3;           // repos to scan per topic
const COMMITS_PER_REPO = 30;         // commits to scan per repo
const MIN_STEPS = 3;                 // minimum steps for a quality recipe
const MAX_STEPS = 20;                // skip mega-commits
const CLONE_DEPTH = 50;              // shallow clone depth
const OUTPUT_DIR = path.resolve('seeds/mined');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gh(cmd: string): string {
  try {
    return execSync(`gh api ${cmd}`, { encoding: 'utf8', timeout: 15000 });
  } catch (err) {
    console.error(`  ⚠ gh api failed: ${cmd}`);
    return '[]';
  }
}

function cloneShallow(url: string, dest: string): boolean {
  try {
    execSync(`git clone --depth ${CLONE_DEPTH} --single-branch ${url} ${dest}`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    return true;
  } catch {
    return false;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n\x1b[1m\x1b[36m');
  console.log('  ╔════════════════════════════════════════════════════╗');
  console.log('  ║   agentgram GitHub Recipe Miner                   ║');
  console.log('  ║   Solving the cold-start problem                  ║');
  console.log('  ╚════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgram-mine-'));

  const allRecipes: SharedRecipe[] = [];
  const seenNames = new Set<string>();
  const reposSeen = new Set<string>();

  for (const topic of TOPICS) {
    console.log(`\n\x1b[1m▸ Topic: ${topic}\x1b[0m`);

    // Find top repos for this topic
    const query = encodeURIComponent(`${topic} language:typescript stars:>500`);
    const raw = gh(
      `search/repositories?q=${query}&sort=stars&order=desc&per_page=${REPOS_PER_TOPIC}`,
    );

    let repos: Array<{ full_name: string; clone_url: string; stargazers_count: number; description: string }>;
    try {
      const parsed = JSON.parse(raw);
      repos = (parsed.items ?? parsed ?? []).slice(0, REPOS_PER_TOPIC);
    } catch {
      console.log('  ⚠ Failed to parse repo list, skipping topic');
      continue;
    }

    for (const repo of repos) {
      if (reposSeen.has(repo.full_name)) continue;
      reposSeen.add(repo.full_name);

      console.log(`\n  📦 ${repo.full_name} (★${repo.stargazers_count})`);

      const repoDir = path.join(tmpBase, slugify(repo.full_name));

      // Clone
      const cloned = cloneShallow(repo.clone_url, repoDir);
      if (!cloned) {
        console.log('    ⚠ Clone failed, skipping');
        continue;
      }

      // Fingerprint
      let fp;
      try {
        fp = await fingerprint(repoDir);
        console.log(`    Fingerprint: ${fp.language}/${fp.framework}/${fp.testFramework}`);
      } catch {
        fp = null;
      }

      // Extract recipes
      let recipes: Recipe[];
      try {
        recipes = await extractRecipesFromRepo(repoDir, { limit: COMMITS_PER_REPO });
      } catch (err) {
        console.log(`    ⚠ Extract failed: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      console.log(`    Raw extracts: ${recipes.length}`);

      // Filter for quality
      const quality = recipes.filter((r) => {
        if (r.steps.length < MIN_STEPS) return false;
        if (r.steps.length > MAX_STEPS) return false;

        // Skip if name is too generic
        const name = r.name.toLowerCase();
        if (name.length < 5) return false;
        if (name.startsWith('merge') || name.startsWith('bump') || name.startsWith('update dep')) return false;
        if (name.startsWith('chore') || name.startsWith('wip')) return false;

        // Deduplicate by name similarity
        const key = slugify(r.name);
        if (seenNames.has(key)) return false;
        seenNames.add(key);

        return true;
      });

      console.log(`    Quality recipes: ${quality.length}`);

      // Convert to SharedRecipe
      for (const recipe of quality) {
        // Build a fake session to use prepareForSharing
        const fakeSession = {
          id: recipe.sourceSessionId,
          name: recipe.name,
          state: 'stopped' as const,
          startedAt: Date.now(),
          stoppedAt: Date.now(),
          operations: recipe.steps.map((s, i) => ({
            id: `op-${i}`,
            type: (s.action === 'find' ? 'read' :
                   s.action === 'create_file' ? 'create' :
                   s.action === 'modify_file' ? 'write' :
                   s.action === 'run_command' ? 'exec' :
                   s.action === 'delete' ? 'delete' : 'read') as 'read' | 'write' | 'create' | 'delete' | 'exec',
            timestamp: Date.now() + i * 1000,
            target: s.target,
            metadata: {},
            causedBy: [] as string[],
          })),
          branch: '',
          baseCommit: '',
          cwd: repoDir,
        };

        const shared = prepareForSharing(fakeSession, {
          name: recipe.name,
          tags: recipe.tags,
          author: repo.full_name.split('/')[0],
          sourceAgent: 'git-history',
        });

        // Override description with original commit message
        shared.description = recipe.description;

        // Add fingerprint info to tags
        if (fp) {
          if (fp.framework !== 'none' && !shared.tags.includes(fp.framework)) {
            shared.tags.push(fp.framework);
          }
          if (fp.orm !== 'none' && !shared.tags.includes(fp.orm)) {
            shared.tags.push(fp.orm);
          }
        }

        allRecipes.push(shared);
      }

      // Cleanup
      try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }

  console.log(`\n\x1b[1m▸ Results\x1b[0m`);
  console.log(`  Total repos scanned: ${reposSeen.size}`);
  console.log(`  Total quality recipes: ${allRecipes.length}`);

  // Save all recipes
  for (const recipe of allRecipes) {
    const filename = `${recipe.metadata.id}.json`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(recipe, null, 2));
  }

  // Build index
  const indexEntries: RecipeIndexEntry[] = allRecipes.map((r) => ({
    id: r.metadata.id,
    name: r.name,
    description: r.description.slice(0, 200),
    author: r.metadata.author,
    tags: r.tags.slice(0, 10),
    sourceAgent: r.metadata.sourceAgent,
    downloads: 0,
    rating: 0,
    createdAt: r.metadata.createdAt,
    stepCount: r.steps.length,
  }));

  const index = {
    version: '1',
    updatedAt: new Date().toISOString(),
    recipes: indexEntries,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\n  Saved to: ${OUTPUT_DIR}/`);
  console.log(`  Index: ${OUTPUT_DIR}/index.json (${indexEntries.length} entries)`);

  // Show sample
  console.log(`\n\x1b[1m▸ Sample recipes:\x1b[0m\n`);
  for (const r of allRecipes.slice(0, 15)) {
    console.log(`  ${r.steps.length} steps  ${r.name.slice(0, 60)}  [${r.tags.slice(0, 3).join(',')}]`);
  }

  // Cleanup
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ok */ }

  console.log(`\n\x1b[1m\x1b[32m✅ Mining complete. ${allRecipes.length} recipes ready for registry.\x1b[0m\n`);
}

main().catch(console.error);
