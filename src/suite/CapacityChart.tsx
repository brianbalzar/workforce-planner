import { useId, useState } from 'react';
import type { WorkforceSample } from './types';
import type { aggregate, Basis } from './engine';
import { fmt, money, type Units } from './Charts';

/* Labor capacity vs. workload, drawn the way the Projects demo draws it:
   bars stack the crew each department can put to work, then the unresolved
   gap up to the workload line, then spare crew above it (dashed). The
   workload is a stepped line; weeks short of labor are shaded. */

type Row = ReturnType<typeof aggregate>[number];
type LayerKey =
  | 'uConf'
  | 'uAssumed'
  | 'uRoster'
  | 'uConfirmed'
  | 'uPlanned'
  | 'shortPlan'
  | 'open';

const SUMMARY: [LayerKey, string, string][] = [
  ['uConf', 'Confirmed capacity', 'conf'],
  ['uAssumed', 'Planned, not yet secured', 'plan'],
  ['shortPlan', 'Unresolved gap', 'gap'],
  ['open', 'Spare capacity', 'spare'],
];
const COMPONENTS: [LayerKey, string, string][] = [
  ['uRoster', 'Crew on roster', 'conf'],
  ['uConfirmed', 'Secured additions', 'hire'],
  ['uPlanned', 'Planned, not yet secured', 'plan'],
  ['shortPlan', 'Unresolved gap', 'gap'],
  ['open', 'Spare capacity', 'spare'],
];
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10])
    if (m * p >= v) return m * p;
  return 10 * p;
}
function ticks(max: number) {
  let n = 4;
  for (const k of [4, 5, 3, 6]) {
    const st = max / k;
    if (max < 10 ? Number.isInteger(st * 2) : Number.isInteger(st)) {
      n = k;
      break;
    }
  }
  return Array.from({ length: n + 1 }, (_, k) => (k * max) / n);
}

