import React from 'react';

import {
  ArrowLeftIcon,
  CircleCheckIcon,
  FileImageIcon,
  LoaderCircleIcon,
  MapPinIcon,
  SparklesIcon,
} from 'lucide-react';

import { Panel } from './Components';

import { api, ApiError, type Bug, type ReportInput } from '../api';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useNavigate } from 'react-router-dom';

type ReportForm = Required<
  Pick<
    ReportInput,
    | 'title'
    | 'description'
    | 'expected_behavior'
    | 'actual_behavior'
    | 'reproduction_steps'
    | 'affected_module'
    | 'page_route'
    | 'environment'
    | 'severity'
    | 'evidence'
    | 'source'
  >
>;

const initialReport: ReportForm = {
  title: '',
  description: '',
  expected_behavior: '',
  actual_behavior: '',
  reproduction_steps: '',
  affected_module: '',
  page_route: '',
  environment: 'preview',
  severity: 'medium',
  evidence: '',
  source: 'manual',
};

export function Report() {
  const navigate = useNavigate();
  const [form, setForm] = React.useState(initialReport);
  const [savedBug, setSavedBug] = React.useState<Bug | null>(null);
  const [message, setMessage] = React.useState('');
  const [requestKey, setRequestKey] = React.useState(() => crypto.randomUUID());
  const cache = useQueryClient();
  const createReport = useMutation({
    mutationFn: async (input: ReportForm) => {
      const { bug } = await api.createBug(
        {
          ...input,
          reporter_browser: navigator.userAgent,
          evidence_count: input.evidence.trim() ? 1 : 0,
        },
        requestKey,
      );
      try {
        const analysis = await api.analyseBug(bug.id);
        return {
          bug: analysis.bug,
          note: analysis.analysis_failed
            ? 'The report was preserved and safely routed to manual investigation.'
            : 'AI checking completed and the safety decision is ready.',
        };
      } catch (error) {
        return {
          bug,
          note:
            error instanceof ApiError && error.status === 403
              ? 'The report is saved. An administrator can start AI checking from the queue.'
              : 'The report is saved. AI checking can be retried safely from the record.',
        };
      }
    },
    onSuccess: ({ bug, note }) => {
      setSavedBug(bug);
      setMessage(note);
      void cache.invalidateQueries({ queryKey: ['shipsure-dashboard'] });
      void cache.invalidateQueries({ queryKey: ['shipsure-bugs'] });
    },
  });
  const field =
    (name: keyof ReportForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      setForm((previous) => ({ ...previous, [name]: value }));
      setRequestKey(crypto.randomUUID());
    };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createReport.mutate(form);
  };
  return savedBug ? (
    <div className="mx-auto max-w-3xl">
      <Panel className="p-7 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#52F2B8]/30 bg-[#52F2B8]/10 text-[#52F2B8]">
          <CircleCheckIcon className="h-7 w-7" />
        </div>
        <p className="mt-5 font-mono text-sm font-bold tracking-[0.12em] text-[#FF7A3D]">
          {savedBug.bug_number}
        </p>
        <h2 className="mt-2 text-2xl font-extrabold text-[#F5FAFF]">
          Bug logged without losing the trail
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#93A4B8]">{message}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            onClick={() => navigate(`/bugs/${savedBug.id}`)}
            className="shipsure-button justify-center"
          >
            Open bug record
          </button>
          <button
            onClick={() => {
              setSavedBug(null);
              setForm(initialReport);
              setRequestKey(crypto.randomUUID());
              setMessage('');
            }}
            className="shipsure-button-secondary justify-center"
          >
            Log another
          </button>
        </div>
      </Panel>
    </div>
  ) : (
    <form onSubmit={submit} className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[#22304A] bg-[#0D1424] p-5 md:flex-row md:items-center">
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-3 inline-flex items-center gap-2 text-xs font-bold text-[#93A4B8] hover:text-white"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            {' Back'}
          </button>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#FF7A3D]">New report</p>
          <h2 className="mt-1 text-2xl font-extrabold text-[#F5FAFF]">
            Give ReleaseGate enough signal to help
          </h2>
          <p className="mt-2 text-sm text-[#93A4B8]">
            Three compact sections. Technical detail stays optional.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 self-start rounded-full border border-[#C65A2E]/30 bg-[#C65A2E]/10 px-3 py-1.5 text-xs font-semibold text-[#FFD0B7]">
          <SparklesIcon className="h-3.5 w-3.5" />
          {' AI check starts after save'}
        </span>
      </div>
      <Panel title="What happened" eyebrow="1 of 3">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2">
            <span className="shipsure-label">Short title</span>
            <input
              value={form.title}
              onChange={field('title')}
              className="shipsure-input"
              placeholder="e.g. Client card does not expand"
              required
              maxLength={240}
            />
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Plain-language description</span>
            <textarea
              value={form.description}
              onChange={field('description')}
              className="shipsure-input min-h-28 resize-y"
              placeholder="What were you trying to do, and what stopped you?"
              required
            />
          </label>
          <label>
            <span className="shipsure-label">Actual result</span>
            <textarea
              value={form.actual_behavior}
              onChange={field('actual_behavior')}
              className="shipsure-input min-h-24 resize-y"
              placeholder="What did you see?"
            />
          </label>
          <label>
            <span className="shipsure-label">Expected result</span>
            <textarea
              value={form.expected_behavior}
              onChange={field('expected_behavior')}
              className="shipsure-input min-h-24 resize-y"
              placeholder="What should have happened?"
            />
          </label>
        </div>
      </Panel>
      <Panel title="Where it happened" eyebrow="2 of 3">
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="shipsure-label">Affected area</span>
            <div className="relative">
              <MapPinIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C65A2E]" />
              <input
                value={form.affected_module}
                onChange={field('affected_module')}
                className="shipsure-input pl-10"
                placeholder="Dashboard, onboarding, version history…"
                required
              />
            </div>
          </label>
          <label>
            <span className="shipsure-label">Page or route</span>
            <input
              value={form.page_route}
              onChange={field('page_route')}
              className="shipsure-input font-mono text-xs"
              placeholder="/admin/bugs"
            />
          </label>
          <label>
            <span className="shipsure-label">Environment</span>
            <select value={form.environment} onChange={field('environment')} className="shipsure-input">
              <option value="preview">Preview</option>
              <option value="live">Live</option>
              <option value="unknown">Not sure</option>
            </select>
          </label>
          <label>
            <span className="shipsure-label">Initial severity</span>
            <select value={form.severity} onChange={field('severity')} className="shipsure-input">
              <option value="critical">Critical — core service unusable</option>
              <option value="high">High — important workflow blocked</option>
              <option value="medium">Medium — degraded but workable</option>
              <option value="low">Low — narrow or visual issue</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="shipsure-label">Reproduction steps</span>
            <textarea
              value={form.reproduction_steps}
              onChange={field('reproduction_steps')}
              className="shipsure-input min-h-28 resize-y"
              placeholder={`1. Open…
2. Click…
3. Observe…`}
            />
          </label>
        </div>
      </Panel>
      <Panel title="Proof" eyebrow="3 of 3">
        <div className="rounded-xl border border-dashed border-[#2D3B55] bg-[#0B1120] p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-[#22304A] bg-[#0D1424] p-2.5 text-[#FF7A3D]">
              <FileImageIcon className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <label>
                <span className="shipsure-label">Evidence notes or controlled file reference</span>
                <textarea
                  value={form.evidence}
                  onChange={field('evidence')}
                  className="shipsure-input min-h-28 resize-y"
                  placeholder="Paste a sanitised log excerpt, screenshot reference or observation. Never include passwords, tokens or private customer data."
                />
              </label>
              <p className="mt-2 text-xs leading-5 text-[#8496AB]">
                Private attachment upload is deliberately deferred until retention and redaction rules
                are finished.
              </p>
            </div>
          </div>
        </div>
      </Panel>
      {createReport.isError && (
        <div
          role="alert"
          className="rounded-xl border border-[#FF6577]/30 bg-[#FF6577]/10 p-4 text-sm text-[#FFB0B0]"
        >
          {createReport.error.message}
        </div>
      )}
      <div className="sticky bottom-4 flex justify-end rounded-xl border border-[#22304A] bg-[#080D18]/95 p-3 shadow-2xl backdrop-blur-xl">
        <button
          type="submit"
          disabled={createReport.isPending}
          className="shipsure-button min-w-44 justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createReport.isPending ? (
            <>
              <LoaderCircleIcon className="h-4 w-4 animate-spin" />
              Logging and checking…
            </>
          ) : (
            <>
              <SparklesIcon className="h-4 w-4" />
              Log bug and check
            </>
          )}
        </button>
      </div>
    </form>
  );
}
