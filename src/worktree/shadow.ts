import path from 'node:path';
import fs from 'node:fs/promises';
import type { Operation, OperationType, Session } from '../core/types.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import {
  createGit,
  getHeadCommit,
  createBranch,
  switchBranch,
  microCommit,
  getLog,
  type GitContext,
} from '../utils/git.js';
import { contentHash, generateId, sessionBranchName } from '../utils/hash.js';

export interface TrackReadOptions {
  linesRead?: [number, number];
  reason?: string;
  causedBy?: string[];
}

export interface TrackWriteOptions {
  reason?: string;
  causedBy?: string[];
}

export interface TrackExecResult {
  exitCode?: number;
  output?: string;
}

export interface SessionSummary {
  session: Session;
  operations: Operation[];
  totalCommits: number;
  branchName: string;
  baseCommit: string;
}

export class ShadowWorktree {
  private ctx: GitContext;
  private session: Session;
  private operations: Operation[] = [];

  private constructor(ctx: GitContext, session: Session) {
    this.ctx = ctx;
    this.session = session;
  }

  /**
   * Create a new ShadowWorktree, branching from current HEAD.
   */
  static async create(cwd: string, sessionName: string): Promise<ShadowWorktree> {
    const ctx = createGit(cwd);
    const baseCommit = await getHeadCommit(ctx);
    const branch = sessionBranchName(sessionName);

    // Remember the current branch before we switch
    const currentBranch = await ctx.git.revparse(['--abbrev-ref', 'HEAD']);

    await createBranch(ctx, branch);

    const session: Session = {
      id: generateId(),
      name: sessionName,
      state: 'recording',
      startedAt: Date.now(),
      operations: [],
      branch,
      baseCommit,
      cwd,
    };

    // Store the original branch name in metadata for stop()
    (session as Session & { _originalBranch: string })._originalBranch =
      currentBranch.trim();

    return new ShadowWorktree(ctx, session);
  }

  /**
   * Record a file read. Does not create a commit.
   */
  async trackRead(
    filePath: string,
    options: TrackReadOptions = {},
  ): Promise<Operation> {
    const absolutePath = this.resolvePath(filePath);
    let hash: string | undefined;

    try {
      const content = await fs.readFile(absolutePath);
      hash = contentHash(content);
    } catch {
      // File may not exist yet; hash stays undefined
    }

    const op: Operation = {
      id: generateId(),
      type: 'read',
      timestamp: Date.now(),
      target: filePath,
      metadata: {
        contentHash: hash,
        linesRead: options.linesRead,
      },
      reason: options.reason,
      causedBy: options.causedBy ?? [],
    };

    this.operations.push(op);
    this.session.operations.push(op);
    return op;
  }

  /**
   * Stage a written file and create a micro-commit.
   */
  async trackWrite(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const absolutePath = this.resolvePath(filePath);

    let beforeHash: string | undefined;
    let afterHash: string | undefined;

    // Try to get before-hash from HEAD
    try {
      const relative = path.relative(this.ctx.cwd, absolutePath);
      const headContent = await this.ctx.git.show([`HEAD:${relative}`]);
      beforeHash = contentHash(headContent);
    } catch {
      // File is new
    }

    try {
      const content = await fs.readFile(absolutePath);
      afterHash = contentHash(content);
    } catch {
      // File may have been deleted
    }

    const op: Operation = {
      id: generateId(),
      type: 'write',
      timestamp: Date.now(),
      target: filePath,
      metadata: { beforeHash, afterHash },
      reason: options.reason,
      causedBy: options.causedBy ?? [],
    };

    this.operations.push(op);
    this.session.operations.push(op);

    const relative = path.relative(this.ctx.cwd, absolutePath);
    await this.ctx.git.add(relative);

    const message = this.buildCommitMessage('write', filePath, options.reason);
    await microCommit(this.ctx, message, DEFAULT_CONFIG);

    return op;
  }

