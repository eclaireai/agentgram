/**
 * Recipe Distillation module
 *
 * Compresses a raw agent session trace into a high-level, reusable "recipe"
 * that can be shared and replayed.
 */

import yaml from 'yaml';
import type { Session, Operation, Recipe, RecipeStep } from '../core/types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type WriteAction = 'modify_file' | 'create_file';

/** Group a flat list of operations into logical "phases" separated by exec ops. */
function groupByPhase(ops: Operation[]): Operation[][] {
  const phases: Operation[][] = [];
  let current: Operation[] = [];

  for (const op of ops) {
    if (op.type === 'exec') {
      if (current.length > 0) {
        phases.push(current);
        current = [];
      }
      phases.push([op]);
    } else {
      current.push(op);
    }
  }

  if (current.length > 0) phases.push(current);
  return phases;
}

/**
 * Detect and compress test-fix cycles:
 * [exec(test,fail), reads+writes, exec(test,pass)] → [exec(test)]
 *
 * Also merges consecutive exec phases with the same command.
 */
function compressExecCycles(phases: Operation[][]): Operation[][] {
  const result: Operation[][] = [];
  let i = 0;

  while (i < phases.length) {
    const phase = phases[i];

    // Detect test-fix cycle: exec(fail) → [read/write ops] → exec(same cmd, pass)
    if (
      phase.length === 1 &&
      phase[0].type === 'exec' &&
      phase[0].metadata.exitCode !== undefined &&
      phase[0].metadata.exitCode !== 0
    ) {
      const failedCmd = phase[0].metadata.command ?? phase[0].target;
      // Look ahead for non-exec phases followed by a passing exec with same command
      let j = i + 1;
      let foundFix = false;
      while (j < phases.length) {
        const lookahead = phases[j];
        if (lookahead.length === 1 && lookahead[0].type === 'exec') {
          const lookaheadCmd = lookahead[0].metadata.command ?? lookahead[0].target;
          if (lookaheadCmd === failedCmd) {
            // Collapse: drop the failing exec, merge fix ops into surrounding phase
            // Include all non-exec phases between i and j into a single fix phase
            const fixOps: Operation[] = [];
            for (let k = i + 1; k < j; k++) {
              fixOps.push(...phases[k]);
            }
            if (fixOps.length > 0) {
              result.push(fixOps);
            }
            // Push the final (successful) exec
            result.push(lookahead);
            i = j + 1;
            foundFix = true;
            break;
          }
          break; // Different exec command — stop looking
        }
        j++;
      }
      if (!foundFix) {
        result.push(phase);
        i++;
      }
      continue;
    }

    // Merge consecutive exec phases with the same command
    if (
      phase.length === 1 &&
      phase[0].type === 'exec' &&
      i + 1 < phases.length &&
      phases[i + 1].length === 1 &&
      phases[i + 1][0].type === 'exec'
    ) {
      const cmd1 = phase[0].metadata.command ?? phase[0].target;
      const cmd2 = phases[i + 1][0].metadata.command ?? phases[i + 1][0].target;
      if (cmd1 === cmd2) {
        // Keep the later one (it reflects the final state)
        result.push(phases[i + 1]);
        i += 2;
        continue;
      }
    }

    result.push(phase);
    i++;
  }

  return result;
}

/** Deduplicate write/create ops to the same target within a phase.
 *
 * Rules:
 * - consecutive writes to same target → keep last
 * - create followed by write(s) to same target → keep create (first), discard subsequent writes
 * - writes that follow a create for the same target (non-consecutive) → drop the writes
 */
function deduplicateWrites(ops: Operation[]): Operation[] {
  // First pass: merge consecutive same-target write ops
  const pass1: Operation[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === 'write' || op.type === 'create') {
      const target = op.target;
      const baseType = op.type;
      let last = op;
      // Merge consecutive same-target same-type ops
      while (
        i + 1 < ops.length &&
        (ops[i + 1].type === 'write' || ops[i + 1].type === 'create') &&
        ops[i + 1].target === target
      ) {
        i++;
        last = ops[i];
      }
      // If original was 'create' but last was 'write', keep 'create'
      if (baseType === 'create' && last.type === 'write') {
        pass1.push({ ...op, reason: last.reason ?? op.reason });
      } else {
        pass1.push(last);
      }
    } else {
      pass1.push(op);
    }
  }

  // Second pass: if a target was 'create'd earlier in the phase, drop any later writes to it
  const created = new Set<string>();
  const pass2: Operation[] = [];
  for (const op of pass1) {
    if (op.type === 'create') {
      created.add(op.target);
      pass2.push(op);
    } else if (op.type === 'write' && created.has(op.target)) {
      // Skip — already covered by create
    } else {
      pass2.push(op);
    }
  }

  return pass2;
}

