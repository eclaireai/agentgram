/**
 * Recipe Executor — Guides an agent through a recipe step-by-step,
 * tracks success/deviation/cost, and feeds back into the registry.
 *
 * Deeply integrated with AgentraceSession: listens to operation events
 * to match actual agent behavior against expected recipe steps.
 *
 * Usage:
 *   const session = await Agentrace.start(cwd, 'guided-run');
 *   const executor = new RecipeExecutor(recipe, session);
 *   executor.start();
 *   // ... agent does its work, session records operations ...
 *   const report = executor.finalize();
 */

import { EventEmitter } from 'node:events';
import type { Operation, Recipe, RecipeStep } from '../core/types.js';
import type { AgentraceSession } from '../core/session.js';
import type { SharedRecipe } from './types.js';

// ---------------------------------------------------------------------------
// Telemetry Types
// ---------------------------------------------------------------------------

/** Result of a single recipe step execution */
export interface StepResult {
  /** Recipe step index */
  stepIndex: number;
  /** The expected recipe step */
  expected: RecipeStep;
  /** Status of this step */
  status: 'completed' | 'skipped' | 'deviated' | 'failed' | 'pending';
  /** Operations that matched this step */
  matchedOperations: string[]; // operation IDs
  /** If deviated, what the agent actually did */
  deviation?: string;
  /** Time spent on this step (ms) */
  durationMs: number;
  /** Timestamp when step started */
  startedAt: number;
  /** Timestamp when step completed */
  completedAt?: number;
}

/** Cost metrics for the execution */
export interface CostMetrics {
  /** Total operations recorded during execution */
  totalOperations: number;
  /** Operations that directly matched recipe steps */
  onRecipeOperations: number;
  /** Extra operations not in the recipe (exploration, retries) */
  extraOperations: number;
  /** Estimated tokens saved vs. unguided (based on operation reduction) */
  estimatedTokensSaved: number;
  /** Efficiency ratio: recipe ops / total ops (1.0 = perfect adherence) */
  efficiency: number;
  /** Total execution time (ms) */
  totalDurationMs: number;
  /** Estimated cost without recipe (based on avg unguided session) */
  estimatedCostWithoutRecipe: number;
  /** Estimated cost with recipe */
  estimatedCostWithRecipe: number;
  /** Savings percentage */
  savingsPercent: number;
}

/** Complete execution report */
export interface ExecutionReport {
  /** Recipe that was executed */
  recipeId: string;
  recipeName: string;
  /** Session that recorded the execution */
  sessionId: string;
  /** Step-by-step results */
  steps: StepResult[];
  /** Aggregated metrics */
  metrics: CostMetrics;
  /** Overall success: all steps completed or deviated acceptably */
  success: boolean;
  /** Completion rate: completed steps / total steps */
  completionRate: number;
  /** Deviation rate: deviated steps / total steps */
  deviationRate: number;
  /** Computed score for the recipe (0-5 based on execution quality) */
  score: number;
  /** Timestamp */
  executedAt: string;
  /** Source agent */
  sourceAgent: string;
}

// ---------------------------------------------------------------------------
// Step Matching
// ---------------------------------------------------------------------------

/** Map recipe step actions to operation types */
function actionMatchesOpType(action: string, opType: string): boolean {
  switch (action) {
    case 'find':
    case 'read':
      return opType === 'read';
    case 'modify_file':
    case 'write':
      return opType === 'write';
    case 'create_file':
    case 'create':
      return opType === 'create';
    case 'delete':
      return opType === 'delete';
    case 'run_command':
    case 'exec':
      return opType === 'exec';
    default:
      return false;
  }
}

