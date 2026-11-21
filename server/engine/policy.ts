import { createHash } from 'node:crypto';
import {
  EngineError,
  type Analysis,
  type BugInput,
  type Family,
  type PolicyInput,
  type Proposal,
  type SafetyDecision,
} from './contracts.ts';

export function fingerprint(value: unknown): string {
  const serialised = JSON.stringify(value, (_key, field) => {
    if (!field || Array.isArray(field) || typeof field !== 'object') return field;
    return Object.fromEntries(
      Object.keys(field)
        .sort()
        .map((key) => [key, field[key]]),
    );
  });
  return createHash('sha256').update(serialised).digest('hex');
}

export function inputFingerprint(bug: BugInput): string {
  if (!bug || !Number.isSafeInteger(bug.revision) || bug.revision < 0) {
    throw new EngineError('invalid_input', 'A persisted bug revision is required.');
  }
  const { id, revision, title, description, affectedArea, expected, actual, severity, evidence } = bug;
  const fields = [id, title, description, affectedArea, expected, actual, severity, evidence];
  if (!fields.every((field) => typeof field === 'string') || !id.trim() || !title.trim()) {
    throw new EngineError('invalid_input', 'The report requires an ID, title and text evidence fields.');
  }
  return fingerprint(['releasegate.input.v1', revision, ...fields]);
}

function confirmedDuplicate(bug: BugInput, policy: PolicyInput): boolean {
  const target = policy.canonical;
  if (
    !target ||
    !target.id ||
    target.id === bug.id ||
    !Number.isSafeInteger(target.revision) ||
    target.revision < 0
  )
    return false;
  return bug.evidence.split(/\r?\n/).some((line) => {
    const declaration = /^Duplicate of\s+(.+)$/i.exec(line.trim());
    return declaration?.[1].trim() === target.id;
  });
}

function scopeText(bug: BugInput): string {
  return [bug.title, bug.description, bug.affectedArea, bug.expected, bug.actual, bug.evidence].join(' ');
}

const protectedScope =
  /\b(auth(?:entication|orisation|orization)?|log[ -]?in|sign[ -]?in|passwords?|sessions?|cookies?|credentials?|permissions?|roles?|privileges?|secrets?|api[ _-]?keys?|schemas?|databases?|migrations?|billing|payments?|integrations?|connectors?|delet(?:e|es|ed|ing|ion)|purge|production publish(?:ing)?|deploy(?:ment)?|security)\b/i;

export function familyFor(bug: BugInput, policy: PolicyInput): Family {
  if (confirmedDuplicate(bug, policy)) return 'duplicate';
  const text = scopeText(bug);
  if (/\bduplicate\b/i.test(text) || policy.canonical) return 'external';
  if (
    /\b(build|version)\b/i.test(text) &&
    /\b(label|caption|prefix|format|whitespace|space|badge)\b/i.test(text)
  )
    return 'build-label';
  if (/\b(card|disclosure|expand|collapse|accordion)\b/i.test(text)) return 'disclosure';
  return 'external';
}

export function assess(
  bug: BugInput,
  family: Family,
  policy: PolicyInput,
): { decision: SafetyDecision; reasons: string[] } {
  const target = family === 'duplicate' ? policy.canonical : null;
  const scope = [scopeText(bug), target?.title, target?.affectedArea].filter(Boolean).join(' ');
  const impacts = [bug.severity, target?.severity].filter((s): s is string => s !== undefined);
  if (protectedScope.test(scope) || impacts.some((severity) => !/^(low|medium)$/i.test(severity))) {
    return { decision: 'manual_only', reasons: ['Protected or high-impact scope requires human judgement.'] };
  }
  if (family === 'external') {
    return {
      decision: 'manual_only',
      reasons: ['The report has no verified match to a local repair recipe.'],
    };
  }
  if (family === 'duplicate') {
    if (!confirmedDuplicate(bug, policy)) {
      return {
        decision: 'manual_only',
        reasons: ['The canonical report must be resolved and explicitly confirmed.'],
      };
    }
    if (policy.automationEnabled) {
      return {
        decision: 'eligible',
        reasons: ['An explicit canonical reference matches the allowlisted workflow.mark_duplicate recipe.'],
      };
    }
    return {
      decision: 'approval_required',
      reasons: ['The installation has disabled automatic workflow recipes.'],
    };
  }
  return {
    decision: 'approval_required',
    reasons: ['A product behaviour change needs human sign-off, even with passing preview checks.'],
  };
}

export function assertAnalysisInput(bug: BugInput, analysis: Analysis, mode: Analysis['engine']) {
  if (
    analysis.engine !== mode ||
    analysis.bugId !== bug.id ||
    analysis.revision !== bug.revision ||
    analysis.inputFingerprint !== inputFingerprint(bug)
  ) {
    throw new EngineError(
      'stale',
      'The analysis belongs to different evidence. Analyse the current report again.',
      409,
    );
  }
}

export function identifyProposal(draft: Omit<Proposal, 'proposalId'>): Proposal {
  return { ...draft, proposalId: fingerprint(['releasegate.proposal.v1', draft]) };
}