/** Collapse consecutive read ops into a single synthetic "find" operation. */
function collapseReads(ops: Operation[]): Array<Operation | { kind: 'find'; targets: string[]; reason?: string }> {
  const result: Array<Operation | { kind: 'find'; targets: string[]; reason?: string }> = [];
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'read') {
      const targets: string[] = [op.target];
      const reasons: string[] = op.reason ? [op.reason] : [];
      while (i + 1 < ops.length && ops[i + 1].type === 'read') {
        i++;
        targets.push(ops[i].target);
        if (ops[i].reason) reasons.push(ops[i].reason!);
      }
      result.push({ kind: 'find', targets, reason: reasons[0] });
    } else {
      result.push(op);
    }
    i++;
  }

  return result;
}

/** Find the longest common path prefix among a list of file paths. */
function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) {
    // Return up to (but not including) the filename
    const lastSlash = paths[0].lastIndexOf('/');
    return lastSlash > 0 ? paths[0].slice(0, lastSlash) : '';
  }

  const parts = paths.map((p) => p.split('/'));
  const minLen = Math.min(...parts.map((p) => p.length));
  let prefix = '';
  for (let i = 0; i < minLen - 1; i++) {
    const segment = parts[0][i];
    if (parts.every((p) => p[i] === segment)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
    } else {
      break;
    }
  }
  return prefix;
}

/** Generate a step description from operation reason + action context. */
function buildDescription(action: string, targets: string | string[], reason?: string): string {
  const targetLabel = Array.isArray(targets)
    ? targets.length === 1
      ? targets[0]
      : `${targets.length} files`
    : targets;

  if (reason) {
    // Capitalize and use the reason directly when available
    const capitalized = reason.charAt(0).toUpperCase() + reason.slice(1);
    return capitalized;
  }

  switch (action) {
    case 'find':
      return `Read ${targetLabel}`;
    case 'modify_file':
      return `Modify ${targetLabel}`;
    case 'create_file':
      return `Create ${targetLabel}`;
    case 'run_command':
      return `Run \`${targetLabel}\``;
    default:
      return `${action} ${targetLabel}`;
  }
}

/** Decide whether a write op is a "create" or "modify". */
function writeAction(op: Operation): WriteAction {
  return op.type === 'create' ? 'create_file' : 'modify_file';
}

// ---------------------------------------------------------------------------
// RecipeDistiller
// ---------------------------------------------------------------------------

export class RecipeDistiller {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Distil a Session into a high-level Recipe.
   */
  distill(session: Session): Recipe {
    const sorted = [...session.operations].sort((a, b) => a.timestamp - b.timestamp);

    if (sorted.length === 0) {
      return this._emptyRecipe(session);
    }

    const steps = this._buildSteps(sorted);

    return {
      name: session.name || `Recipe from ${session.id}`,
      description: `Distilled from session ${session.id}`,
      sourceSessionId: session.id,
      steps,
      parameters: {},
      tags: [],
      version: '1.0.0',
    };
  }

