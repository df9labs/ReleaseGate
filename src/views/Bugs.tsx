import React from 'react';

import {
  ArrowRightIcon,
  BotIcon,
  CircleCheckIcon,
  ListFilterIcon,
  SearchIcon,
  ShieldCheckIcon,
} from 'lucide-react';

import { Badge, EmptyState, Panel, SignalCard } from './Components';

import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../api';

import { nextAction, safetyLabel, workflowLabels } from './presentation';

import { useQuery } from '@tanstack/react-query';

const workflowOptions = [
  ['all', 'All workflow states'],
  ['needs_action', 'Needs action'],
  ['new', 'Reported'],
  ['needs_evidence', 'Needs input'],
  ['needs_manual_investigation', 'Manual investigation'],
  ['ready_for_repair', 'Repair ready'],
  ['awaiting_preview_verification', 'Preview retest'],
  ['awaiting_production_verification', 'Ready to release'],
  ['resolved', 'Live proven'],
  ['closed', 'Completed'],
];

export function Bugs() {
  const [parameters, setParameters] = useSearchParams();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const search = parameters.get('q') || '';
  const workflow = parameters.get('workflow') || 'needs_action';
  const severity = parameters.get('severity') || 'all';
  const safety = parameters.get('safety') || 'all';
  const bugsQuery = useQuery({
    queryKey: ['shipsure-bugs', search.trim()],
    queryFn: () => (search.trim() ? api.search(search.trim()) : api.listBugs(500)),
  });
  const bugs = bugsQuery.data?.records || [];
  const matches = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return bugs.filter((candidate) => {
      const matchesTerm =
        !term ||
        [
          candidate.bug_number,
          candidate.title,
          candidate.affected_module,
          candidate.page_route,
          candidate.linked_semantic_version,
        ]
          .filter(Boolean)
          .some((item) => String(item).toLowerCase().includes(term));
      const matchesWorkflow =
        workflow === 'all' ||
        (workflow === 'needs_action' &&
          !['resolved', 'duplicate', 'closed', 'wont_fix'].includes(candidate.status)) ||
        (workflow === 'closed' &&
          ['resolved', 'duplicate', 'closed', 'wont_fix'].includes(candidate.status)) ||
        candidate.status === workflow;
      return (
        matchesTerm &&
        matchesWorkflow &&
        (severity === 'all' || candidate.severity === severity) &&
        (safety === 'all' || candidate.safety_decision === safety)
      );
    });
  }, [bugs, search, workflow, severity, safety]);
  React.useEffect(() => {
    const first = matches[0]?.id;
    if (!selectedId && first) {
      setSelectedId(first);
    } else if (selectedId && !matches.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(first || null);
    }
  }, [matches, selectedId]);
  const bug = matches.find((candidate) => candidate.id === selectedId) || matches[0];
  const statusLabel = bug ? workflowLabels[bug.status] || workflowLabels.new : null;
  const safetyBadge = safetyLabel(bug);
  const action = nextAction(bug);
  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(parameters);
    if (!value || value === 'all' || (name === 'workflow' && value === 'needs_action'))
      next.delete(name);
    else next.set(name, value);
    setParameters(next);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[#22304A] bg-[#0D1424] p-5 md:flex-row md:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#FF7A3D]">
            Bug register
          </p>
          <h2 className="mt-1 text-2xl font-extrabold text-[#F5FAFF]">
            Every report, one traceable record
          </h2>
          <p className="mt-2 text-sm text-[#93A4B8]">
            Compact queue, structured conclusions, visible safety decisions.
          </p>
        </div>
        <Link to="/report" className="shipsure-button self-start md:self-auto">
          {'Report a bug '}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
      <Panel className="p-3 md:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px_150px_190px]">
          <label className="relative">
            <span className="sr-only">Search reports</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#C65A2E]" />
            <input
              value={search}
              onChange={(event) => filter('q', event.target.value)}
              placeholder="Search ref, title, area or version…"
              className="shipsure-input pl-10"
            />
          </label>
          <label>
            <span className="sr-only">Workflow</span>
            <select
              value={workflow}
              onChange={(event) => filter('workflow', event.target.value)}
              className="shipsure-input"
            >
              {workflowOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Severity</span>
            <select
              value={severity}
              onChange={(event) => filter('severity', event.target.value)}
              className="shipsure-input"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Safety</span>
            <select
              value={safety}
              onChange={(event) => filter('safety', event.target.value)}
              className="shipsure-input"
            >
              <option value="all">All safety decisions</option>
              <option value="eligible">Auto-repair eligible</option>
              <option value="approval_required">Approval required</option>
              <option value="manual_only">Manual only</option>
              <option value="blocked">Blocked</option>
              <option value="not_assessed">Not assessed</option>
            </select>
          </label>
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[0.86fr_1.14fr]">
        <Panel
          title={`${matches.length} reports`}
          eyebrow="Filtered queue"
          action={
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#93A4B8]">
              <ListFilterIcon className="h-3.5 w-3.5" />
              Scannable card view
            </span>
          }
          className="min-h-[660px]"
        >
          {bugsQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from(
                {
                  length: 6,
                },
                (_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-xl bg-[#151C30]" />
                ),
              )}
            </div>
          ) : matches.length ? (
            <div className="space-y-2.5">
              {matches.map((candidate) => (
                <SignalCard
                  key={candidate.id}
                  bug={candidate}
                  selected={candidate.id === bug?.id}
                  onClick={() => setSelectedId(candidate.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nothing matches these filters"
              description="Clear the filters or log a new report."
              actionLabel="Report a bug"
              actionTo="/report"
            />
          )}
        </Panel>
        <Panel
          title={bug?.title || 'Choose a report'}
          eyebrow={bug?.bug_number || 'Bug detail preview'}
          action={statusLabel && <Badge label={statusLabel.label} tone={statusLabel.tone} />}
          className="min-h-[660px]"
        >
          {bug ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 border-b border-[#22304A] pb-4">
                <Badge label={safetyBadge.label} tone={safetyBadge.tone} />
                <Badge
                  label={`AI confidence ${bug.ai_confidence || 0}%`}
                  tone={bug.ai_confidence >= 90 ? 'green' : bug.ai_confidence >= 70 ? 'gold' : 'amber'}
                />
                <span className="ml-auto text-xs text-[#93A4B8]">
                  {bug.affected_module}
                  {' · '}
                  {bug.environment}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                  <BotIcon className="h-4 w-4 text-[#FF7A3D]" />
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                    Likely cause
                  </p>
                  <p className="mt-1.5 text-sm font-semibold leading-5 text-[#F5FAFF]">
                    {bug.suspected_cause || 'Not analysed'}
                  </p>
                </div>
                <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                  <ShieldCheckIcon className="h-4 w-4 text-[#52F2B8]" />
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                    Safety gate
                  </p>
                  <p className="mt-1.5 text-sm font-semibold leading-5 text-[#F5FAFF]">
                    {safetyBadge.label}
                  </p>
                </div>
                <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                  <CircleCheckIcon className="h-4 w-4 text-[#C65A2E]" />
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#93A4B8]">
                    Verification
                  </p>
                  <p className="mt-1.5 text-sm font-semibold leading-5 text-[#F5FAFF]">
                    {bug.preview_verification_status?.replaceAll('_', ' ') || 'Not tested'}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-[#FF6577]/25 bg-[#FF6577]/[0.04] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF8C9A]">
                    What happened
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#DDE7F2]">
                    {bug.actual_behavior || bug.description}
                  </p>
                </div>
                <div className="rounded-xl border border-[#52F2B8]/25 bg-[#52F2B8]/[0.04] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7FF7CD]">
                    What should happen
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#DDE7F2]">
                    {bug.expected_behavior || 'Expected result not supplied.'}
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-[#22304A] bg-[#0B1120] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF7A3D]">
                  AI conclusion
                </p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#F5FAFF]">
                  {bug.ai_summary || 'Run AI checking to create a structured conclusion.'}
                </p>
                {bug.safety_reasons?.length > 0 && (
                  <ul className="mt-3 grid gap-2 text-xs text-[#93A4B8] sm:grid-cols-2">
                    {bug.safety_reasons.map((item) => (
                      <li key={item} className="rounded-lg border border-[#22304A] bg-[#0D1424] p-2.5">
                        {'• '}
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-[#22304A] bg-[#132942] p-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#C65A2E]">
                    Next action
                  </p>
                  <p className="mt-1 text-sm font-bold text-[#F5FAFF]">
                    {action?.label || 'No action required'}
                  </p>
                </div>
                <Link to={`/bugs/${bug.id}`} className="shipsure-button justify-center">
                  {'Open full record '}
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No report selected"
              description="Select a bug from the queue to preview its evidence and next action."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
