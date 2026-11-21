import React from 'react';

import {
  ActivityIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CodeIcon,
  DownloadIcon,
  EyeIcon,
  FileSearchIcon,
  GaugeIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  MousePointerClickIcon,
  OrbitIcon,
  PlusIcon,
  RadarIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  ZapIcon,
} from 'lucide-react';

import { Badge, CountUp } from './Components';
import { HealthButtonDiscovery } from './HealthButtonDiscovery';
import { DesktopInventory, HealthWindowsInspection } from './HealthWindowsInspection';

import { Link, useSearchParams } from 'react-router-dom';

import { api, type Healthcheck as HealthcheckRun, type HealthcheckInput } from '../api';
import { organisationName } from '../organisation';
import { parsePlaywrightReport } from '../health-suite';
import { splitContentNotes, CONTENT_NOTE_PREFIX } from '../health-content-notes';
import { canRerunDirectly, needsRerunUrl, settingsForRerun } from '../health-rerun';
import type { LucideIcon } from 'lucide-react';

import { cx } from '../ui';
import { useAuth } from '../auth';

import { formatDate } from './presentation';

import { motion, useReducedMotion } from 'framer-motion';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type CategoryScore = HealthcheckRun['category_scores'][number];

const categories: Record<string, { label: string; icon: LucideIcon; accent: string }> = {
  core_journeys: {
    label: 'Core journeys',
    icon: RouteIcon,
    accent: '#FF9B5C',
  },
  access_data: {
    label: 'Access & data',
    icon: ShieldCheckIcon,
    accent: '#78F7CA',
  },
  reliability: {
    label: 'Reliability',
    icon: ActivityIcon,
    accent: '#67E8F9',
  },
  usability: {
    label: 'UX & accessibility',
    icon: EyeIcon,
    accent: '#B79AE8',
  },
  release_evidence: {
    label: 'Release proof',
    icon: GitBranchIcon,
    accent: '#D66A32',
  },
  seo: { label: 'Technical SEO', icon: SearchIcon, accent: '#78F7CA' },
  html: { label: 'HTML quality', icon: CodeIcon, accent: '#67E8F9' },
  browser_functions: { label: 'Browser functions', icon: MousePointerClickIcon, accent: '#FF9B5C' },
  suite_functions: { label: 'Staging test results', icon: FileSearchIcon, accent: '#B79AE8' },
  desktop_functions: { label: 'Windows button checks', icon: MousePointerClickIcon, accent: '#FF9B5C' },
};

function categoryLabel(id: string, local: boolean) {
  if (local) {
    if (id === 'usability') return 'HTML structure';
    if (id === 'reliability') return 'Page responses';
    if (id === 'release_evidence') return 'Release evidence';
  }
  return categories[id]?.label || id;
}

function checkCounts(run: HealthcheckRun) {
  const checks = run.checks_performed ?? [];
  const passed = checks.filter((check) => check.passed === true).length;
  const failed = checks.filter((check) => check.passed === false).length;
  const browser = checks.filter((check) => check.category === 'browser_functions');
  return {
    passed,
    failed,
    measured: passed + failed,
    inconclusive: checks.length - passed - failed,
    supplied: checks.filter((check) => check.source === 'supplied').length,
    suite: checks.filter((check) => check.source === 'suite').length,
    pages: run.inspected_pages?.length ?? 0,
    browserPassed: browser.filter((check) => check.passed === true).length,
    browserFailed: browser.filter((check) => check.passed === false).length,
    suiteFailed: checks.filter((check) => check.source === 'suite' && check.passed === false).length,
    browserUntested: browser.filter((check) => check.passed === null).length,
  };
}

const findingBasis: Record<string, { label: string; tone: 'green' | 'gold' | 'slate'; icon: LucideIcon }> = {
  observed: {
    label: 'Observed',
    tone: 'green',
    icon: CircleCheckIcon,
  },
  potential_issue: {
    label: 'Potential issue — verify',
    tone: 'gold',
    icon: SparklesIcon,
  },
  not_tested: {
    label: 'Not tested',
    tone: 'slate',
    icon: CircleDashedIcon,
  },
};

const severityTones: Record<string, 'red' | 'amber' | 'blue' | 'green'> = {
  critical: 'red',
  high: 'amber',
  medium: 'blue',
  low: 'green',
};

const sampleButtonChecks = [
  { button: 'Show release notes', expected_text: 'Preview build approved' },
  { button: 'Open status', expected_text: 'Service status details' },
];

