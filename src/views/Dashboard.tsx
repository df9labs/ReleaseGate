import type { DashboardStats } from '../api';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClipboardCheckIcon,
  OctagonAlertIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge, ChartTooltip, CountUp, EmptyState, MetricCard, Panel, SignalCard } from './Components';

import { Link } from 'react-router-dom';

import { api } from '../api';

import { lifecycle, nextAction, safetyLabel, toneColours, workflowLabels } from './presentation';

import { motion, useReducedMotion } from 'framer-motion';

import { useQuery } from '@tanstack/react-query';

const orbitPoints = [
  {
    angle: 22,
    color: '#52F2B8',
    delay: 0,
  },
  {
    angle: 104,
    color: '#FF7A3D',
    delay: 0.35,
  },
  {
    angle: 196,
    color: '#C65A2E',
    delay: 0.7,
  },
  {
    angle: 292,
    color: '#FF9B5C',
    delay: 1.05,
  },
];

function orbitPosition(angle: number, radius = 111) {
  const radians = (angle - 90) * (Math.PI / 180);
  return {
    x: 140 + radius * Math.cos(radians),
    y: 140 + radius * Math.sin(radians),
  };
}

function Pulse({ value = 0, version = '0.1.0', previewPassed = 0, blockers = 0, safe = 0 }) {
  const reduceMotion = useReducedMotion();
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  const radius = 91;
  const circumference = 2 * Math.PI * radius;
  const state =
    blockers > 0
      ? {
          label: 'Guarded',
          color: '#D66A32',
          icon: ShieldCheckIcon,
        }
      : percent >= 80
        ? {
            label: 'Release clear',
            color: '#52F2B8',
            icon: CircleCheckIcon,
          }
        : {
            label: 'Learning',
            color: '#FF7A3D',
            icon: ActivityIcon,
          };
  const Icon = state.icon;
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[360px]"
      aria-label={`ReleaseGate Pulse: ${percent}% release readiness`}
    >
      <div className="absolute inset-[8%] rounded-full bg-[#FF7A3D]/[0.11] blur-3xl" />
      <motion.div
        aria-hidden="true"
        className="absolute inset-[3%] rounded-full border border-[#FF7A3D]/25"
        animate={
          reduceMotion
            ? undefined
            : {
                rotate: 360,
              }
        }
        transition={{
          duration: 34,
          ease: 'linear',
          repeat: Infinity,
        }}
      >
        <span className="absolute left-1/2 top-[-3px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#FFB05B] shadow-[0_0_20px_#FF7A3D]" />
        <span className="absolute bottom-[13%] right-[7%] h-1 w-1 rounded-full bg-[#C65A2E] shadow-[0_0_16px_#C65A2E]" />
      </motion.div>
      <svg viewBox="0 0 280 280" className="absolute inset-0 h-full w-full overflow-visible" role="img">
        <defs>
          <radialGradient id="pulse-core-fill" cx="50%" cy="42%" r="66%">
            <stop offset="0%" stopColor="#3A241C" stopOpacity="0.9" />
            <stop offset="58%" stopColor="#241915" stopOpacity="0.97" />
            <stop offset="100%" stopColor="#171313" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="pulse-progress" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C65A2E" />
            <stop offset="48%" stopColor="#FF7A3D" />
            <stop offset="100%" stopColor="#FFA13F" />
          </linearGradient>
          <filter id="pulse-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx="140"
          cy="140"
          r="127"
          fill="none"
          stroke="#5C4035"
          strokeOpacity="0.38"
          strokeWidth="1"
          strokeDasharray="2 8"
        />
        <circle
          cx="140"
          cy="140"
          r="111"
          fill="none"
          stroke="#50362E"
          strokeOpacity="0.75"
          strokeWidth="1"
        />
        <circle cx="140" cy="140" r="91" fill="none" stroke="#35231E" strokeWidth="9" />
        <motion.circle
          cx="140"
          cy="140"
          r={radius}
          fill="none"
          stroke="url(#pulse-progress)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={
            reduceMotion
              ? false
              : {
                  strokeDashoffset: circumference,
                }
          }
          animate={{
            strokeDashoffset: circumference * (1 - percent / 100),
          }}
          transition={{
            duration: reduceMotion ? 0 : 1.4,
            ease: [0.22, 1, 0.36, 1],
          }}
          transform="rotate(-90 140 140)"
          filter="url(#pulse-glow)"
        />
        <circle
          cx="140"
          cy="140"
          r="72"
          fill="url(#pulse-core-fill)"
          stroke="#674337"
          strokeOpacity="0.78"
        />
        <circle
          cx="140"
          cy="140"
          r="63"
          fill="none"
          stroke="#FF7A3D"
          strokeOpacity="0.2"
          strokeDasharray="1 7"
        />
        {orbitPoints.map((point) => {
          const position = orbitPosition(point.angle);
          return (
            <g key={point.angle}>
              <line
                x1="140"
                y1="140"
                x2={position.x}
                y2={position.y}
                stroke={point.color}
                strokeOpacity="0.16"
                strokeDasharray="2 5"
              />
              <motion.circle
                cx={position.x}
                cy={position.y}
                r="4"
                fill={point.color}
                initial={
                  reduceMotion
                    ? false
                    : {
                        opacity: 0.45,
                        scale: 0.8,
                      }
                }
                animate={
                  reduceMotion
                    ? {
                        opacity: 0.9,
                      }
                    : {
                        opacity: [0.4, 1, 0.4],
                        scale: [0.8, 1.3, 0.8],
                      }
                }
                transition={{
                  duration: 2.6,
                  delay: point.delay,
                  repeat: reduceMotion ? 0 : Infinity,
                }}
                style={{
                  transformOrigin: `${position.x}px ${position.y}px`,
                }}
                filter="url(#pulse-glow)"
              />
            </g>
          );
        })}
      </svg>
      <motion.div
        className="absolute inset-[29%] flex flex-col items-center justify-center rounded-full text-center"
        initial={
          reduceMotion
            ? false
            : {
                opacity: 0,
                scale: 0.88,
              }
        }
        animate={{
          opacity: 1,
          scale: 1,
        }}
        transition={{
          delay: reduceMotion ? 0 : 0.35,
          duration: 0.65,
        }}
      >
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#7F9AB4]">
          Pulse
        </span>
        <strong className="mt-1 text-5xl font-extrabold tracking-[-0.08em] text-white">
          <CountUp value={percent} />
          <span className="ml-1 text-xl tracking-normal text-[#FF8A4C]">%</span>
        </strong>
        <span
          className="mt-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.13em]"
          style={{
            color: state.color,
          }}
        >
          <Icon className="h-3 w-3" />
          {state.label}
        </span>
      </motion.div>
      <div className="absolute left-0 top-[18%] rounded-full border border-[#7A4A37]/75 bg-[#1A1515]/90 px-2.5 py-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.32),0_0_24px_rgba(255,122,61,0.08)] backdrop-blur-xl">
        <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FFD0B7]">
          <CircleCheckIcon className="h-3 w-3 text-[#52F2B8]" />
          {previewPassed}
          {' proven'}
        </span>
      </div>
      <div className="absolute right-0 top-[27%] rounded-full border border-[#7A4A37]/75 bg-[#1A1515]/90 px-2.5 py-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.32),0_0_24px_rgba(255,122,61,0.08)] backdrop-blur-xl">
        <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FFB078]">
          <SparklesIcon className="h-3 w-3" />
          {safe}
          {' safe'}
        </span>
      </div>
      <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2 rounded-full border border-[#FF7A3D]/35 bg-[#1A1515]/92 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#FF9B5C] shadow-[0_10px_35px_rgba(0,0,0,0.3),0_0_26px_rgba(255,122,61,0.12)] backdrop-blur-xl">
        {'build '}
        {version}
      </div>
    </div>
  );
}