/** Check if an operation's target matches a recipe step's target (with parameter substitution) */
function targetMatches(
  opTarget: string,
  stepTarget: string,
  parameters: Record<string, string>,
): boolean {
  // Substitute parameters
  let resolved = stepTarget;
  for (const [key, value] of Object.entries(parameters)) {
    resolved = resolved.replace(`{${key}}`, value);
  }

  // Normalize paths
  const normOp = opTarget.replace(/\\/g, '/').replace(/^\.\//, '');
  const normStep = resolved.replace(/\\/g, '/').replace(/^\.\//, '');

  // Exact match
  if (normOp === normStep) return true;

  // One ends with the other (relative vs absolute)
  if (normOp.endsWith(normStep) || normStep.endsWith(normOp)) return true;

  // For exec commands, check if the command starts with the expected
  if (normOp.startsWith(normStep) || normStep.startsWith(normOp)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// RecipeExecutor
// ---------------------------------------------------------------------------

export class RecipeExecutor extends EventEmitter {
  private recipe: Recipe;
  private parameters: Record<string, string>;
  private session: AgentraceSession;
  private steps: StepResult[];
  private currentStepIndex: number = 0;
  private allOperations: Operation[] = [];
  private startTime: number = 0;
  private _finalized: boolean = false;
  private operationListener: ((event: { operation: Operation }) => void) | null = null;

  constructor(recipe: Recipe | SharedRecipe, session: AgentraceSession, parameters?: Record<string, string>) {
    super();
    this.recipe = recipe;
    this.parameters = parameters ?? recipe.parameters;
    this.session = session;

    // Initialize step results
    this.steps = recipe.steps.map((step, i) => ({
      stepIndex: i,
      expected: step,
      status: 'pending' as const,
      matchedOperations: [],
      durationMs: 0,
      startedAt: 0,
    }));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start tracking execution. Subscribes to session operation events.
   */
  start(): void {
    this.startTime = Date.now();
    if (this.steps.length > 0) {
      this.steps[0].startedAt = this.startTime;
    }

    this.operationListener = (event: { operation: Operation }) => {
      this.onOperation(event.operation);
    };
    this.session.on('operation', this.operationListener);

    this.emit('execution_start', {
      recipeId: this.getRecipeId(),
      recipeName: this.recipe.name,
      totalSteps: this.recipe.steps.length,
    });
  }

  /**
   * Get the current step the executor expects the agent to perform.
   */
  getCurrentStep(): RecipeStep | null {
    if (this.currentStepIndex >= this.recipe.steps.length) return null;
    return this.recipe.steps[this.currentStepIndex];
  }

  /**
   * Get a guidance prompt for the agent describing the current step.
   */
  getGuidance(): string {
    const step = this.getCurrentStep();
    if (!step) return 'All recipe steps completed.';

    const stepNum = this.currentStepIndex + 1;
    const total = this.recipe.steps.length;
    let target = step.target;

    // Substitute parameters
    for (const [key, value] of Object.entries(this.parameters)) {
      target = target.replace(`{${key}}`, value);
    }

    return `[Step ${stepNum}/${total}] ${step.action}: ${target}\n${step.description}`;
  }

  /**
   * Get progress summary.
   */
  getProgress(): { completed: number; total: number; current: string } {
    const completed = this.steps.filter((s) => s.status === 'completed').length;
    const current = this.getCurrentStep();
    return {
      completed,
      total: this.recipe.steps.length,
      current: current ? `${current.action}: ${current.target}` : 'done',
    };
  }

  /**
   * Finalize execution — compute metrics, generate report.
   * Call this when the agent is done (before or after session.stop()).
   */
  finalize(): ExecutionReport {
    if (this._finalized) {
      throw new Error('Execution already finalized');
    }
    this._finalized = true;

    // Unsubscribe from session events
    if (this.operationListener) {
      this.session.removeListener('operation', this.operationListener);
    }

    // Mark any remaining pending steps
    for (const step of this.steps) {
      if (step.status === 'pending') {
        step.status = 'skipped';
      }
      if (step.startedAt && !step.completedAt) {
        step.completedAt = Date.now();
        step.durationMs = step.completedAt - step.startedAt;
      }
    }

    const report = this.buildReport();

    this.emit('execution_complete', report);

    return report;
  }

  /**
   * Check if the executor has been finalized.
   */
  isFinalized(): boolean {
    return this._finalized;
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private onOperation(op: Operation): void {
    this.allOperations.push(op);

    if (this.currentStepIndex >= this.recipe.steps.length) {
      // Past the end of recipe — extra operations
      return;
    }

    const currentStep = this.steps[this.currentStepIndex];
    const expectedStep = this.recipe.steps[this.currentStepIndex];

    // Check if this operation matches the current expected step
    const matches = actionMatchesOpType(expectedStep.action, op.type)
      && targetMatches(op.target, expectedStep.target, this.parameters);

    if (matches) {
      // Step completed
      currentStep.status = 'completed';
      currentStep.matchedOperations.push(op.id);
      currentStep.completedAt = Date.now();
      currentStep.durationMs = currentStep.completedAt - currentStep.startedAt;

      this.emit('step_completed', {
        stepIndex: this.currentStepIndex,
        step: expectedStep,
        operationId: op.id,
      });

      // Advance to next step
      this.currentStepIndex++;
      if (this.currentStepIndex < this.steps.length) {
        this.steps[this.currentStepIndex].startedAt = Date.now();
      }
    } else {
      // Check if it matches a FUTURE step (agent skipped ahead)
      const futureMatch = this.findFutureStepMatch(op);
      if (futureMatch !== -1) {
        // Mark skipped steps as deviated
        for (let i = this.currentStepIndex; i < futureMatch; i++) {
          this.steps[i].status = 'deviated';
          this.steps[i].deviation = `Skipped — agent jumped to step ${futureMatch + 1}`;
          this.steps[i].completedAt = Date.now();
          this.steps[i].durationMs = this.steps[i].completedAt! - (this.steps[i].startedAt || Date.now());
        }

        // Complete the future step
        this.steps[futureMatch].status = 'completed';
        this.steps[futureMatch].matchedOperations.push(op.id);
        this.steps[futureMatch].startedAt = this.steps[futureMatch].startedAt || Date.now();
        this.steps[futureMatch].completedAt = Date.now();
        this.steps[futureMatch].durationMs = this.steps[futureMatch].completedAt - this.steps[futureMatch].startedAt;

        this.currentStepIndex = futureMatch + 1;
        if (this.currentStepIndex < this.steps.length) {
          this.steps[this.currentStepIndex].startedAt = Date.now();
        }

        this.emit('step_skipped', {
          from: currentStep.stepIndex,
          to: futureMatch,
        });
      }
      // Otherwise, it's an extra operation (exploration/retry) — tracked but not matched
    }
  }

  private findFutureStepMatch(op: Operation): number {
    for (let i = this.currentStepIndex + 1; i < this.recipe.steps.length; i++) {
      if (this.steps[i].status !== 'pending') continue;
      const step = this.recipe.steps[i];
      if (actionMatchesOpType(step.action, op.type)
        && targetMatches(op.target, step.target, this.parameters)) {
        return i;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Report building
  // ---------------------------------------------------------------------------

  private buildReport(): ExecutionReport {
    const totalSteps = this.steps.length;
    const completed = this.steps.filter((s) => s.status === 'completed').length;
    const deviated = this.steps.filter((s) => s.status === 'deviated').length;
    const failed = this.steps.filter((s) => s.status === 'failed').length;
    const skipped = this.steps.filter((s) => s.status === 'skipped').length;

    const completionRate = totalSteps > 0 ? completed / totalSteps : 0;
    const deviationRate = totalSteps > 0 ? deviated / totalSteps : 0;

    // Cost metrics
    const onRecipeOps = this.steps.reduce((sum, s) => sum + s.matchedOperations.length, 0);
    const totalOps = this.allOperations.length;
    const extraOps = totalOps - onRecipeOps;
    const efficiency = totalOps > 0 ? onRecipeOps / totalOps : 1;
    const totalDuration = Date.now() - this.startTime;

    // Cost estimation (rough: ~$0.05 per operation for reasoning agent)
    const costPerOp = 0.05;
    const avgUnguidedOps = totalSteps * 6; // avg 6 ops per recipe step without guidance
    const estimatedCostWithout = avgUnguidedOps * costPerOp;
    const estimatedCostWith = totalOps * costPerOp;
    const savingsPercent = estimatedCostWithout > 0
      ? ((estimatedCostWithout - estimatedCostWith) / estimatedCostWithout) * 100
      : 0;

    const estimatedTokensSaved = Math.max(0, (avgUnguidedOps - totalOps) * 2000); // ~2000 tokens per op

    // Score: 0-5 based on completion, deviation, and efficiency
    let score = 0;
    score += completionRate * 2.5;          // Up to 2.5 for completion
    score += (1 - deviationRate) * 1.0;     // Up to 1.0 for no deviations
    score += efficiency * 1.0;              // Up to 1.0 for efficiency
    score += (failed === 0 && skipped === 0) ? 0.5 : 0; // 0.5 bonus for clean run
    score = Math.min(5, Math.round(score * 10) / 10);

    const success = completed + deviated >= totalSteps * 0.7 && failed === 0;

    const metrics: CostMetrics = {
      totalOperations: totalOps,
      onRecipeOperations: onRecipeOps,
      extraOperations: extraOps,
      estimatedTokensSaved,
      efficiency,
      totalDurationMs: totalDuration,
      estimatedCostWithoutRecipe: Math.round(estimatedCostWithout * 100) / 100,
      estimatedCostWithRecipe: Math.round(estimatedCostWith * 100) / 100,
      savingsPercent: Math.round(savingsPercent),
    };

    return {
      recipeId: this.getRecipeId(),
      recipeName: this.recipe.name,
      sessionId: '', // will be set by caller after session.stop()
      steps: this.steps,
      metrics,
      success,
      completionRate: Math.round(completionRate * 100) / 100,
      deviationRate: Math.round(deviationRate * 100) / 100,
      score,
      executedAt: new Date().toISOString(),
      sourceAgent: 'metadata' in this.recipe
        ? (this.recipe as SharedRecipe).metadata.sourceAgent
        : 'unknown',
    };
  }

  private getRecipeId(): string {
    if ('metadata' in this.recipe) {
      return (this.recipe as SharedRecipe).metadata.id;
    }
    return this.recipe.sourceSessionId || 'local';
  }
}

// ---------------------------------------------------------------------------
// Feedback: update recipe rating in registry
// ---------------------------------------------------------------------------

/**
 * Submit execution feedback to update a recipe's rating in the registry.
 */
export async function submitFeedback(
  report: ExecutionReport,
  registry: { publish: (recipe: SharedRecipe) => Promise<string> },
  store: { load: (id: string) => Promise<SharedRecipe>; save: (recipe: SharedRecipe) => Promise<void> },
): Promise<void> {
  try {
    const recipe = await store.load(report.recipeId);

    // Update rating (weighted average)
    const oldTotal = recipe.metadata.rating * recipe.metadata.ratingCount;
    recipe.metadata.ratingCount += 1;
    recipe.metadata.rating = Math.round(((oldTotal + report.score) / recipe.metadata.ratingCount) * 10) / 10;
    recipe.metadata.updatedAt = new Date().toISOString();

    // Save locally
    await store.save(recipe);
  } catch {
    // Recipe not in local store — skip feedback
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Save an execution report to disk.
 */
export async function saveReport(cwd: string, report: ExecutionReport): Promise<string> {
  const reportsDir = path.join(cwd, '.agentgram', 'reports');
  await fs.mkdir(reportsDir, { recursive: true });

  const filename = `${report.recipeId}-${Date.now().toString(36)}.json`;
  const filepath = path.join(reportsDir, filename);
  await fs.writeFile(filepath, JSON.stringify(report, null, 2), 'utf8');

  return filepath;
}

/**
 * Load all execution reports for a recipe.
 */
export async function loadReports(cwd: string, recipeId?: string): Promise<ExecutionReport[]> {
  const reportsDir = path.join(cwd, '.agentgram', 'reports');
  let entries: string[];
  try {
    entries = await fs.readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: ExecutionReport[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    if (recipeId && !entry.startsWith(recipeId)) continue;

    try {
      const raw = await fs.readFile(path.join(reportsDir, entry), 'utf8');
      reports.push(JSON.parse(raw) as ExecutionReport);
    } catch {
      // skip corrupted
    }
  }

  return reports.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
}
