import React from 'react';

import { Badge, EmptyState, Panel } from './Components';

import {
  CheckIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';

import { api } from '../api';

import { motion, useReducedMotion } from 'framer-motion';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const initialSettings = {
  app_name: 'ReleaseGate',
  reference_prefix: 'SS',
  preview_url: '',
  live_url: '',
  automation_enabled: true,
  onboarding_complete: false,
  policy_version: 'shipsure-policy-v1',
  allowed_recipes: ['workflow.mark_duplicate'],
  blocked_areas: [
    'source_code',
    'authentication',
    'permissions',
    'billing',
    'secrets',
    'schema_destructive_change',
    'production_deploy',
  ],
};

export function Settings() {
  const reduceMotion = useReducedMotion();
  const cache = useQueryClient();
  const [form, setForm] = React.useState(initialSettings);
  const [dirty, setDirty] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [errorMessage, setErrorMessage] = React.useState('');
  const configQuery = useQuery({
    queryKey: ['shipsure-config'],
    queryFn: api.getConfig,
  });
  const auditQuery = useQuery({
    queryKey: ['shipsure-audit'],
    queryFn: api.listAudit,
    retry: false,
  });
  React.useEffect(() => {
    const config = configQuery.data?.config;
    if (config) setForm((previous) => ({ ...previous, ...config }));
  }, [configQuery.data]);
  const saveConfig = useMutation({
    mutationFn: api.updateConfig,
    onSuccess: (result) => {
      setForm((previous) => ({
        ...previous,
        ...result.config,
      }));
      setDirty(true);
      setMessage('');
      setErrorMessage(result.audit_warning || '');
      setTimeout(() => setDirty(false), 2600);
      cache.invalidateQueries({
        queryKey: ['shipsure-config'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-dashboard'],
      });
      cache.invalidateQueries({
        queryKey: ['shipsure-audit'],
      });
    },
    onError: (error) => {
      setErrorMessage('');
      setMessage(error.message);
    },
  });
  const field =
    (fieldName: keyof typeof initialSettings) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((previous) => ({
        ...previous,
        [fieldName]: event.target.value,
      }));
  return configQuery.isLoading ? (
    <div className="h-[72vh] animate-pulse rounded-2xl border border-[#22304A] bg-[#0D1424]" />
  ) : configQuery.isError ? (
    <EmptyState
      title="Settings unavailable"
      description={configQuery.error?.message || 'ReleaseGate could not load the policy configuration.'}
    />
  ) : (
    <div className="space-y-5">
      <motion.section
        initial={
          reduceMotion
            ? false
            : {
                opacity: 0,
                y: 10,
              }
        }
        animate={{
          opacity: 1,
          y: 0,
        }}
        className="relative overflow-hidden rounded-2xl border border-[#273652] bg-[radial-gradient(circle_at_80%_0%,rgba(82,242,184,0.13),transparent_36%),linear-gradient(135deg,#0D1424,#080D18)] p-5 md:p-7"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FF7A3D]/80 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF7A3D]">
              Product configuration
            </p>
            <h2 className="mt-2 text-2xl font-extrabold text-white md:text-3xl">
              Set the target app. Keep the safety boundary fixed.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#93A4B8]">
              These settings make a ReleaseGate install reusable without turning safety-critical rules into
              casual toggles. URLs and bug references are configurable; protected repair areas are not.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Badge label={form.policy_version || 'shipsure-policy-v1'} tone="gold" />
            <Badge
              label={form.automation_enabled ? 'Safe recipes enabled' : 'Automation paused'}
              tone={form.automation_enabled ? 'green' : 'amber'}
            />
          </div>
        </div>
      </motion.section>
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
      {dirty && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-[#52F2B8]/35 bg-[#52F2B8]/10 p-4 text-sm font-semibold text-[#9EF0CB]"
        >
          <CheckIcon className="h-4 w-4" />
          Configuration saved.
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-[#D66A32]/35 bg-[#D66A32]/10 p-4 text-sm text-[#D8CCFF]"
        >
          <span className="flex items-center gap-3">
            <TriangleAlertIcon className="h-4 w-4 shrink-0" />
            {errorMessage}
          </span>
          <button type="button" onClick={() => setErrorMessage('')}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveConfig.mutate(form);
          }}
          className="space-y-5"
        >
          <Panel title="Target app" eyebrow="Install identity">
            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className="shipsure-label">App name</span>
                <input
                  value={form.app_name || ''}
                  onChange={field('app_name')}
                  className="shipsure-input"
                  required
                />
              </label>
              <label>
                <span className="shipsure-label">Bug reference prefix</span>
                <input
                  value={form.reference_prefix || ''}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      reference_prefix: event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 8),
                    }))
                  }
                  className="shipsure-input font-mono uppercase"
                  maxLength={8}
                  required
                />
              </label>
              <label className="md:col-span-2">
                <span className="shipsure-label">Preview URL</span>
                <div className="relative">
                  <input
                    value={form.preview_url || ''}
                    onChange={field('preview_url')}
                    className="shipsure-input pr-10"
                    placeholder="https://preview.example.com"
                  />
                  <ExternalLinkIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708197]" />
                </div>
              </label>
              <label className="md:col-span-2">
                <span className="shipsure-label">Live URL</span>
                <div className="relative">
                  <input
                    value={form.live_url || ''}
                    onChange={field('live_url')}
                    className="shipsure-input pr-10"
                    placeholder="https://app.example.com"
                  />
                  <ExternalLinkIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#708197]" />
                </div>
              </label>
            </div>
          </Panel>
          <Panel title="Workflow automation" eyebrow="Allowlisted only">
            <label
              className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition ${form.automation_enabled ? 'border-[#52F2B8]/35 bg-[#52F2B8]/[0.05]' : 'border-[#D66A32]/35 bg-[#D66A32]/[0.05]'}`}
            >
              <input
                type="checkbox"
                checked={!!form.automation_enabled}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    automation_enabled: event.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-[#FF7A3D]"
              />
              <span className="flex-1">
                <strong className="block text-sm text-white">
                  {form.automation_enabled
                    ? 'Allow safe workflow recipes'
                    : 'Pause all automatic repairs'}
                </strong>
                <span className="mt-1 block text-xs leading-5 text-[#93A4B8]">
                  This controls deterministic metadata actions only. It never permits product-source
                  edits, access changes or production deployment.
                </span>
              </span>
              <SparklesIcon
                className={`h-5 w-5 ${form.automation_enabled ? 'text-[#52F2B8]' : 'text-[#D66A32]'}`}
              />
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-4 rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
              <input
                type="checkbox"
                checked={!!form.onboarding_complete}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    onboarding_complete: event.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-[#FF7A3D]"
              />
              <span>
                <strong className="block text-sm text-white">Installation checked</strong>
                <span className="mt-1 block text-xs leading-5 text-[#93A4B8]">
                  Mark complete once the Preview and Live URLs, admin access and first test report have
                  been verified.
                </span>
              </span>
            </label>
          </Panel>
          <button
            type="submit"
            disabled={saveConfig.isPending}
            className="shipsure-button w-full justify-center disabled:opacity-60"
          >
            {saveConfig.isPending ? (
              <LoaderCircleIcon className="h-4 w-4 animate-spin" />
            ) : (
              <SaveIcon className="h-4 w-4" />
            )}
            Save configuration
          </button>
        </form>
        <div className="space-y-5">
          <Panel title="Allowed recipes" eyebrow="Deterministic and reversible">
            <div className="space-y-2">
              {(form.allowed_recipes || []).map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-[#52F2B8]/25 bg-[#52F2B8]/[0.04] p-3"
                >
                  <ShieldCheckIcon className="h-4 w-4 shrink-0 text-[#52F2B8]" />
                  <code className="min-w-0 flex-1 truncate text-[10px] font-bold text-[#C9F5E2]">
                    {item}
                  </code>
                  <Badge label="Bound" tone="green" />
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-[#93A4B8]">
              Duplicate marking requires a specific, still-existing canonical target. Any evidence change
              invalidates eligibility and forces reanalysis.
            </p>
          </Panel>
          <Panel title="Protected areas" eyebrow="Never auto-repaired">
            <div className="flex flex-wrap gap-2">
              {(form.blocked_areas || []).map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#FF6577]/25 bg-[#FF6577]/[0.045] px-2 py-1.5 font-mono text-[9px] font-bold text-[#FFB0B0]"
                >
                  <LockKeyholeIcon className="h-3 w-3" />
                  {item.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          </Panel>
          <Panel title="Security posture" eyebrow="Week-one boundary">
            <div className="space-y-3 text-xs leading-5 text-[#93A4B8]">
              <p className="flex gap-3">
                <KeyRoundIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#C65A2E]" />
                <span>
                  Secrets never belong in bug descriptions or evidence. Store controlled references
                  instead.
                </span>
              </p>
              <p className="flex gap-3">
                <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#D66A32]" />
                <span>
                  AI output is a recommendation. The safety policy and current evidence decide the repair
                  route.
                </span>
              </p>
              <p className="flex gap-3">
                <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#52F2B8]" />
                <span>
                  Every privileged action runs through the authenticated ReleaseGate gateway. Retried
                  audit-write failures are surfaced instead of being presented as proof.
                </span>
              </p>
            </div>
          </Panel>
          <Panel title="Recent audit activity" eyebrow="Append-only evidence">
            {auditQuery.data?.events?.length ? (
              <div className="space-y-3">
                {auditQuery.data.events.slice(0, 6).map((item) => {
                  return (
                    <div
                      key={item.id}
                      className="border-b border-[#22304A] pb-3 last:border-0 last:pb-0"
                    >
                      <p className="text-xs font-bold text-white">{item.action?.replaceAll('.', ' ')}</p>
                      <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#93A4B8]">
                        {item.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs leading-5 text-[#8496AB]">
                Audit entries appear after configuration, analysis, repair and release actions.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