function HealthPanel({
  children,
  className = '',
  active = false,
}: React.PropsWithChildren<{ className?: string; active?: boolean }>) {
  return (
    <section
      className={cx(
        'group relative min-w-0 overflow-hidden rounded-[24px] border bg-gradient-to-b from-[#0B1120]/95 to-[#070C16]/95 shadow-[0_20px_70px_rgba(0,0,0,.28)] transition-[transform,border-color,box-shadow] duration-200',
        active
          ? 'border-[#FF7A3D]/45 shadow-[0_22px_80px_rgba(255,122,61,.12)]'
          : 'border-white/[0.08] hover:-translate-y-0.5 hover:border-[#FF7A3D]/30',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {children}
    </section>
  );
}

function HealthDial({
  run,
  counts,
  activeCategory,
  onCategory,
}: {
  run: HealthcheckRun;
  counts: ReturnType<typeof checkCounts> | null;
  activeCategory: string;
  onCategory: (id: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const ringValue = counts
    ? (counts.measured && run.band !== 'not_scored' ? 100 * counts.passed / counts.measured : 0)
    : Number(run.readiness_indicator || 0);
  const scores = run?.category_scores || [];
  const positions = [
    'left-1/2 top-[3%] -translate-x-1/2',
    'right-[2%] top-[30%]',
    'right-[14%] bottom-[5%]',
    'left-[14%] bottom-[5%]',
    'left-[2%] top-[30%]',
  ];
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[390px]"
      aria-label="ReleaseGate Pulse category map"
    >
      <div className="absolute inset-[9%] rounded-full border border-white/[0.08]" />
      <div className="absolute inset-[22%] rounded-full border border-white/[0.08]" />
      <div className="absolute inset-[35%] rounded-full border border-white/[0.08]" />
      <div className="absolute left-1/2 top-[12%] h-[76%] w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/[0.09] to-transparent" />
      <div className="absolute left-[12%] top-1/2 h-px w-[76%] -translate-y-1/2 bg-gradient-to-r from-transparent via-white/[0.09] to-transparent" />
      <div
        className={cx(
          'absolute inset-[9%] rounded-full opacity-70',
          !reduceMotion && 'animate-[spin_8s_linear_infinite]',
        )}
        style={{
          background:
            'conic-gradient(from 0deg,transparent 0deg 298deg,rgba(255,122,61,.02) 306deg,rgba(255,122,61,.26) 345deg,rgba(73,231,255,.7) 359deg)',
        }}
      />
      <svg
        className="absolute inset-[18%] h-[64%] w-[64%] -rotate-90"
        viewBox="0 0 120 120"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="health-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF9B5C" />
            <stop offset="54%" stopColor="#FF7A3D" />
            <stop offset="100%" stopColor="#52F2B8" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="51" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="2" />
        <motion.circle
          cx="60"
          cy="60"
          r="51"
          fill="none"
          stroke="url(#health-ring)"
          strokeWidth="3.5"
          strokeLinecap="round"
          pathLength="100"
          initial={
            reduceMotion
              ? false
              : {
                  strokeDasharray: '0 100',
                }
          }
          animate={{
            strokeDasharray: `${ringValue} ${100 - ringValue}`,
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.9,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      </svg>
      <motion.div
        initial={
          reduceMotion
            ? false
            : {
                opacity: 0,
                scale: 0.9,
              }
        }
        animate={{
          opacity: 1,
          scale: 1,
        }}
        className="absolute left-1/2 top-1/2 flex h-[34%] w-[34%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-[#FF7A3D]/30 bg-[#050913]/90 text-center shadow-[0_0_70px_rgba(255,122,61,.14)] backdrop-blur-xl"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#93A4B8]">
          {counts ? 'Passed' : 'Readiness'}
        </span>
        <strong className="mt-1 text-5xl font-extrabold tabular-nums tracking-[-0.06em] text-[#F5FAFF]">
          {counts ? (counts.measured ? `${Math.round(100 * counts.passed / counts.measured)}%` : '—') : <CountUp value={ringValue} />}
        </strong>
        <span className="mt-1 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#FF9B5C]">
          {counts ? `${counts.passed} of ${counts.measured} measured` : run.band?.replaceAll('_', ' ') || 'not scored'}
        </span>
      </motion.div>
      {scores.slice(0, positions.length).map((category, index) => {
        const style = categories[category.id] || categories.reliability;
        const CategoryIcon = style.icon;
        const selected = activeCategory === category.id;
        const label = categoryLabel(category.id, !!counts);
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategory(selected ? '' : category.id)}
            aria-pressed={selected}
            aria-label={counts
              ? `${label}: ${category.completed_checks || 'no'} check${category.completed_checks === 1 ? '' : 's'} measured`
              : `${label}: score ${category.score}, ${category.completed_checks} of ${category.total_checks} checks observed`}
            className={cx(
              'absolute z-10 flex h-12 w-12 items-center justify-center rounded-2xl border bg-[#0A1020]/95 shadow-xl backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A3D]',
              positions[index],
              selected
                ? 'scale-110 border-[#FF7A3D]/75 shadow-[0_0_30px_rgba(255,122,61,.24)]'
                : 'border-white/[0.12] hover:border-[#FF7A3D]/45',
            )}
            style={{
              color: style.accent,
            }}
          >
            <CategoryIcon className="h-5 w-5" />
            <span className="absolute -bottom-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full border border-white/10 bg-[#050913] px-1 text-[9px] font-extrabold text-white">
              {counts ? category.completed_checks || '—' : category.score}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HealthcheckForm({
  previous,
  onCancel,
  onCreate,
  onEdit,
  pending,
  error,
}: {
  previous?: HealthcheckRun;
  onCancel?: () => void;
  onCreate: (input: HealthcheckInput) => void;
  onEdit: () => void;
  pending: boolean;
  error: Error | null;
}) {
  const operator = useAuth().user?.role === 'admin';
  const [initial] = React.useState(() => previous && settingsForRerun(previous));
  const [desktop, setDesktop] = React.useState(previous?.check_source === 'desktop');
  const [desktopAlias, setDesktopAlias] = React.useState<string>();
  const nativeRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => nativeRequest.current?.abort(), []);
  const capture = useMutation({ mutationFn: () => {
    nativeRequest.current?.abort();
    nativeRequest.current = new AbortController();
    return api.inspectWindowsDesktop(nativeRequest.current.signal);
  } });
  const inspection = capture.data && !('cancelled' in capture.data) ? capture.data : undefined;
  const savedAlias = previous?.desktop_inspection && inspection?.application === previous.desktop_inspection.application
    ? previous.target_name : '';
  const desktopName = desktopAlias ?? savedAlias;
  const [form, setForm] = React.useState(() => ({
    target_name: initial?.target_name ?? '',
    target_type: initial?.target_type ?? 'web_app',
    target_url: initial?.target_url ?? '',
    environment: initial?.environment ?? 'preview',
    current_version: initial?.current_version ?? '',
    scope_notes: initial?.scope_notes ?? '',
    supplied_evidence: '',
    suite_results: [] as ReturnType<typeof parsePlaywrightReport>,
    authorization_attested: false,
    sample_site: initial?.sample_site ?? false,
    follow_links: initial?.follow_links ?? true,
    max_pages: initial?.max_pages ?? 4,
    browser_checks: initial?.browser_checks ?? true,
  }));
  const [buttonJourneys, setButtonJourneys] = React.useState(() =>
    (initial?.button_journeys ?? []).map((journey, id) => ({ ...journey, id })),
  );
  const nextRowId = React.useRef(buttonJourneys.length);
  const reportSelection = React.useRef(0);
  const reportInput = React.useRef<HTMLInputElement>(null);
  const [readingReport, setReadingReport] = React.useState(false);
  const [reportError, setReportError] = React.useState('');
  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) =>
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  const sampleName = (initial?.sample_site && initial.target_name) || organisationName + ' sample site';
  const hasWebsite = !desktop && (form.sample_site || Boolean(form.target_url.trim()));
  const browserChecks = hasWebsite && form.browser_checks;
  const namedJourneys = buttonJourneys.map(({ button, expected_text }) => ({
    button: button.trim(),
    expected_text: expected_text.trim(),
  })).filter((journey) => journey.button || journey.expected_text);
  const missingExamples = sampleButtonChecks.filter((example) => !namedJourneys.some(
    (journey) => journey.button === example.button && journey.expected_text === example.expected_text,
  ));
  const incompleteJourney = browserChecks && namedJourneys.some(
    (journey) => !journey.button || !journey.expected_text,
  );
  const evidence = form.supplied_evidence.trim();
  const enoughEvidence =
    evidence.length >= 60 && evidence.split(/\r?\n/).some((line) => /^\s*(PASS|FAIL)\s*:\s*\S/i.test(line));
  const ready = form.authorization_attested && (desktop ? !!inspection : (hasWebsite || enoughEvidence || form.suite_results.length > 0)
    && (!previous || !needsRerunUrl(previous) || hasWebsite)
    && !incompleteJourney && !readingReport && !reportError);
  function chooseMode(nextDesktop: boolean) {
    if (nextDesktop === desktop) return;
    capture.reset();
    if (error) onEdit();
    setField('authorization_attested', false);
    setDesktop(nextDesktop);
  }
  async function selectReport(file?: File) {
    const selection = ++reportSelection.current;
    setField('suite_results', []);
    setReportError('');
    setReadingReport(!!file);
    if (error) onEdit();
    if (!file) {
      if (reportInput.current) reportInput.current.value = '';
      return;
    }
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Choose a Playwright JSON report of 4 MiB or less.');
      const content = await file.text();
      if (selection !== reportSelection.current) return;
      let raw: unknown;
      try {
        raw = JSON.parse(content);
      } catch {
        throw new Error('This file contains invalid JSON. Choose a Playwright JSON report.');
      }
      const results = parsePlaywrightReport(raw);
      if (!results.length) throw new Error('Choose a report containing at least one test result.');
      setField('suite_results', results);
    } catch (issue) {
      if (selection === reportSelection.current) {
        if (reportInput.current) reportInput.current.value = '';
        setReportError(issue instanceof Error ? issue.message : 'The test report could not be read.');
      }
    } finally {
      if (selection === reportSelection.current) setReadingReport(false);
    }
  }
  function editJourney(id: number, field: 'button' | 'expected_text', value: string) {
    setButtonJourneys((rows) => rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  }
  const spareRow = buttonJourneys.find((row) => !row.button.trim() && !row.expected_text.trim());
  function chooseButton(name: string) {
    if (buttonJourneys.some((row) => row.button.trim() === name.trim())) return;
    if (!spareRow && buttonJourneys.length >= 8) return;
    const id = spareRow?.id ?? nextRowId.current++;
    if (spareRow) editJourney(id, 'button', name);
    else setButtonJourneys((rows) => [...rows, { id, button: name, expected_text: '' }]);
    if (error) onEdit();
    requestAnimationFrame(() => document.getElementById(`health-expected-text-${id}`)?.focus());
  }
  function addSampleJourneys() {
    if (error) onEdit();
    const used = buttonJourneys.filter((row) => row.button.trim() || row.expected_text.trim());
    const examples = missingExamples.map((example) => ({ ...example, id: nextRowId.current++ }));
    setButtonJourneys([...used, ...examples]);
  }
  const switchSample = () => {
    if (error) onEdit();
    setForm((previous) => ({
      ...previous,
      sample_site: !previous.sample_site,
      authorization_attested: false,
    }));
  };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ready && !pending) {
      if (desktop && inspection) {
        onCreate({
          target_type: 'internal_tool', target_name: desktopName.trim() || inspection.application,
          target_url: '', environment: form.environment, current_version: form.current_version,
          scope_notes: form.scope_notes, authorization_attested: form.authorization_attested,
          desktop_inspection: inspection,
        });
        return;
      }
      onCreate({
        ...form,
        target_url: form.sample_site ? '' : form.target_url.trim(),
        target_name: form.sample_site ? sampleName : form.target_name.trim(),
        follow_links: hasWebsite && form.follow_links,
        browser_checks: browserChecks,
        button_journeys: browserChecks ? namedJourneys : [],
      });
    }
  };
  return (
    <HealthPanel className="overflow-visible p-5 md:p-7 xl:p-8">
      <div className="grid gap-8 xl:grid-cols-[0.76fr_1.24fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#FF7A3D]/25 bg-[#FF7A3D]/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#FF9B5C]">
            <RadarIcon className="h-3.5 w-3.5" />
            {' Initial Healthcheck'}
          </div>
          <h2 className="mt-5 max-w-lg text-4xl font-extrabold leading-[0.98] tracking-[-0.045em] text-white md:text-5xl">
            {previous ? `Rerun ${previous.healthcheck_number}` : desktop ? 'Check a Windows app.' : 'Check a website.'}
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-[#B0C0D1]">
            {desktop
              ? 'Inspect the controls in a running Windows application and record what happens when you use them.'
              : previous
              ? 'Review the saved settings and add any fresh observations or staging test results for this run.'
              : 'Enter a public page you own or manage. See which checks passed, inspect the evidence and turn a failed check into a bug.'}
          </p>
          <div className="mt-6 space-y-3">
            {(desktop ? [
              ['Button discovery', 'See which buttons the open window exposes to Windows accessibility tools.'],
              ['Button checks', 'Choose an action and the on-screen result you expect. The inspector asks before activating it in your app.'],
            ] : [
              ['Website checks', 'Inspect HTTP responses, HTML quality and search engine metadata.'],
              ['Page scope', 'Start with one public URL. Choose how many pages to check when following links on the same site.'],
              [
                'Manual evidence',
                'Supply test results for sign-in, permissions, server-side changes and deployment verification.',
              ],
            ]).map(([item, item2]) => (
              <div
                key={item}
                className="flex gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#52F2B8]/10 text-[#78F7CA]">
                  <CircleCheckIcon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-xs font-bold text-white">{item}</p>
                  <p className="mt-0.5 text-xs text-[#8FA3B7]">{item2}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <form
          onSubmit={submit}
          onChange={() => {
            if (error) onEdit();
          }}
          aria-busy={pending}
          className="rounded-[22px] border border-white/[0.09] bg-[#070C16]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.04)] md:p-5"
        >
          <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
            {operator && <fieldset disabled={capture.isPending} className="space-y-2 sm:col-span-2">
              <legend className="shipsure-label">What are you checking?</legend>
              <div className="flex flex-wrap gap-2">
                {[{ value: false, label: 'Website or supplied evidence' }, { value: true, label: 'Windows desktop app (.exe)' }].map((mode) => (
                  <label key={mode.label} className={cx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold',
                    desktop === mode.value ? 'border-[#FF7A3D]/50 text-[#FFAD7D]' : 'border-white/10 text-[#B9C7D5]')}>
                    <input type="radio" name="healthcheck-mode" checked={desktop === mode.value}
                      onChange={() => chooseMode(mode.value)} className="accent-[#FF7A3D]" />
                    {mode.label}
                  </label>
                ))}
              </div>
            </fieldset>}
            {!desktop && <div className="space-y-2 sm:col-span-2">
              {!form.sample_site && (
                <label className="shipsure-label" htmlFor="health-target-url">
                  Website URL
                </label>
              )}
              {form.sample_site ? (
                <p
                  role="status"
                  className="rounded-xl border border-[#52F2B8]/30 bg-[#52F2B8]/[0.05] p-3 text-sm text-[#B5F7DC]"
                >
                  {sampleName}
                </p>
              ) : (
                <input
                  id="health-target-url"
                  type="url"
                  value={form.target_url}
                  onChange={(event) => {
                    const target_url = event.target.value;
                    setForm((previous) => ({ ...previous, target_url, authorization_attested: false }));
                  }}
                  placeholder="https://example.com"
                  className="shipsure-input h-11"
                />
              )}
              <button type="button" onClick={switchSample} className="shipsure-button-secondary text-xs">
                {form.sample_site ? 'Use my own website' : 'Try a sample site'}
              </button>
              <p className="text-xs leading-5 text-[#93A4B8]">
                {previous && needsRerunUrl(previous) && !form.sample_site
                  ? 'Enter the original URL, including its query or fragment. The saved report contains only the site and path.'
                  : form.sample_site
                  ? 'The sample runs on this installation and includes an image with a missing description.'
                  : 'You can leave the URL blank to review a staging test report or manual observations.'}
              </p>
              {hasWebsite && (
                <>
                  <label className="flex items-center gap-2 text-sm text-[#B9C7D5]">
                    <input
                      type="checkbox"
                      checked={form.follow_links}
                      onChange={(event) => setField('follow_links', event.target.checked)}
                      className="h-4 w-4 accent-[#FF7A3D]"
                    />
                    Follow links on this site
                  </label>
                  {form.follow_links && (
                    <div className="space-y-1.5">
                      <label className="shipsure-label" htmlFor="health-page-limit">Page limit</label>
                      <select
                        id="health-page-limit"
                        className="shipsure-input h-10"
                        value={form.max_pages}
                        onChange={(event) => setField('max_pages', Number(event.target.value))}
                      >
                        {Array.from(new Set([4, 12, 25, form.max_pages])).sort((a, b) => a - b).map((limit) => (
                          <option key={limit} value={limit}>{limit} {limit === 1 ? 'page' : 'pages'}</option>
                        ))}
                      </select>
                      <p className="text-xs leading-5 text-[#93A4B8]">
                        The limit includes the starting page. Wider reviews follow links found on subsequent
                        pages until the page or time limit is reached.
                      </p>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm text-[#B9C7D5]">
                    <input
                      type="checkbox"
                      checked={form.browser_checks}
                      onChange={(event) => setField('browser_checks', event.target.checked)}
                      className="h-4 w-4 accent-[#FF7A3D]"
                    />
                    Run browser checks
                  </label>
                  {form.browser_checks && form.follow_links && form.max_pages > 4 && (
                    <p className="text-xs leading-5 text-[#93A4B8]">
                      The browser tests as many functions as the review time allows. Check the recorded
                      results for the pages and controls it reached.
                    </p>
                  )}
                </>
              )}
            </div>}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#FF7A3D]/18 bg-[#FF7A3D]/[0.055] p-3.5 sm:col-span-2">
              <input type="checkbox" checked={form.authorization_attested} disabled={capture.isPending}
                onChange={(event) => {
                  if (desktop) capture.reset();
                  setField('authorization_attested', event.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-[#FF7A3D]"/>
              <span className="text-xs leading-5 text-[#B9C7D5]">
                {desktop ? 'I am authorised to inspect this Windows application and choose which actions to test.'
                  : form.sample_site
                  ? 'I authorise this read-only check of the sample site.'
                  : 'I own or manage this product, or I am authorised to request this read-only review.'}
              </span>
            </label>
            {desktop && <HealthWindowsInspection
              authorised={form.authorization_attested} pending={capture.isPending}
              cancelled={!!capture.data && 'cancelled' in capture.data} error={capture.error}
              inspection={inspection} choose={() => { if (error) onEdit(); capture.mutate(); }}
            />}
            {browserChecks && (
              <section className="min-w-0 space-y-3 rounded-xl border border-white/10 p-3.5 sm:col-span-2">
                <h3 className="text-sm font-bold text-white">Button checks</h3>
                <p className="text-xs leading-5 text-[#93A4B8]">
                  Find buttons on the starting page, then choose one and enter the text you expect after a click.
                  Discovery reads the controls. Running the Healthcheck tests their behaviour in an isolated browser.
                  Safe menus, tabs, disclosures, galleries and cookie controls can be checked automatically.
                </p>
                <HealthButtonDiscovery
                  key={JSON.stringify([form.sample_site, form.target_url, form.authorization_attested])}
                  targetUrl={form.target_url} sampleSite={form.sample_site} authorised={form.authorization_attested}
                  chosen={namedJourneys.map((journey) => journey.button)}
                  canAdd={!!spareRow || buttonJourneys.length < 8} onChoose={chooseButton}
                />
                {form.sample_site && (
                  <div className="space-y-2">
                    <p className="text-xs leading-5 text-[#CCD9E7]">
                      The sample includes a working “Show release notes” button and an unresponsive “Open status” button.
                    </p>
                    <button
                      type="button" className="shipsure-button-secondary text-xs disabled:opacity-50"
                      disabled={!missingExamples.length || namedJourneys.length + missingExamples.length > 8}
                      onClick={addSampleJourneys}
                    >
                      Add sample button checks
                    </button>
                  </div>
                )}
                {buttonJourneys.map((row, index) => (
                  <fieldset key={row.id} className="grid min-w-0 gap-3 rounded-lg bg-white/[0.035] p-3 sm:grid-cols-2">
                    <legend className="px-1 text-xs font-bold text-[#CCD9E7]">Button check {index + 1}</legend>
                    <label className="space-y-1 text-xs text-[#B9C7D5]">
                      <span>Button name</span>
                      <input
                        className="shipsure-input h-10"
                        value={row.button}
                        placeholder="Show details"
                        maxLength={160}
                        onChange={(event) => editJourney(row.id, 'button', event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-xs text-[#B9C7D5]">
                      <span>Expected visible text</span>
                      <input
                        id={`health-expected-text-${row.id}`}
                        className="shipsure-input h-10"
                        value={row.expected_text}
                        placeholder="Product details"
                        maxLength={240}
                        onChange={(event) => editJourney(row.id, 'expected_text', event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="justify-self-start text-xs font-bold text-[#FF9B5C] hover:underline"
                      onClick={() => {
                        if (error) onEdit();
                        setButtonJourneys((rows) => rows.filter((item) => item.id !== row.id));
                      }}
                    >
                      Remove button check
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={buttonJourneys.length >= 8}
                  className="shipsure-button-secondary text-xs disabled:opacity-50"
                  onClick={() => {
                    if (error) onEdit();
                    const id = nextRowId.current++;
                    setButtonJourneys((rows) => [...rows, { id, button: '', expected_text: '' }]);
                  }}
                >
                  <PlusIcon className="h-4 w-4" /> Add button check
                </button>
                {incompleteJourney && (
                  <p className="text-xs text-[#93A4B8]">Complete both fields or remove the button check.</p>
                )}
                {buttonJourneys.length === 8 && (
                  <p className="text-xs text-[#93A4B8]">Each review can include up to eight button checks.</p>
                )}
              </section>
            )}
            <label className="space-y-2 sm:col-span-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                {'Target name '}
                <span className="normal-case tracking-normal text-[#667E94]">
                  {desktop ? 'optional · defaults to the application filename' : 'optional · inferred from the URL if left blank'}
                </span>
              </span>
              <input
                value={desktop ? desktopName : form.sample_site ? sampleName : form.target_name}
                disabled={!desktop && form.sample_site}
                onChange={(event) => desktop ? setDesktopAlias(event.target.value) : setField('target_name', event.target.value)}
                placeholder={desktop ? inspection?.application || 'e.g. Indie Dev Studio' : 'e.g. Northstar client portal'}
                className="shipsure-input h-11"
              />
            </label>
            {!desktop && <label className="space-y-2">
              <span id="health-product-type-label" className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                Product type
              </span>
              <select
                aria-labelledby="health-product-type-label"
                value={form.target_type}
                onChange={(event) => setField('target_type', event.target.value)}
                className="shipsure-input h-11"
              >
                <option value="web_app">Web app</option>
                <option value="website">Website</option>
                <option value="internal_tool">Internal tool</option>
                <option value="other">Other</option>
              </select>
            </label>}
            {!desktop && form.target_type === 'internal_tool' && (
              <button type="button" onClick={() => chooseMode(true)} className="shipsure-button-secondary self-end text-xs">
                Inspect a Windows .exe instead
              </button>
            )}
            <label className="space-y-2">
              <span id="health-environment-label" className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                Environment
              </span>
              <select
                aria-labelledby="health-environment-label"
                value={form.environment}
                onChange={(event) => setField('environment', event.target.value)}
                className="shipsure-input h-11"
              >
                <option value="preview">Preview</option>
                <option value="live">Live</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                Version / build
              </span>
              <input
                value={form.current_version}
                onChange={(event) => setField('current_version', event.target.value)}
                placeholder="0.3.0-preview"
                className="shipsure-input h-11"
              />
            </label>
            <label className="space-y-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                Scope notes
              </span>
              <input
                value={form.scope_notes}
                onChange={(event) => setField('scope_notes', event.target.value)}
                placeholder="Onboarding and release flow"
                className="shipsure-input h-11"
              />
            </label>
            {!desktop && <><label className="space-y-2 sm:col-span-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#93A4B8]">
                {'Manual evidence '}
                <span className="normal-case tracking-normal text-[#667E94]">
                  one observation per line, beginning with PASS: or FAIL:
                </span>
              </span>
              <textarea
                value={form.supplied_evidence}
                onChange={(event) => setField('supplied_evidence', event.target.value)}
                rows={5}
                placeholder={
                  'PASS: The preview page loaded.\nFAIL: The client card stayed closed after activation.'
                }
                className="shipsure-input min-h-[120px] resize-y py-3 leading-6"
              />
            </label>
            <div className="space-y-2 sm:col-span-2">
              <label htmlFor="health-suite-report" className="shipsure-label">Playwright JSON report</label>
              <p id="health-suite-help" className="text-xs leading-5 text-[#93A4B8]">
                Import an existing staging run for journeys such as sign-in or saving a record. ReleaseGate
                reads the file locally and saves only test names and outcomes. Maximum file size 4 MiB.
              </p>
              <input
                ref={reportInput} id="health-suite-report" type="file" accept=".json,application/json"
                aria-describedby="health-suite-help"
                aria-invalid={!!reportError}
                className="block w-full text-xs text-[#B9C7D5] file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:font-bold file:text-white"
                onChange={(event) => void selectReport(event.target.files?.[0])}
              />
              {readingReport && <p role="status" className="text-xs text-[#93A4B8]">Reading test results…</p>}
              {form.suite_results.length > 0 && (
                <p role="status" className="text-xs text-[#78F7CA]">
                  {form.suite_results.length} staging test result{form.suite_results.length === 1 ? '' : 's'} ready to import.
                </p>
              )}
              {reportError && <p role="alert" className="text-xs text-[#FFA0AD]">{reportError}</p>}
              {(readingReport || reportError || form.suite_results.length > 0) && (
                <button type="button" className="text-xs font-bold text-[#FF9B5C] hover:underline" onClick={() => void selectReport()}>
                  Remove test report
                </button>
              )}
            </div></>}
          </fieldset>
          {!desktop && !hasWebsite && !enoughEvidence && !form.suite_results.length && !readingReport && !reportError && (
            <p className="mt-4 text-xs text-[#8EA2B6]">
              Import a staging test report, or enter at least 60 characters of manual evidence including a PASS: or FAIL: observation.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-[#FF6577]/30 bg-[#FF6577]/10 p-3 text-xs text-[#FFA0AD]"
            >
              {error.message}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={pending || capture.isPending}
                className="shipsure-button-secondary"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={pending || !ready}
              className="shipsure-button min-w-[190px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <>
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                  <span role="status">{desktop ? 'Saving desktop results…' : hasWebsite ? 'Checking pages…' : 'Reviewing observations…'}</span>
                </>
              ) : (
                <>
                  <WandSparklesIcon className="h-4 w-4" />
                  Run healthcheck
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </HealthPanel>
  );
}

function RunEvidence({
  run, counts, category, clearCategory,
}: {
  run: HealthcheckRun;
  counts: ReturnType<typeof checkCounts>;
  category: string;
  clearCategory: () => void;
}) {
  const pages = run.inspected_pages ?? [];
  const checks = run.checks_performed ?? [];
  const [outcome, setOutcome] = React.useState('all');
  const categoryChecks = category ? checks.filter((check) =>
    (check.category ?? (check.source === 'supplied' ? 'release_evidence' : undefined)) === category,
  ) : checks;
  const expectedOutcome = outcome === 'passed' ? true : outcome === 'failed' ? false : null;
  const visibleChecks = category === 'browser_functions' && outcome !== 'all'
    ? categoryChecks.filter((check) => check.passed === expectedOutcome)
    : categoryChecks;
  return (
    <HealthPanel className="p-5 md:p-6">
      <h3 className="text-lg font-extrabold text-white">Run evidence</h3>
      <p className="mt-2 text-sm text-[#B0C0D1]">
        {counts.passed} passed · {counts.failed} failed · {counts.inconclusive} inconclusive
      </p>
      {run.desktop_inspection && (
        <div className="mt-4">
          <DesktopInventory inspection={run.desktop_inspection} />
        </div>
      )}
      {pages.length > 0 && (
        <div className="mt-5">
          <h4 className="shipsure-label">Pages inspected</h4>
          <ul className="mt-2 grid gap-2" aria-label="Pages inspected">
            {pages.map((page, index) => (
              <li
                key={index}
                className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-white/[0.035] px-3 py-2 text-xs"
              >
                <span className="min-w-0 break-all font-mono text-[#CCD9E7]">{page.url}</span>
                <span className="shrink-0 text-[#93A4B8]">
                  {page.status === null ? 'No HTTP response' : 'HTTP ' + page.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {category && (
        <div className="mt-4 flex items-center gap-3 text-xs">
          <span className="font-bold text-[#B9C7D5]">{categoryLabel(category, true)}</span>
          <button type="button" onClick={clearCategory} className="font-bold text-[#FF9B5C] hover:underline">
            Show all checks
          </button>
        </div>
      )}
      {category === 'browser_functions' && categoryChecks.length > 0 && (
        <div className="mt-3 max-w-xs space-y-1.5">
          <label htmlFor="browser-check-outcome" className="shipsure-label">Browser check outcome</label>
          <select
            id="browser-check-outcome" className="shipsure-input h-10"
            value={outcome} onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="all">All outcomes ({categoryChecks.length})</option>
            <option value="failed">Failed ({counts.browserFailed})</option>
            <option value="untested">Untested ({counts.browserUntested})</option>
            <option value="passed">Passed ({counts.browserPassed})</option>
          </select>
        </div>
      )}
      {category && !visibleChecks.length && (
        <p className="mt-3 text-sm text-[#93A4B8]">
          {categoryChecks.length ? 'No browser checks have this outcome.' : 'This review contains no checks in this category.'}
        </p>
      )}
      {visibleChecks.length > 0 && (
        <details key={category} open={category ? true : undefined} className="mt-4 rounded-xl border border-white/10 p-3">
          <summary className="cursor-pointer text-sm font-bold text-[#FF9B5C]">
            Check results ({visibleChecks.length})
          </summary>
          <ul className="mt-3 divide-y divide-white/[0.08]" aria-label="Check results">
            {visibleChecks.map((check, index) => (
              <li key={index} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    label={check.passed === null
                      ? (check.source === 'browser' || check.source === 'website' ? 'Untested' : 'Inconclusive')
                      : check.passed ? 'Passed' : 'Failed'}
                    tone={check.passed === null ? 'slate' : check.passed ? 'green' : 'red'}
                    compact
                  />
                  <strong>{check.title}</strong>
                  {check.source === 'suite' && check.passed === null && check.suite_outcome && (
                    <span className="text-xs capitalize text-[#B79AE8]">{check.suite_outcome}</span>
                  )}
                </div>
                <p className="mt-1 break-words text-[#B0C0D1]">{check.detail}</p>
                <p className="mt-1 break-all text-xs text-[#93A4B8]">
                  {{ supplied: 'Operator observation', website: 'Website response', browser: 'Isolated browser', suite: 'Imported test result', desktop: 'Windows inspector' }[check.source]}
                  {check.category && ' · ' + categoryLabel(check.category, true)}
                  {check.page && ' · ' + check.page}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {splitContentNotes(run.limitations).rest.length > 0 && (
        <div className="mt-4">
          <h4 className="shipsure-label">Limits and suggestions</h4>
          <ul aria-label="Limits of this review" className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[#93A4B8]">
            {splitContentNotes(run.limitations).rest.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}
    </HealthPanel>
  );
}

function SlopPanel({ run }: { run: HealthcheckRun }) {
  const { notes, count } = splitContentNotes(run.limitations);
  if (!notes.length && run.check_source !== 'website') return null;
  return (
    <HealthPanel className="border-[#FFB020]/50 p-5 md:p-7">
      <section aria-label="AI slop">
        <p className="text-xs font-extrabold uppercase tracking-[0.15em] text-[#FFB020]">AI slop</p>
        {notes.length ? (
          <>
            <p className="mt-2 text-4xl font-black leading-tight text-[#FFD28A] md:text-6xl">
              {count} AI {count === 1 ? 'cliché' : 'clichés'} found
            </p>
            <ul className="mt-4 space-y-3 text-base leading-6 text-white md:text-lg">
              {notes.map((note, index) => (
                <li key={index} className="break-words">
                  {note.phrase ? (
                    <>
                      <mark className="rounded bg-[#FFB020]/20 px-1.5 py-0.5 font-bold text-[#FFD28A]">{note.phrase}</mark>
                      <span className="text-[#B0C0D1]"> {note.where} · {note.rule}</span>
                    </>
                  ) : note.raw.slice(CONTENT_NOTE_PREFIX.length).trim()}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-[#B0C0D1]">Pattern matches, not proof. Rewrite in plain, specific words.</p>
          </>
        ) : <p className="mt-2 text-sm text-[#B0C0D1]">No AI clichés found</p>}
      </section>
    </HealthPanel>
  );
}

function CategoryCard({
  category,
  local,
  selected,
  onSelect,
}: {
  category: CategoryScore;
  local: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const categoryStyle = categories[category.id] || categories.reliability;
  const Icon = categoryStyle.icon;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="text-left focus-visible:outline-none">
      <HealthPanel active={selected} className="h-full p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]"
            style={{
              color: categoryStyle.accent,
            }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-3xl font-extrabold tabular-nums tracking-[-0.05em] text-white">
            {category.completed_checks ? (local ? category.completed_checks : category.score) : '—'}
          </span>
        </div>
        <h3 className="mt-5 text-sm font-extrabold text-white">
          {categoryLabel(category.id, local)}
        </h3>
        {local ? (
          <p className="mt-3 text-xs font-bold text-[#93A4B8]">
            {category.completed_checks ? 'Checks measured' : 'No checks measured'}
          </p>
        ) : (
          <>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                initial={{
                  width: 0,
                }}
                animate={{
                  width: `${category.score}%`,
                }}
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg,${categoryStyle.accent}88,${categoryStyle.accent})`,
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[#7E93A8]">
              <span>
                {category.completed_checks}
                {' of '}
                {category.total_checks}
                {' observed'}
              </span>
              <span>{category.status}</span>
            </div>
          </>
        )}
      </HealthPanel>
    </button>
  );
}

/** Self-serve accounts see their daily allowance and, when needed, a prompt to confirm their email. */
function AccountBanner() {
  const { account } = useAuth();
  const resend = useMutation({ mutationFn: api.resendVerification });
  if (!account || account.unlimited) return null;
  const unverified = account.verification_required && !account.verified;
  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 text-sm',
      unverified ? 'border-[#FFB547]/30 bg-[#FFB547]/[0.06] text-[#FFD9A0]' : 'border-white/10 bg-white/[0.03] text-[#C9D5E1]')}>
      {unverified ? (
        <>
          <span><strong className="text-white">Confirm your email to start.</strong> We've sent you a link. Check your inbox and spam folder.</span>
          <button type="button" className="text-xs font-bold text-[#FFAD7D] underline disabled:opacity-60" disabled={resend.isPending || resend.isSuccess}
            onClick={() => resend.mutate()}>
            {resend.isSuccess ? 'Link sent' : resend.isPending ? 'Sending…' : 'Send it again'}
          </button>
          {resend.error && <span className="text-xs text-[#FFA0AD]">{(resend.error as Error).message}</span>}
        </>
      ) : (
        <span>
          <strong className="text-white">{account.scans_remaining} of {account.scans_limit}</strong> free checks left today.
          {' '}Your allowance resets at midnight UTC.
        </span>
      )}
    </div>
  );
}

export function Healthcheck() {
  return (
    <div className="space-y-4">
      <AccountBanner />
      <HealthcheckPage />
    </div>
  );
}

function HealthcheckPage() {
  const { refresh, user } = useAuth();
  const operator = user?.role === 'admin';
  const cache = useQueryClient();
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const queueRef = React.useRef<HTMLDivElement>(null);
  const evidenceRef = React.useRef<HTMLDivElement>(null);
  const submitting = React.useRef(false);
  const [params, setParams] = useSearchParams();
  const creating = params.get('new') === '1';
  function setCreating(open: boolean, previousId?: string) {
    const next = new URLSearchParams(params);
    if (open && previousId) next.set('from', previousId);
    else next.delete('from');
    if (open) next.set('new', '1');
    else next.delete('new');
    setParams(next, { replace: !open });
  }
  const [runId, setRunId] = React.useState('');
  const [findingId, setFindingId] = React.useState('');
  const [category, setCategory] = React.useState('');
  const healthQuery = useQuery({
    queryKey: ['healthchecks'],
    queryFn: () => api.listHealthchecks(),
  });
  const runs = healthQuery.data?.records || [];
  const run = runs.find((run2) => run2.id === runId) || runs[0];
  const findings = React.useMemo(() => {
    const result = run?.findings || [];
    return category ? result.filter((item) => item.category === category) : result;
  }, [run, category]);
  const finding = findings.find((finding2) => finding2.id === findingId) || findings[0];
  React.useEffect(() => {
    if (!runId && runs[0]) setRunId(runs[0].id);
  }, [runs, runId]);

  React.useEffect(() => {
    if (findings[0] && !findings.some((item) => item.id === findingId)) {
      setFindingId(findings[0].id);
    }
  }, [findings, findingId]);

  const createRun = useMutation({
    mutationFn: api.runHealthcheck,
    onSuccess: ({ run: created }) => {
      cache.setQueryData<{ records: HealthcheckRun[] }>(['healthchecks'], (previous) => ({
        records: [created, ...(previous?.records ?? []).filter((saved) => saved.id !== created.id)],
      }));
      setRunId(created.id);
      setCategory('');
      setCreating(false);
      requestAnimationFrame(() => titleRef.current?.focus());
      void cache.invalidateQueries({ queryKey: ['release-notifications'] });
      void cache.invalidateQueries({ queryKey: ['shipsure-audit'] });
      void refresh();
    },
    onSettled: () => { submitting.current = false; },
  });
  const exportPdf = useMutation({
    mutationFn: async (selected: Pick<HealthcheckRun, 'id' | 'healthcheck_number'>) => {
      const pdf = await api.healthcheckPdf(selected.id);
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ReleaseGate-${selected.healthcheck_number}.pdf`;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    },
  });
  const convertFinding = useMutation({
    mutationFn: (input: { runId: string; findingId: string }) =>
      api.convertHealthcheckFinding(input.runId, input.findingId),
    onSuccess: ({ run: updated }) => {
      cache.setQueryData<{ records: HealthcheckRun[] }>(['healthchecks'], (previous) => ({
        records: (previous?.records ?? []).map((item) => (item.id === updated.id ? updated : item)),
      }));
      void cache.invalidateQueries({ queryKey: ['shipsure-dashboard'] });
      void cache.invalidateQueries({ queryKey: ['shipsure-bugs'] });
      void cache.invalidateQueries({ queryKey: ['release-notifications'] });
      void cache.invalidateQueries({ queryKey: ['shipsure-audit'] });
    },
  });
  function newRun() {
    createRun.reset();
    setCreating(true);
  }
  function submitRun(input: HealthcheckInput) {
    if (submitting.current) return;
    submitting.current = true;
    createRun.mutate(input);
  }
  function editRun(previous: HealthcheckRun) {
    createRun.reset();
    setCreating(true, previous.id);
  }
  function rerun(previous: HealthcheckRun) {
    if (!canRerunDirectly(previous)) return editRun(previous);
    submitRun({ ...settingsForRerun(previous), authorization_attested: true });
  }
  if (healthQuery.isLoading)
    return (
      <div className="space-y-4">
        <div className="h-[520px] animate-pulse rounded-[28px] border border-white/[0.08] bg-[#0B1120]" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-[24px] bg-[#0B1120]" />
          ))}
        </div>
      </div>
    );
  if (healthQuery.isError)
    return (
      <HealthPanel className="p-8 text-center">
        <TriangleAlertIcon className="mx-auto h-8 w-8 text-[#FF6577]" />
        <h2 className="mt-4 text-xl font-bold">Healthcheck could not load</h2>
        <p className="mt-2 text-sm text-[#93A4B8]">{healthQuery.error?.message}</p>
        <button onClick={() => healthQuery.refetch()} className="shipsure-button mt-5">
          <RefreshCwIcon className="h-4 w-4" />
          Retry
        </button>
      </HealthPanel>
    );
  const previousId = params.get('from');
  const previous = creating && previousId ? runs.find((saved) => saved.id === previousId) : undefined;
  if (creating && previousId && !previous)
    return (
      <HealthPanel className="space-y-4 p-6">
        <p role="alert">This saved healthcheck is unavailable.</p>
        <button type="button" onClick={newRun} className="shipsure-button">New healthcheck</button>
      </HealthPanel>
    );
  if (creating || !run)
    return (
      <HealthcheckForm
        key={previous?.id ?? 'blank'}
        previous={previous}
        onCancel={run ? () => {
          createRun.reset();
          if (previous) setRunId(previous.id);
          setCreating(false);
        } : undefined}
        onCreate={submitRun}
        onEdit={createRun.reset}
        pending={createRun.isPending}
        error={createRun.error}
      />
    );
  const hasHighRisk = (run.findings || []).some(
    (finding2) => finding2.basis === 'observed' && finding2.severity === 'critical',
  );
  const nextFinding =
    (run.findings || []).find(
      (finding2) => finding2.basis === 'observed' && ['critical', 'high'].includes(finding2.severity),
    ) || (run.findings || []).find((finding) => ['browser_functions', 'suite_functions', 'desktop_functions'].includes(finding.category)) || (run.findings || [])[0];
  const counts = run.check_source ? checkCounts(run) : null;
  const desktop = run.check_source === 'desktop';
  const reportedSources: string[] = [];
  if (counts?.suite) reportedSources.push(`${counts.suite} imported staging test result${counts.suite === 1 ? '' : 's'}`);
  if (counts?.supplied) reportedSources.push(`${counts.supplied} operator observation${counts.supplied === 1 ? '' : 's'}`);
  const hasBrowserEvidence = !!counts && counts.browserPassed + counts.browserFailed + counts.browserUntested > 0;
  const hasExpandedReview = !desktop && (run.browser_checks !== undefined || (run.checks_performed ?? []).some(
    (check) => ['seo', 'html', 'browser_functions'].includes(check.category ?? ''),
  ));
  function inspectCategory(id: string) {
    setCategory(id);
    if (counts && id) evidenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  let headline = 'Your release has a pulse.';
  if (counts) {
    const functionFailures = desktop ? counts.failed : counts.browserFailed + counts.suiteFailed;
    if (functionFailures) headline = `${functionFailures} functional ${functionFailures === 1 ? 'check' : 'checks'} failed`;
    else if (desktop && !run.desktop_inspection?.checks.length) headline = 'Button inventory only';
    else if (!counts.measured) headline = 'No checks measured';
    else if (run.band === 'not_scored') headline = 'Page evidence incomplete';
    else headline = `${counts.passed} of ${counts.measured} checks passed`;
  }
  const metrics = counts ? [
    [desktop ? 'Buttons found' : 'URLs checked', desktop ? run.desktop_inspection?.buttons.length ?? 0 : counts.pages, '#67E8F9'],
    ['Checks passed', counts.passed, '#78F7CA'],
    ['Checks failed', counts.failed, '#FF9B5C'],
    ['Inconclusive checks', counts.inconclusive, '#B79AE8'],
  ] as const : [
    ['Observed', run.observed_count, '#78F7CA'],
    ['Potential', run.potential_count, '#FF9B5C'],
    ['Coverage', `${run.evidence_coverage}%`, '#67E8F9'],
    ['High priority', run.high_priority_count, hasHighRisk ? '#FF91A0' : '#D66A32'],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4 px-1 pb-1">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#FF7A3D]">
            <OrbitIcon className="h-3.5 w-3.5" />
            ReleaseGate intelligence
          </div>
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-white md:text-4xl"
          >
            Initial Healthcheck
          </h2>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {runs.length > 1 && (
            <select
              aria-label="Healthcheck history"
              value={run.id}
              disabled={createRun.isPending}
              onChange={(event) => {
                createRun.reset();
                setRunId(event.target.value);
                setCategory('');
              }}
              className="shipsure-input h-10 min-w-0 max-w-full text-xs"
            >
              {runs.map((run2) => (
                <option key={run2.id} value={run2.id}>
                  {run2.healthcheck_number}
                  {' · '}
                  {run2.target_name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => rerun(run)}
            title={canRerunDirectly(run) ? `Authorise a fresh read-only check of ${run.target_name}` : 'Open the saved settings for a fresh review'}
            disabled={createRun.isPending}
            className="shipsure-button disabled:opacity-50"
          >
            {createRun.isPending ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="h-4 w-4" />}
            {createRun.isPending ? 'Rerunning…' : 'Rerun healthcheck'}
          </button>
          <button type="button" onClick={() => exportPdf.mutate(run)} disabled={exportPdf.isPending}
            className="shipsure-button-secondary disabled:opacity-50">
            {exportPdf.isPending ? <LoaderCircleIcon className="h-4 w-4 animate-spin" /> : <DownloadIcon className="h-4 w-4" />}
            {exportPdf.isPending ? 'Preparing PDF…' : 'Export PDF'}
          </button>
          <button type="button" disabled={createRun.isPending} onClick={newRun} className="shipsure-button-secondary disabled:opacity-50">
            <PlusIcon className="h-4 w-4" />
            New healthcheck
          </button>
        </div>
      </div>
      {createRun.isPending && <p role="status" className="px-1 text-sm text-[#B0C0D1]">Repeating {run.healthcheck_number} for {run.target_name}…</p>}
      {createRun.isSuccess && createRun.data?.run.id === run.id && (
        <p role="status" className="px-1 text-sm text-[#78F7CA]">Fresh results saved as {run.healthcheck_number}.</p>
      )}
      {createRun.error && <p role="alert" className="rounded-xl border border-[#FF6577]/30 p-3 text-sm text-[#FFA0AD]">{createRun.error.message}</p>}
      {exportPdf.isError && exportPdf.variables?.id === run.id && (
        <p role="alert" className="rounded-xl border border-[#FF6577]/30 p-3 text-sm text-[#FFA0AD]">
          PDF export failed. {exportPdf.error.message}
        </p>
      )}
      <SlopPanel run={run} />
      <div className="grid auto-rows-[minmax(148px,auto)] grid-cols-1 gap-4 xl:grid-cols-12">
        <HealthPanel className={cx('min-h-[520px] p-5 md:p-7 xl:col-span-8 xl:row-span-2', counts && 'flex flex-col')}>
          <div className="pointer-events-none absolute -left-28 -top-28 h-80 w-80 rounded-full bg-[#FF7A3D]/[0.08] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-36 right-0 h-96 w-96 rounded-full bg-[#C65A2E]/[0.11] blur-3xl" />
          <div className={cx('relative grid items-center gap-4 lg:grid-cols-[0.85fr_1.15fr]', counts ? 'flex-1' : 'h-full')}>
            <div className="z-10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#FF9B5C]">
                  {'ReleaseGate Pulse · '}
                  {run.healthcheck_number}
                  {' · '}
                  {run.environment}
                </span>
                {run.check_source ? (
                  <Badge
                    label={
                      {
                        website: 'Website check', sample: 'Sample site', desktop: 'Windows desktop inspection',
                        supplied: counts?.suite ? (counts.supplied ? 'Supplied evidence' : 'Staging test report') : 'Manual review',
                      }[
                        run.check_source
                      ]
                    }
                    tone="blue"
                    compact
                  />
                ) : (
                  run.is_synthetic && <Badge label="Demo data" tone="blue" compact />
                )}
              </div>
              <h3 className="mt-5 max-w-md text-5xl font-extrabold leading-[0.92] tracking-[-0.055em] text-white md:text-6xl">
                {headline}
              </h3>
              <p className="mt-5 max-w-md text-sm leading-6 text-[#B0C0D1]">
                {counts ? (
                  <>
                    <strong className="text-[#F5FAFF]">Release readiness unassessed</strong>
                    <span className="mt-1 block">
                      {(counts.browserFailed > 0 || counts.suiteFailed > 0) &&
                        `Across the review, ${counts.passed} of ${counts.measured} measured checks passed. `}
                      {desktop && 'Only buttons tested against a stated outcome contribute to the results. '}
                      {!desktop && run.check_source !== 'supplied' && `ReleaseGate checked ${counts.pages} URL${counts.pages === 1 ? '' : 's'}. `}
                      {reportedSources.length
                        ? `This review includes ${reportedSources.join(' and ')}.`
                        : run.check_source === 'supplied'
                          ? 'This review records the observations supplied by the operator.'
                          : 'Each result below records the check and its evidence.'}
                    </span>
                  </>
                ) : 'See what is directly supported, what still needs evidence, and what is unsafe to call proven.'}
              </p>
              {hasBrowserEvidence && counts && (
                <button
                  type="button"
                  onClick={() => inspectCategory('browser_functions')}
                  className={cx(
                    'mt-4 block rounded-xl border p-3 text-left text-sm focus-visible:outline focus-visible:outline-[#FF9B5C]',
                    counts.browserFailed
                      ? 'border-[#FF6577]/40 bg-[#FF6577]/[0.08] text-[#FFA7B4]'
                      : 'border-white/10 bg-white/[0.035] text-[#CCD9E7]',
                  )}
                >
                  <strong className="flex items-center gap-2">Browser function checks <ArrowRightIcon className="h-4 w-4" /></strong>
                  <span className="mt-1 block">
                    {counts.browserPassed} passed · {counts.browserFailed} failed · {counts.browserUntested} untested
                  </span>
                </button>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (counts) setCategory('');
                    (counts ? evidenceRef : queueRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="shipsure-button"
                >
                  {counts ? 'Review check results ' : `Review ${run.observed_count || 0} observed findings `}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
                {canRerunDirectly(run) && <button type="button" disabled={createRun.isPending} onClick={() => editRun(run)} className="shipsure-button-secondary disabled:opacity-50">
                  <RadarIcon className="h-4 w-4" />
                  Edit and rerun
                </button>}
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[10px] font-bold uppercase tracking-[0.11em] text-[#8297AB]">
                <span>{run.target_name}</span>
                <span>{run.current_version || 'Version not supplied'}</span>
                <span>{formatDate(run.completed_at)}</span>
              </div>
            </div>
            <HealthDial run={run} counts={counts} activeCategory={category} onCategory={inspectCategory} />
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2 border-t border-white/[0.07] pt-4 sm:grid-cols-4">
            {metrics.map(([label, value, colour]) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#71879B]">{label}</p>
                <p
                  className="mt-1 text-xl font-extrabold tabular-nums"
                  style={{
                    color: colour,
                  }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </HealthPanel>
        <HealthPanel className={cx('p-5 xl:col-span-4', hasHighRisk && 'border-[#FF6577]/28')}>
          <div className="flex items-start justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF6577]/10 text-[#FF91A0]">
              <ZapIcon className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#7E93A8]">
              Next action
            </span>
          </div>
          <h3 className="mt-5 text-2xl font-extrabold leading-tight tracking-[-0.03em] text-white">
            {nextFinding ? nextFinding.title : 'Add more direct evidence'}
          </h3>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#9FB1C3]">
            {nextFinding?.impact || (desktop
              ? 'Inspect another workflow in the application, choose a button and check its expected effect.'
              : counts
              ? 'Record a browser test of a critical journey, including the expected and actual outcome.'
              : 'No high-priority observed issue was found in the checks completed.')}
          </p>
          {nextFinding && (
            <button
              type="button"
              onClick={() => {
                setCategory('');
                setFindingId(nextFinding.id);
                queueRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="mt-5 inline-flex items-center gap-2 text-xs font-extrabold text-[#FF9B5C]"
            >
              {'Open finding '}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </HealthPanel>
        {counts ? (
          <HealthPanel className="p-5 xl:col-span-4">
            <h3 className="text-lg font-extrabold text-white">Review scope</h3>
            <p className="mt-3 text-sm leading-6 text-[#B0C0D1]">
              {desktop
                ? 'The Windows inspector read accessible buttons in the selected application window. Each action check looks for an expected change on screen. Data saves, background jobs and other windows need separate evidence.'
                : run.check_source === 'supplied'
                ? (counts.suite
                  ? 'The Playwright results describe a run in the test environment where the report was generated. ReleaseGate records those outcomes without repeating the tests.'
                  : 'The operator supplied the results. ReleaseGate did not visit the site or repeat those checks.')
                : hasExpandedReview
                  ? (run.browser_checks === false
                    ? 'This review checked public responses and delivered HTML. Browser interactions, sign-in, permissions and deployment verification need separate evidence.'
                    : 'Page checks use public responses and browser checks use an isolated copy. Sign-in, permissions, server-side changes and deployment verification need separate evidence.')
                  : 'The automatic checks read public page responses. Sign-in, permissions, JavaScript interactions and release proof each need separate evidence.'}
            </p>
            {hasExpandedReview && run.check_source !== 'supplied' && !hasBrowserEvidence && (
              <p className="mt-3 text-xs leading-5 text-[#93A4B8]">
                {run.browser_checks === false ? 'Browser checks were switched off.' : 'This review contains no browser function results.'}
              </p>
            )}
            {counts.supplied > 0 && run.check_source !== 'supplied' && (
              <p className="mt-3 text-xs leading-5 text-[#93A4B8]">
                Operator observations are labelled individually in the check results.
              </p>
            )}
            {counts.suite > 0 && run.check_source !== 'supplied' && (
              <p className="mt-3 text-xs leading-5 text-[#93A4B8]">
                Imported Playwright results describe the environment where the tests were run.
              </p>
            )}
          </HealthPanel>
        ) : (
          <HealthPanel className="p-5 xl:col-span-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#7E93A8]">
                Evidence coverage
              </span>
              <FileSearchIcon className="h-5 w-5 text-[#67E8F9]" />
            </div>
            <div className="mt-4 flex items-end gap-2">
              <strong className="text-5xl font-extrabold tracking-[-0.06em] text-white">
                <CountUp value={run.evidence_coverage || 0} />%
              </strong>
              <span className="pb-1.5 text-xs font-bold text-[#7E93A8]">
                directly observed
              </span>
            </div>
            <div className="mt-5 grid grid-cols-10 gap-1.5">
              {Array.from(
                {
                  length: 10,
                },
                (value, value2) => (
                  <span
                    key={value2}
                    className={cx(
                      'h-8 rounded-md border',
                      value2 < Math.round((run.evidence_coverage || 0) / 10)
                        ? 'border-[#C65A2E]/40 bg-[#C65A2E]/45'
                        : 'border-dashed border-white/[0.09] bg-white/[0.025]',
                    )}
                  />
                ),
              )}
            </div>
            <p className="mt-4 text-xs leading-5 text-[#8EA2B6]">
              The readiness indicator is provisional. Potential issues never reduce the score until they are validated.
            </p>
          </HealthPanel>
        )}
      </div>
      {counts && (
        <div ref={evidenceRef} className="scroll-mt-28">
          <RunEvidence key={run.id + category} run={run} counts={counts} category={category} clearCategory={() => setCategory('')} />
        </div>
      )}
      <div className={cx('grid gap-4 md:grid-cols-2', (run.category_scores || []).length > 5 ? 'xl:grid-cols-4' : 'xl:grid-cols-5')}>
        {(run.category_scores || []).map((item) => (
          <CategoryCard
            key={item.id}
            category={item}
            local={!!counts}
            selected={category === item.id}
            onSelect={() => inspectCategory(category === item.id ? '' : item.id)}
          />
        ))}
      </div>
      {run.compared_to_previous && (
        <HealthPanel
          className={cx('p-5 md:p-6', (run.regressions || []).length > 0 && 'border-[#FF6577]/28')}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#FF7A3D]">
                Proof loop
              </p>
              <h3 className="mt-1 text-lg font-extrabold text-white">
                {'Compared with '}
                {run.previous_healthcheck_number}
              </h3>
              <p className="mt-1 text-xs text-[#8EA2B6]">
                {counts || run.is_synthetic
                  ? 'These comparisons use the local review and its recorded evidence.'
                  : 'Every fix and every regression below is re-derived from a fresh live scan, not self-reported.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(run.resolved_findings || []).length > 0 && (
                <Badge label={`${run.resolved_findings.length} fixed`} tone="green" compact />
              )}
              {(run.regressions || []).length > 0 && (
                <Badge label={`${run.regressions.length} regressed`} tone="red" compact />
              )}
              {!(run.resolved_findings || []).length && !(run.regressions || []).length && (
                <Badge label="No change" tone="slate" compact />
              )}
            </div>
          </div>
          {(run.resolved_findings || []).length > 0 && (
            <div className="mt-5 space-y-3">
              {run.resolved_findings.map((bug) => (
                <div
                  key={bug.check_key}
                  className="rounded-2xl border border-[#52F2B8]/25 bg-[#52F2B8]/[0.04] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CircleCheckIcon className="h-4 w-4 shrink-0 text-[#52F2B8]" />
                      <p className="text-sm font-extrabold text-white">{bug.title}</p>
                    </div>
                    {bug.auto_verified ? (
                      <Badge label="Verified automatically" tone="green" compact />
                    ) : (
                      <Badge label="Awaiting repair record" tone="gold" compact />
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                      <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#7F94A8]">
                        {'Before · '}
                        {bug.previous_healthcheck_number}
                      </p>
                      <p className="mt-1.5 text-xs leading-5 text-[#C1CDD8]">
                        {bug.previous_evidence_summary || 'Issue observed'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#52F2B8]/20 bg-white/[0.02] p-3">
                      <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#78F7CA]">
                        {'After · '}
                        {run.healthcheck_number}
                      </p>
                      <p className="mt-1.5 text-xs leading-5 text-[#C1CDD8]">{bug.resolution_evidence}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[#71879B]">
                    {bug.bug_number && (
                      <Link to={`/bugs/${bug.bug_id}`} className="text-[#FF9B5C] hover:underline">
                        {bug.bug_number}
                      </Link>
                    )}
                    {bug.verification_blocked_reason && (
                      <span className="normal-case tracking-normal text-[#8EA2B6]">
                        {bug.verification_blocked_reason}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(run.regressions || []).length > 0 && (
            <div className="mt-5 space-y-3">
              {run.regressions.map((bug) => (
                <div
                  key={bug.check_key}
                  className="rounded-2xl border border-[#FF6577]/30 bg-[#FF6577]/[0.06] p-4"
                >
                  <div className="flex items-center gap-2">
                    <TriangleAlertIcon className="h-4 w-4 shrink-0 text-[#FF91A0]" />
                    <p className="text-sm font-extrabold text-white">
                      {'Regression: '}
                      {bug.title}
                    </p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#C1CDD8]">
                    {'This check passed as of '}
                    {bug.bug_number}
                    {bug.previously_resolved_at ? ` (${formatDate(bug.previously_resolved_at)})` : ''}
                    {counts
                      ? ' and failed again in the recorded checks.'
                      : run.is_synthetic
                      ? ' and failed again in the supplied evidence.'
                      : ' and has failed again on this scan.'}
                  </p>
                  {bug.bug_number && (
                    <Link
                      to={`/bugs/${bug.bug_id}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-[#FF9B5C]"
                    >
                      {'Open '}
                      {bug.bug_number} <ArrowRightIcon className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
          {!(run.resolved_findings || []).length && !(run.regressions || []).length && (
            <p className="mt-4 text-xs leading-5 text-[#8EA2B6]">
              {'Nothing changed on the checks ReleaseGate can compare directly since '}
              {run.previous_healthcheck_number}.
            </p>
          )}
        </HealthPanel>
      )}
      <div ref={queueRef} className="grid scroll-mt-28 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <HealthPanel className="p-4 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#FF7A3D]">
                Signal queue
              </p>
              <h3 className="mt-1 text-lg font-extrabold text-white">Findings</h3>
            </div>
            {category && (
              <button
                type="button"
                onClick={() => setCategory('')}
                className="text-xs font-bold text-[#93A4B8] hover:text-white"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="mt-4 space-y-2.5">
            {findings.length ? (
              findings.map((finding2) => {
                const result = findingBasis[finding2.basis] || findingBasis.potential_issue;
                return (
                  <button
                    key={finding2.id}
                    type="button"
                    onClick={() => setFindingId(finding2.id)}
                    className={cx(
                      'w-full rounded-2xl border p-4 text-left transition',
                      finding?.id === finding2.id
                        ? 'border-[#FF7A3D]/45 bg-[#FF7A3D]/[0.07] shadow-[inset_3px_0_0_#FF7A3D]'
                        : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14]',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-[#FF9B5C]">
                        {finding2.reference}
                      </span>
                      <Badge label={finding2.severity} tone={severityTones[finding2.severity]} compact />
                      <Badge
                        label={finding2.category === 'suite_functions' ? 'Imported test result'
                          : counts && finding2.confidence === 'operator_reported' ? 'Operator observation' : result.label}
                        tone={result.tone} compact
                      />
                      {finding2.is_regression && (
                        <Badge
                          label={`Regression of ${finding2.regression_of_bug_number}`}
                          tone="red"
                          compact
                        />
                      )}
                    </div>
                    <p className="mt-3 text-sm font-extrabold text-white">{finding2.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[#71879B]">
                      <span>{categoryLabel(finding2.category, !!counts)}</span>
                      <span>{finding2.converted_bug_number || 'Not logged'}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.09] p-8 text-center">
                <CircleCheckIcon className="mx-auto h-7 w-7 text-[#52F2B8]" />
                <p className="mt-3 text-sm font-bold">No findings in this view</p>
                <p className="mt-1 text-xs text-[#8EA2B6]">
                  Try another category or add more direct evidence.
                </p>
              </div>
            )}
          </div>
        </HealthPanel>
        <HealthPanel className="p-5 md:p-6">
          {finding ? (
            <motion.div
              key={finding.id}
              initial={{
                opacity: 0,
                y: 6,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#FF9B5C]">{finding.reference}</span>
                    <Badge
                      label={finding.category === 'suite_functions' ? 'Imported test result'
                        : counts && finding.confidence === 'operator_reported' ? 'Operator observation' : findingBasis[finding.basis]?.label}
                      tone={findingBasis[finding.basis]?.tone}
                    />
                  </div>
                  <h3 className="mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.035em] text-white">
                    {finding.title}
                  </h3>
                </div>
                {finding.converted_bug_number ? (
                  <Link to={`/bugs/${finding.converted_bug_id}`} className="shipsure-button">
                    <CircleCheckIcon className="h-4 w-4" />
                    {'Open '}
                    {finding.converted_bug_number}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      convertFinding.mutate({
                        runId: run.id,
                        findingId: finding.id,
                      })
                    }
                    disabled={convertFinding.isPending}
                    className="shipsure-button disabled:opacity-50"
                  >
                    {convertFinding.isPending ? (
                      <LoaderCircleIcon className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlusIcon className="h-4 w-4" />
                    )}
                    Create bug
                  </button>
                )}
              </div>
              {finding.basis !== 'observed' && (
                <div className="mt-5 rounded-2xl border border-dashed border-[#FF7A3D]/30 bg-[#FF7A3D]/[0.055] p-4">
                  <div className="flex gap-3">
                    <SparklesIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#FF9B5C]" />
                    <div>
                      <p className="text-xs font-extrabold text-[#8DEFFF]">
                        AI interpretation — not direct proof
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#B7C4D1]">
                        If converted, this bug starts in Needs evidence and cannot become auto-repair eligible
                        until validated.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {finding.is_regression && (
                <div className="mt-5 rounded-2xl border border-[#FF6577]/30 bg-[#FF6577]/[0.06] p-4">
                  <div className="flex gap-3">
                    <TriangleAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#FF91A0]" />
                    <div>
                      <p className="text-xs font-extrabold text-[#FF91A0]">Regression</p>
                      <p className="mt-1 text-xs leading-5 text-[#B7C4D1]">
                        {'This was previously fixed and verified as '}
                        {finding.regression_of_bug_number}
                        {counts
                          ? ', and failed again in the recorded checks.'
                          : run.is_synthetic
                          ? ', and failed again in the supplied evidence.'
                          : ', and has failed again on this scan.'}
                      </p>
                      <Link
                        to={`/bugs/${finding.regression_of_bug_id}`}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-extrabold text-[#FF9B5C]"
                      >
                        {'Open '}
                        {finding.regression_of_bug_number} <ArrowRightIcon className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {(
                  [
                    [finding.category === 'suite_functions' ? 'What the test report recorded'
                      : counts && finding.confidence === 'operator_reported' ? 'What the operator reported' : 'What ReleaseGate found', finding.observation, EyeIcon],
                    ['Why it matters', finding.impact, TriangleAlertIcon],
                    [
                      'Evidence basis',
                      finding.evidence_summary || 'No direct evidence supplied',
                      FileSearchIcon,
                    ],
                    ['Suggested next check', finding.validation_step || finding.recommendation, GaugeIcon],
                  ] as const
                ).map(([label, text, Icon]) => (
                  <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                    <Icon className="h-4 w-4 text-[#FF7A3D]" />
                    <p className="mt-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-[#7F94A8]">
                      {label}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#C1CDD8]">{text || 'Not supplied'}</p>
                  </div>
                ))}
              </div>
              {convertFinding.isError && (
                <p className="mt-4 rounded-xl border border-[#FF6577]/30 bg-[#FF6577]/10 p-3 text-xs text-[#FFA0AD]">
                  {convertFinding.error?.message}
                </p>
              )}
            </motion.div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
              <SparklesIcon className="h-8 w-8 text-[#FF7A3D]" />
              <h3 className="mt-4 text-lg font-bold">Select a signal</h3>
              <p className="mt-2 max-w-sm text-sm text-[#8EA2B6]">
                Choose a finding to inspect its evidence, impact and recommended next check.
              </p>
            </div>
          )}
        </HealthPanel>
      </div>
      {!counts && (
        <HealthPanel className="p-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#FF7A3D]">
                Analysis summary
              </p>
              <p className="mt-3 text-sm leading-6 text-[#C1CDD8]">{run.summary}</p>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#78F7CA]">
                Strengths observed
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[#B0C0D1]">
                {(run.strengths || []).map((item) => (
                  <li key={item} className="flex gap-2">
                    <CircleCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#52F2B8]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#67E8F9]">Boundary</p>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-[#8EA2B6]">
                {splitContentNotes(run.limitations).rest.map((item) => (
                  <li key={item}>
                    {'• '}
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </HealthPanel>
      )}
    </div>
  );
}
