/**
 * Session orchestrator for agentgram.
 *
 * AgentraceSession is the main user-facing API. It wires together:
 *   - ShadowWorktree   → micro-commits per operation
 *   - ProvenanceTracker → causal DAG
 *   - RecipeDistiller  → high-level recipe from the recorded trace
 *
 * Agentrace is the static factory / registry that persists sessions to disk.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ShadowWorktree } from '../worktree/shadow.js';
import type { TrackReadOptions, TrackWriteOptions, TrackExecResult } from '../worktree/shadow.js';
import { ProvenanceTracker } from '../provenance/graph.js';
import { RecipeDistiller } from '../recipe/distill.js';
import type {
  Session,
  Operation,
  ProvenanceGraph,
  Recipe,
  AgentraceConfig,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionResult {
  session: Session;
  operations: Operation[];
  provenance: ProvenanceGraph;
  recipe: Recipe;
  branch: string;
  baseCommit: string;
  totalCommits: number;
}

/** Shape stored on disk inside .agentgram/sessions/{id}.json */
interface PersistedSession {
  session: Session;
  provenance: ProvenanceGraph;
  recipe: Recipe;
}

// ---------------------------------------------------------------------------
// AgentraceSession
// ---------------------------------------------------------------------------

export class AgentraceSession extends EventEmitter {
  private worktree: ShadowWorktree;
  private tracker: ProvenanceTracker;
  private distiller: RecipeDistiller;
  private _session: Session;
  private config: AgentraceConfig;