function ProgressSteps({ step = 0 }) {
  return (
    <div className="relative grid grid-cols-7 gap-1.5" aria-label="Bug lifecycle">
      {lifecycle.map((label, index) => {
        const complete = index < step;
        const current = index === step;
        return (
          <div key={label} className="relative min-w-0">
            <motion.div
              initial={false}
              animate={{
                opacity: complete || current ? 1 : 0.42,
              }}
              className={`relative h-1.5 overflow-hidden rounded-full ${complete ? 'bg-[#52F2B8]' : current ? 'bg-[#FF7A3D]' : 'bg-[#22304A]'}`}
            >
              {current && (
                <span className="shipsure-scan absolute inset-0 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
              )}
            </motion.div>
            <p
              className={`mt-2 hidden truncate text-[9px] font-bold uppercase tracking-[0.07em] xl:block ${current ? 'text-[#FF9B5C]' : complete ? 'text-[#7FF7CD]' : 'text-[#718197]'}`}
            >
              {label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SignalMeter({
  icon: Icon,
  label,
  value,
  max,
  tone,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  max: number;
  tone: string;
  note: string;
}) {
  const percent = Math.max(
    5,
    Math.min(100, max ? (Number(value || 0) / max) * 100 : Number(value || 0)),
  );
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.035] p-3.5 transition duration-300 hover:border-white/[0.14] hover:bg-white/[0.055]">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-current/[0.08]"
          style={{
            color: tone,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7F94AA]">{label}</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-[#DDE7F2]">{note}</p>
        </div>
        <strong className="font-mono text-2xl font-bold tracking-[-0.08em] text-white">
          <CountUp value={Number(value || 0)} />
        </strong>
      </div>
      <div className="mt-3 h-px overflow-hidden bg-[#24334D]">
        <motion.div
          className="h-full"
          style={{
            backgroundColor: tone,
            boxShadow: `0 0 14px ${tone}`,
          }}
          initial={{
            width: 0,
          }}
          animate={{
            width: `${percent}%`,
          }}
          transition={{
            duration: 0.9,
            ease: 'easeOut',
          }}
        />
      </div>
    </div>
  );
}

function TelemetryStrip({ stats }: { stats: DashboardStats }) {
  const metrics = [
    {
      label: 'Reports observed',
      value: stats.total,
      tone: '#FF8A4C',
    },
    {
      label: 'Preview proven',
      value: stats.previewPassed,
      tone: '#52F2B8',
    },
    {
      label: 'Safe automation',
      value: stats.safe,
      tone: '#F07A3C',
    },
    {
      label: 'Human decisions',
      value: stats.manual,
      tone: '#C65A2E',
    },
    {
      label: 'Live proof',
      value: stats.livePassed,
      tone: '#FFA15F',
    },
  ];
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-[#B95A32]/35 bg-[linear-gradient(100deg,rgba(111,48,28,0.26),rgba(42,27,24,0.82)_34%,rgba(31,25,24,0.88))] shadow-[inset_0_1px_0_rgba(255,177,121,0.08),0_14px_42px_rgba(99,43,24,0.14)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FF8A4C]/60 to-transparent" />
      <div className="shipsure-ribbon-glow absolute inset-y-0 w-36 bg-gradient-to-r from-transparent via-[#FF7A3D]/30 to-transparent shadow-[0_0_34px_rgba(255,122,61,0.24)]" />
      <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.06] sm:grid-cols-3 xl:grid-cols-5 xl:divide-y-0">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="relative min-w-0 px-4 py-4 transition-colors duration-300 hover:bg-[#FF7A3D]/[0.045]"
          >
            <span
              className="absolute left-0 top-1/2 h-5 w-px -translate-y-1/2"
              style={{
                backgroundColor: metric.tone,
              }}
            />
            <p className="truncate text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#B59A8D]">
              {metric.label}
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <strong className="font-mono text-[1.4rem] font-extrabold text-[#FFF7F2] drop-shadow-[0_0_14px_rgba(255,122,61,0.16)]">
                <CountUp value={Number(metric.value || 0)} />
              </strong>
              <span
                className="h-1.5 w-1.5 rounded-full shadow-[0_0_10px_currentColor]"
                style={{
                  color: metric.tone,
                  backgroundColor: metric.tone,
                }}
              />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const reduceMotion = useReducedMotion();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const dashboardQuery = useQuery({
    queryKey: ['shipsure-dashboard'],
    queryFn: api.dashboard,
    refetchInterval: 45e3,
  });
  const dashboard = dashboardQuery.data;
  const bugs = dashboard?.bugs ?? [];
  const stats: DashboardStats = dashboard?.stats ?? {
    total: 0,
    open: 0,
    resolved: 0,
    manual: 0,
    safe: 0,
    blockers: 0,
    previewPassed: 0,
    livePassed: 0,
    readiness: 100,
    statuses: [],
    severities: [],
    trend: [],
    currentVersion: null,
  };
  React.useEffect(() => {
    if (!bugs.some((bug) => bug.id === selectedId)) setSelectedId(bugs[0]?.id ?? null);
  }, [bugs, selectedId]);
  const selectedBug = bugs.find((bug) => bug.id === selectedId) || bugs[0];
  const priorityBugs = React.useMemo(() => {
    const filtered = bugs.filter(
      (bug) => !['resolved', 'duplicate', 'closed', 'wont_fix'].includes(bug.status),
    );
    return (filtered.length ? filtered : bugs).slice(0, 6);
  }, [bugs]);
  const workflow = (selectedBug && workflowLabels[selectedBug.status]) || workflowLabels.new;
  const safety = safetyLabel(selectedBug);
  const action = nextAction(selectedBug);
  const currentVersion = stats.currentVersion;
  const build = currentVersion?.semantic_version || '0.1.0';
  return dashboardQuery.isLoading ? (
    <div className="space-y-5" aria-label="Loading ReleaseGate dashboard">
      <div className="shipsure-panel h-[460px] animate-pulse rounded-[28px]" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from(
          {
            length: 4,
          },
          (_, index) => (
            <div key={index} className="shipsure-panel h-32 animate-pulse rounded-2xl" />
          ),
        )}
      </div>
    </div>
  ) : dashboardQuery.isError ? (
    <EmptyState
      title="ReleaseGate couldn't load the release data"
      description={
        dashboardQuery.error?.message ||
        'The workflow API may still be starting. Retry without losing any records.'
      }
    >
      <button onClick={() => dashboardQuery.refetch()} className="shipsure-button mt-5">
        <RefreshCwIcon className="h-4 w-4" />
        Retry
      </button>
    </EmptyState>
  ) : (
    <div className="relative min-w-0 space-y-5">
      <section className="shipsure-hero relative isolate overflow-hidden rounded-[28px] border border-[#5A4038]/75 bg-[#201B1C]/94 p-4 shadow-[0_40px_120px_rgba(0,0,0,0.35)] sm:p-6 xl:p-7">
        <div className="shipsure-hero-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute -left-24 top-[-30%] h-96 w-96 rounded-full bg-[#7A351F]/18 blur-3xl" />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute right-[18%] top-[-30%] h-80 w-80 rounded-full bg-[#FF7A3D]/[0.075] blur-[90px]"
          animate={
            reduceMotion
              ? undefined
              : {
                  opacity: [0.35, 0.75, 0.35],
                  scale: [0.9, 1.08, 0.9],
                }
          }
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <div className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-[#FF9B5C]/80 to-transparent" />
        <div className="relative grid min-w-0 items-center gap-7 xl:grid-cols-[1.08fr_0.92fr_0.72fr]">
          <div className="min-w-0 py-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#52F2B8]/20 bg-[#52F2B8]/[0.055] px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#52F2B8] opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#52F2B8] shadow-[0_0_12px_#52F2B8]" />
              </span>
              <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#8FF9D4]">
                Release intelligence online
              </span>
            </div>
            <h2 className="mt-5 max-w-[590px] text-[clamp(2.45rem,5vw,5.35rem)] font-extrabold leading-[0.91] tracking-[-0.072em] text-white">
              Confidence,
              <span className="block bg-gradient-to-r from-[#D66A32] via-[#FF7A3D] to-[#52F2B8] bg-clip-text text-transparent">
                in motion.
              </span>
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[#9DB0C2] md:text-base md:leading-7">
              ReleaseGate watches every report become a decision, a controlled repair and proof you can
              trust. The Pulse shows the release changing in real time.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/report" className="shipsure-button">
                <PlusIcon className="h-4 w-4" />
                Inject a report
              </Link>
              <Link to="/versions" className="shipsure-button-secondary">
                {'Inspect release proof '}
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-7 grid max-w-xl gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3.5 backdrop-blur">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#71879D]">
                  Current build
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <strong className="font-mono text-2xl font-bold tracking-[-0.06em] text-[#FF9B5C]">
                    {build}
                  </strong>
                  <Badge
                    label={
                      currentVersion?.release_status
                        ? currentVersion.release_status.replaceAll('_', ' ')
                        : 'MVP building'
                    }
                    tone={currentVersion?.production_status === 'passed' ? 'green' : 'gold'}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3.5 backdrop-blur">
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#71879D]">
                  Evidence posture
                </p>
                <p className="mt-2 flex items-center gap-2 text-xs font-bold text-[#DDE7F2]">
                  <ShieldCheckIcon className="h-4 w-4 text-[#52F2B8]" />
                  Preview and Live isolated
                </p>
                <p className="mt-1 text-[10px] text-[#71879D]">Policy-controlled proof chain</p>
              </div>
            </div>
          </div>
          <div className="relative flex min-w-0 items-center justify-center py-3">
            <Pulse
              value={stats.readiness}
              version={build}
              previewPassed={stats.previewPassed}
              blockers={stats.blockers}
              safe={stats.safe}
            />
          </div>
          <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-[#1B1718]/72 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#FF7A3D]">
                  Signal stack
                </p>
                <p className="mt-1 text-xs font-semibold text-[#8EA2B6]">Live release telemetry</p>
              </div>
              <ZapIcon className="h-4 w-4 text-[#FF7A3D]" />
            </div>
            <div className="space-y-2">
              <SignalMeter
                icon={ClipboardCheckIcon}
                label="Observed"
                value={stats.total}
                max={Math.max(stats.total, 1)}
                tone="#FF7A3D"
                note="Reports in memory"
              />
              <SignalMeter
                icon={CircleCheckIcon}
                label="Proven"
                value={stats.previewPassed}
                max={Math.max(stats.total, 1)}
                tone="#52F2B8"
                note="Preview evidence"
              />
              <SignalMeter
                icon={WrenchIcon}
                label="Human gate"
                value={stats.manual}
                max={Math.max(stats.total, 1)}
                tone="#D66A32"
                note="Judgement required"
              />
              <SignalMeter
                icon={OctagonAlertIcon}
                label="Blockers"
                value={stats.blockers}
                max={Math.max(stats.total, 1)}
                tone="#FF6577"
                note="Release resistance"
              />
            </div>
          </div>
        </div>
        <TelemetryStrip stats={stats} />
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Open signals"
          value={stats.open}
          note="Across the active workflow"
          icon={ActivityIcon}
          tone="blue"
          index={0}
        />
        <MetricCard
          label="Auto-repair ready"
          value={stats.safe}
          note="Inside the safety boundary"
          icon={SparklesIcon}
          tone="gold"
          index={1}
        />
        <MetricCard
          label="Proof secured"
          value={stats.resolved}
          note="Resolved, closed or duplicate"
          icon={CircleCheckIcon}
          tone="green"
          index={2}
        />
        <MetricCard
          label="Human intelligence"
          value={stats.manual}
          note="Manual or blocked decisions"
          icon={BotIcon}
          tone="amber"
          index={3}
        />
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <Panel
          title="Signals requiring action"
          eyebrow="Priority stream"
          action={
            <Link
              to="/bugs"
              className="inline-flex items-center gap-1 text-xs font-bold text-[#FF9B5C] hover:text-white"
            >
              {'All signals '}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
          className="shipsure-panel rounded-2xl xl:min-h-[650px]"
        >
          {priorityBugs.length ? (
            <div className="space-y-2.5">
              {priorityBugs.map((bug, index) => (
                <motion.div
                  key={bug.id}
                  initial={
                    reduceMotion
                      ? false
                      : {
                          opacity: 0,
                          x: -8,
                        }
                  }
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  transition={{
                    delay: reduceMotion ? 0 : 0.035 * index,
                  }}
                >
                  <SignalCard
                    bug={bug}
                    selected={selectedBug?.id === bug.id}
                    onClick={() => setSelectedId(bug.id)}
                    dense
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No issues logged yet"
              description="Log your first report to see the full ReleaseGate loop: analysis, a controlled repair and proof before release."
              actionLabel="Report first bug"
              actionTo="/report"
            />
          )}
        </Panel>
        <Panel
          title={selectedBug ? selectedBug.title : 'Select a signal'}
          eyebrow={selectedBug?.bug_number || 'Decision surface'}
          className="shipsure-panel rounded-2xl xl:min-h-[650px]"
          action={selectedBug && <Badge label={workflow.label} tone={workflow.tone} />}
        >
          {selectedBug ? (
            <motion.div
              key={selectedBug.id}
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      x: 12,
                    }
              }
              animate={{
                opacity: 1,
                x: 0,
              }}
              className="space-y-5"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-[#4C3A34]/70 pb-4">
                <Badge label={safety.label} tone={safety.tone} />
                <Badge
                  label={`AI ${selectedBug.ai_confidence || 0}%`}
                  tone={
                    selectedBug.ai_confidence >= 90
                      ? 'green'
                      : selectedBug.ai_confidence >= 70
                        ? 'gold'
                        : 'amber'
                  }
                />
                <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#71879D]">
                  <CircleDotIcon className="h-3 w-3 text-[#C65A2E]" />
                  {selectedBug.environment}
                </span>
              </div>
              <ProgressSteps step={workflow.step || 0} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="group relative overflow-hidden rounded-2xl border border-[#FF6577]/25 bg-gradient-to-br from-[#FF6577]/[0.075] to-transparent p-4">
                  <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#FF6577]/10 blur-2xl" />
                  <p className="relative flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.17em] text-[#FF8C9A]">
                    <ActivityIcon className="h-3.5 w-3.5" />
                    Observed state
                  </p>
                  <p className="relative mt-3 text-sm leading-6 text-[#DDE7F2]">
                    {selectedBug.actual_behavior || selectedBug.description}
                  </p>
                  <div className="relative mt-4 rounded-xl border border-[#FF6577]/15 bg-[#1A1616]/58 p-3 text-xs leading-5 text-[#8FA2B5]">
                    {selectedBug.evidence || 'No supporting evidence attached yet.'}
                  </div>
                </div>
                <div className="group relative overflow-hidden rounded-2xl border border-[#52F2B8]/25 bg-gradient-to-br from-[#52F2B8]/[0.07] to-transparent p-4">
                  <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#52F2B8]/10 blur-2xl" />
                  <p className="relative flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.17em] text-[#7FF7CD]">
                    <CircleCheckIcon className="h-3.5 w-3.5" />
                    Proof target
                  </p>
                  <p className="relative mt-3 text-sm leading-6 text-[#DDE7F2]">
                    {selectedBug.expected_behavior || 'Expected behaviour still needs to be recorded.'}
                  </p>
                  <div className="relative mt-4 rounded-xl border border-[#52F2B8]/15 bg-[#1A1616]/58 p-3 text-xs leading-5 text-[#8FA2B5]">
                    {selectedBug.preview_evidence || 'Preview proof has not been recorded yet.'}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-[1.25fr_0.75fr]">
                <div className="relative overflow-hidden rounded-2xl border border-[#59433A]/75 bg-[#201A19]/86 p-4">
                  <div className="absolute left-0 top-4 h-8 w-0.5 bg-gradient-to-b from-[#FF7A3D] to-[#52F2B8]" />
                  <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#FF7A3D]">
                    ReleaseGate intelligence
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#F5FAFF]">
                    {selectedBug.ai_summary || 'AI checking has not run yet.'}
                  </p>
                  {selectedBug.safety_reasons?.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-xs text-[#8FA2B5]">
                      {selectedBug.safety_reasons.slice(0, 3).map((item) => (
                        <li key={item}>
                          {'• '}
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-col justify-between rounded-2xl border border-[#FF7A3D]/20 bg-gradient-to-br from-[#FF7A3D]/[0.08] to-transparent p-4">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#7991A8]">
                      Next move
                    </p>
                    <p className="mt-2 text-sm font-bold text-[#F5FAFF]">
                      {action?.label || 'No action required'}
                    </p>
                  </div>
                  <Link
                    to={`/bugs/${selectedBug.id}`}
                    className="shipsure-button mt-4 w-full justify-center"
                  >
                    {'Open record '}
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </motion.div>
          ) : (
            <EmptyState
              title="No signal selected"
              description="Choose a report from the stream to inspect its safety decision and evidence."
            />
          )}
        </Panel>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel
          title="Movement through the system"
          eyebrow="Seven-day release velocity"
          className="shipsure-panel rounded-2xl"
        >
          <div className="mb-4 flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7D92A7]">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-5 rounded-full bg-[#FF7A3D] shadow-[0_0_10px_#FF7A3D]" />
              Reported
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-5 rounded-full bg-[#52F2B8] shadow-[0_0_10px_#52F2B8]" />
              Proven
            </span>
          </div>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.trend}>
                <defs>
                  <linearGradient id="reported-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={toneColours.gold} stopOpacity={0.42} />
                    <stop offset="95%" stopColor={toneColours.gold} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="proven-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={toneColours.green} stopOpacity={0.34} />
                    <stop offset="95%" stopColor={toneColours.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1C2942" strokeDasharray="2 7" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{
                    fill: '#71879D',
                    fontSize: 10,
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{
                    fill: '#71879D',
                    fontSize: 10,
                  }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="reported"
                  stroke={toneColours.gold}
                  fill="url(#reported-fill)"
                  strokeWidth={2.5}
                  isAnimationActive={!reduceMotion}
                  animationDuration={1100}
                />
                <Area
                  type="monotone"
                  dataKey="proven"
                  stroke={toneColours.green}
                  fill="url(#proven-fill)"
                  strokeWidth={2.5}
                  isAnimationActive={!reduceMotion}
                  animationDuration={1350}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Risk field"
          eyebrow="Current signal distribution"
          className="shipsure-panel rounded-2xl"
        >
          <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7D92A7]">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-[#FF7A3D]" />
            Severity before action
          </div>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.severities}
                layout="vertical"
                margin={{
                  left: 8,
                  right: 16,
                }}
              >
                <CartesianGrid stroke="#1C2942" strokeDasharray="2 7" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{
                    fill: '#71879D',
                    fontSize: 10,
                  }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{
                    fill: '#B5C1D0',
                    fontSize: 11,
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={62}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="value"
                  radius={[0, 8, 8, 0]}
                  isAnimationActive={!reduceMotion}
                  animationDuration={1e3}
                  barSize={14}
                >
                  {(stats.severities || []).map((item) => (
                    <Cell
                      key={item.name}
                      fill={
                        item.name === 'critical'
                          ? toneColours.red
                          : item.name === 'high'
                            ? toneColours.amber
                            : item.name === 'medium'
                              ? toneColours.blue
                              : toneColours.green
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
