import React from 'react';

import {
  ArrowRightIcon,
  BotIcon,
  ClipboardCheckIcon,
  GitCompareArrowsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchIcon,
} from 'lucide-react';

import { Badge, CountUp, EmptyState, Panel, SignalCard } from './Components';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { Link } from 'react-router-dom';

import { api, type Bug } from '../api';
import type { LucideIcon } from 'lucide-react';

import { motion, useReducedMotion } from 'framer-motion';

import { useQuery } from '@tanstack/react-query';

const laneColours = ['#52F2B8', '#FF7A3D', '#D66A32', '#C65A2E'];

function RepairLane({
  icon: Icon,
  title,
  eyebrow,
  tone,
  records,
  description,
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  tone: 'green' | 'gold' | 'amber' | 'blue';
  records: Bug[];
  description: string;
}) {
  const palette = {
    green: 'border-[#52F2B8]/30 bg-[#52F2B8]/[0.045] text-[#7FF7CD]',
    gold: 'border-[#FF7A3D]/30 bg-[#FF7A3D]/[0.045] text-[#FF9B5C]',
    amber: 'border-[#D66A32]/30 bg-[#D66A32]/[0.045] text-[#FFC267]',
    blue: 'border-[#C65A2E]/30 bg-[#C65A2E]/[0.045] text-[#9DC2E6]',
  }[tone];
  return (
    <section className={`rounded-2xl border p-4 ${palette}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-[#050810]/35">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-80">{eyebrow}</p>
          <h3 className="mt-1 text-base font-extrabold text-[#F5FAFF]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#93A4B8]">{description}</p>
        </div>
        <strong className="ml-auto font-mono text-2xl text-[#F5FAFF]">
          <CountUp value={records.length} />
        </strong>
      </div>
      <div className="mt-4 space-y-2">
        {records.slice(0, 3).map((bug) => (
          <Link
            key={bug.id}
            to={`/bugs/${bug.id}`}
            className="group flex items-center gap-3 rounded-xl border border-[#22304A] bg-[#0B1120]/80 p-3 transition hover:border-current/40 hover:bg-[#0D1424]"
          >
            <span className="font-mono text-[10px] font-bold text-[#FF7A3D]">{bug.bug_number}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#DDE7F2]">{bug.title}</span>
            <ArrowRightIcon className="h-3.5 w-3.5 text-[#708197] transition group-hover:translate-x-0.5 group-hover:text-white" />
          </Link>
        ))}
        {!records.length && (
          <p className="rounded-xl border border-dashed border-[#2D3B55] p-4 text-center text-xs text-[#8496AB]">
            Nothing waiting in this lane.
          </p>
        )}
      </div>
      {records.length > 3 && (
        <p className="mt-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] opacity-80">
          +{records.length - 3}
          {' more in bug register'}
        </p>
      )}
    </section>
  );
}

export function Repairs() {
  const reduceMotion = useReducedMotion();
  const bugsQuery = useQuery({
    queryKey: ['shipsure-bugs'],
    queryFn: () => api.listBugs(500),
  });
  const bugs = bugsQuery.data?.records || [];
  const lanes = React.useMemo(() => {
    return {
      automatic: bugs.filter((bug) => bug.status === 'ready_for_repair' && bug.safe_fix_eligible),
      approval: bugs.filter(
        (bug) => ['ready_for_repair', 'repair_in_progress'].includes(bug.status) && !bug.safe_fix_eligible,
      ),
      manual: bugs.filter((bug) =>
        ['needs_manual_investigation', 'preview_failed', 'reopened', 'blocked'].includes(bug.status),
      ),
      verify: bugs.filter((bug) =>
        ['awaiting_preview_verification', 'awaiting_production_verification'].includes(bug.status),
      ),
    };
  }, [bugs]);
  const activeBugs = [...lanes.automatic, ...lanes.approval, ...lanes.manual, ...lanes.verify];
  const mix = [
    {
      name: 'Allowlisted',
      value: lanes.automatic.length,
    },
    {
      name: 'Approval',
      value: lanes.approval.length,
    },
    {
      name: 'Manual',
      value: lanes.manual.length,
    },
    {
      name: 'Verification',
      value: lanes.verify.length,
    },
  ];
  return bugsQuery.isLoading ? (
    <div className="h-[72vh] animate-pulse rounded-2xl border border-[#22304A] bg-[#0D1424]" />
  ) : bugsQuery.isError ? (
    <EmptyState
      title="Repair workspace unavailable"
      description={bugsQuery.error?.message || 'ReleaseGate could not load the repair queue.'}
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
        className="relative overflow-hidden rounded-2xl border border-[#273652] bg-[radial-gradient(circle_at_90%_0%,rgba(255,122,61,0.17),transparent_38%),linear-gradient(135deg,#0D1424,#080D18)] p-5 md:p-7"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FF7A3D]/80 to-transparent" />
        <div className="grid items-center gap-6 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF7A3D]">
              Controlled repair cockpit
            </p>
            <h2 className="mt-2 max-w-3xl text-2xl font-extrabold text-[#F5FAFF] md:text-3xl">
              Automation gets a narrow lane. Everything else earns human approval.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#93A4B8]">
              ReleaseGate can apply only allowlisted workflow metadata recipes. Product-source repairs stay in an
              isolated Preview path with a checkpoint, implementation record and separate retest proof.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge label="No production auto-deploy" tone="green" />
              <Badge label="Evidence is untrusted input" tone="blue" />
              <Badge label="Checkpoint before change" tone="gold" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[310px]">
            {(
              [
                [SparklesIcon, lanes.automatic.length, 'Allowlisted'],
                [ShieldCheckIcon, lanes.approval.length, 'Approval'],
                [BotIcon, lanes.manual.length, 'Human only'],
                [ClipboardCheckIcon, lanes.verify.length, 'Need proof'],
              ] as const
            ).map(([Icon, count, label]) => (
              <div key={label} className="rounded-xl border border-[#22304A] bg-[#050810]/35 p-3">
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
        </div>
      </motion.section>
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4 md:grid-cols-2">
          <RepairLane
            icon={SparklesIcon}
            title="Safe workflow recipes"
            eyebrow="Automation allowed"
            tone="green"
            records={lanes.automatic}
            description="Deterministic and bound to the exact approved analysis."
          />
          <RepairLane
            icon={ShieldCheckIcon}
            title="Awaiting approval"
            eyebrow="Controlled Preview"
            tone="gold"
            records={lanes.approval}
            description="Plan, checkpoint and record the implementation before retesting."
          />
          <RepairLane
            icon={ShieldAlertIcon}
            title="Manual investigation"
            eyebrow="Automation blocked"
            tone="amber"
            records={lanes.manual}
            description="Auth, data, billing, integrations and uncertain diagnoses stay human."
          />
          <RepairLane
            icon={GitCompareArrowsIcon}
            title="Evidence required"
            eyebrow="Retest or release"
            tone="blue"
            records={lanes.verify}
            description="Implementation is not resolution. Preview and Live proof remain separate."
          />
        </div>
        <div className="space-y-5">
          <Panel title="Repair mix" eyebrow="Current queue">
            {activeBugs.length ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={mix}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={58}
                      outerRadius={82}
                      paddingAngle={4}
                      isAnimationActive={!reduceMotion}
                    >
                      {mix.map((item, index) => (
                        <Cell key={item.name} fill={laneColours[index]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: '#080D18',
                        border: '1px solid #2D3B55',
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      itemStyle={{
                        color: '#F5FAFF',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="Repair queue clear"
                description="New analysed reports will be routed here by safety decision."
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              {mix.map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center gap-2 text-[10px] font-semibold text-[#93A4B8]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: laneColours[index],
                    }}
                  />
                  <span className="flex-1">{item.name}</span>
                  <strong className="font-mono text-white">{item.value}</strong>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Safety policy" eyebrow="shipsure-policy-v1">
            <div className="space-y-3">
              {[
                ['Diagnose', 'Structured AI can explain and recommend.'],
                ['Decide', 'A separate policy gate chooses the route.'],
                ['Repair', 'Only deterministic workflow recipes auto-apply.'],
                ['Prove', 'A human records Preview and Live evidence.'],
              ].map(([item, item2], index) => (
                <div key={item} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#FF7A3D]/35 bg-[#FF7A3D]/10 font-mono text-[10px] font-bold text-[#FF9B5C]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-white">{item}</p>
                    <p className="mt-0.5 text-xs leading-5 text-[#93A4B8]">{item2}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      {activeBugs.length > 0 && (
        <Panel title="All active repair work" eyebrow="Open the evidence record">
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {activeBugs.slice(0, 9).map((item) => (
              <SignalCard key={item.id} bug={item} to={`/bugs/${item.id}`} />
            ))}
          </div>
          <Link to="/bugs" className="shipsure-button-secondary mt-4 w-full justify-center">
            <WrenchIcon className="h-4 w-4" />
            Open full bug register
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </Panel>
      )}
    </div>
  );
}
