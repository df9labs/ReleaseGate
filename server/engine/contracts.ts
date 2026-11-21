export interface BugInput {
  id: string;
  revision: number;
  title: string;
  description: string;
  affectedArea: string;
  expected: string;
  actual: string;
  severity: string;
  evidence: string;
}

export interface CanonicalBug {
  id: string;
  title: string;
  revision: number;
  affectedArea?: string;
  severity?: string;
}

export interface PolicyInput {
  automationEnabled: boolean;
  canonical?: CanonicalBug | null;
}

export type Family = 'disclosure' | 'build-label' | 'duplicate' | 'external';
export type EngineMode = 'demo' | 'llm';
export type SafetyDecision = 'eligible' | 'approval_required' | 'manual_only';

export interface Analysis {
  engine: EngineMode;
  bugId: string;
  revision: number;
  inputFingerprint: string;
  policyFingerprint?: string;
  diagnosis: string;
  confidence: number;
  risk: 'low' | 'high';
  family: Family;
  reasons: string[];
  plan?: string[];
  proposedChecks?: string[];
}

export interface Proposal {
  engine: EngineMode;
  bugId: string;
  revision: number;
  inputFingerprint: string;
  proposalId: string;
  diagnosis: string;
  summary: string;
  steps: string[];
  checks: string[];
  family: Family;
  canonical: CanonicalBug | null;
  safetyDecision: SafetyDecision;
  safetyReasons: string[];
}

export type PreviewState =
  | { kind: 'disclosure'; activation: 'ignore' | 'toggle' }
  | { kind: 'build-label'; normalise: boolean }
  | { kind: 'duplicate'; bugId: string; canonicalId: string; duplicateOf: string | null };

export interface PreviewChange {
  proposalId: string;
  bugId: string;
  revision: number;
  inputFingerprint: string;
  family: Family;
  before: PreviewState;
  after: PreviewState;
  checkpoint: string;
}

export interface Proof {
  proposalId: string;
  bugId: string;
  revision: number;
  inputFingerprint: string;
  fixture: string;
  before: string;
  after: string;
  checks: { name: string; beforePassed: boolean; afterPassed: boolean }[];
  passed: boolean;
  receipt: string;
}

export interface GateDecision {
  route: 'automatic' | 'human' | 'blocked';
  reasons: string[];
}

export interface RepairEngine {
  readonly mode: EngineMode;
  analyse(bug: BugInput, policy: PolicyInput): Promise<Analysis>;
  propose(bug: BugInput, analysis: Analysis, policy: PolicyInput): Proposal;
}

export interface DemoEngine extends RepairEngine {
  readonly mode: 'demo';
  applyToPreview(bug: BugInput, proposal: Proposal, policy: PolicyInput): PreviewChange;
  gatherProof(change: PreviewChange): Proof;
  restorePreview(change: PreviewChange): PreviewState;
  decide(bug: BugInput, proposal: Proposal, proof: Proof, policy: PolicyInput): GateDecision;
}

export interface ProposalOnlyEngine extends RepairEngine {
  readonly mode: 'llm';
}

export class EngineError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'stale' | 'invalid_proof' | 'provider_failed',
    message: string,
    public readonly status = 422,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
