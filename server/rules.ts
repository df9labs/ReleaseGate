import type { Bug, DashboardStats, ReportInput, Severity, Version } from '../src/api';
import { choice, fields, now, textField, uid } from './support';

export const severities = ['critical', 'high', 'medium', 'low'] as const;
const complete = new Set(['resolved', 'closed', 'duplicate', 'wont_fix']);
export function prepareReport(input: unknown): ReportInput {
  const body = fields(input);
  return {
    title: textField(body, 'title', true, 240),
    description: textField(body, 'description', true),
    affected_module: textField(body, 'affected_module', true),
    page_route: textField(body, 'page_route'),
    environment: choice(body.environment ?? 'preview', ['preview', 'live', 'unknown'], 'environment'),
    severity: choice(body.severity ?? 'medium', severities, 'severity'),
    actual_behavior: textField(body, 'actual_behavior'),
    expected_behavior: textField(body, 'expected_behavior'),
    reproduction_steps: textField(body, 'reproduction_steps'),
    evidence: textField(body, 'evidence'),
    source: textField(body, 'source') || 'manual',
    duplicate_candidate_id:
      body.duplicate_candidate_id == null ? null : textField(body, 'duplicate_candidate_id') || null,
  };
}

export function newBug(input: ReportInput, reference: string): Bug {
  const date = now();
  return {
    ...input,
    id: uid(),
    bug_number: reference,
    revision: 1,
    category: 'unknown',
    priority: 'normal',
    status: 'new',
    severity: input.severity ?? 'medium',
    environment: input.environment ?? 'preview',
    evidence_count: input.evidence ? 1 : 0,
    reported_at: date,
    created_date: date,
    updated_date: date,
    is_synthetic: false,
    ai_triage_status: 'not_started',
    ai_summary: null,
    ai_confidence: 0,
    ai_risk_level: null,
    suspected_cause: null,
    proposed_fix: null,
    alternative_hypothesis: null,
    missing_information: [],
    affected_areas: [],
    regression_risks: [],
    repair_checks: [],
    safety_decision: 'not_assessed',
    safety_reasons: [],
    safe_fix_eligible: false,
    requires_manual_investigation: false,
    latest_analysis_id: null,
    analysis_count: 0,
    analysis_stale: false,
    repair_status: 'not_started',
    repair_mode: null,
    repair_recipe_id: null,
    implementation_summary: null,
    implementation_reference: null,
    implementation_evidence: null,
    preview_verification_status: 'not_tested',
    preview_evidence: null,
    production_verification_status: 'not_published',
    production_evidence: null,
    linked_version_record_id: null,
    linked_semantic_version: null,
    gate_status: null,
  };
}

export function reopenRevision(bug: Bug) {
  bug.revision++;
  Object.assign(bug, {
    status: 'reopened',
    analysis_stale: true,
    safe_fix_eligible: false,
    safety_decision: 'not_assessed',
    safety_reasons: ['Evidence changed. Run a fresh analysis.'],
    gate_status: null,
    preview_verification_status: 'not_tested',
    preview_evidence: null,
    production_verification_status: 'not_published',
    production_evidence: null,
    repair_status: 'not_started',
    repair_mode: null,
    repair_recipe_id: null,
    implementation_summary: null,
    implementation_reference: null,
    implementation_evidence: null,
    linked_version_record_id: null,
    linked_semantic_version: null,
  });
}

export function matchesSearch(bug: Bug, query: string) {
  const term = query.trim().toLowerCase();
  return [
    bug.bug_number,
    bug.title,
    bug.affected_module,
    bug.page_route,
    bug.linked_semantic_version,
  ].some((value) => value?.toLowerCase().includes(term));
}

export function metrics(bugs: Bug[], versions: Version[], date = new Date()): DashboardStats {
  const count = (predicate: (bug: Bug) => boolean) => bugs.filter(predicate).length;
  const previewPassed = count((b) => b.preview_verification_status === 'passed');
  const livePassed = count((b) => b.production_verification_status === 'passed');
  const buckets: [string, Bug['status'][]][] = [
    ['Reported', ['new', 'triage_in_progress']],
    ['Needs input', ['needs_evidence']],
    ['Repair', ['ready_for_repair', 'repair_in_progress']],
    ['Verification', ['awaiting_preview_verification', 'awaiting_production_verification']],
    ['Proven', ['resolved', 'closed', 'duplicate']],
  ];
  const latest = versions
    .filter((version) => version.release_status === 'released')
    .sort((a, b) => (b.released_at ?? b.recorded_at).localeCompare(a.released_at ?? a.recorded_at))[0];
  const currentVersion = latest
    ? {
        id: latest.id,
        semantic_version: latest.semantic_version,
        release_status: latest.release_status,
        production_status: latest.production_status,
      }
    : null;
  return {
    total: bugs.length,
    open: count((b) => !complete.has(b.status)),
    resolved: count((b) => ['resolved', 'closed', 'duplicate'].includes(b.status)),
    safe: count((b) => b.safe_fix_eligible && !b.analysis_stale && b.status === 'ready_for_repair'),
    manual: count(
      (b) =>
        !complete.has(b.status) &&
        !['approved', 'automatic'].includes(b.gate_status ?? '') &&
        (b.gate_status === 'pending' ||
          ['manual_only', 'blocked', 'approval_required'].includes(b.safety_decision)),
    ),
    blockers: count(
      (b) => ['blocked', 'preview_failed'].includes(b.status) || b.gate_status === 'rejected',
    ),
    previewPassed,
    livePassed,
    readiness: bugs.length ? Math.round((100 * (previewPassed + livePassed)) / (2 * bugs.length)) : 0,
    statuses: buckets.map(([name, states]) => ({
      name,
      value: count((b) => states.includes(b.status)),
    })),
    severities: severities.map((name: Severity) => ({ name, value: count((b) => b.severity === name) })),
    trend: Array.from({ length: 7 }, (_, index) => {
      const utc = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 6 + index),
      )
        .toISOString()
        .slice(0, 10);
      return {
        day: utc.slice(5),
        reported: count((b) => b.reported_at.startsWith(utc)),
        proven: count(
          (b) =>
            b.production_verification_status === 'passed' &&
            Boolean(b.production_verified_at?.startsWith(utc)),
        ),
      };
    }),
    currentVersion,
  };
}
