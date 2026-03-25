/**
 * Enriched Recipes — Recipes with provenance explanations attached.
 *
 * Each step gets:
 *   - `why`: causal explanations ("informed by reading auth.ts")
 *   - `preconditions`: what must happen before this step
 *   - `intent`: the human reason from the original operation
 *
 * This transforms a recipe from "WHAT to do" into "WHY to do it",
 * enabling adaptive execution — agents can adjust when context differs.
 */

import type { Session, Recipe, RecipeStep, ProvenanceGraph, Operation } from '../core/types.js';

export interface EnrichedStep extends RecipeStep {
  /** Causal explanations: why this step is needed */
  why?: string[];
  /** What must be done before this step */
  preconditions?: string[];
  /** Original intent from the agent's reasoning */
  intent?: string;
}

export interface EnrichedRecipe extends Omit<Recipe, 'steps'> {
  steps: EnrichedStep[];
  /** Full provenance graph for the recipe */
  provenance: ProvenanceGraph;
}

/**
 * Match a recipe step back to operations that produced it.
 * Heuristic: match by action↔type and target overlap.
 */
function findMatchingOps(step: RecipeStep, ops: Operation[]): Operation[] {
  return ops.filter((op) => {
    const targetMatch =
      op.target === step.target ||
      op.target.endsWith(step.target) ||
      step.target.endsWith(op.target) ||
      (step.pattern && step.pattern.split(', ').some((p) => op.target.includes(p)));

    const typeMatch =
      (step.action === 'find' && op.type === 'read') ||
      (step.action === 'modify_file' && op.type === 'write') ||
      (step.action === 'create_file' && op.type === 'create') ||
      (step.action === 'run_command' && op.type === 'exec') ||
      (step.action === 'delete' && op.type === 'delete') ||
      step.action === op.type;

    return targetMatch && typeMatch;
  });
}

/**
 * Enrich a recipe with causal provenance data.
 */
export function enrichRecipeWithProvenance(
  recipe: Recipe,
  provenance: ProvenanceGraph,
  session: Session,
): EnrichedRecipe {
  const ops = session.operations;

  const enrichedSteps: EnrichedStep[] = recipe.steps.map((step) => {
    const matchedOps = findMatchingOps(step, ops);

    // Build "why" — trace back causal edges to find what informed this step
    const why: string[] = [];
    const preconditions: string[] = [];

    for (const op of matchedOps) {
      // Find all edges pointing TO this operation
      const incomingEdges = provenance.edges.filter((e) => e.to === op.id);

      for (const edge of incomingEdges) {
        const sourceNode = provenance.nodes.find((n) => n.operationId === edge.from);
        if (!sourceNode) continue;

        if (edge.relation === 'informed') {
          why.push(`Informed by reading ${sourceNode.target}`);
        } else if (edge.relation === 'depends_on') {
          why.push(`Depends on config: ${sourceNode.target}`);
        } else if (edge.relation === 'triggered') {
          preconditions.push(`After: ${sourceNode.type} ${sourceNode.target}`);
        }
      }
    }

    // Build "intent" — gather reasons from matched operations
    const reasons = matchedOps
      .map((op) => op.reason)
      .filter((r): r is string => Boolean(r));
    const intent = reasons.length > 0 ? reasons.join('; ') : undefined;

    return {
      ...step,
      why: why.length > 0 ? why : undefined,
      preconditions: preconditions.length > 0 ? preconditions : undefined,
      intent,
    };
  });

  return {
    ...recipe,
    steps: enrichedSteps,
    provenance,
  };
}
