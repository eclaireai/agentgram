/**
 * PR→Recipe Reverse Extractor
 *
 * Mines git history to extract recipes from existing commits.
 * Every merged commit is a session that already happened — we just
 * need to parse it.
 *
 * This solves the cold-start problem: 1,000 repos → 50,000 recipes.
 */

import simpleGit from 'simple-git';
import type { Recipe, RecipeStep } from '../core/types.js';

/** Files that should be ignored when extracting recipes */
const TRIVIAL_FILES = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /\.DS_Store$/,
  /\.gitignore$/,
  /node_modules\//,
  /dist\//,
  /\.map$/,
];

function isTrivial(filepath: string): boolean {
  return TRIVIAL_FILES.some((re) => re.test(filepath));
}

interface DiffFile {
  file: string;
  status: 'A' | 'M' | 'D' | 'R';
}

/**
 * Parse `git diff --name-status` output into structured file changes.
 */
function parseDiffNameStatus(raw: string): DiffFile[] {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      const file = rest.join('\t');
      return { status: status.charAt(0) as DiffFile['status'], file };
    })
    .filter((d) => !isTrivial(d.file));
}

/**
 * Detect new dependencies added in a package.json change.
 */
function detectNewDeps(parentJson: string | null, currentJson: string | null): string[] {
  if (!parentJson || !currentJson) return [];
  try {
    const before = JSON.parse(parentJson);
    const after = JSON.parse(currentJson);

    const oldDeps = { ...(before.dependencies ?? {}), ...(before.devDependencies ?? {}) };
    const newDeps = { ...(after.dependencies ?? {}), ...(after.devDependencies ?? {}) };

    return Object.keys(newDeps).filter((k) => !(k in oldDeps));
  } catch {
    return [];
  }
}

/**
 * Extract a recipe from a single git commit.
 * Returns null if the commit is trivial (only lockfiles, etc.).
 */
export async function extractRecipeFromCommit(
  cwd: string,
  commitSha: string,
): Promise<Recipe | null> {
  const git = simpleGit(cwd);

  // Get commit message
  const logEntry = await git.log({ from: commitSha + '~1', to: commitSha, maxCount: 1 }).catch(() => null);
  if (!logEntry?.latest) return null;

  const message = logEntry.latest.message;
  const cleanMessage = message.replace(/^(feat|fix|chore|refactor|docs|test|ci|style|perf|build)(\(.*?\))?:\s*/i, '');

  // Get changed files
  let diffRaw: string;
  try {
    diffRaw = await git.diff(['--name-status', commitSha + '~1', commitSha]);
  } catch {
    // First commit — diff against empty tree
    diffRaw = await git.diff(['--name-status', '4b825dc642cb6eb9a060e54bf899d15363e86d46', commitSha]);
  }

  const files = parseDiffNameStatus(diffRaw);
  if (files.length === 0) return null;

  // Build recipe steps
  const steps: RecipeStep[] = [];

  // Check for new deps in package.json
  const pkgChange = files.find((f) => f.file === 'package.json' && f.status === 'M');
  if (pkgChange) {
    try {
      const parentPkg = await git.show([`${commitSha}~1:package.json`]).catch(() => null);
      const currentPkg = await git.show([`${commitSha}:package.json`]).catch(() => null);
      const newDeps = detectNewDeps(parentPkg, currentPkg);

      if (newDeps.length > 0) {
        steps.push({
          action: 'run_command',
          target: `npm install ${newDeps.join(' ')}`,
          description: `Install ${newDeps.length === 1 ? newDeps[0] : newDeps.length + ' dependencies'}`,
        });
      }
    } catch {
      // ignore
    }
  }

  // Convert file changes to steps
  for (const { file, status } of files) {
    // Skip package.json only if we already extracted deps from it
    if (file === 'package.json' && pkgChange && steps.some((s) => s.action === 'run_command')) continue;

    switch (status) {
      case 'A':
        steps.push({
          action: 'create_file',
          target: file,
          description: `Create ${file.split('/').pop()}`,
        });
        break;
      case 'M':
        steps.push({
          action: 'modify_file',
          target: file,
          description: `Modify ${file.split('/').pop()}`,
        });
        break;
      case 'D':
        steps.push({
          action: 'delete',
          target: file,
          description: `Delete ${file.split('/').pop()}`,
        });
        break;
    }
  }

  if (steps.length === 0) return null;

  // Extract name from commit message
  const name = cleanMessage.charAt(0).toUpperCase() + cleanMessage.slice(1);

  return {
    name: name.slice(0, 80),
    description: message,
    sourceSessionId: commitSha.slice(0, 12),
    steps,
    parameters: {},
    tags: inferTags(files.map((f) => f.file), message),
    version: '1.0.0',
  };
}

/**
 * Extract recipes from multiple commits in a repo.
 */
export async function extractRecipesFromRepo(
  cwd: string,
  options: { limit?: number; since?: string } = {},
): Promise<Recipe[]> {
  const git = simpleGit(cwd);
  const limit = options.limit ?? 50;

  const logArgs: string[] = [`-${limit + 10}`, '--format=%H']; // extra buffer for filtering
  if (options.since) logArgs.push(`--since=${options.since}`);

  const raw = await git.raw(['log', ...logArgs]);
  const shas = raw.trim().split('\n').filter(Boolean);

  const recipes: Recipe[] = [];
  for (const sha of shas) {
    if (recipes.length >= limit) break;
    const recipe = await extractRecipeFromCommit(cwd, sha);
    if (recipe) recipes.push(recipe);
  }

  return recipes;
}

/**
 * Infer tags from file paths and commit message.
 */
function inferTags(files: string[], message: string): string[] {
  const tags = new Set<string>();
  const lower = message.toLowerCase();
  const allFiles = files.join(' ').toLowerCase();

  // From message keywords
  const keywords: Record<string, string> = {
    auth: 'auth', authentication: 'auth', jwt: 'jwt', login: 'auth',
    test: 'testing', spec: 'testing', vitest: 'vitest', jest: 'jest',
    docker: 'docker', dockerfile: 'docker', container: 'docker',
    ci: 'ci', workflow: 'ci', pipeline: 'ci', github: 'github-actions',
    lint: 'linting', eslint: 'eslint', prettier: 'prettier',
    database: 'database', prisma: 'prisma', migration: 'database',
    api: 'api', route: 'api', endpoint: 'api',
    middleware: 'middleware',
    security: 'security', helmet: 'security', cors: 'cors',
    error: 'error-handling', logging: 'logging', logger: 'logging',
    typescript: 'typescript', type: 'typescript',
    react: 'react', next: 'nextjs', express: 'express',
    deploy: 'deployment', build: 'build',
  };

  for (const [keyword, tag] of Object.entries(keywords)) {
    if (lower.includes(keyword) || allFiles.includes(keyword)) {
      tags.add(tag);
    }
  }

  // From file extensions
  if (allFiles.includes('.ts')) tags.add('typescript');
  if (allFiles.includes('.py')) tags.add('python');
  if (allFiles.includes('.yml') || allFiles.includes('.yaml')) tags.add('config');

  return [...tags].slice(0, 10);
}
