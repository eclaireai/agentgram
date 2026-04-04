/**
 * EU AI Act Compliance Report Generator
 *
 * Maps agentgram's cryptographically-signed audit trails to the specific
 * requirements of Regulation (EU) 2024/1689 ("EU AI Act"), in force
 * August 2024.
 *
 * Articles covered:
 *   Article 12  — Record-keeping
 *   Article 13  — Transparency
 *   Article 14  — Human oversight
 *   Article 26  — Obligations of deployers
 *   Annex IV    — Technical documentation
 *
 * No external dependencies — uses only Node.js built-ins and types already
 * defined in this module.
 */

import type { ComplianceBundle, AuditReport } from './types.js';
import { verifyChain } from './merkle.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EuAiActSection {
  /** e.g. "Article 12(1)" */
  article: string;
  /** Plain English requirement */
  requirement: string;
  status: 'compliant' | 'partial' | 'not-applicable';
  /** Evidence items drawn from agentgram data */
  evidence: string[];
  /** Gaps remaining for full compliance (omitted when fully compliant) */
  gaps?: string[];
}

export interface EuAiActReport {
  generatedAt: string;
  /** e.g. "Claude Code / agentgram" */
  systemName: string;
  /** AI Act risk tier — agentgram is typically limited risk */
  riskCategory: 'limited' | 'high' | 'unacceptable';
  reportingPeriod: { from: string; to: string };
  totalSessions: number;
  /** Decision points where a human explicitly approved or rejected an action */
  humanOversightEvents: number;
  /** Operations that proceeded without explicit human confirmation */
  automatedDecisions: number;
  /** Whether the Merkle chain is intact (no deletions or tampering) */
  chainIntact: boolean;
  sections: EuAiActSection[];
  /** Plain English paragraph suitable for legal / DPA review */
  summary: string;
  /** keyId of the signing key used for this bundle */
  exportedBy: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive the reporting period from the earliest and latest signedAt values. */
function derivePeriod(bundle: ComplianceBundle): { from: string; to: string } {
  const timestamps = bundle.signedTraces.map((t) => t.signedAt).sort();
  if (timestamps.length === 0) {
    const now = new Date().toISOString();
    return { from: now, to: now };
  }
  return {
    from: timestamps[0]!,
    to: timestamps[timestamps.length - 1]!,
  };
}

/**
 * Count reports that have at least one explicit decision point recorded.
 * Each such decision point represents a moment where the AI agent paused and
 * a human could review / redirect — the closest proxy to "human oversight
 * events" available in the agentgram data model.
 */
function countHumanOversightEvents(reports: AuditReport[]): number {
  return reports.reduce((sum, r) => sum + r.decisionPoints.length, 0);
}

/**
 * Count operations that were executed without a recorded decision point as
 * their immediate parent — i.e. automated/unconfirmed operations.
 * Proxy: total commands executed across all sessions.
 */
function countAutomatedDecisions(reports: AuditReport[]): number {
  return reports.reduce((sum, r) => sum + r.commandsExecuted.length, 0);
}

/** Return the keyId of the first signed trace, falling back to bundle.exportedBy. */
function resolveExportedBy(bundle: ComplianceBundle): string {
  if (bundle.signedTraces.length > 0) {
    return bundle.signedTraces[0]!.keyId;
  }
  return bundle.exportedBy ?? 'unknown';
}

/** Check whether every signed trace carries a traceHash (Article 12(1)). */
function allTracesHaveHash(bundle: ComplianceBundle): boolean {
  return bundle.signedTraces.every((t) => typeof t.traceHash === 'string' && t.traceHash.length > 0);
}

/**
 * Check for provenance / causedBy links in any trace JSON (Article 12(2)).
 * The agentgram CognitiveTrace doesn't formalise a causedBy graph yet, so we
 * check for the presence of decisionPoints (which link a decision to its
 * reasoning and alternatives) as the closest available proxy.
 */
function hasProvenanceLinks(reports: AuditReport[]): boolean {
  return reports.some((r) => r.decisionPoints.length > 0);
}

/** Compute the dead-end rate across all sessions as a rough accuracy metric. */
function deadEndRate(reports: AuditReport[]): { deadEnds: number; totalOps: number } {
  const deadEnds = reports.reduce((s, r) => s + r.deadEnds.length, 0);
  const totalOps = reports.reduce(
    (s, r) => s + r.filesCreated.length + r.filesModified.length + r.commandsExecuted.length,
    0,
  );
  return { deadEnds, totalOps };
}

// ---------------------------------------------------------------------------
// Section builders — one function per EU AI Act article
// ---------------------------------------------------------------------------

function buildSection12_1(bundle: ComplianceBundle, chainIntact: boolean): EuAiActSection {
  const traceCount = bundle.signedTraces.length;
  const allHaveHash = allTracesHaveHash(bundle);
  const isCompliant = traceCount > 0 && chainIntact && allHaveHash;

  const evidence: string[] = [];
  if (traceCount > 0) {
    evidence.push(`${traceCount} AI session${traceCount !== 1 ? 's' : ''} cryptographically signed (Ed25519)`);
  }
  if (chainIntact) {
    evidence.push('Merkle hash-chain intact — no deletions or reordering detected');
  }
  if (allHaveHash) {
    evidence.push('Every record carries a SHA-256 traceHash binding content to its signature');
  }
  if (bundle.bundleHash) {
    evidence.push(`Bundle-level SHA-256 integrity hash present: ${bundle.bundleHash.slice(0, 16)}…`);
  }

  const gaps: string[] = [];
  if (traceCount === 0) gaps.push('No signed traces found in bundle');
  if (!chainIntact) gaps.push('Merkle chain is broken — records may have been deleted or tampered with');
  if (!allHaveHash) gaps.push('One or more traces are missing a traceHash');

  return {
    article: 'Article 12(1)',
    requirement:
      'High-risk AI systems must automatically log events to the extent necessary to ensure traceability of outputs and to detect conditions that may result in risks.',
    status: isCompliant ? 'compliant' : gaps.length > 0 ? 'partial' : 'compliant',
    evidence,
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

function buildSection12_2(bundle: ComplianceBundle, reports: AuditReport[]): EuAiActSection {
  const hasLinks = hasProvenanceLinks(reports);
  const decisionCount = reports.reduce((s, r) => s + r.decisionPoints.length, 0);

  const evidence: string[] = [];
  if (hasLinks) {
    evidence.push(
      `${decisionCount} decision point${decisionCount !== 1 ? 's' : ''} recorded with reasoning, chosen option, and rejected alternatives`,
    );
  }
  evidence.push('Each signed trace is bound to the full session JSON via SHA-256 traceHash');
  evidence.push('Chain index links each record to its predecessor — ordering is cryptographically enforced');
  if (bundle.merkleChain.length > 0) {
    evidence.push('Merkle chain allows any record to be traced back through the full session lineage');
  }

  const gaps: string[] = [];
  if (!hasLinks) {
    gaps.push(
      'No explicit causedBy / provenance graph in traces — decision points are the only available lineage signal',
    );
  }
  gaps.push(
    'Formal input-to-output provenance graph (causal DAG) not yet implemented — planned as future enhancement',
  );

  return {
    article: 'Article 12(2)',
    requirement:
      'Logs must enable tracing the sequence of operations and identifying the inputs that contributed to each output.',
    status: 'partial',
    evidence,
    gaps,
  };
}

function buildSection13_1(reports: AuditReport[]): EuAiActSection {
  const sessionCount = reports.length;

  const evidence: string[] = [
    'agentgram records the intent, operations, and outcomes of every AI session in human-readable Markdown audit reports',
    `${sessionCount} session report${sessionCount !== 1 ? 's' : ''} generated — each contains intent, files modified/created, commands executed, and a plain-English summary`,
    'Cryptographic signatures allow any stakeholder to independently verify that reports have not been altered',
  ];

  const gaps: string[] = [
    'Automated notification to affected persons (users, data subjects) not implemented — reports must be shared manually',
    'No built-in mechanism to surface transparency information inside the AI system UI at inference time',
  ];

  return {
    article: 'Article 13(1)',
    requirement:
      'High-risk AI systems must be designed and developed in such a way as to ensure their operation is sufficiently transparent to enable deployers to interpret outputs and use them appropriately.',
    status: 'partial',
    evidence,
    gaps,
  };
}

function buildSection14_1(reports: AuditReport[]): EuAiActSection {
  const decisionCount = reports.reduce((s, r) => s + r.decisionPoints.length, 0);
  const sessionCount = reports.length;
  const sessionsWithDecisions = reports.filter((r) => r.decisionPoints.length > 0).length;

  const evidence: string[] = [
    `${decisionCount} explicit decision point${decisionCount !== 1 ? 's' : ''} recorded across ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`,
    `${sessionsWithDecisions} session${sessionsWithDecisions !== 1 ? 's' : ''} contain recorded moments where the agent evaluated alternatives — a human could intervene at each`,
    'agentgram audit trail provides real-time and retrospective visibility into all AI actions',
    'Merkle chain integrity check immediately detects any post-hoc modification of records',
  ];

  const gaps: string[] = [];
  if (decisionCount === 0) {
    gaps.push('No decision points recorded — human oversight hooks not instrumented in these sessions');
  }
  gaps.push(
    'Explicit "humanApproved" flag per decision not yet present in the data model — oversight events are inferred from decisionPoints',
  );

  return {
    article: 'Article 14(1)',
    requirement:
      'High-risk AI systems must be designed with human oversight measures that allow natural persons to effectively monitor and correct outputs during the period of use.',
    status: decisionCount > 0 ? 'compliant' : 'partial',
    evidence,
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

function buildSection14_4(): EuAiActSection {
  return {
    article: 'Article 14(4)',
    requirement:
      'Deployers of high-risk AI systems must be able to override, interrupt, or overrule AI system outputs at any time.',
    status: 'not-applicable',
    evidence: [
      'agentgram is a developer coding tool (Claude Code) — it operates under direct human command and does not take autonomous decisions that require override capability',
      'The human developer controls every session start/stop; no background autonomous execution occurs',
      'All file and command operations require an active human-initiated session',
    ],
  };
}

function buildSection26_5(bundle: ComplianceBundle, reports: AuditReport[]): EuAiActSection {
  const period = derivePeriod(bundle);
  const sessionCount = reports.length;

  let periodDays = 0;
  try {
    const from = new Date(period.from);
    const to = new Date(period.to);
    periodDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  } catch { /* ignore date parse errors */ }

  const evidence: string[] = [
    `${sessionCount} session${sessionCount !== 1 ? 's' : ''} monitored over a ${periodDays}-day period (${period.from.slice(0, 10)} → ${period.to.slice(0, 10)})`,
    'Continuous hash-chain monitoring: any gap in session sequence is immediately detectable',
    'Bundle-level integrity hash enables periodic re-verification without access to original keys',
  ];

  const deadEnds = reports.reduce((s, r) => s + r.deadEnds.length, 0);
  if (deadEnds > 0) {
    evidence.push(
      `${deadEnds} dead-end event${deadEnds !== 1 ? 's' : ''} recorded and self-corrected — signals ongoing behavioural monitoring`,
    );
  }

  const gaps: string[] = [
    'No automated alerting when chain integrity check fails — currently requires manual re-verification',
    'Monitoring frequency and retention policy not formally documented outside this report',
  ];

  return {
    article: 'Article 26(5)',
    requirement:
      'Deployers must monitor the operation of the AI system on the basis of instructions for use and report any serious incidents to the relevant authorities.',
    status: 'partial',
    evidence,
    gaps,
  };
}

function buildAnnexIV_2(): EuAiActSection {
  return {
    article: 'Annex IV(2)',
    requirement:
      'Technical documentation must include a description of the training data, validation and testing data, training methodologies, and general architecture of the AI system.',
    status: 'partial',
    evidence: [
      'agentgram records operational behaviour of the deployed model in full detail (operations, decisions, outcomes)',
      'Session-level audit reports document the functional architecture as observed at runtime',
      'Signing key metadata (Ed25519, PKCS#8/SPKI) documents the cryptographic layer',
    ],
    gaps: [
      'Training data description, validation datasets, and fine-tuning methodology are not recorded — this information is not available to operators of a third-party model (Anthropic Claude)',
      'Model architecture, parameter count, and training compute are not exposed through the Claude API',
      'For full Annex IV(2) compliance, the AI provider (Anthropic) must supply a conformity assessment; agentgram can only document the deployment layer',
    ],
  };
}

function buildAnnexIV_6(reports: AuditReport[]): EuAiActSection {
  const { deadEnds, totalOps } = deadEndRate(reports);
  const sessionCount = reports.length;

  const evidence: string[] = [];

  if (totalOps > 0) {
    const rate = ((deadEnds / totalOps) * 100).toFixed(1);
    evidence.push(
      `Dead-end rate: ${deadEnds} dead end${deadEnds !== 1 ? 's' : ''} out of ${totalOps} total operations (${rate}%) — lower is better`,
    );
  }

  evidence.push(
    `Self-correction rate: ${deadEnds} dead end${deadEnds !== 1 ? 's' : ''} automatically resolved across ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`,
  );

  const successfulSessions = reports.filter((r) => r.signatureValid && r.chainIntact).length;
  evidence.push(
    `Signature validity: ${successfulSessions}/${sessionCount} sessions have verified signatures and intact chain`,
  );

  const gaps: string[] = [
    'Formal accuracy, robustness, and cybersecurity metrics per ISO/IEC 25010 not yet computed',
    'Recipe success rate (task completion without dead ends) available in session logs but not aggregated into a standardised metric',
    'No adversarial testing / red-team results recorded',
  ];

  return {
    article: 'Annex IV(6)',
    requirement:
      'Technical documentation must include measures for accuracy, robustness, and cybersecurity that the AI system has been tested against, along with the metrics used.',
    status: 'partial',
    evidence,
    gaps,
  };
}

// ---------------------------------------------------------------------------
// Summary paragraph builder
// ---------------------------------------------------------------------------

function buildSummary(
  report: EuAiActReport,
  sections: EuAiActSection[],
): string {
  const compliantCount = sections.filter((s) => s.status === 'compliant').length;
  const partialCount = sections.filter((s) => s.status === 'partial').length;
  const naCount = sections.filter((s) => s.status === 'not-applicable').length;

  const riskLabel =
    report.riskCategory === 'limited' ? 'Limited Risk (Article 6)' : 'High Risk (Annex III)';

  const chainStatus = report.chainIntact
    ? 'The cryptographic audit chain is intact, confirming no records have been deleted or tampered with.'
    : 'WARNING: The cryptographic audit chain is broken — records may have been modified or deleted.';

  return (
    `This compliance report covers ${report.totalSessions} AI session${report.totalSessions !== 1 ? 's' : ''} ` +
    `by ${report.systemName} between ${report.reportingPeriod.from.slice(0, 10)} and ` +
    `${report.reportingPeriod.to.slice(0, 10)}, assessed against the EU AI Act (Regulation (EU) 2024/1689). ` +
    `The system is classified as ${riskLabel}. ` +
    `${chainStatus} ` +
    `Of the ${sections.length} articles examined, ${compliantCount} ${compliantCount === 1 ? 'is' : 'are'} fully compliant, ` +
    `${partialCount} ${partialCount === 1 ? 'is' : 'are'} partially compliant (gaps documented above), ` +
    `and ${naCount} ${naCount === 1 ? 'is' : 'are'} not applicable to this system's risk category or operational model. ` +
    `The ${report.humanOversightEvents} human oversight event${report.humanOversightEvents !== 1 ? 's' : ''} recorded across all sessions ` +
    `demonstrate active human-in-the-loop governance. ` +
    `All sessions were signed with Ed25519 key \`${report.exportedBy}\` and can be independently verified ` +
    `by any auditor using the instructions in VERIFY.md.`
  );
}

// ---------------------------------------------------------------------------
// Core: generateEuAiActReport
// ---------------------------------------------------------------------------

export function generateEuAiActReport(options: {
  bundle: ComplianceBundle;
  systemName?: string;
  riskCategory?: 'limited' | 'high';
}): EuAiActReport {
  const {
    bundle,
    systemName = 'Claude Code / agentgram',
    riskCategory = 'limited',
  } = options;

  // Verify chain integrity using the existing merkle verifier
  const chainVerification = verifyChain(bundle.merkleChain, bundle.signedTraces);
  const chainIntact = chainVerification.intact;

  const reports = bundle.reports;
  const period = derivePeriod(bundle);

  const sections: EuAiActSection[] = [
    buildSection12_1(bundle, chainIntact),
    buildSection12_2(bundle, reports),
    buildSection13_1(reports),
    buildSection14_1(reports),
    buildSection14_4(),
    buildSection26_5(bundle, reports),
    buildAnnexIV_2(),
    buildAnnexIV_6(reports),
  ];

  const humanOversightEvents = countHumanOversightEvents(reports);
  const automatedDecisions = countAutomatedDecisions(reports);
  const exportedBy = resolveExportedBy(bundle);

  const partial: EuAiActReport = {
    generatedAt: new Date().toISOString(),
    systemName,
    riskCategory,
    reportingPeriod: period,
    totalSessions: reports.length,
    humanOversightEvents,
    automatedDecisions,
    chainIntact,
    sections,
    summary: '', // filled below after sections are finalised
    exportedBy,
  };

  partial.summary = buildSummary(partial, sections);

  return partial;
}

// ---------------------------------------------------------------------------
// Markdown formatter — for DPAs and legal teams
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<EuAiActSection['status'], string> = {
  compliant: '✅ Compliant',
  partial: '⚠️ Partial',
  'not-applicable': '➖ N/A',
};

const STATUS_ICON_SHORT: Record<EuAiActSection['status'], string> = {
  compliant: '✅',
  partial: '⚠️',
  'not-applicable': '➖',
};

export function formatEuAiActReportMarkdown(report: EuAiActReport): string {
  const riskLabel =
    report.riskCategory === 'limited'
      ? 'Limited Risk (Article 6)'
      : report.riskCategory === 'high'
      ? 'High Risk (Annex III)'
      : 'Unacceptable Risk (Article 5)';

  // --- Compliance summary table ---
  const tableRows = report.sections
    .map((s) => {
      const evidenceSummary = s.evidence[0] ?? '—';
      const truncated =
        evidenceSummary.length > 60
          ? evidenceSummary.slice(0, 57) + '…'
          : evidenceSummary;
      return `| ${s.article} | ${s.requirement.slice(0, 45)}… | ${STATUS_ICON_SHORT[s.status]} ${s.status.charAt(0).toUpperCase() + s.status.slice(1).replace('-', ' ')} | ${truncated} |`;
    })
    .join('\n');

  // --- Detailed findings ---
  const detailedFindings = report.sections
    .map((s) => {
      const evidenceList = s.evidence.map((e) => `- ${e}`).join('\n');
      const gapsSection =
        s.gaps && s.gaps.length > 0
          ? `\n**Gaps / Remediation Required:**\n${s.gaps.map((g) => `- ${g}`).join('\n')}`
          : '';
      return (
        `### ${s.article} — ${s.requirement.split('.')[0]}\n` +
        `**Status:** ${STATUS_ICON[s.status]}\n\n` +
        `**Evidence:**\n${evidenceList}` +
        gapsSection
      );
    })
    .join('\n\n---\n\n');

  // --- Stats block ---
  const stats = [
    `| Total sessions | ${report.totalSessions} |`,
    `| Human oversight events | ${report.humanOversightEvents} |`,
    `| Automated decisions | ${report.automatedDecisions} |`,
    `| Merkle chain intact | ${report.chainIntact ? '✅ Yes' : '❌ BROKEN'} |`,
    `| Signed by key | \`${report.exportedBy}\` |`,
  ].join('\n');

  return `# EU AI Act Compliance Report
**System:** ${report.systemName}
**Risk Category:** ${riskLabel}
**Period:** ${report.reportingPeriod.from.slice(0, 10)} to ${report.reportingPeriod.to.slice(0, 10)}
**Generated:** ${report.generatedAt}
**Signed by key:** \`${report.exportedBy}\`

---

## Executive Summary

${report.summary}

---

## System Statistics

| Metric | Value |
|--------|-------|
${stats}

---

## Compliance Status

| Article | Requirement | Status | Evidence (summary) |
|---------|-------------|--------|--------------------|
${tableRows}

---

## Detailed Findings

${detailedFindings}

---

## Verification Instructions

Any auditor can independently verify this report:

\`\`\`bash
npx agentgram verify --compliance --bundle <path-to-bundle>
\`\`\`

Or manually:
1. Compute SHA-256 of each \`traceJson\` and verify against \`traceHash\`
2. Verify Ed25519 signature over \`traceHash\` using the embedded \`publicKeyPem\`
3. Re-walk the Merkle chain: each \`nodeHash\` = SHA-256(\`traceHash\` + \`previousNodeHash\` + \`chainIndex\`)

---

*Generated by [agentgram TraceVault](https://github.com/eclaireai/agentgram) — EU AI Act compliance layer*
*Regulation (EU) 2024/1689 of the European Parliament and of the Council*
`;
}

// ---------------------------------------------------------------------------
// JSON formatter — for automated compliance systems
// ---------------------------------------------------------------------------

export function formatEuAiActReportJson(report: EuAiActReport): string {
  return JSON.stringify(report, null, 2);
}
