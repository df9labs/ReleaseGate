import {
  EngineError,
  type Analysis,
  type BugInput,
  type DemoEngine,
  type GateDecision,
  type PolicyInput,
  type Proof,
  type Proposal,
} from './contracts.ts';
import { applyFixture, fixturePlans, gatherProof, restorePreview } from './fixtures.ts';
import {
  assess,
  assertAnalysisInput,
  familyFor,
  fingerprint,
  identifyProposal,
  inputFingerprint,
} from './policy.ts';

function analyseLocal(bug: BugInput, policy: PolicyInput): Analysis {
  const binding = inputFingerprint(bug);
  const family = familyFor(bug, policy);
  const { decision, reasons } = assess(bug, family, policy);
  return {
    engine: 'demo',
    bugId: bug.id,
    revision: bug.revision,
    inputFingerprint: binding,
    family,
    policyFingerprint: fingerprint([
      'releasegate.policy.v1',
      policy.automationEnabled,
      policy.canonical ?? null,
    ]),
    diagnosis:
      family === 'external'
        ? 'This report needs independent diagnosis. The local demonstration will exercise a sample client card.'
        : fixturePlans[family].diagnosis,
    confidence: family === 'external' ? 0 : family === 'duplicate' ? 100 : 85,
    risk: decision === 'manual_only' ? 'high' : 'low',
    reasons,
  };
}

function propose(bug: BugInput, analysis: Analysis, policy: PolicyInput): Proposal {
  assertAnalysisInput(bug, analysis, 'demo');
  const current = analyseLocal(bug, policy);
  if (fingerprint(current) !== fingerprint(analysis)) {
    throw new EngineError(
      'stale',
      'The policy, canonical reference or analysis has changed. Analyse again.',
      409,
    );
  }
  const { decision, reasons } = assess(bug, current.family, policy);
  const plan = fixturePlans[current.family === 'external' ? 'disclosure' : current.family];
  return identifyProposal({
    engine: 'demo',
    bugId: bug.id,
    revision: bug.revision,
    inputFingerprint: current.inputFingerprint,
    family: current.family,
    diagnosis: current.diagnosis,
    summary:
      current.family === 'external'
        ? 'Demonstrate a client card correction on an isolated sample.'
        : plan.summary,
    steps: [...plan.steps],
    checks: [...plan.checks],
    canonical: current.family === 'duplicate' && policy.canonical ? { ...policy.canonical } : null,
    safetyDecision: decision,
    safetyReasons: reasons,
  });
}

function applyToPreview(bug: BugInput, submitted: Proposal, policy: PolicyInput) {
  const expected = propose(bug, analyseLocal(bug, policy), policy);
  if (fingerprint(expected) !== fingerprint(submitted)) {
    throw new EngineError(
      'stale',
      'The proposal no longer matches the report, canonical target and installation policy.',
      409,
    );
  }
  return applyFixture(expected);
}

function decide(bug: BugInput, proposal: Proposal, proof: Proof, policy: PolicyInput): GateDecision {
  try {
    const independent = gatherProof(applyToPreview(bug, proposal, policy));
    if (!proof?.passed || !independent.passed || fingerprint(proof) !== fingerprint(independent)) {
      return { route: 'blocked', reasons: ['Current before-and-after preview evidence did not verify.'] };
    }
    const { decision, reasons } = assess(bug, proposal.family, policy);
    return { route: decision === 'eligible' ? 'automatic' : 'human', reasons };
  } catch (error) {
    if (error instanceof EngineError) return { route: 'blocked', reasons: [error.message] };
    throw error;
  }
}

export function createDemoEngine(): DemoEngine {
  return {
    mode: 'demo',
    analyse: async (bug, policy) => analyseLocal(bug, policy),
    propose,
    applyToPreview,
    gatherProof,
    restorePreview,
    decide,
  };
}