export function CapacityChart({
  data,
  rows,
  units,
  horizon,
  basis,
  components,
  rate,
  workloadLabel,
  onSelect,
  selected,
}: {
  data: WorkforceSample;
  rows: Row[];
  units: Units;
  horizon: number;
  basis: Basis;
  components: boolean;
  rate: number;
  workloadLabel: string;
  onSelect: (i: number) => void;
  selected?: number;
}) {
  const id = useId().replaceAll(':', '');
  const [tip, setTip] = useState<{ j: number; x: number; y: number } | null>(
    null,
  );
  const { PAST, HPF, SHORT_TE } = data.reference.constants;
  const values = rows.slice(0, PAST + horizon);
  const cols = values.length;
  const scale = units === 'People' ? 1 / HPF : units === 'Cost' ? rate : 1;
  const unit = (h: number) =>
    units === 'People'
      ? fmt(h / HPF, 1)
      : units === 'Cost'
        ? money(h * rate)
        : fmt(h);
  const layers = components ? COMPONENTS : SUMMARY;
  const hasActual = values.slice(0, PAST).some((r) => r.actual !== undefined);
  const lineHist = (r: Row) => r.historyPlan;
  const signed = (r: Row, j: number) => (j < PAST ? lineHist(r) : r.hard);
  const withSoft = (r: Row, j: number) =>
    signed(r, j) + (j < PAST ? 0 : r.soft);
  const all = (r: Row, j: number) =>
    withSoft(r, j) + (j < PAST ? 0 : r.proposed);

  const cw = Math.max(16, 1140 / cols),
    L = units === 'Cost' ? 62 : 46,
    R = 10,
    T = 16,
    H = 300,
    B = 36,
    W = L + R + cols * cw;
  const mx = niceMax(
    Math.max(
      1,
      ...values.map((r, j) =>
        Math.max(
          r.capacity + r.shortPlan,
          r.secured + r.shortConf,
          all(r, j),
          r.actual ?? 0,
        ),
      ),
    ) *
      scale *
      1.08,
  );
  const y = (h: number) => T + H - ((h * scale) / mx) * H;
  const yv = (v: number) => T + H - (v / mx) * H;
  const step = (fn: (r: Row, j: number) => number, from: number) =>
    values
      .slice(from)
      .map((r, k) => {
        const j = k + from,
          yy = y(fn(r, j));
        return `${k ? 'L' : 'M'}${L + j * cw} ${yy} L${L + (j + 1) * cw} ${yy}`;
      })
      .join(' ');
  const anySoft = values.some((r, j) => j >= PAST && r.soft > 0.5);
  const anyProp = values.some((r, j) => j >= PAST && r.proposed > 0.5);
  const lines: [string, string][] = components
    ? [
        ...(anyProp ? ([[step(all, PAST), 'prop']] as [string, string][]) : []),
        ...(anySoft
          ? ([[step(withSoft, PAST), 'soft']] as [string, string][])
          : []),
        [step(signed, 0), 'hard'],
      ]
    : [[step(all, 0), 'hard']];
  const shortOf = (r: Row) =>
    (basis === 'confirmed' ? r.shortConf : r.shortPlan) / HPF;
  const tx = L + PAST * cw,
    bw = cw - 4;
  const t = tip ? values[tip.j] : null;

  return (
    <div className="ws-cc">
      <div className="ws-chart-scroll" onMouseLeave={() => setTip(null)}>
        <svg
          className="ws-cc-svg"
          viewBox={`0 0 ${W} ${T + H + B}`}
          style={{ minWidth: Math.round(cols * 13 + 60) }}
          role="group"
          aria-label={`Weekly labor capacity bars and workload line, ${units.toLowerCase()}. Select a week for details.`}
        >
          <defs>
            <pattern
              id={`pp-${id}`}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-45)"
            >
              <rect width="5" height="5" fill="#f4e7c9" />
              <rect width="2.2" height="5" fill="#c98a12" />
            </pattern>
            <pattern
              id={`pg-${id}`}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="5" height="5" fill="#f6d9d6" />
              <rect width="2.2" height="5" fill="#c2372d" />
            </pattern>
          </defs>
          {ticks(mx).map((tv) => (
            <g key={tv}>
              <line
                x1={L}
                x2={W - R}
                y1={yv(tv)}
                y2={yv(tv)}
                className="grid"
              />
              <text x={L - 6} y={yv(tv) + 4} className="ax" textAnchor="end">
                {units === 'Cost'
                  ? `$${fmt(tv / 1000)}K`
                  : fmt(tv, mx < 10 ? 1 : 0)}
              </text>
            </g>
          ))}
          <rect x={L} y={T} width={PAST * cw} height={H} className="past" />
          {values.map((r, j) => {
            if (j < PAST) return null;
            const g = shortOf(r);
            return g > SHORT_TE ? (
              <rect
                key={`s${r.i}`}
                x={L + j * cw}
                y={T}
                width={cw}
                height={H}
                className={`short${g >= 1 ? ' hi' : ''}`}
              />
            ) : null;
          })}
          {values.map((r, j) => {
            const x = L + j * cw + 2;
            let base = 0;
            const bars = layers.map(([f, , cls]) => {
              const v = r[f] ?? 0;
              if (v <= 0.01) return null;
              const el = (
                <rect
                  key={f}
                  x={x}
                  y={y(base + v)}
                  width={bw}
                  height={y(base) - y(base + v)}
                  className={`l-${cls}`}
                  fill={
                    cls === 'plan'
                      ? `url(#pp-${id})`
                      : cls === 'gap'
                        ? `url(#pg-${id})`
                        : undefined
                  }
                />
              );
              base += v;
              return el;
            });
            const d = new Date(r.weekStart);
            return (
              <g key={r.i}>
                <g className={j < PAST ? 'hist' : undefined}>{bars}</g>
                {j < PAST && r.actual !== undefined && (
                  <rect
                    x={x + bw * 0.2}
                    y={y(r.actual) - 1.5}
                    width={bw * 0.6}
                    height="3"
                    className="disp"
                  />
                )}
                {d.getUTCDate() <= 7 && (
                  <>
                    <line
                      x1={L + j * cw}
                      x2={L + j * cw}
                      y1={T + H}
                      y2={T + H + 5}
                      className="axl"
                    />
                    <text x={L + j * cw + 2} y={T + H + 17} className="ax">
                      {MON[d.getUTCMonth()]}
                      {d.getUTCMonth() === 0
                        ? ` ’${String(d.getUTCFullYear()).slice(2)}`
                        : ''}
                    </text>
                  </>
                )}
                {r.holiday && (
                  <circle
                    cx={L + j * cw + cw / 2}
                    cy={T + H + 28}
                    r="2.5"
                    className="hol"
                  >
                    <title>{r.holiday}</title>
                  </circle>
                )}
              </g>
            );
          })}
          {lines.map(([d], k) => (
            <path key={`h${k}`} d={d} className="wl halo" />
          ))}
          {lines.map(([d, c], k) => (
            <path key={`l${k}`} d={d} className={`wl ${c}`} />
          ))}
          <line x1={tx} x2={tx} y1={T - 6} y2={T + H} className="today" />
          <text x={tx + 4} y={T + 4} className="ax strong">
            This week
          </text>
          <text x={L + 4} y={T + 12} className="ax">
            {hasActual ? 'History · dispatched' : 'History · no timesheet feed'}
          </text>
          {values.map((r, j) =>
            selected === r.i ? (
              <rect
                key="sel"
                x={L + j * cw + 1}
                y={T}
                width={cw - 2}
                height={H}
                className="sel"
              />
            ) : null,
          )}
          {values.map((r, j) => (
            <rect
              key={`hit${r.i}`}
              x={L + j * cw}
              y={T}
              width={cw}
              height={H}
              className="hit"
              role="button"
              tabIndex={0}
              aria-label={`Week of ${r.label}: workload ${unit(all(r, j))}, confirmed ${unit(r.secured)}, short ${unit(basis === 'confirmed' ? r.shortConf : r.shortPlan)} ${units.toLowerCase()}`}
              onClick={() => onSelect(r.i)}
              onMouseMove={(e) => setTip({ j, x: e.clientX, y: e.clientY })}
              onFocus={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                setTip({ j, x: b.right, y: b.top + 40 });
              }}
              onBlur={() => setTip(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(r.i);
                }
              }}
            />
          ))}
        </svg>
      </div>
      {t && tip && (
        <div
          className="ws-cc-tip"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 250),
            top: Math.min(tip.y + 14, window.innerHeight - 260),
          }}
        >
          <b>Week of {t.label}</b>
          {t.holiday && <div className="ws-cc-tnote">{t.holiday}</div>}
          <div className="ws-cc-tsec">Workload</div>
          {tip.j < PAST ? (
            <>
              <Tr
                label="Signed work (planned)"
                v={unit(t.historyPlan)}
                sw="lk-hard"
              />
              {t.actual !== undefined && (
                <>
                  <Tr label="Dispatched" v={unit(t.actual)} sw="lk-disp" />
                  <Tr
                    label="Not worked, carried forward"
                    v={unit(Math.max(0, t.historyPlan - t.actual))}
                    cls="neg"
                  />
                </>
              )}
            </>
          ) : (
            <>
              <Tr label="Signed work" v={unit(t.hard)} sw="lk-hard" />
              {t.soft > 0.5 && (
                <Tr label="+ Soft backlog" v={unit(t.soft)} sw="lk-soft" />
              )}
              {t.proposed > 0.5 && (
                <Tr label="+ Proposed" v={unit(t.proposed)} sw="lk-prop" />
              )}
              <Tr label="Total workload" v={unit(t.demand)} cls="tot" />
            </>
          )}
          <div className="ws-cc-tsec">Labor capacity</div>
          <Tr label="Crew on roster" v={unit(t.roster)} sw="l-conf" />
          {t.secured - t.roster > 0.5 && (
            <Tr
              label="Secured additions"
              v={unit(t.secured - t.roster)}
              sw="l-hire"
            />
          )}
          {t.planned > 0.5 && (
            <Tr label="Planned, not secured" v={unit(t.planned)} sw="l-plan" />
          )}
          {tip.j >= PAST && (
            <>
              <Tr
                label="Gap, confirmed capacity"
                v={unit(t.shortConf)}
                cls={t.shortConf > 0.5 ? 'neg tot' : 'tot'}
              />
              <Tr
                label="Gap if plan succeeds"
                v={unit(t.shortPlan)}
                cls={t.shortPlan > 0.5 ? 'neg' : ''}
                sw="l-gap"
              />
              {t.open > 0.5 && (
                <Tr label="Spare capacity" v={unit(t.open)} sw="l-spare" />
              )}
              {t.shortPlan > 0.5 && t.open > 0.5 && (
                <div className="ws-cc-tnote">
                  Spare crew in one department or category isn’t counted against
                  a gap in another.
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div className="ws-cc-legend">
        <div>
          <span className="lg-h">Capacity · bars</span>
          {layers.map(([, lab, cls]) => (
            <span key={lab}>
              <i className={`sw l-${cls}`} />
              {lab}
            </span>
          ))}
        </div>
        <div>
          <span className="lg-h">
            Workload · {components ? 'lines' : 'line'}
          </span>
          {components ? (
            <>
              <span>
                <i className="sw lk-hard" />
                Signed work (BuildOps, updated with dispatch)
              </span>
              {anySoft && (
                <span>
                  <i className="sw lk-soft" />+ Soft backlog
                </span>
              )}
              {anyProp && (
                <span>
                  <i className="sw lk-prop" />+ Proposed projects
                </span>
              )}
            </>
          ) : (
            <span>
              <i className="sw lk-hard" />
              {workloadLabel}
            </span>
          )}
          {hasActual && (
            <span>
              <i className="sw lk-disp" />
              Dispatched
            </span>
          )}
          {values.some((r) => r.holiday) && (
            <span>
              <i className="sw hol" />
              Holiday week
            </span>
          )}
          <span>
            <i className="sw shk" />
            Short{' '}
            {basis === 'confirmed'
              ? 'on confirmed capacity'
              : 'if plan succeeds'}
          </span>
          <span>
            <i className="sw shk hi" />
            Short 1+ person
          </span>
        </div>
      </div>
    </div>
  );
}

function Tr({
  label,
  v,
  cls = '',
  sw,
}: {
  label: string;
  v: string;
  cls?: string;
  sw?: string;
}) {
  return (
    <div className={`ws-cc-tr ${cls}`}>
      <span>
        {sw && <i className={`sw ${sw}`} />}
        {label}
      </span>
      <span>{v}</span>
    </div>
  );
}