  /**
   * Replace concrete path values in a Recipe with parameter variables.
   */
  parameterize(recipe: Recipe): Recipe {
    const allPaths = recipe.steps.flatMap((s) => [s.target]);
    const prefix = commonPathPrefix(allPaths);

    const parameters: Record<string, string> = {};
    if (prefix) {
      parameters['source_dir'] = prefix;
    }

    // Build a variable name for each unique directory prefix seen
    const dirMap = new Map<string, string>();
    for (const path of allPaths) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir && !dirMap.has(dir)) {
        const varName = this._dirToVarName(dir, prefix);
        dirMap.set(dir, varName);
        parameters[varName] = dir;
      }
    }

    const replaceTarget = (target: string): string => {
      // Try longest matching prefix first
      let best = '';
      let bestVar = '';
      for (const [dir, varName] of dirMap.entries()) {
        if (target.startsWith(dir) && dir.length > best.length) {
          best = dir;
          bestVar = varName;
        }
      }
      if (best) {
        return `{${bestVar}}${target.slice(best.length)}`;
      }
      return target;
    };

    const steps: RecipeStep[] = recipe.steps.map((s) => ({
      ...s,
      target: replaceTarget(s.target),
    }));

    return { ...recipe, steps, parameters };
  }

  /** Serialize a Recipe to YAML. */
  toYAML(recipe: Recipe): string {
    return yaml.stringify(recipe);
  }

  /** Deserialize a Recipe from YAML. */
  fromYAML(input: string): Recipe {
    const parsed = yaml.parse(input) as Recipe;
    return parsed;
  }

  /** Serialize a Recipe to JSON. */
  toJSON(recipe: Recipe): string {
    return JSON.stringify(recipe, null, 2);
  }

  /** Deserialize a Recipe from JSON. */
  fromJSON(input: string): Recipe {
    return JSON.parse(input) as Recipe;
  }

  /**
   * Render a Recipe as human-readable Markdown.
   */
  toMarkdown(recipe: Recipe): string {
    const lines: string[] = [];

    lines.push(`# ${recipe.name}`);
    lines.push('');
    lines.push(recipe.description);
    lines.push('');
    lines.push(`- **Version:** ${recipe.version}`);
    lines.push(`- **Source session:** ${recipe.sourceSessionId}`);

    if (recipe.tags.length > 0) {
      lines.push(`- **Tags:** ${recipe.tags.join(', ')}`);
    }

    if (Object.keys(recipe.parameters).length > 0) {
      lines.push('');
      lines.push('## Parameters');
      lines.push('');
      for (const [key, value] of Object.entries(recipe.parameters)) {
        lines.push(`- \`${key}\`: \`${value}\``);
      }
    }

    if (recipe.steps.length > 0) {
      lines.push('');
      lines.push('## Steps');
      lines.push('');
      recipe.steps.forEach((step, idx) => {
        lines.push(`### ${idx + 1}. \`${step.action}\``);
        lines.push('');
        lines.push(`**Target:** \`${step.target}\``);
        lines.push('');
        lines.push(step.description);
        if (step.pattern) {
          lines.push('');
          lines.push(`**Pattern:** ${step.pattern}`);
        }
        if (step.expect) {
          lines.push('');
          lines.push(`**Expected:** ${step.expect}`);
        }
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  /**
   * Merge multiple recipes into a single combined recipe.
   */
  static merge(recipes: Recipe[]): Recipe {
    if (recipes.length === 0) {
      return {
        name: 'Merged Recipe',
        description: 'Merged from multiple recipes',
        sourceSessionId: '',
        steps: [],
        parameters: {},
        tags: [],
        version: '1.0.0',
      };
    }

    if (recipes.length === 1) {
      return { ...recipes[0] };
    }

    // Combine steps, deduplicating by (action, target)
    const seen = new Set<string>();
    const steps: RecipeStep[] = [];

    for (const recipe of recipes) {
      for (const step of recipe.steps) {
        const key = `${step.action}:${step.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          steps.push(step);
        }
      }
    }

    // Merge parameters
    const parameters: Record<string, string> = {};
    for (const recipe of recipes) {
      Object.assign(parameters, recipe.parameters);
    }

    // Merge tags
    const tagSet = new Set<string>();
    for (const recipe of recipes) {
      recipe.tags.forEach((t) => tagSet.add(t));
    }

    return {
      name: `Merged: ${recipes.map((r) => r.name).join(', ')}`,
      description: `Merged from ${recipes.length} recipes`,
      sourceSessionId: recipes.map((r) => r.sourceSessionId).filter(Boolean).join(', '),
      steps,
      parameters,
      tags: [...tagSet],
      version: '1.0.0',
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _emptyRecipe(session: Session): Recipe {
    return {
      name: session.name || `Recipe from ${session.id}`,
      description: `Distilled from session ${session.id}`,
      sourceSessionId: session.id,
      steps: [],
      parameters: {},
      tags: [],
      version: '1.0.0',
    };
  }

  /**
   * Core distillation algorithm:
   * 1. Sort by timestamp
   * 2. Phase-split on exec boundaries
   * 3. Within each non-exec phase: deduplicate writes then collapse reads
   * 4. Convert to RecipeStep[]
   */
  private _buildSteps(sorted: Operation[]): RecipeStep[] {
    const rawPhases = groupByPhase(sorted);
    const phases = compressExecCycles(rawPhases);
    const steps: RecipeStep[] = [];

    for (const phase of phases) {
      if (phase.length === 0) continue;

      // Single exec op
      if (phase.length === 1 && phase[0].type === 'exec') {
        const op = phase[0];
        const cmd = op.metadata.command ?? op.target;
        steps.push({
          action: 'run_command',
          target: cmd,
          description: buildDescription('run_command', cmd, op.reason),
        });
        continue;
      }

      // Non-exec phase: deduplicate writes, then collapse reads
      const deduped = deduplicateWrites(phase);
      const collapsed = collapseReads(deduped);

      // Further: collapse multiple writes to same target within this phase
      // (already handled by deduplicateWrites above)

      for (const item of collapsed) {
        if ('kind' in item && item.kind === 'find') {
          const primaryTarget =
            item.targets.length === 1
              ? item.targets[0]
              : commonPathPrefix(item.targets) || item.targets[0];
          steps.push({
            action: 'find',
            target: primaryTarget,
            description: buildDescription('find', item.targets, item.reason),
            pattern: item.targets.length > 1 ? item.targets.join(', ') : undefined,
          });
        } else {
          const op = item as Operation;
          const action = writeAction(op);
          steps.push({
            action,
            target: op.target,
            description: buildDescription(action, op.target, op.reason),
          });
        }
      }
    }

    // Final dedup pass: remove adjacent steps with same (action, target)
    return this._deduplicateAdjacentSteps(steps);
  }

  /** Remove adjacent steps that have the same action and target. */
  private _deduplicateAdjacentSteps(steps: RecipeStep[]): RecipeStep[] {
    const result: RecipeStep[] = [];
    for (const step of steps) {
      const prev = result[result.length - 1];
      if (prev && prev.action === step.action && prev.target === step.target) {
        // Keep the one with a richer description
        if (step.description.length > prev.description.length) {
          result[result.length - 1] = step;
        }
        continue;
      }
      result.push(step);
    }
    return result;
  }

  /** Convert a directory path into a snake_case variable name. */
  private _dirToVarName(dir: string, prefix: string): string {
    const relative = prefix && dir.startsWith(prefix) ? dir.slice(prefix.length + 1) : dir;
    const cleaned = relative
      .replace(/^\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    return cleaned || 'source_dir';
  }
}