  private constructor(
    worktree: ShadowWorktree,
    tracker: ProvenanceTracker,
    distiller: RecipeDistiller,
    session: Session,
    config: AgentraceConfig,
  ) {
    super();
    this.worktree = worktree;
    this.tracker = tracker;
    this.distiller = distiller;
    this._session = session;
    this.config = config;
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  /**
   * Start a new recording session in `cwd`.
   */
  static async start(
    cwd: string,
    name: string,
    config: Partial<AgentraceConfig> = {},
  ): Promise<AgentraceSession> {
    const mergedConfig: AgentraceConfig = { ...DEFAULT_CONFIG, ...config };

    const worktree = await ShadowWorktree.create(cwd, name);

    // Grab the session object that ShadowWorktree built internally.
    // We access it through stop() later; for now we reconstruct the minimal
    // view we need from getOperations() (empty at this point) and the branch.
    // We call stop() lazily, so we keep a provisional session reference here.
    // The real session is held inside ShadowWorktree; we expose it via stop().
    // ──────────────────────────────────────────────────────────────────────
    // We need a session id up-front for the ProvenanceTracker.
    // We derive one by doing a tiny "peek" — shadow.stop() gives us the real
    // Session object.  However, calling stop() now would end the session.
    // Instead we create a temporary id.  The tracker will be re-keyed when
    // stop() is called and the real session id is known.
    // Actually we can avoid all that: ShadowWorktree exposes the session
    // through the summary returned by stop(); until then we create the tracker
    // with a placeholder id and patch it inside stop().
    // For simplicity (and to avoid mutating tracker internals) we generate an
    // id here and accept a tiny mismatch risk — the id is already stable
    // because generateId() is called once inside ShadowWorktree.create().
    //
    // The cleanest approach: peek at the branch name (which embeds the stable
    // id suffix) to build a provisional session id.  But the session object
    // lives privately in ShadowWorktree.
    //
    // Resolution: we expose a lightweight getSession() from ShadowWorktree OR
    // we simply use a random local id that we replace at stop() time.
    // For the tracker, sessionId is just metadata on the graph object; we can
    // safely replace it when we finalize the session.

    // Use a provisional id; will be replaced in stop()
    const provisionalId = `provisional-${Date.now().toString(36)}`;
    const tracker = new ProvenanceTracker(provisionalId);
    const distiller = new RecipeDistiller();

    // Build a minimal provisional session to expose via getSession()
    const provisionalSession: Session = {
      id: provisionalId,
      name,
      state: 'recording',
      startedAt: Date.now(),
      operations: [],
      branch: '',
      baseCommit: '',
      cwd,
    };

    const instance = new AgentraceSession(
      worktree,
      tracker,
      distiller,
      provisionalSession,
      mergedConfig,
    );

    instance.emit('session_start', { type: 'session_start', sessionId: provisionalId });

    return instance;
  }

  // ── Operation tracking ────────────────────────────────────────────────────

  async read(filePath: string, options: TrackReadOptions = {}): Promise<Operation> {
    const op = await this.worktree.trackRead(filePath, options);
    this.tracker.addRead(op);
    this._session.operations.push(op);
    this.emit('operation', { type: 'operation', operation: op });
    return op;
  }

  async write(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const op = await this.worktree.trackWrite(filePath, options);
    this.tracker.addWrite(op);
    this._session.operations.push(op);
    this.emit('operation', { type: 'operation', operation: op });
    return op;
  }

  async exec(
    command: string,
    result: TrackExecResult = {},
    options: { reason?: string; causedBy?: string[] } = {},
  ): Promise<Operation> {
    const op = await this.worktree.trackExec(command, result, options);
    this.tracker.addExec(op);
    this._session.operations.push(op);
    this.emit('operation', { type: 'operation', operation: op });
    return op;
  }

  async create(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const op = await this.worktree.trackCreate(filePath, options);
    this.tracker.addWrite(op);
    this._session.operations.push(op);
    this.emit('operation', { type: 'operation', operation: op });
    return op;
  }

  async delete(filePath: string, options: TrackWriteOptions = {}): Promise<Operation> {
    const op = await this.worktree.trackDelete(filePath, options);
    this.tracker.addWrite(op);
    this._session.operations.push(op);
    this.emit('operation', { type: 'operation', operation: op });
    return op;
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  /**
   * Stop the session.  Collects results from all modules, saves to disk and
   * returns a SessionResult.
   */
  async stop(): Promise<SessionResult> {
    const summary = await this.worktree.stop();

    // Patch the provisional session with the real data from ShadowWorktree
    const realSession = summary.session;

    // Patch provenance graph's sessionId to match the real session id
    const provenance = this.tracker.getProvenance();
    (provenance as { sessionId: string }).sessionId = realSession.id;

    const recipe = this.distiller.distill(realSession);

    this._session = { ...realSession };

    // Persist to disk
    await this._persist(realSession, provenance, recipe);

    this.emit('session_stop', { type: 'session_stop', sessionId: realSession.id });

    return {
      session: realSession,
      operations: summary.operations,
      provenance,
      recipe,
      branch: summary.branchName,
      baseCommit: summary.baseCommit,
      totalCommits: summary.totalCommits,
    };
  }

  /**
   * Distil the current operations into a Recipe without stopping the session.
   */
  distill(): Recipe {
    return this.distiller.distill(this._session);
  }

  /** Return the current provenance graph. */
  getProvenance(): ProvenanceGraph {
    return this.tracker.getProvenance();
  }

  /** Return operations recorded so far (does not include the worktree's own copy). */
  getOperations(): Operation[] {
    return [...this._session.operations];
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  private async _persist(
    session: Session,
    provenance: ProvenanceGraph,
    recipe: Recipe,
  ): Promise<void> {
    const sessionsDir = path.join(session.cwd, this.config.dataDir, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });

    const filePath = path.join(sessionsDir, `${session.id}.json`);
    const data: PersistedSession = { session, provenance, recipe };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Agentrace — static factory + registry
// ---------------------------------------------------------------------------

export class Agentrace {
  /**
   * Start a new session.  Delegates to AgentraceSession.start().
   */
  static async start(
    cwd: string,
    name: string,
    config: Partial<AgentraceConfig> = {},
  ): Promise<AgentraceSession> {
    return AgentraceSession.start(cwd, name, config);
  }

  /**
   * Load a previously saved session by id.
   * Returns the persisted Session object (read-only; not an AgentraceSession).
   */
  static async load(cwd: string, sessionId: string): Promise<Session> {
    const config = DEFAULT_CONFIG;
    const filePath = path.join(cwd, config.dataDir, 'sessions', `${sessionId}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as PersistedSession;
    return data.session;
  }

  /**
   * List all stored sessions for the given working directory.
   */
  static async list(cwd: string): Promise<Session[]> {
    const config = DEFAULT_CONFIG;
    const sessionsDir = path.join(cwd, config.dataDir, 'sessions');

    let entries: string[];
    try {
      entries = await fs.readdir(sessionsDir);
    } catch {
      return [];
    }

    const sessions: Session[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const filePath = path.join(sessionsDir, entry);
        const raw = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(raw) as PersistedSession;
        sessions.push(data.session);
      } catch {
        // Skip corrupted files
      }
    }

    return sessions.sort((a, b) => a.startedAt - b.startedAt);
  }
}
