import { useId } from 'react';
import type {
  CapacityAction,
  WorkforceSample,
  DeptKey,
  TradeKey,
} from './types';
import {
  aggregate,
  dateAt,
  displayDate,
  negative,
  timeline,
  sum,
  type Cube,
} from './engine';

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits });
export const money = (n: number) =>
  n >= 1e6 ? `$${fmt(n / 1e6, 1)}M` : `$${fmt(n)}`;
export type Units = 'People' | 'Hours' | 'Cost';
export function ShortfallChart({
  data,
  cube,
  depts,
  trades,
  horizon,
  onSelect,
}: {
  data: WorkforceSample;
  cube: Cube;
  depts: DeptKey[];
  trades: TradeKey[];
  horizon: number;
  onSelect: (i: number, tk: TradeKey) => void;
}) {
  const colors = [
    '#0068cc',
    '#2a9787',
    '#7d62b5',
    '#c99a14',
    '#c1563c',
    '#66788c',
    '#26313d',
    '#b0457a',
    '#2a8558',
  ];
  const weeks = data.weeks.slice(
    data.reference.constants.PAST,
    data.reference.constants.PAST + horizon,
  );
  const series = trades.map((tk) => ({
    tk,
    values: weeks.map(
      (w) =>
        sum(depts.map((dk) => cube[dk]?.[tk]?.[w.i]?.gap ?? 0)) /
        data.reference.constants.HPF,
    ),
  }));
  const max = Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const x = (i: number) => 48 + (i * 1020) / Math.max(1, weeks.length - 1);
  const y = (v: number) => 170 - (v / max) * 145;
  return (
    <div className="ws-chart-scroll">
      <svg
        className="ws-chart"
        viewBox="0 0 1100 215"
        role="group"
        aria-label="Shortfall by labor category in people"
      >
        {[0, 1, 2, 3].map((n) => (
          <g key={n}>
            <line
              x1="48"
              x2="1068"
              y1={y((max * n) / 3)}
              y2={y((max * n) / 3)}
              stroke="#e6eaee"
            />
            <text x="40" y={y((max * n) / 3) + 4} textAnchor="end">
              {fmt((max * n) / 3, 1)}
            </text>
          </g>
        ))}
        {series.map((s, n) => (
          <polyline
            key={s.tk}
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            fill="none"
            stroke={colors[n % colors.length]}
            strokeWidth="2"
          />
        ))}
        {weeks.map((w, i) => {
          const worst = [...series].sort(
            (a, b) => b.values[i] - a.values[i],
          )[0];
          return (
            <g key={w.i}>
              {i % (horizon > 26 ? 4 : 2) === 0 && (
                <text x={x(i)} y="192" textAnchor="middle">
                  {new Date(w.weekStart).toLocaleDateString('en-US', {
                    timeZone: 'UTC',
                    month: 'short',
                    day: 'numeric',
                  })}
                </text>
              )}
              <rect
                x={x(i) - 10}
                y="20"
                width={Math.max(12, 1020 / weeks.length)}
                height="155"
                fill="transparent"
                role="button"
                tabIndex={0}
                aria-label={`${displayDate(w.weekStart)}: ${data.reference.trades.find((t) => t.k === worst.tk)?.name} short ${fmt(worst.values[i], 1)} people`}
                onClick={() => onSelect(w.i, worst.tk)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(w.i, worst.tk);
                  }
                }}
              >
                <title>
                  {series
                    .map(
                      (s) =>
                        `${data.reference.trades.find((t) => t.k === s.tk)?.name}: ${fmt(s.values[i], 1)}`,
                    )
                    .join('\n')}
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="ws-legend">
        {series.map((s, n) => (
          <span key={s.tk}>
            <i style={{ background: colors[n % colors.length] }} />
            {data.reference.trades.find((t) => t.k === s.tk)?.name}
          </span>
        ))}
      </div>
    </div>
  );
}
export function Segments<T extends string | number>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="ws-segment-group">
      <span className="ws-eyebrow">{label}</span>
      <div className="ws-segments" role="group" aria-label={label}>
        {values.map((v) => (
          <button
            type="button"
            key={v}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  tone = '',
  onClick,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="ws-eyebrow">{label}</span>
      <strong>{value}</strong>
      <span>{detail}</span>
    </>
  );
  return onClick ? (
    <button className={`ws-metric ${tone}`} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={`ws-metric ${tone}`}>{content}</div>
  );
}
export function Chart({
  data,
  rows,
  units,
  horizon,
  onSelect,
  selected,
  service = false,
  components = false,
  rate = 50,
}: {
  data: WorkforceSample;
  rows: ReturnType<typeof aggregate>;
  units: Units;
  horizon: number;
  onSelect: (i: number) => void;
  selected?: number;
  service?: boolean;
  components?: boolean;
  rate?: number;
}) {
  const id = useId().replaceAll(':', '');
  const { PAST, HPF } = data.reference.constants;
  const values = rows.slice(0, PAST + horizon);
  const scale = units === 'People' ? 1 / HPF : units === 'Cost' ? rate : 1;
  const max =
    Math.max(
      1,
      ...values.flatMap((r) => [r.demand, r.capacity, r.actual ?? 0]),
    ) *
    scale *
    1.1;
  const top = 20,
    left = 68,
    width = 1100,
    height = 270,
    bottom = top + height;
  const dx = (width - left - 16) / values.length;
  const y = (n: number) => bottom - ((n * scale) / max) * height;
  const line = (fn: (r: (typeof rows)[number]) => number, start = 0) =>
    values
      .slice(start)
      .map((r, j) => `${left + (j + start + 0.5) * dx},${y(fn(r))}`)
      .join(' ');
  return (
    <div className="ws-chart-scroll">
      <svg
        className="ws-chart"
        viewBox={`0 0 ${width} ${bottom + 54}`}
        role="group"
        aria-label={`${service ? 'Service demand' : 'Labor capacity'} and workload by week, ${units.toLowerCase()}. Select a week for details.`}
      >
        <defs>
          <pattern
            id={`plan-${id}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill="#fff4d7" />
            <path
              d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2"
              stroke="#bd870f"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
        <rect
          x={left}
          y={top}
          width={PAST * dx}
          height={height}
          fill="#f3f5f7"
        />
        {Array.from({ length: 5 }, (_, i) => {
          const v = (max * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width - 16}
                y1={bottom - (i * height) / 4}
                y2={bottom - (i * height) / 4}
                stroke="#e6eaee"
              />
              <text
                x={left - 9}
                y={bottom - (i * height) / 4 + 4}
                textAnchor="end"
              >
                {units === 'Cost'
                  ? `$${fmt(v / 1000, 0)}k`
                  : fmt(v, max < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}
        {values.map((r, j) => {
          const x = left + j * dx + 1.5,
            bw = Math.max(1, dx - 3),
            isHistory = j < PAST;
          return (
            <g key={r.i}>
              {!isHistory && r.gap > 0 && (
                <rect
                  x={x - 1}
                  y={top}
                  width={dx}
                  height={height}
                  fill="#f8e6e4"
                  opacity="0.65"
                />
              )}
              {isHistory ? (
                <rect
                  x={x}
                  y={y(r.actual ?? 0)}
                  width={bw}
                  height={Math.max(0, bottom - y(r.actual ?? 0))}
                  fill="#a5b0bd"
                />
              ) : service ? (
                <>
                  <rect
                    x={x}
                    y={y(r.hard)}
                    width={bw}
                    height={bottom - y(r.hard)}
                    fill="#719cc2"
                  />
                  <rect
                    x={x}
                    y={y(r.hard + r.soft)}
                    width={bw}
                    height={y(r.hard) - y(r.hard + r.soft)}
                    fill="#d9ad50"
                  />
                </>
              ) : (
                <>
                  <rect
                    x={x}
                    y={y(components ? r.roster : r.secured)}
                    width={bw}
                    height={bottom - y(components ? r.roster : r.secured)}
                    fill="#2e4d6e"
                  />
                  {components && (
                    <rect
                      x={x}
                      y={y(r.secured)}
                      width={bw}
                      height={Math.max(0, y(r.roster) - y(r.secured))}
                      fill="#2f8461"
                    />
                  )}
                  <rect
                    x={x}
                    y={y(r.capacity)}
                    width={bw}
                    height={Math.max(0, y(r.secured) - y(r.capacity))}
                    fill={`url(#plan-${id})`}
                  />
                </>
              )}
              {selected === r.i && (
                <rect
                  x={x - 1}
                  y={top}
                  width={dx}
                  height={height}
                  fill="none"
                  stroke="#006fd6"
                  strokeWidth="2"
                />
              )}
              {(j % (horizon > 26 ? 4 : 2) === 0 || j === PAST) && (
                <text x={x + bw / 2} y={bottom + 19} textAnchor="middle">
                  {new Date(r.weekStart).toLocaleDateString('en-US', {
                    timeZone: 'UTC',
                    month: 'short',
                    day: 'numeric',
                  })}
                </text>
              )}
            </g>
          );
        })}
        <polyline
          points={line((r) => (service ? r.secured : r.demand), PAST)}
          stroke={service ? '#23394d' : '#111a23'}
          strokeWidth="2.7"
          fill="none"
        />
        <polyline
          points={line((r) => (service ? r.capacity : r.hard), PAST)}
          stroke={service ? '#926720' : '#0068cc'}
          strokeWidth="1.8"
          strokeDasharray="5 3"
          fill="none"
        />
        <line
          x1={left + PAST * dx}
          x2={left + PAST * dx}
          y1={top - 6}
          y2={bottom}
          stroke="#006fd6"
          strokeDasharray="3 3"
        />
        <text x={left + PAST * dx + 5} y={top - 7}>
          Forecast as of {displayDate(data.reference.constants.WEEK0)}
        </text>
        <text x={left + 8} y={top + 15}>
          {values.slice(0, PAST).some((r) => r.actual !== undefined)
            ? 'History · logged hours'
            : 'History · no timesheet feed'}
        </text>
        {values.map((r, j) => (
          <rect
            key={r.i}
            x={left + j * dx}
            y={top}
            width={dx}
            height={height}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={`Week of ${r.label}: workload ${fmt(r.demand * scale, 1)}, secured ${fmt(r.secured * scale, 1)}, shortage ${fmt(r.gap * scale, 1)} ${units.toLowerCase()}`}
            onClick={() => onSelect(r.i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(r.i);
              }
            }}
          >
            <title>
              {r.label}: demand {fmt(r.demand * scale, 1)} · secured{' '}
              {fmt(r.secured * scale, 1)} · planned {fmt(r.planned * scale, 1)}{' '}
              · short {fmt(r.gap * scale, 1)}
            </title>
          </rect>
        ))}
      </svg>
      <div className="ws-legend">
        {service ? (
          <>
            <span>
              <i style={{ background: '#719cc2' }} />
              Committed maintenance + calls
            </span>
            <span>
              <i style={{ background: '#d9ad50' }} />
              Expected renewals
            </span>
            <span className="line">Secured capacity</span>
            <span className="line dashed">If plan succeeds</span>
          </>
        ) : (
          <>
            <span>
              <i style={{ background: '#2e4d6e' }} />
              Secured capacity
            </span>
            {components && (
              <span>
                <i style={{ background: '#2f8461' }} />
                Secured additions
              </span>
            )}
            <span>
              <i className="hatched" />
              Planned, not secured
            </span>
            <span className="line">Total workload</span>
            <span className="line dashed">Signed work</span>
          </>
        )}
        <span>
          <i style={{ background: '#f8e6e4' }} />
          Short on selected capacity basis
        </span>
      </div>
    </div>
  );
}

