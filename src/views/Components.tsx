import type { Bug } from '../api';
import type { LucideIcon } from 'lucide-react';
import React from 'react';

import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  FileTextIcon,
  FlaskConicalIcon,
  InboxIcon,
  MapPinIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import { Link } from 'react-router-dom';

import { cx } from '../ui';

import { motion, useReducedMotion } from 'framer-motion';

import { relativeTime, severityLabels, workflowLabels } from './presentation';

export function CountUp({
  value = 0,
  duration = 700,
  formatter = (amount) => Math.round(amount).toLocaleString('en-GB'),
}: {
  value?: number;
  duration?: number;
  formatter?: (amount: number) => React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = React.useState(reduceMotion ? value : 0);
  React.useEffect(() => {
    if (reduceMotion || duration <= 0) {
      setDisplayValue(value);
      return;
    }
    const start = performance.now();
    let frame: number;
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      setDisplayValue(value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduceMotion]);
  return <>{formatter(displayValue)}</>;
}

const badgeStyles: Record<string, string> = {
  red: 'border-[#FF6577]/35 bg-[#FF6577]/10 text-[#FF8C9A]',
  amber: 'border-[#D66A32]/40 bg-[#D66A32]/12 text-[#FFB27B]',
  gold: 'border-[#FF7A3D]/40 bg-[#FF7A3D]/12 text-[#FF9B5C]',
  green: 'border-[#52F2B8]/35 bg-[#52F2B8]/10 text-[#7FF7CD]',
  blue: 'border-[#C65A2E]/40 bg-[#C65A2E]/12 text-[#F4A06F]',
  slate: 'border-[#526B84]/35 bg-[#526B84]/10 text-[#B5C1D0]',
};

const badgeIcons: Record<string, LucideIcon> = {
  red: ShieldAlertIcon,
  amber: TriangleAlertIcon,
  gold: SparklesIcon,
  green: CircleCheckIcon,
  blue: CircleIcon,
  slate: CircleIcon,
};

export function Badge({ label = '', tone = 'slate', className = '', compact = false }) {
  const Icon = badgeIcons[tone] || CircleIcon;
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold tracking-[0.01em]',
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        badgeStyles[tone] || badgeStyles.slate,
        className,
      )}
    >
      <Icon className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden="true" />
      {label}
    </span>
  );
}

function Confidence({ value }: { value: number }) {
  const percent = Number(value || 0);
  const colour =
    percent >= 90 ? '#52F2B8' : percent >= 70 ? '#FF7A3D' : percent > 0 ? '#FF6577' : '#6E5B52';
  return (
    <div
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${colour} ${percent * 3.6}deg, #1D2940 0deg)`,
      }}
      aria-label={percent ? `AI confidence ${percent}%` : 'Not analysed'}
    >
      <div className="absolute inset-[3px] rounded-full bg-[#0B1120]" />
      <span className="relative z-10 flex flex-col items-center leading-none">
        <span className="font-mono text-[10px] font-extrabold text-[#F5FAFF]">
          {percent ? `${percent}%` : '—'}
        </span>
        <span
          className="mt-1 text-[7px] font-extrabold uppercase tracking-[0.12em]"
          style={{
            color: colour,
          }}
        >
          AI
        </span>
      </span>
    </div>
  );
}

