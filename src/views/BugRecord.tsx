import React from 'react';

import {
  ActivityIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CopyIcon,
  HistoryIcon,
  LoaderCircleIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';

import { Badge, EmptyState, Panel } from './Components';

import { Link, useNavigate, useParams } from 'react-router-dom';

import { api, type Bug, type RepairPlan, type ReportInput, type VerificationInput } from '../api';

import {
  formatDate,
  formatFixPlan,
  lifecycle,
  modelName,
  nextAction,
  safetyLabel,
  safetyLabels,
  severityLabels,
  workflowLabels,
} from './presentation';

import { notify } from '../ui';

import { useAuth } from '../auth';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function copyPrompt(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    notify({ title: 'Prompt copied', description: 'Paste it into your AI coding agent.' });
  } catch {
    notify({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' });
  }
}

const recordTabs = [
  ['overview', 'Overview'],
  ['analysis', 'Analysis'],
  ['repair', 'Repair'],
  ['verification', 'Verification'],
  ['activity', 'Activity'],
];

function EvidenceText({
  value,
  empty = 'Nothing recorded.',
}: {
  value?: string | null;
  empty?: string;
}) {
  return value ? (
    <p className="whitespace-pre-wrap text-sm leading-6 text-[#DDE7F2]">{value}</p>
  ) : (
    <p className="text-sm italic text-[#708197]">{empty}</p>
  );
}

function EvidenceList({
  title,
  items = [],
  empty = 'None recorded.',
}: {
  title: string;
  items?: string[];
  empty?: string;
}) {
  return (
    <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-5 text-[#DDE7F2]">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-1 text-[#FF7A3D]">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm italic text-[#708197]">{empty}</p>
      )}
    </div>
  );
}

function Lifecycle({ step }: { step: number }) {
  return (
    <ol className="space-y-0">
      {lifecycle.map((label, index) => {
        const completed = index < step;
        const current = index === step;
        return (
          <li key={label} className="relative flex gap-3 pb-5 last:pb-0">
            {index < lifecycle.length - 1 && (
              <span
                className={`absolute left-[9px] top-5 h-[calc(100%-10px)] w-px ${completed ? 'bg-[#52F2B8]' : 'bg-[#22304A]'}`}
              />
            )}
            <span
              className={`relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${completed ? 'border-[#52F2B8] bg-[#52F2B8] text-[#050810]' : current ? 'border-[#FF7A3D] bg-[#FF7A3D]/15 text-[#FF9B5C]' : 'border-[#2D3B55] bg-[#0D1424] text-[#708197]'}`}
            >
              {completed ? (
                <CircleCheckIcon className="h-3 w-3" />
              ) : current ? (
                <CircleDashedIcon className="h-3 w-3" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <div>
              <p
                className={`text-xs font-bold ${current ? 'text-[#FF9B5C]' : completed ? 'text-[#7FF7CD]' : 'text-[#8496AB]'}`}
              >
                {label}
              </p>
              {current && <p className="mt-1 text-[10px] text-[#93A4B8]">Current stage</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const formTitles = {
  evidence: 'Add or correct evidence',
  repair: 'Plan a controlled Preview repair',
  'record-repair': 'Record saved implementation',
  'verify-preview': 'Record Preview retest',
  'verify-live': 'Record Live proof',
};

type FormAction = keyof typeof formTitles;

type RecordCommand =
  | { action: 'analyse' | 'deep-analyse' | 'safe-repair' }
  | { action: 'gate'; decision: 'approve' | 'reject'; reason: string }
  | { action: 'evidence'; payload: Partial<ReportInput> }
  | { action: 'repair'; payload: RepairPlan }
  | { action: 'record-repair'; payload: { summary: string; reference: string; evidence: string } }
  | { action: 'verify-preview' | 'verify-live'; payload: VerificationInput };

function isFormAction(value: string): value is FormAction {
  return Object.hasOwn(formTitles, value);
}

function RecordActionForm({
  type,
  bug,
  onCancel,
  onSubmit,
  pending,
}: {
  type: FormAction;
  bug: Bug;
  onCancel: () => void;
  onSubmit: (command: RecordCommand) => void;
  pending: boolean;
}) {
  const [form, setForm] = React.useState(() => ({
    actual_behavior: bug.actual_behavior || '',
    expected_behavior: bug.expected_behavior || '',
    reproduction_steps: bug.reproduction_steps || '',
    evidence: type === 'evidence' ? bug.evidence || '' : '',
    summary: type === 'repair' ? bug.proposed_fix || '' : '',
    affected_resources: bug.affected_areas.join('\n'),
    planned_tests: bug.repair_checks.join('\n'),
    checkpoint_reference: '',
    reference: '',
    result: 'passed',
    expected_result: bug.expected_behavior || '',
    observed_result: '',
    url: '',
    build_reference: '',
  }));
  const field =
    (name: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      setForm((previous) => ({ ...previous, [name]: value }));
    };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    switch (type) {
      case 'evidence': {
        const { actual_behavior, expected_behavior, reproduction_steps, evidence } = form;
        return onSubmit({
          action: type,
          payload: { actual_behavior, expected_behavior, reproduction_steps, evidence },
        });
      }
      case 'repair': {
        const lines = (text: string) =>
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        return onSubmit({
          action: type,
          payload: {
            summary: form.summary,
            checkpoint_reference: form.checkpoint_reference,
            mode: 'external_agent',
            affected_resources: lines(form.affected_resources),
            planned_tests: lines(form.planned_tests),
          },
        });
      }
      case 'record-repair': {
        const { summary, reference, evidence } = form;
        return onSubmit({ action: type, payload: { summary, reference, evidence } });
      }
      case 'verify-preview':
      case 'verify-live': {
        const { result, summary, evidence, expected_result, observed_result, url, build_reference } =
          form;
        return onSubmit({
          action: type,
          payload: {
            environment: type === 'verify-live' ? 'live' : 'preview',
            method: 'manual',
            result,
            summary,
            evidence,
            expected_result,
            observed_result,
            url,
            build_reference,
          },
        });
      }
    }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-[#FF7A3D]/35 bg-[#FF7A3D]/[0.05] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF7A3D]">
            Current action
          </p>
          <h3 className="mt-1 text-sm font-extrabold text-[#F5FAFF]">{formTitles[type]}</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-2 text-[#93A4B8] hover:bg-[#0D1424]"
          aria-label="Close action"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      {type === 'evidence' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="shipsure-label">Actual result</span>
            <textarea
              value={form.actual_behavior}
              onChange={field('actual_behavior')}
              className="shipsure-input min-h-24"
            />
          </label>
          <label>
            <span className="shipsure-label">Expected result</span>
            <textarea
              value={form.expected_behavior}
              onChange={field('expected_behavior')}
              className="shipsure-input min-h-24"
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Reproduction steps</span>
            <textarea
              value={form.reproduction_steps}
              onChange={field('reproduction_steps')}
              className="shipsure-input min-h-24"
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Evidence</span>
            <textarea
              value={form.evidence}
              onChange={field('evidence')}
              className="shipsure-input min-h-24"
              required
            />
          </label>
        </div>
      )}
      {type === 'repair' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="shipsure-label">Repair plan</span>
            <textarea
              value={form.summary}
              onChange={field('summary')}
              className="shipsure-input min-h-28"
              required
            />
          </label>
          <label>
            <span className="shipsure-label">Affected resources — one per line</span>
            <textarea
              value={form.affected_resources}
              onChange={field('affected_resources')}
              className="shipsure-input min-h-24 font-mono text-xs"
            />
          </label>
          <label>
            <span className="shipsure-label">Planned tests — one per line</span>
            <textarea
              value={form.planned_tests}
              onChange={field('planned_tests')}
              className="shipsure-input min-h-24"
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Checkpoint / backup reference</span>
            <input
              value={form.checkpoint_reference}
              onChange={field('checkpoint_reference')}
              className="shipsure-input font-mono text-xs"
              placeholder="Required before implementation begins"
              required
            />
          </label>
        </div>
      )}
      {type === 'record-repair' && (
        <div className="grid gap-4">
          <label>
            <span className="shipsure-label">What changed</span>
            <textarea
              value={form.summary}
              onChange={field('summary')}
              className="shipsure-input min-h-24"
              required
            />
          </label>
          <label>
            <span className="shipsure-label">Commit, checkpoint or change reference</span>
            <input
              value={form.reference}
              onChange={field('reference')}
              className="shipsure-input font-mono text-xs"
            />
          </label>
          <label>
            <span className="shipsure-label">Saved implementation evidence</span>
            <textarea
              value={form.evidence}
              onChange={field('evidence')}
              className="shipsure-input min-h-24"
              required
            />
          </label>
        </div>
      )}
      {(type === 'verify-preview' || type === 'verify-live') && (
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="shipsure-label">Result</span>
            <select value={form.result} onChange={field('result')} className="shipsure-input">
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="blocked">Blocked</option>
              <option value="inconclusive">Inconclusive</option>
              {type === 'verify-live' && (
                <option value="published_unverified">Published, unverified</option>
              )}
            </select>
          </label>
          <label>
            <span className="shipsure-label">Build / version reference</span>
            <input
              value={form.build_reference}
              onChange={field('build_reference')}
              className="shipsure-input font-mono text-xs"
            />
          </label>
          <label>
            <span className="shipsure-label">Expected</span>
            <textarea
              value={form.expected_result}
              onChange={field('expected_result')}
              className="shipsure-input min-h-20"
            />
          </label>
          <label>
            <span className="shipsure-label">Observed</span>
            <textarea
              value={form.observed_result}
              onChange={field('observed_result')}
              className="shipsure-input min-h-20"
              required
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Evidence</span>
            <textarea
              value={form.evidence}
              onChange={field('evidence')}
              className="shipsure-input min-h-24"
              required
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Checked URL</span>
            <input value={form.url} onChange={field('url')} className="shipsure-input" />
          </label>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="shipsure-button-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="shipsure-button disabled:opacity-60">
          {pending && <LoaderCircleIcon className="h-4 w-4 animate-spin" />}Save action
        </button>
      </div>
    </form>
  );
}

function ReleaseGateForm({
  onSave,
  onCancel,
  pending,
}: {
  onSave: (decision: 'approve' | 'reject', reason: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [reason, setReason] = React.useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave('approve', reason);
      }}
      className="space-y-4 rounded-xl border border-[#FF7A3D]/35 bg-[#FF7A3D]/[0.05] p-4"
    >
      <div>
        <p className="shipsure-label">Human gate</p>
        <h3 className="mt-1 text-sm font-extrabold text-white">Review release gate</h3>
        <p className="mt-2 text-sm text-[#93A4B8]">
          This decision applies to the recorded preview proof for this revision.
        </p>
      </div>
      <label className="block">
        <span className="shipsure-label">Decision reason</span>
        <textarea
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="shipsure-input min-h-20"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !reason.trim()} className="shipsure-button">
          Approve release
        </button>
        <button
          type="button"
          disabled={pending || !reason.trim()}
          onClick={() => onSave('reject', reason)}
          className="shipsure-button-secondary"
        >
          Reject release
        </button>
        <button type="button" onClick={onCancel} className="shipsure-button-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function BugRecord() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [tab, setTab] = React.useState('overview');
  const [actionForm, setActionForm] = React.useState<FormAction | 'gate' | null>(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const bugQuery = useQuery({
    queryKey: ['shipsure-bug', id],
    queryFn: () => api.getBug(id),
    enabled: !!id,
  });
  const saveAction = useMutation({
    mutationFn: (command: RecordCommand) => {
      switch (command.action) {
        case 'gate':
          return api.gate(id, command.decision, command.reason);
        case 'analyse':
          return api.analyseBug(id);
        case 'deep-analyse':
          return api.deepAnalyseBug(id);
        case 'safe-repair':
          return api.applySafeRepair(id);
        case 'evidence':
          return api.updateBug(id, command.payload);
        case 'repair':
          return api.beginRepair(id, command.payload);
        case 'record-repair':
          return api.recordRepair(id, command.payload);
        case 'verify-preview':
        case 'verify-live':
          return api.recordVerification(id, command.payload);
      }
    },
    onSuccess: () => {
      setActionForm(null);
      setErrorMessage('');
      cache.invalidateQueries({
        queryKey: ['shipsure-bug', id],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-bugs'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-dashboard'],
      });
    },
    onError: (error) => setErrorMessage(error.message),
  });
  if (bugQuery.isLoading) {
    return <div className="h-[70vh] animate-pulse rounded-2xl border border-[#22304A] bg-[#0D1424]" />;
  }
  const record = bugQuery.data;
  if (bugQuery.isError || !record?.bug) {
    return (
      <EmptyState
        title="Bug record unavailable"
        description={bugQuery.error?.message || 'The requested report could not be loaded.'}
        actionLabel="Return to bugs"
        actionTo="/bugs"
      />
    );
  }
  const { bug } = record;
  const workflow = (bug && workflowLabels[bug.status]) || workflowLabels.new;
  const severity = (bug && severityLabels[bug.severity]) || severityLabels.medium;
  const safety = safetyLabel(bug);
  const next =
    bug.analysis_engine === 'llm' && !bug.analysis_stale
      ? null
      : bug.gate_status === 'pending'
        ? { id: 'gate', label: 'Review release gate' }
        : ['approved', 'automatic'].includes(bug.gate_status || '') &&
            bug.production_verification_status === 'not_published'
          ? {
              id: 'version',
              label: bug.linked_version_record_id ? 'Inspect linked version' : 'Record release version',
            }
          : nextAction(bug);
  // Everyone works their own records; the server enforces ownership.
  const action = next && user ? next : null;
  const openAction = () => {
    if (action) {
      if (action.id === 'gate') {
        setTab('verification');
        setActionForm('gate');
        return;
      }
      if (action.id === 'version') {
        navigate('/versions');
        return;
      }
      if (action.id === 'analyse') {
        if (
          bug.analysis_count > 0 &&
          !window.confirm(
            'Create a new analysis from the latest evidence? Earlier analysis history will be preserved.',
          )
        )
          return;
        saveAction.mutate({
          action: 'analyse',
        });
        return;
      }
      if (action.id === 'safe-repair') {
        if (
          !window.confirm(
            'Apply the bound deterministic workflow repair? No product source code will be changed.',
          )
        )
          return;
        saveAction.mutate({
          action: 'safe-repair',
        });
        return;
      }
      if (isFormAction(action.id)) setActionForm(action.id);
    }
  };
  return (
    <div className="min-w-0 space-y-5">
      <div className="rounded-2xl border border-[#22304A] bg-[#0D1424] p-5">
        <button
          type="button"
          onClick={() => navigate('/bugs')}
          className="mb-4 inline-flex items-center gap-2 text-xs font-bold text-[#93A4B8] hover:text-white"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Bug register
        </button>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold tracking-[0.1em] text-[#FF7A3D]">
                {bug.bug_number}
              </span>
              <Badge label={severity.label} tone={severity.tone} />
              <Badge label={workflow.label} tone={workflow.tone} />
              {bug.is_synthetic && <Badge label="Demo fixture" tone="blue" />}
            </div>
            <h2 className="mt-3 text-2xl font-extrabold text-[#F5FAFF] md:text-3xl">{bug.title}</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-[#93A4B8]">{bug.description}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#8496AB]">
              <span>{bug.affected_module}</span>
              <span>{bug.page_route || 'Route not supplied'}</span>
              <span className="capitalize">{bug.environment}</span>
              <span>
                {'Reported '}
                {formatDate(bug.reported_at)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row xl:flex-col">
            {action && (
              <button
                type="button"
                onClick={openAction}
                disabled={saveAction.isPending}
                className="shipsure-button justify-center disabled:opacity-60"
              >
                {saveAction.isPending ? (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <SparklesIcon className="h-4 w-4" />
                )}
                {action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab('activity')}
              className="shipsure-button-secondary justify-center"
            >
              <HistoryIcon className="h-4 w-4" />
              View audit trail
            </button>
          </div>
        </div>
      </div>
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#FF6577]/35 bg-[#FF6577]/10 p-4 text-sm text-[#FFB0B0]"
        >
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {actionForm === 'gate' && (
        <ReleaseGateForm
          pending={saveAction.isPending}
          onCancel={() => setActionForm(null)}
          onSave={(decision, reason) => saveAction.mutate({ action: 'gate', decision, reason })}
        />
      )}
      {actionForm && actionForm !== 'gate' && (
        <RecordActionForm
          key={actionForm}
          type={actionForm}
          bug={bug}
          onCancel={() => setActionForm(null)}
          onSubmit={(command) => saveAction.mutate(command)}
          pending={saveAction.isPending}
        />
      )}
      <div className="min-w-0 grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0 space-y-5">
          <div className="max-w-full overflow-x-auto rounded-xl border border-[#22304A] bg-[#0B1120] p-1.5">
            <div className="flex min-w-max gap-1">
              {recordTabs.map(([tabId, tabLabel]) => {
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setTab(tabId)}
                    className={`rounded-lg px-4 py-2.5 text-xs font-bold transition ${tab === tabId ? 'bg-[#FF7A3D]/15 text-[#FF9B5C]' : 'text-[#93A4B8] hover:bg-[#0D1424] hover:text-white'}`}
                  >
                    {tabLabel}
                    {tabId === 'analysis' && record.analyses.length > 0 ? (
                      <span className="ml-2 rounded-full bg-[#151C30] px-1.5 py-0.5 font-mono text-[9px]">
                        {record.analyses.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          {tab === 'overview' && (
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Plain-language report" eyebrow="Intake">
                <EvidenceText value={bug.description} />
              </Panel>
              <Panel title="Impact" eyebrow="Classification">
                <div className="flex flex-wrap gap-2">
                  <Badge label={severity.label} tone={severity.tone} />
                  <Badge label={bug.priority} tone="blue" />
                  <Badge label={bug.category} tone="slate" />
                </div>
              </Panel>
              <Panel title="What happened" eyebrow="Observed" tone="danger">
                <EvidenceText value={bug.actual_behavior} />
              </Panel>
              <Panel title="What should happen" eyebrow="Expected" tone="success">
                <EvidenceText value={bug.expected_behavior} />
              </Panel>
              <Panel title="Reproduction steps" eyebrow="How to reproduce" className="md:col-span-2">
                <EvidenceText value={bug.reproduction_steps} />
              </Panel>
              <Panel title="Evidence" eyebrow="Proof supplied" className="md:col-span-2">
                <EvidenceText value={bug.evidence} empty="No evidence supplied yet." />
              </Panel>
            </div>
          )}
          {tab === 'analysis' && (
            <div className="space-y-4">
              {user && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                  <div>
                    <p className="text-sm font-bold text-[#F5FAFF]">Deep Analyse</p>
                    <p className="mt-1 text-xs leading-5 text-[#93A4B8]">
                      {bug.analysis_count > 0
                        ? 'Run another pass with the configured analyser to review the current report and its evidence. Each pass is saved in the analysis history.'
                        : 'Run the initial analysis first before a deeper scan.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      saveAction.mutate({
                        action: 'deep-analyse',
                      })
                    }
                    disabled={saveAction.isPending || !bug.analysis_count}
                    className="shipsure-button-secondary shrink-0 justify-center disabled:opacity-50"
                  >
                    {saveAction.isPending ? (
                      <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <SparklesIcon className="h-4 w-4" />
                    )}
                    Run another analysis
                  </button>
                </div>
              )}
              {record.analyses?.length ? (
                record.analyses.map((analysis) => {
                  return (
                    <Panel
                      key={analysis.id}
                      title={`${analysis.analysis_pass === 'deep' ? 'Deep analysis' : 'Analysis'} pass ${analysis.analysis_sequence}`}
                      eyebrow={formatDate(analysis.analyzed_at)}
                      tone={analysis.analysis_status === 'failed' ? 'danger' : 'default'}
                    >
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <Badge
                          label={analysis.analysis_pass === 'deep' ? 'Deep scan' : 'Initial scan'}
                          tone={analysis.analysis_pass === 'deep' ? 'blue' : 'slate'}
                        />
                        <Badge
                          label={analysis.analysis_status}
                          tone={analysis.analysis_status === 'failed' ? 'red' : 'green'}
                        />
                        <Badge
                          label={`AI confidence ${analysis.confidence || 0}%`}
                          tone={
                            analysis.confidence >= 90
                              ? 'green'
                              : analysis.confidence >= 70
                                ? 'gold'
                                : 'amber'
                          }
                        />
                        <Badge
                          label={analysis.safety_decision?.replaceAll('_', ' ')}
                          tone={
                            (safetyLabels[analysis.safety_decision] || safetyLabels.not_assessed).tone
                          }
                        />
                        {analysis.analysis_pass === 'deep' && analysis.escalation_outcome && (
                          <Badge
                            label={
                              analysis.escalation_outcome === 'fix_proposed'
                                ? 'Fix proposed'
                                : 'Needs manual investigation'
                            }
                            tone={analysis.escalation_outcome === 'fix_proposed' ? 'green' : 'amber'}
                          />
                        )}
                        <span className="ml-auto font-mono text-[10px] text-[#708197]">
                          {modelName(analysis.analysis_model)}
                        </span>
                      </div>
                      {analysis.failure_reason ? (
                        <p className="text-sm text-[#FFB0B0]">{analysis.failure_reason}</p>
                      ) : (
                        <>
                          <p className="text-sm font-semibold leading-6 text-[#F5FAFF]">
                            {analysis.summary}
                          </p>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <EvidenceList
                              title="Evidence supporting diagnosis"
                              items={analysis.evidence_supporting}
                            />
                            <EvidenceList
                              title="Missing evidence"
                              items={analysis.missing_information}
                            />
                            <EvidenceList title="Affected areas" items={analysis.affected_areas} />
                            <EvidenceList title="Regression risks" items={analysis.regression_risks} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                                Likely cause
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[#DDE7F2]">
                                {analysis.suspected_cause}
                              </p>
                            </div>
                            <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                                Alternative hypothesis
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[#DDE7F2]">
                                {analysis.alternative_hypothesis || 'None recorded.'}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                                {analysis.implementation_prompt
                                  ? 'Fix prompt (model-authored)'
                                  : 'Fix prompt (built from this analysis)'}
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  copyPrompt(
                                    analysis.implementation_prompt || formatFixPlan(bug, analysis),
                                  )
                                }
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#2D3B55] px-2.5 py-1.5 text-[10px] font-bold text-[#DDE7F2] hover:bg-[#151C30]"
                              >
                                <CopyIcon className="h-3 w-3" />
                                Copy prompt
                              </button>
                            </div>
                            {analysis.implementation_prompt && (
                              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[#22304A] bg-[#050810] p-3 text-[11px] leading-5 text-[#B5C1D0]">
                                {analysis.implementation_prompt}
                              </pre>
                            )}
                          </div>
                        </>
                      )}
                    </Panel>
                  );
                })
              ) : (
                <EmptyState
                  title="No AI analysis yet"
                  description="Run AI checking to create a structured, versioned conclusion."
                />
              )}
            </div>
          )}
          {tab === 'repair' && (
            <div className="space-y-4">
              <Panel title="Current repair gate" eyebrow="Trust boundary">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={safety.label} tone={safety.tone} />
                  <Badge label={bug.repair_status?.replaceAll('_', ' ')} tone="blue" />
                </div>
                <p className="mt-4 text-sm font-semibold leading-6 text-[#F5FAFF]">
                  {bug.proposed_fix || 'No repair proposal exists yet.'}
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <EvidenceList title="Why ReleaseGate chose this gate" items={bug.safety_reasons} />
                  <EvidenceList title="Planned checks" items={bug.repair_checks} />
                </div>
              </Panel>
              {record.repairs?.length ? (
                record.repairs.map((repair) => {
                  return (
                    <Panel
                      key={repair.id}
                      title={`Repair attempt ${repair.attempt_sequence}`}
                      eyebrow={repair.mode?.replaceAll('_', ' ')}
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          label={repair.status}
                          tone={
                            repair.status === 'applied'
                              ? 'green'
                              : repair.status === 'failed'
                                ? 'red'
                                : 'gold'
                          }
                        />
                        <span className="font-mono text-[10px] text-[#708197]">
                          {repair.checkpoint_reference || 'No checkpoint reference'}
                        </span>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-[#DDE7F2]">{repair.summary}</p>
                      {repair.implementation_evidence && (
                        <div className="mt-4 rounded-lg border border-[#52F2B8]/25 bg-[#52F2B8]/[0.04] p-3 text-xs leading-5 text-[#B5C1D0]">
                          {repair.implementation_evidence}
                        </div>
                      )}
                    </Panel>
                  );
                })
              ) : (
                <EmptyState
                  title="No repair attempt yet"
                  description="The approved repair route and checkpoint evidence will appear here."
                />
              )}
            </div>
          )}
          {tab === 'verification' && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Panel
                  title="Preview evidence"
                  eyebrow={bug.preview_verification_status?.replaceAll('_', ' ')}
                  tone={
                    bug.preview_verification_status === 'passed'
                      ? 'success'
                      : bug.preview_verification_status === 'failed'
                        ? 'danger'
                        : 'default'
                  }
                >
                  <EvidenceText value={bug.preview_evidence} empty="Preview has not been proven yet." />
                </Panel>
                <Panel
                  title="Live evidence"
                  eyebrow={bug.production_verification_status?.replaceAll('_', ' ')}
                  tone={
                    bug.production_verification_status === 'passed'
                      ? 'success'
                      : bug.production_verification_status === 'failed'
                        ? 'danger'
                        : 'default'
                  }
                >
                  <EvidenceText value={bug.production_evidence} empty="Live has not been proven yet." />
                </Panel>
              </div>
              {record.verifications?.length ? (
                record.verifications.map((verification) => {
                  return (
                    <Panel
                      key={verification.id}
                      title={`${verification.environment} verification`}
                      eyebrow={formatDate(verification.verified_at)}
                      tone={
                        verification.result === 'passed'
                          ? 'success'
                          : verification.result === 'failed'
                            ? 'danger'
                            : 'default'
                      }
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          label={verification.result?.replaceAll('_', ' ')}
                          tone={
                            verification.result === 'passed'
                              ? 'green'
                              : verification.result === 'failed'
                                ? 'red'
                                : 'amber'
                          }
                        />
                        <Badge label={verification.method} tone="blue" />
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="shipsure-label">Expected</p>
                          <EvidenceText value={verification.expected_result} />
                        </div>
                        <div>
                          <p className="shipsure-label">Observed</p>
                          <EvidenceText value={verification.observed_result} />
                        </div>
                      </div>
                      <div className="mt-4 rounded-lg border border-[#22304A] bg-[#0B1120] p-3 text-xs leading-5 text-[#B5C1D0]">
                        {verification.evidence}
                      </div>
                      {verification.proof && (
                        <section className="mt-4 space-y-3 rounded-xl border border-[#52F2B8]/25 p-4">
                          <h4 className="text-sm font-bold text-white">{verification.proof.fixture}</h4>
                          <p className="text-xs text-[#93A4B8]">
                            Checks ran against the isolated demo preview.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <p className="shipsure-label">Before</p>
                              <EvidenceText value={verification.proof.before} />
                            </div>
                            <div>
                              <p className="shipsure-label">After</p>
                              <EvidenceText value={verification.proof.after} />
                            </div>
                          </div>
                          <ul className="space-y-1 text-xs text-[#93A4B8]">
                            {verification.proof.checks.map((check) => (
                              <li key={check.name}>
                                {check.name} ? before {check.beforePassed ? 'passed' : 'failed'} ? after{' '}
                                {check.afterPassed ? 'passed' : 'failed'}
                              </li>
                            ))}
                          </ul>
                          <p className="break-all font-mono text-xs text-[#708197]">
                            Receipt {verification.proof.receipt}
                          </p>
                        </section>
                      )}
                    </Panel>
                  );
                })
              ) : (
                <EmptyState
                  title="No retest proof yet"
                  description="Record Preview evidence after implementation. Live proof stays separate."
                />
              )}
            </div>
          )}
          {tab === 'activity' && (
            <Panel title="Immutable activity trail" eyebrow="Who did what, and when">
              {record.activity?.length ? (
                <div className="space-y-0">
                  {record.activity.map((entry, index) => {
                    return (
                      <div key={entry.id} className="relative flex gap-4 pb-5 last:pb-0">
                        {index < record.activity.length - 1 && (
                          <span className="absolute left-[15px] top-8 h-[calc(100%-14px)] w-px bg-[#22304A]" />
                        )}
                        <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2D3B55] bg-[#0B1120] text-[#FF7A3D]">
                          <ActivityIcon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-sm font-bold text-[#F5FAFF]">
                            {entry.action?.replaceAll('.', ' ')}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[#93A4B8]">{entry.detail}</p>
                          <p className="mt-1 font-mono text-[9px] text-[#66788D]">
                            {formatDate(entry.occurred_at)}
                            {' · '}
                            {entry.actor_email}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No activity recorded"
                  description="Actions will appear here as append-only evidence."
                />
              )}
            </Panel>
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          <Panel title="Lifecycle" eyebrow="Report to Live proof">
            <Lifecycle step={workflow.step || 0} />
          </Panel>
          <Panel title="Safety decision" eyebrow="Independent of confidence">
            <Badge label={safety.label} tone={safety.tone} />
            <p className="mt-3 text-3xl font-extrabold text-[#F5FAFF]">
              {bug.ai_confidence || 0}
              <span className="text-sm text-[#93A4B8]">%</span>
            </p>
            <p className="text-xs text-[#93A4B8]">AI diagnosis confidence</p>
            <div className="mt-4 space-y-2">
              {(bug.safety_reasons || []).map((item) => (
                <p
                  key={item}
                  className="rounded-lg border border-[#22304A] bg-[#0B1120] p-2.5 text-xs leading-5 text-[#B5C1D0]"
                >
                  {item}
                </p>
              ))}
            </div>
          </Panel>
          <Panel title="Release linkage" eyebrow="Version Recorder">
            {bug.linked_semantic_version ? (
              <Link
                to="/versions"
                className="flex items-center justify-between rounded-lg border border-[#FF7A3D]/30 bg-[#FF7A3D]/10 p-3"
              >
                <span className="font-mono font-bold text-[#FF9B5C]">
                  v{bug.linked_semantic_version}
                </span>
                <ChevronRightIcon className="h-4 w-4 text-[#FF7A3D]" />
              </Link>
            ) : (
              <p className="text-sm leading-6 text-[#93A4B8]">
                No release linked yet. Preview must be proven before this belongs in a Version Record.
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
