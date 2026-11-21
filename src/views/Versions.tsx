import type { Bug, Version, VersionInput } from '../api';
import React from 'react';

import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PlusIcon,
  RocketIcon,
  ShieldCheckIcon,
  TagIcon,
  XIcon,
} from 'lucide-react';

import { Badge, CountUp, EmptyState, Panel } from './Components';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Link } from 'react-router-dom';

import { api } from '../api';

import { formatDate } from './presentation';

import { motion, useReducedMotion } from 'framer-motion';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const initialVersion: VersionInput & { linked_bug_ids: string[] } = {
  semantic_version: '',
  title: '',
  summary: '',
  change_type: 'fix',
  release_status: 'draft',
  changes: '',
  reason: '',
  qa_status: 'not_tested',
  qa_notes: '',
  known_issues: '',
  rollback_notes: '',
  implementation_status: 'saved',
  implementation_evidence: '',
  source_checkpoint: '',
  preview_status: 'not_tested',
  preview_evidence: '',
  production_status: 'not_published',
  production_evidence: '',
  linked_bug_ids: [],
};

function proofTone(status: string | undefined) {
  return status === 'passed' || status === 'live_verified'
    ? 'green'
    : status === 'failed' || status === 'rolled_back'
      ? 'red'
      : status === 'partial' || status === 'published_unverified'
        ? 'amber'
        : 'blue';
}

