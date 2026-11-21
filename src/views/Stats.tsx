import { useQuery } from '@tanstack/react-query';
import { api, type SiteStats } from '../api';

const metrics: [string, string][] = [
  ['visit', 'Page loads'],
  ['visitor', 'Unique visitors'],
  ['signup', 'Sign-ups'],
  ['verified', 'Emails confirmed'],
  ['scan', 'Checks run'],
  ['discovery', 'Button discoveries'],
  ['cap_hit', 'Limits reached'],
];

function table(stats: SiteStats) {
  const days = [...new Set(stats.rows.map((r) => r.day))].sort().reverse();
  const value = (day: string, metric: string) => stats.rows.find((r) => r.day === day && r.metric === metric)?.count ?? 0;
  const total = (metric: string) => stats.rows.filter((r) => r.metric === metric).reduce((n, r) => n + r.count, 0);
  return { days, value, total };
}

export function Stats() {
  const query = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 60_000 });
  if (query.isLoading) return <p className="p-4 text-sm text-[#B0C0D1]">Loading statistics…</p>;
  if (query.error) return <p role="alert" className="p-4 text-sm text-[#FFA0AD]">{(query.error as Error).message}</p>;
  const stats = query.data!;
  const { days, value, total } = table(stats);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight text-white">Stats</h2>
        <p className="mt-1 text-sm text-[#B0C0D1]">
          Counted on this server only, with no third-party analytics. The last 30 days, since {stats.since}, in UTC. Only administrators can see this page.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Accounts', stats.accounts],
          ['Confirmed emails', stats.verification_required ? stats.verified_accounts : 'n/a'],
          ['Checks today', value(today, 'scan') + ' / ' + stats.limits.scansTotal],
          ['Checks (all time)', stats.scans_all_time],
        ].map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-[#0A1020] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[#8C9BAD]">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">{n}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.1em] text-[#8C9BAD]">
            <tr>
              <th className="px-3 py-2">Day</th>
              {metrics.map(([, label]) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-white/10 font-bold text-white">
              <td className="px-3 py-2">30-day total</td>
              {metrics.map(([m]) => <td key={m} className="px-3 py-2 text-right tabular-nums">{total(m)}</td>)}
            </tr>
            {days.map((day) => (
              <tr key={day} className="border-t border-white/5 text-[#C9D5E1]">
                <td className="px-3 py-2 font-mono text-xs">{day}</td>
                {metrics.map(([m]) => <td key={m} className="px-3 py-2 text-right tabular-nums">{value(day, m)}</td>)}
              </tr>
            ))}
            {!days.length && (
              <tr><td colSpan={metrics.length + 1} className="px-3 py-6 text-center text-[#8C9BAD]">No activity recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#8C9BAD]">
        Limits: {stats.limits.scansPerUser} checks per person per day, {stats.limits.scansTotal} in total per day. To change them, ask Claude to update
        PUBLIC_SCANS_PER_USER_DAILY and PUBLIC_SCANS_TOTAL_DAILY on the API server.
      </p>
    </div>
  );
}