export function Timeline({
  data,
  actions,
  onSelect,
}: {
  data: WorkforceSample;
  actions: CapacityAction[];
  onSelect: (a: CapacityAction) => void;
}) {
  const start = -16,
    end = data.reference.constants.FUT,
    length = end - start;
  const x = (v: number) =>
    Math.max(0, Math.min(100, ((v - start) / length) * 100));
  return (
    <div className="ws-timeline" aria-label="Capacity action timeline">
      <div className="ws-timeline-axis">
        <span>Action / position</span>
        <div>
          {Array.from({ length: 7 }, (_, n) => (
            <span key={n} style={{ left: `${(n / 6) * 100}%` }}>
              {new Date(
                dateAt(data, start + (length * n) / 6),
              ).toLocaleDateString('en-US', {
                timeZone: 'UTC',
                month: 'short',
                year: '2-digit',
              })}
            </span>
          ))}
        </div>
      </div>
      {actions.map((a) => {
        const tl = timeline(a, data);
        return (
          <button
            key={a.id}
            className="ws-timeline-row"
            onClick={() => onSelect(a)}
          >
            <span>
              <b>
                {fmt(a.qty, 1)} ×{' '}
                {data.reference.trades.find((t) => t.k === a.tk)?.one}
              </b>
              <small>
                {data.reference.departments.find((d) => d.k === a.dk)?.name} ·{' '}
                {a.kind}
              </small>
            </span>
            <div className="ws-track">
              <i className="ws-asof" style={{ left: `${x(0)}%` }} />
              {tl.phases.map(([name, from, to], i) => (
                <i
                  key={name}
                  title={`${name}: ${displayDate(dateAt(data, from))} – ${displayDate(dateAt(data, to))}`}
                  style={{
                    left: `${x(from)}%`,
                    width: `${Math.max(0, x(to) - x(from))}%`,
                    background: `hsl(267 30% ${80 - i * 9}%)`,
                  }}
                />
              ))}
              <i
                title={
                  negative(a)
                    ? 'Known reduction in capacity'
                    : 'Productive capacity'
                }
                className={negative(a) ? 'reduction' : 'productive'}
                style={{
                  left: `${x(tl.productive)}%`,
                  width: `${Math.max(0, x(a.kind === 'hire' || a.kind === 'attrition' ? end : a.to + 1) - x(tl.productive))}%`,
                }}
              />
            </div>
          </button>
        );
      })}
      <p className="ws-fine">
        Purple: recruiting → selection → notice → onboarding → ramp-up. Green:
        productive capacity. Gray: known reductions. Dates use the same
        milestones as the hiring queue.
      </p>
    </div>
  );
}
