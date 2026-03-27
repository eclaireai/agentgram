/**
 * Audit Report Generator
 *
 * Converts a CognitiveTrace + SignedTrace into a structured audit report
 * readable by compliance officers, auditors, and legal teams.
 *
 * Output formats: JSON (machine) + Markdown (human)
 */

import type { AuditReport } from './types.js';
import type { SignedTrace } from './types.js';
import type { CognitiveTrace } from '../cognitive/trace.js';
import { verifySignedTrace } from './sign.js';

// ---------------------------------------------------------------------------
// Extract structured fields from CognitiveTrace
// ---------------------------------------------------------------------------

function extractFilesModified(trace: CognitiveTrace): string[] {
  return [
    ...new Set(
      trace.events
        .filter((e) => e.operation.type === 'write' && !e.isDeadEnd)
        .map((e) => e.operation.target)
    ),
  ];
}

function extractFilesCreated(trace: CognitiveTrace): string[] {
  return [
    ...new Set(
      trace.events
        .filter((e) => e.operation.type === 'create' && !e.isDeadEnd)
        .map((e) => e.operation.target)
    ),
  ];
}

function extractCommandsExecuted(trace: CognitiveTrace): string[] {
  return [
    ...new Set(
      trace.events
        .filter((e) => e.operation.type === 'exec' && !e.isDeadEnd)
        .map((e) => e.operation.metadata?.command ?? e.operation.target)
        .filter(Boolean)
    ),
  ] as string[];
}

function buildSummary(trace: CognitiveTrace): string {
  const modifiedCount = extractFilesModified(trace).length;
  const createdCount = extractFilesCreated(trace).length;
  const commandCount = extractCommandsExecuted(trace).length;
  const deadEndCount = trace.deadEnds.length;
  const decisionCount = trace.events.filter((e) => e.isDecisionPoint).length;

  const parts: string[] = [];
  parts.push(`AI agent session "${trace.sessionId.slice(0, 12)}".`);

  if (trace.initialIntent) parts.push(`Intent: ${trace.initialIntent}.`);

  const changes: string[] = [];
  if (createdCount > 0) changes.push(`created ${createdCount} file${createdCount > 1 ? 's' : ''}`);
  if (modifiedCount > 0) changes.push(`modified ${modifiedCount} file${modifiedCount > 1 ? 's' : ''}`);
  if (commandCount > 0) changes.push(`executed ${commandCount} command${commandCount > 1 ? 's' : ''}`);
  if (changes.length > 0) parts.push(`Agent ${changes.join(', ')}.`);

  if (deadEndCount > 0) {
    parts.push(`${deadEndCount} dead end${deadEndCount > 1 ? 's' : ''} detected and self-corrected.`);
  }
  if (decisionCount > 0) {
    parts.push(`${decisionCount} explicit decision point${decisionCount > 1 ? 's' : ''} recorded.`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Core: generateAuditReport
// ---------------------------------------------------------------------------

export function generateAuditReport(
  trace: CognitiveTrace,
  signed: SignedTrace,
  chainIntact: boolean,
  developer?: string,
): AuditReport {
  const { signatureValid } = verifySignedTrace(signed);

  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    sessionId: trace.sessionId,
    developer,
    intent: trace.initialIntent ?? 'Not specified',
    filesModified: extractFilesModified(trace),
    filesCreated: extractFilesCreated(trace),
    commandsExecuted: extractCommandsExecuted(trace),
    deadEnds: trace.deadEnds.map((de) => ({
      description: de.reason,
      resolution: de.undoneBy.metadata?.command ?? de.undoneBy.type,
      tokensWasted: de.estimatedTokensWasted,
    })),
    decisionPoints: trace.decisionPoints.map((dp) => ({
      description: dp.reasoning,
      chosen: dp.chosen,
      alternatives: dp.alternatives.map((a) => `${a.description} (rejected: ${a.rejectedBecause})`),
    })),
    signatureValid,
    chainIntact,
    keyId: signed.keyId,
    signedAt: signed.signedAt,
    chainIndex: signed.chainIndex,
    summary: buildSummary(trace),
  };
}

// ---------------------------------------------------------------------------
// Markdown formatter — for human readers
// ---------------------------------------------------------------------------

export function formatAuditReportMarkdown(report: AuditReport): string {
  const sigIcon = report.signatureValid ? '✅' : '❌';
  const chainIcon = report.chainIntact ? '✅' : '❌';
  const date = new Date(report.generatedAt).toUTCString();

  const deadEndSection = report.deadEnds.length > 0
    ? `\n## Dead Ends (Self-Corrected)\n\n${report.deadEnds.map((de, i) =>
      `${i + 1}. **${de.description}**\n   - Resolution: \`${de.resolution}\`\n   - Tokens wasted: ~${de.tokensWasted}`
    ).join('\n\n')}\n`
    : '';

  const decisionSection = report.decisionPoints.length > 0
    ? `\n## Decision Points\n\n${report.decisionPoints.map((dp, i) =>
      `${i + 1}. **${dp.description}**\n   - Chosen: ${dp.chosen}\n   - Alternatives considered: ${dp.alternatives.join(', ') || 'none'}`
    ).join('\n\n')}\n`
    : '';

  return `# Audit Report — Session \`${report.sessionId}\`

**Generated:** ${date}
**Developer:** ${report.developer ?? 'Not specified'}
**Intent:** ${report.intent}

## Integrity

| Check | Status |
|-------|--------|
| Signature valid | ${sigIcon} ${report.signatureValid ? 'Verified' : 'INVALID'} |
| Chain intact | ${chainIcon} ${report.chainIntact ? 'Intact' : 'BROKEN'} |
| Key ID | \`${report.keyId}\` |
| Signed at | ${report.signedAt} |
| Chain index | ${report.chainIndex} |

## Summary

${report.summary}

## Files Created (${report.filesCreated.length})

${report.filesCreated.length > 0
  ? report.filesCreated.map((f) => `- \`${f}\``).join('\n')
  : '_None_'}

## Files Modified (${report.filesModified.length})

${report.filesModified.length > 0
  ? report.filesModified.map((f) => `- \`${f}\``).join('\n')
  : '_None_'}

## Commands Executed (${report.commandsExecuted.length})

${report.commandsExecuted.length > 0
  ? report.commandsExecuted.map((c) => `- \`${c}\``).join('\n')
  : '_None_'}
${deadEndSection}${decisionSection}

---
*Generated by [agentgram TraceVault](https://github.com/eclaireai/agentgram) — tamper-evident AI session audit trail*
`;
}

// ---------------------------------------------------------------------------
// JSON formatter — for machine processing
// ---------------------------------------------------------------------------

export function formatAuditReportJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