function VersionForm({
  bugs,
  onCancel,
  onSubmit,
  pending,
}: {
  bugs: Bug[];
  onCancel: () => void;
  onSubmit: (input: VersionInput) => void;
  pending: boolean;
}) {
  const [form, setForm] = React.useState(initialVersion);
  const field =
    (fieldName: keyof VersionInput) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((previous) => ({
        ...previous,
        [fieldName]: event.target.value,
      }));
  const eligibleBugs = bugs.filter((bug) =>
    ['awaiting_production_verification', 'resolved', 'closed', 'duplicate'].includes(bug.status),
  );
  const toggleBug = (value: string) => {
    setForm((previous) => ({
      ...previous,
      linked_bug_ids: previous.linked_bug_ids.includes(value)
        ? previous.linked_bug_ids.filter((item) => item !== value)
        : [...previous.linked_bug_ids, value],
    }));
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
      className="rounded-2xl border border-[#FF7A3D]/35 bg-[#0D1424] p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#FF7A3D]">
            Version Recorder
          </p>
          <h3 className="mt-1 text-xl font-extrabold text-white">Create a release record</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-2 text-[#93A4B8] hover:bg-[#151C30]"
          aria-label="Close form"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label>
          <span className="shipsure-label">Semantic version</span>
          <input
            value={form.semantic_version}
            onChange={field('semantic_version')}
            className="shipsure-input font-mono"
            placeholder="0.1.0"
            required
          />
        </label>
        <label>
          <span className="shipsure-label">Change type</span>
          <select value={form.change_type} onChange={field('change_type')} className="shipsure-input">
            <option value="baseline">Baseline</option>
            <option value="feature">Feature</option>
            <option value="fix">Fix</option>
            <option value="refinement">Refinement</option>
            <option value="architecture">Architecture</option>
            <option value="security">Security</option>
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="shipsure-label">Release title</span>
          <input value={form.title} onChange={field('title')} className="shipsure-input" required />
        </label>
        <label className="md:col-span-2">
          <span className="shipsure-label">Plain-language summary</span>
          <textarea
            value={form.summary}
            onChange={field('summary')}
            className="shipsure-input min-h-24"
            required
          />
        </label>
        <label>
          <span className="shipsure-label">What changed</span>
          <textarea
            value={form.changes}
            onChange={field('changes')}
            className="shipsure-input min-h-28"
            required
          />
        </label>
        <label>
          <span className="shipsure-label">Why it changed</span>
          <textarea
            value={form.reason}
            onChange={field('reason')}
            className="shipsure-input min-h-28"
            required
          />
        </label>
        <label>
          <span className="shipsure-label">Source checkpoint</span>
          <input
            value={form.source_checkpoint}
            onChange={field('source_checkpoint')}
            className="shipsure-input font-mono text-xs"
          />
        </label>
        <label>
          <span className="shipsure-label">QA status</span>
          <select value={form.qa_status} onChange={field('qa_status')} className="shipsure-input">
            <option value="not_tested">Not tested</option>
            <option value="partial">Partial</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <label>
          <span className="shipsure-label">Preview status</span>
          <select
            value={form.preview_status}
            onChange={field('preview_status')}
            className="shipsure-input"
          >
            <option value="not_tested">Not tested</option>
            <option value="partial">Partial</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label>
          <span className="shipsure-label">Release status</span>
          <select
            value={form.release_status}
            onChange={field('release_status')}
            className="shipsure-input"
          >
            <option value="draft">Draft</option>
            <option value="preview_verified">Preview verified</option>
          </select>
        </label>
        <label className="md:col-span-2">
          <span className="shipsure-label">Implementation evidence</span>
          <textarea
            value={form.implementation_evidence}
            onChange={field('implementation_evidence')}
            className="shipsure-input min-h-20"
          />
        </label>
        <label>
          <span className="shipsure-label">Preview evidence</span>
          <textarea
            value={form.preview_evidence}
            onChange={field('preview_evidence')}
            className="shipsure-input min-h-20"
          />
        </label>
        <label>
          <span className="shipsure-label">Rollback notes</span>
          <textarea
            value={form.rollback_notes}
            onChange={field('rollback_notes')}
            className="shipsure-input min-h-20"
          />
        </label>
        <label className="md:col-span-2">
          <span className="shipsure-label">Known issues</span>
          <textarea
            value={form.known_issues}
            onChange={field('known_issues')}
            className="shipsure-input min-h-20"
          />
        </label>
      </div>
      <div className="mt-5">
        <p className="shipsure-label">Link bugs with Preview proof</p>
        {eligibleBugs.length ? (
          <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
            {eligibleBugs.map((bug) => (
              <label
                key={bug.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${form.linked_bug_ids.includes(bug.id) ? 'border-[#FF7A3D]/50 bg-[#FF7A3D]/10' : 'border-[#22304A] bg-[#0B1120] hover:border-[#2D3B55]'}`}
              >
                <input
                  type="checkbox"
                  checked={form.linked_bug_ids.includes(bug.id)}
                  onChange={() => toggleBug(bug.id)}
                  className="accent-[#FF7A3D]"
                />
                <span className="font-mono text-[10px] font-bold text-[#FF7A3D]">{bug.bug_number}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#DDE7F2]">
                  {bug.title}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-[#2D3B55] p-3 text-xs text-[#8496AB]">
            No bugs are release-ready yet. The Version Record can still capture a baseline.
          </p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" onClick={onCancel} className="shipsure-button-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="shipsure-button disabled:opacity-60">
          {pending && <LoaderCircleIcon className="h-4 w-4 animate-spin" />}Save Version Record
        </button>
      </div>
    </form>
  );
}

function VersionCard({
  version,
  expanded,
  onToggle,
  onRelease,
  onVerify,
  releasing,
  verifying,
}: {
  version: Version;
  expanded: boolean;
  onToggle: () => void;
  onRelease: (id: string) => void;
  onVerify: (id: string, proof: { result: string; evidence: string }) => void;
  releasing: boolean;
  verifying: boolean;
}) {
  const [verification, setVerification] = React.useState({
    result: 'passed',
    evidence: '',
  });
  const linkedBugs = version.linked_bug_numbers || [];
  const hasProof = version.preview_status === 'passed' && Boolean(version.preview_evidence?.trim());
  const canRelease = hasProof && ['draft', 'preview_verified'].includes(version.release_status);
  const canVerify = version.release_status === 'released' && version.production_status !== 'passed';
  return (
    <article className="overflow-hidden rounded-2xl border border-[#22304A] bg-[#0D1424]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-4 p-5 text-left hover:bg-[#151C30]/45"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#FF7A3D]/30 bg-[#FF7A3D]/10 text-[#FF9B5C]">
          <TagIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-extrabold text-[#FF9B5C]">
              v{version.semantic_version}
            </span>
            <Badge
              label={version.release_status?.replaceAll('_', ' ')}
              tone={proofTone(version.release_status)}
            />
            {version.is_synthetic && <Badge label="Demo fixture" tone="blue" />}
          </div>
          <h3 className="mt-2 text-base font-extrabold text-white">{version.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#93A4B8]">{version.summary}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[#708197]">
            <span>{formatDate(version.recorded_at)}</span>
            <span>
              {linkedBugs.length}
              {' linked bugs'}
            </span>
            <span>{version.change_type}</span>
          </div>
        </div>
        {expanded ? (
          <ChevronUpIcon className="mt-2 h-4 w-4 text-[#93A4B8]" />
        ) : (
          <ChevronDownIcon className="mt-2 h-4 w-4 text-[#93A4B8]" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-[#22304A] p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
              <p className="shipsure-label">What changed</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#DDE7F2]">
                {version.changes}
              </p>
            </div>
            <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
              <p className="shipsure-label">Why it changed</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#DDE7F2]">
                {version.reason}
              </p>
            </div>
            <div className="rounded-xl border border-[#52F2B8]/25 bg-[#52F2B8]/[0.035] p-4">
              <p className="shipsure-label">Saved implementation</p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#B5C1D0]">
                {version.implementation_evidence || 'No implementation evidence recorded.'}
              </p>
            </div>
            <div className="rounded-xl border border-[#C65A2E]/25 bg-[#C65A2E]/[0.035] p-4">
              <p className="shipsure-label">Preview proof</p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#B5C1D0]">
                {version.preview_evidence || 'Preview has not been proven.'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge label={`QA ${version.qa_status}`} tone={proofTone(version.qa_status)} />
            <Badge
              label={`Preview ${version.preview_status}`}
              tone={proofTone(version.preview_status)}
            />
            <Badge
              label={`Live ${version.production_status}`}
              tone={proofTone(version.production_status)}
            />
          </div>
          {linkedBugs.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {linkedBugs.map((reference) => (
                <span
                  key={reference}
                  className="rounded-md border border-[#22304A] bg-[#0B1120] px-2 py-1 font-mono text-[10px] font-bold text-[#FF7A3D]"
                >
                  {reference}
                </span>
              ))}
            </div>
          )}
          {canRelease && (
            <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#52F2B8]/30 bg-[#52F2B8]/[0.04] p-4 md:flex-row md:items-center">
              <div className="flex-1">
                <p className="text-xs font-extrabold text-white">
                  Preview proven. Record the release decision.
                </p>
                <p className="mt-1 text-xs leading-5 text-[#93A4B8]">
                  Mark this version Released after it has been published. Live verification remains a
                  separate evidence step.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRelease(version.id)}
                disabled={releasing}
                className="shipsure-button justify-center disabled:opacity-60"
              >
                {releasing ? (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <RocketIcon className="h-4 w-4" />
                )}
                Mark released
              </button>
            </div>
          )}
          {!hasProof && ['draft', 'preview_verified'].includes(version.release_status) && (
            <p className="mt-5 rounded-xl border border-[#22304A] bg-[#0B1120] p-4 text-xs leading-5 text-[#93A4B8]">
              Passing Preview evidence is required before this version can be marked Released.
            </p>
          )}
          {canVerify && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onVerify(version.id, verification);
              }}
              className="mt-5 rounded-xl border border-[#FF7A3D]/30 bg-[#FF7A3D]/[0.04] p-4"
            >
              <p className="text-xs font-extrabold text-white">Record Live release proof</p>
              <p className="mt-1 text-xs leading-5 text-[#93A4B8]">
                Publishing is not verification. Record the observed result after checking the real app.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[190px_1fr_auto]">
                <select
                  value={verification.result}
                  onChange={(event) =>
                    setVerification((previous) => ({
                      ...previous,
                      result: event.target.value,
                    }))
                  }
                  className="shipsure-input"
                >
                  <option value="passed">Passed</option>
                  <option value="partial">Partial</option>
                  <option value="failed">Failed</option>
                  <option value="published_unverified">Published, unverified</option>
                </select>
                <input
                  value={verification.evidence}
                  onChange={(event) =>
                    setVerification((previous) => ({
                      ...previous,
                      evidence: event.target.value,
                    }))
                  }
                  className="shipsure-input"
                  placeholder="URL, observed result and evidence reference"
                  required
                />
                <button
                  type="submit"
                  disabled={verifying}
                  className="shipsure-button justify-center disabled:opacity-60"
                >
                  {verifying ? (
                    <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheckIcon className="h-4 w-4" />
                  )}
                  Save proof
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

export function Versions() {
  const reduceMotion = useReducedMotion();
  const cache = useQueryClient();
  const [recorderOpen, setRecorderOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const versionsQuery = useQuery({
    queryKey: ['shipsure-versions'],
    queryFn: api.listVersions,
  });
  const bugsQuery = useQuery({
    queryKey: ['shipsure-bugs'],
    queryFn: () => api.listBugs(500),
  });
  const versions = versionsQuery.data?.records || [];
  const bugs = bugsQuery.data?.records || [];
  const createVersion = useMutation({
    mutationFn: api.createVersion,
    onSuccess: (result) => {
      setRecorderOpen(false);
      setMessage('');
      setErrorMessage(result.audit_warning || '');
      cache.invalidateQueries({
        queryKey: ['shipsure-versions'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-dashboard'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-bugs'],
      });
    },
    onError: (error) => {
      setErrorMessage('');
      setMessage(error.message);
    },
  });
  const releaseVersion = useMutation({
    mutationFn: api.markVersionReleased,
    onSuccess: (result) => {
      setMessage('');
      setErrorMessage(result.audit_warning || '');
      cache.invalidateQueries({
        queryKey: ['shipsure-versions'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-dashboard'],
      });
    },
    onError: (error) => {
      setErrorMessage('');
      setMessage(error.message);
    },
  });
  const verifyVersion = useMutation({
    mutationFn: (input: { id: string; result: string; evidence: string }) => {
      const { id, result, evidence } = input;
      return api.verifyVersionLive(id, result, evidence);
    },
    onSuccess: (result) => {
      setMessage('');
      setErrorMessage(result.audit_warning || '');
      cache.invalidateQueries({
        queryKey: ['shipsure-versions'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-dashboard'],
      });
    },
    onError: (error) => {
      setErrorMessage('');
      setMessage(error.message);
    },
  });
  const counts = React.useMemo(
    () => ({
      recorded: versions.length,
      preview: versions.filter((version) => version.preview_status === 'passed').length,
      live: versions.filter((version) => version.production_status === 'passed').length,
      linked: versions.reduce((version, version2) => {
        return version + (version2.linked_bug_numbers?.length || 0);
      }, 0),
    }),
    [versions],
  );
  const chartData = versions
    .slice()
    .reverse()
    .slice(-8)
    .map((version) => ({
      version: `v${version.semantic_version}`,
      QA: version.qa_status === 'passed' ? 100 : version.qa_status === 'partial' ? 55 : 10,
      Preview:
        version.preview_status === 'passed' ? 100 : version.preview_status === 'partial' ? 55 : 10,
      Live:
        version.production_status === 'passed'
          ? 100
          : version.production_status === 'partial'
            ? 55
            : version.production_status === 'published_unverified'
              ? 25
              : 10,
    }));
  return versionsQuery.isLoading || bugsQuery.isLoading ? (
    <div className="h-[72vh] animate-pulse rounded-2xl border border-[#22304A] bg-[#0D1424]" />
  ) : versionsQuery.isError ? (
    <EmptyState
      title="Version Recorder unavailable"
      description={versionsQuery.error?.message || 'ReleaseGate could not load release records.'}
    />
  ) : (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-[#273652] bg-[radial-gradient(circle_at_30%_0%,rgba(31,71,112,0.42),transparent_42%),linear-gradient(135deg,#0D1424,#080D18)] p-5 md:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FF7A3D]/80 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF7A3D]">
              Version Recorder
            </p>
            <h2 className="mt-2 text-2xl font-extrabold text-white md:text-3xl">
              A release is a claim. Keep the evidence beside it.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#93A4B8]">
              Capture what changed, why, the checkpoint, linked bugs, Preview proof and a separate Live
              result. Every version remains readable long after the build chat disappears.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRecorderOpen((previous) => !previous)}
            className="shipsure-button shrink-0"
          >
            {recorderOpen ? <XIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
            {recorderOpen ? 'Close recorder' : 'Record version'}
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              [TagIcon, counts.recorded, 'Versions'],
              [ClipboardCheckIcon, counts.preview, 'Preview proven'],
              [RocketIcon, counts.live, 'Live proven'],
              [GitBranchIcon, counts.linked, 'Linked bugs'],
            ] as const
          ).map(([Icon, count, label]) => (
            <div key={label} className="rounded-xl border border-[#22304A] bg-[#050810]/30 p-3">
              <Icon className="h-4 w-4 text-[#FF7A3D]" />
              <p className="mt-3 font-mono text-2xl font-extrabold text-white">
                <CountUp value={count} />
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#93A4B8]">
                {label}
              </p>
            </div>
          ))}
        </div>
      </section>
      {message && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-[#FF6577]/35 bg-[#FF6577]/10 p-4 text-sm text-[#FFB0B0]"
        >
          <span>{message}</span>
          <button type="button" onClick={() => setMessage('')}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-[#C65A2E]/35 bg-[#C65A2E]/10 p-4 text-sm text-[#D8CCFF]"
        >
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage('')}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      {recorderOpen && (
        <VersionForm
          bugs={bugs}
          onCancel={() => setRecorderOpen(false)}
          onSubmit={(value) => createVersion.mutate(value)}
          pending={createVersion.isPending}
        />
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          {versions.length ? (
            versions.map((version, index) => (
              <motion.div
                key={version.id}
                initial={
                  reduceMotion
                    ? false
                    : {
                        opacity: 0,
                        y: 8,
                      }
                }
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                transition={{
                  delay: Math.min(index * 0.04, 0.24),
                }}
              >
                <VersionCard
                  version={version}
                  expanded={expandedId === version.id}
                  onToggle={() => setExpandedId(expandedId === version.id ? null : version.id)}
                  onRelease={(versionId) => releaseVersion.mutate(versionId)}
                  onVerify={(versionId, evidence) =>
                    verifyVersion.mutate({
                      id: versionId,
                      ...evidence,
                    })
                  }
                  releasing={releaseVersion.isPending}
                  verifying={verifyVersion.isPending}
                />
              </motion.div>
            ))
          ) : (
            <EmptyState
              title="No Version Records yet"
              description="Create the 0.1.0 baseline so every later release has a trusted starting point."
            />
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Release proof" eyebrow="Last eight versions">
            {chartData.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 4,
                      left: -26,
                      bottom: 0,
                    }}
                  >
                    <CartesianGrid stroke="#22304A" strokeDasharray="3 4" vertical={false} />
                    <XAxis
                      dataKey="version"
                      stroke="#708197"
                      tick={{
                        fill: '#93A4B8',
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#708197"
                      tick={{
                        fill: '#93A4B8',
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#080D18',
                        border: '1px solid #2D3B55',
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                    />
                    <Bar
                      dataKey="QA"
                      fill="#C65A2E"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={!reduceMotion}
                    />
                    <Bar
                      dataKey="Preview"
                      fill="#FF7A3D"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={!reduceMotion}
                    />
                    <Bar
                      dataKey="Live"
                      fill="#52F2B8"
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={!reduceMotion}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="Chart awaits a baseline"
                description="Proof coverage will animate as releases are recorded."
              />
            )}
            <div className="mt-3 flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-[0.1em] text-[#93A4B8]">
              <span>
                <i className="mr-2 inline-block h-2 w-2 rounded-full bg-[#C65A2E]" />
                QA
              </span>
              <span>
                <i className="mr-2 inline-block h-2 w-2 rounded-full bg-[#FF7A3D]" />
                Preview
              </span>
              <span>
                <i className="mr-2 inline-block h-2 w-2 rounded-full bg-[#52F2B8]" />
                Live
              </span>
            </div>
          </Panel>
          <Panel title="Release rule" eyebrow="Proof ladder">
            <div className="space-y-3">
              {[
                ['Saved', 'Checkpoint and implementation evidence exist.'],
                ['Preview proven', 'The repaired behaviour is observed in Preview.'],
                ['Released', 'The version is published; Live is still unverified.'],
                ['Live proven', 'The real URL matches the expected result.'],
              ].map(([stepLabel, description], index) => (
                <div key={stepLabel} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold ${index === 3 ? 'border-[#52F2B8]/40 bg-[#52F2B8]/10 text-[#7FF7CD]' : 'border-[#FF7A3D]/35 bg-[#FF7A3D]/10 text-[#FF9B5C]'}`}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-white">{stepLabel}</p>
                    <p className="mt-0.5 text-xs leading-5 text-[#93A4B8]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Link
            to="/bugs?workflow=awaiting_production_verification"
            className="shipsure-button-secondary w-full justify-center"
          >
            <CircleCheckIcon className="h-4 w-4" />
            View release-ready bugs
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