  /**
   * Record a command execution and create a micro-commit.
   */
  async trackExec(
    command: string,
    result: TrackExecResult = {},
    options: { reason?: string; causedBy?: string[] } = {},
  ): Promise<Operation> {
    const op: Operation = {
      id: generateId(),
      type: 'exec',
      timestamp: Date.now(),
      target: command,
      metadata: {
        command,
        exitCode: result.exitCode,
        output: result.output,
      },
      reason: options.reason,
      causedBy: options.causedBy ?? [],
    };

    this.operations.push(op);
    this.session.operations.push(op);

    // Write an exec log entry so we have something to commit
    const logDir = path.join(this.ctx.cwd, '.agentgram', 'exec-log');
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `${op.id}.json`);
    await fs.writeFile(
      logFile,
      JSON.stringify({ command, exitCode: result.exitCode, output: result.output }, null, 2),
    );

    await this.ctx.git.add(path.relative(this.ctx.cwd, logFile));

    const message = this.buildCommitMessage('exec', command, options.reason);
    await microCommit(this.ctx, message, DEFAULT_CONFIG);

    return op;
  }

  /**
   * Stage a newly created file and create a micro-commit.
   */
  async trackCreate(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const absolutePath = this.resolvePath(filePath);

    let afterHash: string | undefined;
    try {
      const content = await fs.readFile(absolutePath);
      afterHash = contentHash(content);
    } catch {
      // ignore
    }

    const op: Operation = {
      id: generateId(),
      type: 'create',
      timestamp: Date.now(),
      target: filePath,
      metadata: { afterHash },
      reason: options.reason,
      causedBy: options.causedBy ?? [],
    };

    this.operations.push(op);
    this.session.operations.push(op);

    const relative = path.relative(this.ctx.cwd, absolutePath);
    await this.ctx.git.add(relative);

    const message = this.buildCommitMessage('create', filePath, options.reason);
    await microCommit(this.ctx, message, DEFAULT_CONFIG);

    return op;
  }

  /**
   * Stage a file deletion and create a micro-commit.
   */
  async trackDelete(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const absolutePath = this.resolvePath(filePath);

    let beforeHash: string | undefined;
    try {
      const content = await fs.readFile(absolutePath);
      beforeHash = contentHash(content);
    } catch {
      // File may already be gone
    }

    const op: Operation = {
      id: generateId(),
      type: 'delete',
      timestamp: Date.now(),
      target: filePath,
      metadata: { beforeHash },
      reason: options.reason,
      causedBy: options.causedBy ?? [],
    };

    this.operations.push(op);
    this.session.operations.push(op);

    // Stage deletion
    const relative = path.relative(this.ctx.cwd, absolutePath);
    try {
      await this.ctx.git.rm([relative]);
    } catch {
      // If git rm fails, try plain add -A for already-deleted files
      await this.ctx.git.add(['-A', relative]);
    }

    const message = this.buildCommitMessage('delete', filePath, options.reason);
    await microCommit(this.ctx, message, DEFAULT_CONFIG);

    return op;
  }

  /**
   * Return the git log of the shadow branch since the base commit.
   */
  async getHistory() {
    return getLog(this.ctx, this.session.baseCommit, 'HEAD');
  }

  /**
   * Return all recorded Operation objects.
   */
  getOperations(): Operation[] {
    return [...this.operations];
  }

  /**
   * Switch back to the original branch and return a session summary.
   */
  async stop(): Promise<SessionSummary> {
    this.session.state = 'stopped';
    this.session.stoppedAt = Date.now();

    const originalBranch =
      (this.session as Session & { _originalBranch?: string })._originalBranch ?? 'main';

    await switchBranch(this.ctx, originalBranch);

    const historyLog = await this.ctx.git.log({
      from: this.session.baseCommit,
      to: this.session.branch,
    });

    return {
      session: { ...this.session },
      operations: this.getOperations(),
      totalCommits: historyLog.total,
      branchName: this.session.branch,
      baseCommit: this.session.baseCommit,
    };
  }

  // ---- helpers ----

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(this.ctx.cwd, filePath);
  }

  private buildCommitMessage(type: OperationType, target: string, reason?: string): string {
    const description = reason ?? this.defaultDescription(type, target);
    return `[agentgram] ${type}(${target}): ${description}`;
  }

  private defaultDescription(type: OperationType, target: string): string {
    switch (type) {
      case 'write':
        return `wrote ${target}`;
      case 'exec':
        return `executed command`;
      case 'create':
        return `created ${target}`;
      case 'delete':
        return `deleted ${target}`;
      default:
        return target;
    }
  }
}

export default ShadowWorktree;
