import simpleGit, { type SimpleGit, type SimpleGitOptions } from 'simple-git';
import type { AgentraceConfig } from '../core/types.js';

export interface GitContext {
  git: SimpleGit;
  cwd: string;
}

/** Create a SimpleGit instance for a given directory */
export function createGit(cwd: string): GitContext {
  const options: Partial<SimpleGitOptions> = {
    baseDir: cwd,
    binary: 'git',
    maxConcurrentProcesses: 6,
  };
  return { git: simpleGit(options), cwd };
}

/** Check if a directory is inside a git repo */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { git } = createGit(cwd);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

/** Get the current HEAD commit hash */
export async function getHeadCommit(ctx: GitContext): Promise<string> {
  const log = await ctx.git.log({ maxCount: 1 });
  if (!log.latest) {
    throw new Error('No commits found in repository');
  }
  return log.latest.hash;
}

/** Create a new branch from current HEAD */
export async function createBranch(ctx: GitContext, branchName: string): Promise<void> {
  await ctx.git.checkoutLocalBranch(branchName);
}

/** Switch to a branch */
export async function switchBranch(ctx: GitContext, branchName: string): Promise<void> {
  await ctx.git.checkout(branchName);
}

/**
 * Create a micro-commit with operation metadata.
 * Commits only what is already staged — callers must stage files first.
 * Passing `paths` stages those specific files before committing.
 */
export async function microCommit(
  ctx: GitContext,
  message: string,
  config: AgentraceConfig,
  paths?: string[],
): Promise<string> {
  if (paths && paths.length > 0) {
    await ctx.git.add(paths);
  }

  const status = await ctx.git.status();
  if (status.staged.length === 0) {
    return '';
  }

  const result = await ctx.git.commit(message, {
    '--author': `${config.gitAuthor.name} <${config.gitAuthor.email}>`,
  });

  return result.commit || '';
}

/** Get the diff between two commits */
export async function getDiff(ctx: GitContext, from: string, to: string): Promise<string> {
  return ctx.git.diff([from, to]);
}

/** Get the log between two commits */
export async function getLog(ctx: GitContext, from: string, to?: string) {
  return ctx.git.log({ from, to: to || 'HEAD' });
}

/** Create a git worktree */
export async function createWorktree(
  ctx: GitContext,
  path: string,
  branch: string,
): Promise<void> {
  await ctx.git.raw(['worktree', 'add', path, '-b', branch]);
}

/** Remove a git worktree */
export async function removeWorktree(ctx: GitContext, path: string): Promise<void> {
  await ctx.git.raw(['worktree', 'remove', path, '--force']);
}

/** Check if there are uncommitted changes */
export async function hasChanges(ctx: GitContext): Promise<boolean> {
  const status = await ctx.git.status();
  return !status.isClean();
}

/** Get file content at a specific commit */
export async function getFileAtCommit(
  ctx: GitContext,
  filePath: string,
  commit: string,
): Promise<string> {
  return ctx.git.show([`${commit}:${filePath}`]);
}
