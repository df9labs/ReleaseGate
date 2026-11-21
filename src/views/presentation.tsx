import type { Bug, Analysis } from '../api';
export const toneColours = {
  gold: '#FF7A3D',
  green: '#52F2B8',
  amber: '#D66A32',
  red: '#FF6577',
  blue: '#C65A2E',
};

export const workflowLabels = {
  new: {
    label: 'Reported',
    tone: 'blue',
    step: 0,
  },
  triage_in_progress: {
    label: 'Analysing',
    tone: 'gold',
    step: 1,
  },
  needs_evidence: {
    label: 'Needs input',
    tone: 'amber',
    step: 1,
  },
  needs_manual_investigation: {
    label: 'Manual investigation',
    tone: 'amber',
    step: 2,
  },
  ready_for_repair: {
    label: 'Repair ready',
    tone: 'gold',
    step: 2,
  },
  repair_in_progress: {
    label: 'Repairing',
    tone: 'gold',
    step: 3,
  },
  awaiting_preview_verification: {
    label: 'Preview retest',
    tone: 'blue',
    step: 4,
  },
  preview_failed: {
    label: 'Preview failed',
    tone: 'red',
    step: 4,
  },
  awaiting_production_verification: {
    label: 'Ready to release',
    tone: 'green',
    step: 5,
  },
  resolved: {
    label: 'Live proven',
    tone: 'green',
    step: 6,
  },
  reopened: {
    label: 'Reopened',
    tone: 'red',
    step: 2,
  },
  duplicate: {
    label: 'Duplicate',
    tone: 'green',
    step: 6,
  },
  blocked: {
    label: 'Blocked',
    tone: 'red',
    step: 2,
  },
  closed: {
    label: 'Closed',
    tone: 'green',
    step: 6,
  },
  wont_fix: {
    label: "Won't fix",
    tone: 'slate',
    step: 6,
  },
};

export const severityLabels = {
  critical: {
    label: 'Critical',
    tone: 'red',
  },
  high: {
    label: 'High',
    tone: 'amber',
  },
  medium: {
    label: 'Medium',
    tone: 'blue',
  },
  low: {
    label: 'Low',
    tone: 'green',
  },
};

export const safetyLabels = {
  not_assessed: {
    label: 'Not assessed',
    tone: 'slate',
  },
  eligible: {
    label: 'Auto-repair eligible',
    tone: 'green',
  },
  approval_required: {
    label: 'Approval required',
    tone: 'gold',
  },
  manual_only: {
    label: 'Manual only',
    tone: 'amber',
  },
  blocked: {
    label: 'Automation blocked',
    tone: 'red',
  },
};

export function safetyLabel(bug?: Bug | null) {
  return bug?.repair_mode === 'allowlisted_automation' && bug?.repair_status === 'applied'
    ? {
        label: 'Safe workflow repair applied',
        tone: 'green',
      }
    : safetyLabels[bug?.safety_decision ?? 'not_assessed'] || safetyLabels.not_assessed;
}

export const lifecycle = [
  'Report',
  'Analysis',
  'Safety',
  'Preview repair',
  'Retest',
  'Release',
  'Live proof',
];

export function formatDate(value: string | null | undefined, options: {year?:boolean; time?:boolean} = {}) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: options.year ? 'numeric' : undefined,
        hour: options.time === false ? undefined : '2-digit',
        minute: options.time === false ? undefined : '2-digit',
      }).format(date);
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 6e4));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const modelNames: Record<string, string> = {
  gpt_5_mini: 'GPT-5 mini',
  'claude-sonnet-5': 'Claude Sonnet 5',
};

export function modelName(model: string | null | undefined) {
  return modelNames[model ?? ''] || model || 'Unknown model';
}

export function formatFixPlan(bug: Bug, analysis: Analysis) {
  const reasons = (analysis?.safety_reasons || []).map((item) => `- ${item}`);
  return (
    reasons.push('- Keep the change minimal and scoped to this bug.'),
    reasons.push('- Do not refactor or restructure unrelated code while making this fix.'),
    [
      '# Implementation task — Bug fix',
      '',
      `Bug reference: ${bug?.bug_number || '—'}`,
      `Affected area: ${bug?.affected_module || '—'}${bug?.page_route ? ` (${bug.page_route})` : ''}`,
      `Severity: ${bug?.severity || 'medium'} · Priority: ${bug?.priority || 'normal'}`,
      '',
      '## Description',
      bug?.description || '—',
      '',
      '## What happens now (actual)',
      bug?.actual_behavior || '—',
      '',
      '## What should happen (expected)',
      bug?.expected_behavior || '—',
      '',
      '## Reproduction steps',
      bug?.reproduction_steps || '—',
      '',
      '## Evidence',
      bug?.evidence || '—',
      '',
      '## Likely cause',
      analysis?.suspected_cause || '—',
      '',
      '## Proposed fix',
      analysis?.proposed_fix || bug?.proposed_fix || '—',
      '',
      '## Planned checks / QA',
      (analysis?.repair_checks || bug?.repair_checks || []).map((item) => `- ${item}`).join(`
`) || '—',
      '',
      '## Safety notes',
      reasons.join(`
`),
    ].join(`
`)
  );
}

export function nextAction(bug?: Bug | null) {
  if (!bug) return null;
  if (bug.analysis_stale || bug.status === 'new') {
    return { id: 'analyse', label: bug.analysis_count ? 'Reanalyse' : 'Analyse bug' };
  }
  switch (bug.status) {
    case 'needs_evidence': return { id: 'evidence', label: 'Add evidence' };
    case 'ready_for_repair':
      return bug.safe_fix_eligible
        ? { id: 'safe-repair', label: 'Apply safe workflow repair' }
        : { id: 'repair', label: 'Plan Preview repair' };
    case 'needs_manual_investigation':
    case 'preview_failed':
    case 'reopened': return { id: 'repair', label: 'Plan Preview repair' };
    case 'repair_in_progress': return { id: 'record-repair', label: 'Record implementation' };
    case 'awaiting_preview_verification': return { id: 'verify-preview', label: 'Record Preview retest' };
    case 'awaiting_production_verification': return { id: 'verify-live', label: 'Record Live proof' };
    default: return null;
  }
}