export function SignalCard({
  bug,
  selected = false,
  onClick = undefined,
  to = '',
  dense = false,
}: {
  bug: Bug;
  selected?: boolean;
  onClick?: () => void;
  to?: string;
  dense?: boolean;
}) {
  const workflow = workflowLabels[bug.status] || workflowLabels.new;
  const severity = severityLabels[bug.severity] || severityLabels.medium;
  const content = (
    <>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cx(
            'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition',
            selected
              ? 'border-[#FF7A3D]/38 bg-[#FF7A3D]/11 text-[#FF9B5C] shadow-[0_0_24px_rgba(255,122,61,0.11)]'
              : 'border-[#4D3A34] bg-[#211A1A] text-[#D66A32]',
          )}
        >
          <FileTextIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] font-bold tracking-[0.08em] text-[#FF9B5C]">
              {bug.bug_number}
            </span>
            <Badge label={workflow.label} tone={workflow.tone} compact />
            {!dense && <Badge label={severity.label} tone={severity.tone} compact />}
            {bug.is_synthetic && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#C65A2E]/25 bg-[#C65A2E]/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.09em] text-[#FFB27B]">
                <FlaskConicalIcon className="h-2.5 w-2.5" />
                {' Demo'}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-sm font-bold leading-5 tracking-[-0.015em] text-[#F5FAFF]">
            {bug.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-[#8496AB]">
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPinIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{bug.affected_module || bug.page_route || 'Unknown area'}</span>
            </span>
            <span>{bug.environment || 'unknown'}</span>
            <span>{relativeTime(bug.reported_at)}</span>
            {!!bug.evidence_count && (
              <span>
                {bug.evidence_count}
                {' evidence'}
              </span>
            )}
          </div>
          {bug.analysis_stale && (
            <div className="mt-2">
              <Badge label="Analysis stale" tone="amber" compact />
            </div>
          )}
        </div>
      </div>
      <div className="ml-2 flex items-center gap-2">
        <Confidence value={bug.ai_confidence} />
        <ChevronRightIcon className="h-4 w-4 text-[#75635A] transition-transform group-hover:translate-x-0.5 group-hover:text-[#FF9B5C]" />
      </div>
    </>
  );
  const classes = cx(
    'group relative flex w-full items-center rounded-xl border p-3 text-left transition duration-200',
    selected
      ? 'border-[#FF7A3D]/42 bg-gradient-to-r from-[#FF7A3D]/[0.11] to-[#C65A2E]/[0.045] shadow-[inset_2px_0_0_#FF7A3D,0_14px_40px_rgba(0,0,0,0.2)]'
      : 'border-[#4A3832] bg-[#201A1A]/84 hover:-translate-y-0.5 hover:border-[#C65A2E]/40 hover:bg-[#28201F]',
    bug.status === 'blocked' && !selected && 'border-[#FF6577]/30',
  );
  return to ? (
    <Link to={to} className={classes}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}

export function EmptyState({
  title = 'Nothing here yet',
  description = '',
  actionLabel = '',
  actionTo = '',
  children = null,
}: {
  title?: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[#2D3B55] bg-[#0B1120] p-8 text-center">
      <div className="rounded-xl border border-[#22304A] bg-[#0D1424] p-3 text-[#FF7A3D]">
        <InboxIcon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-bold text-[#F5FAFF]">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-6 text-[#93A4B8]">{description}</p>}
      {actionLabel && actionTo && (
        <Link to={actionTo} className="shipsure-button mt-5">
          {actionLabel}
        </Link>
      )}
      {children}
    </div>
  );
}

const metricStyles = {
  gold: {
    text: 'text-[#FF9B5C]',
    border: 'border-[#FF7A3D]/30',
    glow: 'from-[#FF7A3D]/[0.16]',
    color: '#FF7A3D',
  },
  green: {
    text: 'text-[#7FF7CD]',
    border: 'border-[#52F2B8]/25',
    glow: 'from-[#52F2B8]/[0.12]',
    color: '#52F2B8',
  },
  amber: {
    text: 'text-[#FFB27B]',
    border: 'border-[#D66A32]/30',
    glow: 'from-[#D66A32]/[0.15]',
    color: '#D66A32',
  },
  red: {
    text: 'text-[#FF8C9A]',
    border: 'border-[#FF6577]/25',
    glow: 'from-[#FF6577]/[0.12]',
    color: '#FF6577',
  },
  blue: {
    text: 'text-[#F4A06F]',
    border: 'border-[#C65A2E]/30',
    glow: 'from-[#C65A2E]/[0.16]',
    color: '#C65A2E',
  },
};

export function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone = 'blue',
  suffix = '',
  index = 0,
}: {
  label: string;
  value: number;
  note: string;
  icon: LucideIcon;
  tone?: string;
  suffix?: string;
  index?: number;
}) {
  const reduceMotion = useReducedMotion();
  const palette = metricStyles[tone as keyof typeof metricStyles] || metricStyles.blue;
  return (
    <motion.div
      initial={
        reduceMotion
          ? false
          : {
              opacity: 0,
              y: 14,
            }
      }
      animate={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        duration: 0.48,
        delay: reduceMotion ? 0 : index * 0.07,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={
        reduceMotion
          ? undefined
          : {
              y: -3,
            }
      }
      className={cx(
        'group relative min-w-0 overflow-hidden rounded-2xl border bg-[#201B1A]/90 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl',
        palette.border,
      )}
    >
      <div
        className={cx(
          'pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70',
          palette.glow,
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative z-10 flex min-h-[104px] flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#7D92A7]">{label}</p>
          <span
            className={cx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border bg-current/[0.07]',
              palette.text,
              palette.border,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[2.35rem] font-bold leading-none tracking-[-0.1em] text-white">
              <CountUp value={Number(value || 0)} />
              {suffix}
            </p>
            <p className="mt-2 truncate text-[11px] font-medium text-[#8DA1B4]">{note}</p>
          </div>
          <div className="mb-1 flex h-7 items-end gap-1" aria-hidden="true">
            {[0.34, 0.62, 0.46, 0.84].map((heightRatio, barIndex) => (
              <motion.span
                key={heightRatio}
                className="w-1 rounded-full"
                style={{
                  backgroundColor: palette.color,
                  boxShadow: `0 0 8px ${palette.color}55`,
                }}
                initial={
                  reduceMotion
                    ? false
                    : {
                        height: 3,
                      }
                }
                animate={{
                  height: `${heightRatio * 28}px`,
                }}
                transition={{
                  duration: 0.45,
                  delay: reduceMotion ? 0 : index * 0.07 + barIndex * 0.06,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function Panel({
  title = '',
  eyebrow = '',
  action = null,
  children = null,
  className = '',
  tone = 'default',
}: {
  title?: React.ReactNode;
  eyebrow?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  const panelStyle =
    tone === 'danger'
      ? 'border-[#FF6577]/28 bg-gradient-to-br from-[#FF6577]/[0.06] to-[#080D18]/90'
      : tone === 'success'
        ? 'border-[#52F2B8]/25 bg-gradient-to-br from-[#52F2B8]/[0.05] to-[#080D18]/90'
        : 'border-[#5A4038]/70 bg-gradient-to-br from-[#282021]/96 to-[#1A1718]/94';
  return (
    <section
      className={cx(
        'relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_20px_70px_rgba(0,0,0,0.2)] backdrop-blur-xl md:p-5',
        panelStyle,
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#FF8A4C]/45 to-transparent" />
      {(title || action) && (
        <div className="relative mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#FF8A4C]">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="text-[15px] font-bold tracking-[-0.025em] text-[#F5FAFF]">{title}</h2>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="relative min-w-0">{children}</div>
    </section>
  );
}

export function ChartTooltip({
  active = false,
  payload = [],
  label = '',
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string; value?: number | string; color?: string }[];
  label?: string | number;
} = {}) {
  return !active || !payload?.length ? null : (
    <div className="rounded-xl border border-[#5A4038]/75 bg-[#1B1718]/96 p-3 text-xs shadow-[0_18px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <p className="mb-2 font-bold text-[#F5FAFF]">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="mt-1 flex items-center justify-between gap-6 text-[#93A4B8]">
          <span className="capitalize">{item.dataKey}</span>
          <strong
            style={{
              color: item.color,
            }}
          >
            {item.value}
          </strong>
        </p>
      ))}
    </div>
  );
}
