import type { SuiteCase } from './health-suite';
import { checkHostedApiResponse, hostedJobResponse, isNetlifyClient, usesHostedJob } from './netlify-jobs';

/** The browser talks only to the installation serving this interface. */
export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
}

/** Daily allowance for a self-serve account. Administrators are unlimited. */
export interface Account {
  unlimited: boolean;
  scans_used?: number;
  scans_limit?: number;
  scans_remaining?: number;
  verified?: boolean;
  verification_required?: boolean;
}
export interface SiteStats {
  since: string;
  rows: { day: string; metric: string; count: number }[];
  accounts: number;
  verified_accounts: number;
  scans_all_time: number;
  limits: { scansPerUser: number; scansTotal: number; discoveriesPerUser: number };
  verification_required: boolean;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type SafetyDecision = 'not_assessed' | 'eligible' | 'approval_required' | 'manual_only' | 'blocked';
export type BugStatus =
  | 'new'
  | 'triage_in_progress'
  | 'needs_evidence'
  | 'needs_manual_investigation'
  | 'ready_for_repair'
  | 'repair_in_progress'
  | 'awaiting_preview_verification'
  | 'preview_failed'
  | 'awaiting_production_verification'
  | 'resolved'
  | 'reopened'
  | 'duplicate'
  | 'blocked'
  | 'closed'
  | 'wont_fix';

export interface ReportInput {
  title: string;
  description: string;
  affected_module: string;
  page_route?: string;
  environment?: string;
  severity?: Severity;
  reproduction_steps?: string;
  expected_behavior?: string;
  actual_behavior?: string;
  evidence?: string;
  source?: string;
  reporter_browser?: string;
  evidence_count?: number;
  duplicate_candidate_id?: string | null;
}

export interface Bug extends ReportInput {
  id: string;
  bug_number: string;
  revision: number;
  category: string;
  priority: string;
  status: BugStatus;
  severity: Severity;
  environment: string;
  evidence_count: number;
  reported_at: string;
  created_date: string;
  updated_date: string;
  is_synthetic: boolean;
  ai_triage_status: string;
  analysis_engine?: 'demo' | 'llm';
  ai_summary: string | null;
  ai_confidence: number;
  ai_risk_level: string | null;
  suspected_cause: string | null;
  proposed_fix: string | null;
  alternative_hypothesis: string | null;
  missing_information: string[];
  affected_areas: string[];
  regression_risks: string[];
  repair_checks: string[];
  safety_decision: SafetyDecision;
  safety_reasons: string[];
  safe_fix_eligible: boolean;
  requires_manual_investigation: boolean;
  latest_analysis_id: string | null;
  analysis_count: number;
  analysis_stale: boolean;
  repair_status: string;
  repair_mode: string | null;
  repair_recipe_id: string | null;
  implementation_summary: string | null;
  implementation_reference: string | null;
  implementation_evidence: string | null;
  preview_verification_status: string;
  preview_evidence: string | null;
  preview_verified_at?: string | null;
  production_verification_status: string;
  production_evidence: string | null;
  production_verified_at?: string | null;
  reported_by_id?: string | null;
  linked_version_record_id: string | null;
  linked_semantic_version: string | null;
  source_healthcheck_id?: string | null;
  source_healthcheck_number?: string | null;
  source_check_key?: string | null;
  gate_status?: 'pending' | 'approved' | 'rejected' | 'automatic' | null;
}

export interface Analysis {
  id: string;
  bug_record_id: string;
  analysis_sequence: number;
  analysis_status: string;
  analysis_pass: string;
  escalation_outcome?: string | null;
  analysis_model: string;
  analyzed_at: string;
  summary: string | null;
  suspected_cause: string | null;
  proposed_fix: string | null;
  alternative_hypothesis: string | null;
  implementation_prompt: string | null;
  confidence: number;
  risk_level: string;
  safety_decision: SafetyDecision;
  safety_reasons: string[];
  evidence_supporting: string[];
  missing_information: string[];
  affected_areas: string[];
  regression_risks: string[];
  repair_checks: string[];
  failure_reason: string | null;
}

export interface RepairPlan {
  summary: string;
  checkpoint_reference: string;
  affected_resources?: string[];
  planned_tests?: string[];
  mode?: string;
}

export interface Repair extends RepairPlan {
  id: string;
  bug_record_id: string;
  attempt_sequence: number;
  status: string;
  implementation_evidence?: string;
}

export interface VerificationInput {
  environment: 'preview' | 'live';
  result: string;
  summary?: string;
  method?: string;
  expected_result?: string;
  observed_result: string;
  evidence: string;
  url?: string;
  build_reference?: string;
}

export interface Verification extends VerificationInput {
  id: string;
  bug_record_id: string;
  verified_at: string;
  proof?: {
    fixture: string;
    before: string;
    after: string;
    checks: { name: string; beforePassed: boolean; afterPassed: boolean }[];
    passed: boolean;
    receipt: string;
  };
}

export interface AuditEvent {
  id: string;
  action: string;
  entity_name: string;
  record_id: string;
  bug_record_id?: string | null;
  bug_number?: string | null;
  actor_email?: string | null;
  actor_role: string;
  detail: string;
  occurred_at: string;
}

export interface BugRecord {
  bug: Bug;
  analyses: Analysis[];
  repairs: Repair[];
  verifications: Verification[];
  activity: AuditEvent[];
}

export interface VersionInput {
  semantic_version: string;
  title: string;
  summary: string;
  changes: string;
  reason: string;
  change_type?: string;
  release_status?: string;
  qa_status?: string;
  qa_notes?: string;
  known_issues?: string;
  rollback_notes?: string;
  implementation_status?: string;
  implementation_evidence?: string;
  source_checkpoint?: string;
  preview_status?: string;
  preview_evidence?: string;
  production_status?: string;
  production_evidence?: string;
  linked_bug_ids?: string[];
}

export interface Version extends VersionInput {
  id: string;
  linked_bug_numbers: string[];
  recorded_at: string;
  released_at?: string;
  release_status: string;
  production_status: string;
  preview_status: string;
  qa_status: string;
  is_synthetic: boolean;
}

export interface DashboardStats {
  total: number;
  open: number;
  resolved: number;
  manual: number;
  safe: number;
  blockers: number;
  previewPassed: number;
  livePassed: number;
  readiness: number;
  statuses: { name: string; value: number }[];
  severities: { name: string; value: number }[];
  trend: { day: string; reported: number; proven: number }[];
  currentVersion: Pick<Version, 'id' | 'semantic_version' | 'release_status' | 'production_status'> | null;
}

export interface Dashboard {
  user: Pick<User, 'email' | 'role'>;
  stats: DashboardStats;
  bugs: Bug[];
  versions: Version[];
}

export interface Settings {
  app_name: string;
  reference_prefix: string;
  preview_url: string;
  live_url: string;
  automation_enabled: boolean;
  onboarding_complete: boolean;
  policy_version: string;
  blocked_areas: string[];
  allowed_recipes: string[];
}

export interface DesktopInspection {
  application: string;
  captured_at?: string;
  buttons: { name: string; enabled: boolean }[];
  checks: {
    button: string;
    expected: string;
    outcome: 'passed' | 'failed' | 'inconclusive';
    detail?: string;
  }[];
  limitations: string[];
}

export interface HealthcheckInput {
  sample_site?: boolean;
  follow_links?: boolean;
  max_pages?: number;
  browser_checks?: boolean;
  button_journeys?: { button: string; expected_text: string }[];
  suite_results?: SuiteCase[];
  desktop_inspection?: DesktopInspection;
  target_name: string;
  target_type: string;
  target_url: string;
  environment: string;
  current_version?: string;
  scope_notes?: string;
  supplied_evidence?: string;
  authorization_attested: boolean;
}

export interface DiscoveredButton {
  name: string;
  disabled: boolean;
  ambiguous: boolean;
  automatic: boolean;
  selectable: boolean;
}

export interface ButtonDiscovery {
  buttons: DiscoveredButton[];
  total: number;
  limitations: string[];
}

export interface Finding {
  id: string;
  reference: string;
  title: string;
  basis: string;
  category: string;
  severity: string;
  check_key: string;
  confidence: string;
  observed_at?: string;
  evidence_summary: string;
  observation: string;
  impact: string;
  affected_area: string;
  recommendation: string;
  validation_step: string;
  converted_bug_id?: string | null;
  converted_bug_number?: string | null;
  regression_of_bug_id?: string | null;
  regression_of_bug_number?: string | null;
  is_regression?: boolean;
}

export interface PriorHealthFinding {
  check_key: string;
  title: string;
  bug_number?: string | null;
  bug_id?: string | null;
}

export interface ResolvedFinding extends PriorHealthFinding {
  auto_verified: boolean;
  previous_healthcheck_number?: string;
  previous_evidence_summary?: string;
  resolution_evidence?: string;
  verification_blocked_reason?: string;
}

export interface RegressedFinding extends PriorHealthFinding {
  previously_resolved_at?: string;
}

export interface Healthcheck extends HealthcheckInput {
  check_source?: 'website' | 'supplied' | 'sample' | 'desktop';
  target_url_needs_input?: boolean;
  inspected_pages?: { url: string; status: number | null }[];
  checks_performed?: HealthObservation[];
  compared_to_previous?: boolean;
  previous_healthcheck_number?: string | null;
  id: string;
  healthcheck_number: string;
  status: string;
  band: string;
  completed_at: string;
  readiness_indicator: number;
  evidence_coverage: number;
  observed_count: number;
  potential_count: number;
  high_priority_count: number;
  not_tested_count: number;
  summary: string;
  category_scores: {
    id: string;
    label: string;
    score: number;
    coverage: number;
    status: string;
    completed_checks: number;
    total_checks: number;
  }[];
  findings: Finding[];
  resolved_findings: ResolvedFinding[];
  regressions: RegressedFinding[];
  strengths: string[];
  limitations: string[];
  next_steps: string[];
  is_synthetic: boolean;
}

export interface HealthObservation {
  category?: string;
  title: string;
  passed: boolean | null;
  detail: string;
  page?: string;
  source: 'website' | 'supplied' | 'browser' | 'suite' | 'desktop';
  suite_outcome?: SuiteCase['outcome'];
}

export interface Notification {
  id: string;
  title: string;
  detail: string;
  href: string;
  occurred_at: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestResponse(path: string, options: RequestInit, accept: string): Promise<Response> {
  if (!path.startsWith('/api/')) throw new Error('Expected a local API path.');
  const headers = new Headers(options.headers);
  headers.set('Accept', accept);
  const settings: RequestInit = {
    ...options,
    headers,
    credentials: 'same-origin',
    redirect: 'error',
  };
  const response = isNetlifyClient && usesHostedJob(settings.method ?? 'GET', path)
    ? await hostedJobResponse(path, settings)
    : await fetch(path, settings);
  if (isNetlifyClient) checkHostedApiResponse(response);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const message = typeof problem?.message === 'string' ? problem.message : problem?.error;
    throw new ApiError(
      response.status,
      typeof message === 'string' ? message : `Request failed (HTTP ${response.status}).`,
    );
  }
  return response;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await requestResponse(path, options, 'application/json');
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: object = {}, idempotencyKey?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  return request<T>(path, { method, headers, body: JSON.stringify(body) });
}

const bugPath = (id: string) => '/api/bugs/' + encodeURIComponent(id);
const versionPath = (id: string) => '/api/versions/' + encodeURIComponent(id);
const healthPath = (id: string) => '/api/healthchecks/' + encodeURIComponent(id);
type Rows<T> = { records: T[] };
type Mutation<T> = T & { audit_warning?: string };
type BugMutation = Mutation<{ bug: Bug; analysis_failed?: boolean }>;

export const api = {
  session: () => request<{ user: User }>('/api/auth/session'),
  login: (email: string, password: string) =>
    send<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => send<void>('POST', '/api/auth/logout'),
  register: (full_name: string, email: string, password: string) =>
    send<{ user: User }>('POST', '/api/auth/register', { full_name, email, password }),
  forgotPassword: (email: string) =>
    send<{ message: string }>('POST', '/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    send<{ message: string }>('POST', '/api/auth/reset-password', { token, password }),
  verifyEmail: (token: string) => send<{ message: string }>('POST', '/api/auth/verify-email', { token }),
  resendVerification: () => send<{ message: string }>('POST', '/api/auth/resend-verification'),
  stats: () => request<SiteStats>('/api/stats'),
  dashboard: () => request<Dashboard>('/api/dashboard'),
  listBugs: (limit = 300) => request<Rows<Bug>>('/api/bugs?limit=' + encodeURIComponent(limit)),
  getBug: (id: string) => request<BugRecord>(bugPath(id)),
  createBug: (report: ReportInput, idempotencyKey?: string) =>
    send<BugMutation>('POST', '/api/reports', report, idempotencyKey),
  updateBug: (id: string, evidence: Partial<ReportInput>) =>
    send<BugMutation>('PATCH', bugPath(id), evidence),
  analyseBug: (id: string) => send<BugMutation>('POST', bugPath(id) + '/analyses'),
  deepAnalyseBug: (id: string) => send<BugMutation>('POST', bugPath(id) + '/analyses', { deep: true }),
  beginRepair: (id: string, plan: RepairPlan) => send<BugMutation>('POST', bugPath(id) + '/repairs', plan),
  applySafeRepair: (id: string) => send<BugMutation>('POST', bugPath(id) + '/repairs/apply-safe'),
  recordRepair: (id: string, record: { summary: string; reference?: string; evidence: string }) =>
    send<BugMutation>('POST', bugPath(id) + '/implementation', record),
  recordVerification: (id: string, verification: VerificationInput) =>
    send<BugMutation>('POST', bugPath(id) + '/verifications', verification),
  gate: (id: string, decision: 'approve' | 'reject', reason: string) =>
    send<BugMutation>('POST', bugPath(id) + '/gate', { decision, reason }),
  reopenBug: (id: string, reason: string) => send<BugMutation>('POST', bugPath(id) + '/reopen', { reason }),
  listVersions: () => request<Rows<Version>>('/api/versions'),
  createVersion: (version: VersionInput) =>
    send<Mutation<{ version: Version }>>('POST', '/api/versions', version),
  markVersionReleased: (id: string) =>
    send<Mutation<{ version: Version }>>('POST', versionPath(id) + '/release'),
  verifyVersionLive: (id: string, result: string, evidence: string) =>
    send<Mutation<{ version: Version }>>('POST', versionPath(id) + '/verify', { result, evidence }),
  listHealthchecks: () => request<Rows<Healthcheck>>('/api/healthchecks'),
  getHealthcheck: (id: string) => request<{ run: Healthcheck }>(healthPath(id)),
  healthcheckPdf: async (id: string) => {
    const response = await requestResponse(healthPath(id) + '/pdf', {}, 'application/pdf');
    if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/pdf')
      throw new Error('ReleaseGate returned an unexpected file format.');
    return response.blob();
  },
  discoverHealthButtons: (input: { target_url: string; sample_site: boolean; authorization_attested: boolean }, signal?: AbortSignal) =>
    request<ButtonDiscovery>('/api/healthchecks/discover-buttons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }),
  inspectWindowsDesktop: (signal?: AbortSignal) => request<DesktopInspection | { cancelled: true }>('/api/healthchecks/inspect-windows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorization_attested: true }),
    signal,
  }),
  runHealthcheck: (input: HealthcheckInput) => send<{ run: Healthcheck }>('POST', '/api/healthchecks', input),
  convertHealthcheckFinding: (id: string, findingId: string) =>
    send<{ run: Healthcheck; bug: Bug }>(
      'POST',
      healthPath(id) + '/findings/' + encodeURIComponent(findingId) + '/bug',
    ),
  getConfig: () => request<{ config: Settings }>('/api/settings'),
  updateConfig: (settings: Partial<Settings>) =>
    send<Mutation<{ config: Settings }>>('PUT', '/api/settings', settings),
  listAudit: () => request<{ events: AuditEvent[] }>('/api/audit'),
  search: (q: string) => request<Rows<Bug>>('/api/search?q=' + encodeURIComponent(q)),
  notifications: () => request<{ notifications: Notification[] }>('/api/notifications'),
};
