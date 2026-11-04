import type { DeptKey, TradeKey, WorkforceSample } from './types';
import { laborHistory } from './laborActuals';
import { displayDate } from './engine';
import { fmt } from './Charts';

export function LaborHistory({
  data,
  depts,
  trades,
  jobs,
}: {
  data: WorkforceSample;
  depts: DeptKey[];
  trades: TradeKey[];
  jobs?: Set<string>;
}) {
  if (!data.labor_actuals) return null;
  const rows = laborHistory(data, depts, trades, jobs);
  const sum = (k: 'verified' | 'unclassified' | 'total' | 'pto') =>
    rows.reduce((n, r) => n + r[k], 0);
  return (
    <section className="ws-card" aria-label="Approved labor history">
      <div className="ws-card-head">
        <div>
          <h2>Approved labor history</h2>
          <p>
            {jobs
              ? 'Selected active forecast projects'
              : 'All retrieved Service work'}{' '}
            · recorded departments ·{' '}
            {displayDate(data.labor_actuals.periodStart)}–
            {displayDate(data.labor_actuals.periodEnd)}.
          </p>
        </div>
      </div>
      <p>
        Verified hours follow the labor-category selection. Unclassified actual
        labor stays visible because its craft is unknown. These source hours do
        not adjust trade forecasts or determine crew availability.
      </p>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Verified selected categories</th>
              <th>Unclassified actual labor</th>
              <th>Approved non-PTO hours</th>
              <th>PTO excluded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.weekStart}>
                <td>{displayDate(r.weekStart)}</td>
                <td>{r.hasRecords ? fmt(r.verified, 2) : '—'}</td>
                <td>{r.hasRecords ? fmt(r.unclassified, 2) : '—'}</td>
                <td>{r.hasRecords ? fmt(r.total, 2) : '—'}</td>
                <td>{r.hasRecords ? fmt(r.pto, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
          {rows.some((r) => r.hasRecords) && (
            <tfoot>
              <tr>
                <th>Total retrieved</th>
                <td>{fmt(sum('verified'), 2)}</td>
                <td>{fmt(sum('unclassified'), 2)}</td>
                <td>{fmt(sum('total'), 2)}</td>
                <td>{fmt(sum('pto'), 2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="ws-fine">
        No retrieved entries is shown as —, not certified zero work. Source
        approval is time-entry review status; payroll posting and payment are
        unverified. Service history includes maintenance, calls, projects and
        internal work.
      </p>
    </section>
  );
}
