import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { LABOR_CATEGORIES, MONTHS, PROJECTS } from '../data/runtimeData';
import type {
  LaborCategory,
  ScenarioConfig,
  WorkforcePlan,
} from '../domain/types';
import { actionStartDate, analyze, metrics } from '../planning/engine';
import { departmentColor, departmentShortLabel } from './departmentSelection';

const TODAY = new Date();

// Five-step ramp for the constrained-categories heat strip, matching the
// design handoff's scan coloring — a category's peak-relative severity, not
// the good/watch/critical coverage classification used elsewhere.
const RAMP = ['#FCEDED', '#F7D2D2', '#F0B0B0', '#C82F32', '#8F1416'];
function rampColor(t: number): string {
  if (t <= 0) return '';
  if (t < 0.2) return RAMP[0];
  if (t < 0.4) return RAMP[1];
  if (t < 0.62) return RAMP[2];
  if (t < 0.82) return RAMP[3];
  return RAMP[4];
}

interface PanelCategory {
  category: LaborCategory;
  peak: number;
  peakMonth: string;
  cells: { t: number; title: string }[];
}

function buildPanel(
  config: ScenarioConfig,
  department: string,
  category: LaborCategory,
) {
  const result = analyze(config, category, department);
  const m = metrics(result);
  const perCategory: PanelCategory[] = LABOR_CATEGORIES.map((cat) => {
    const r = cat === category ? result : analyze(config, cat, department);
    const peak = Math.max(...r.gap);
    const peakIndex = r.gap.indexOf(peak);
    return {
      category: cat,
      peak,
      peakMonth: MONTHS[peakIndex],
      cells: r.gap.map((g, i) => ({
        t: g > 0.05 ? g : 0,
        title: `${MONTHS[i]} — ${cat} · ${g > 0.05 ? `${g.toFixed(1)} FTE unresolved` : 'covered'}`,
      })),
    };
  });
  const constrained = perCategory
    .filter((p) => p.peak > 0.05)
    .sort((a, b) => b.peak - a.peak);
  const sharedMax = Math.max(1, ...constrained.map((p) => p.peak));
  const worst = constrained[0];
  const projects = PROJECTS.filter((p) => p.department === department).length;
  const deadlines = config.actions
    .filter(
      (a) =>
        a.category === category &&
        ['hire', 'subcontract'].includes(a.kind) &&
        !a.confirmed,
    )
    .map((a) => ({ ...a, date: actionStartDate(a) }))
    .sort((a, b) => +a.date - +b.date);
  return {
    department,
    result,
    metrics: m,
    projects,
    constrained: constrained.slice(0, 6),
    constrainedTotal: constrained.length,
    sharedMax,
    worst,
    deadlines,
  };
}

function MiniChart({ result }: { result: ReturnType<typeof analyze> }) {
  const data = MONTHS.map((month, i) => ({
    month,
    hard: result.hard[i],
    prefab: result.prefab[i],
    existing: result.existing[i],
    confirmed: result.confirmedHires[i],
    planned: result.plannedHires[i],
    subcontract: result.subcontract[i],
    overtime: result.overtime[i],
    gap: result.gap[i],
    scenario: result.scenario[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 30 }}
      >
        <CartesianGrid stroke="#efeeec" vertical={false} />
        <XAxis
          dataKey="month"
          interval={2}
          angle={-45}
          textAnchor="end"
          tick={{ fontSize: 9 }}
        />
        <YAxis tick={{ fontSize: 10 }} width={32} />
        <Bar dataKey="prefab" stackId="capacity" fill="#1f8a70" />
        <Bar dataKey="existing" stackId="capacity" fill="#8ac3ff" />
        <Bar dataKey="confirmed" stackId="capacity" fill="#009500" />
        <Bar dataKey="planned" stackId="capacity" fill="#8acc8a" />
        <Bar dataKey="subcontract" stackId="capacity" fill="#b8740b" />
        <Bar dataKey="overtime" stackId="capacity" fill="#6e4b9e" />
        <Bar dataKey="gap" stackId="capacity" fill="#fbecec" stroke="#b91d1d" />
        <Line dataKey="scenario" stroke="#8e2da8" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function DepartmentCompare({
  departments,
  category,
  config,
  plan,
  display,
  focusDepartment,
}: {
  /** Lead first, then the rest of the comparison set. */
  departments: string[];
  category: LaborCategory;
  config: ScenarioConfig;
  plan: WorkforcePlan;
  display: (v: number) => string;
  focusDepartment: (department: string) => void;
}) {
  const panels = useMemo(
    () => departments.map((d) => buildPanel(config, d, category)),
    [departments, config, category],
  );
  return (
    <>
      <section className="screen-card dept-compare-header">
        <div className="section-title">
          <div>
            <span>DEPARTMENT COMPARISON</span>
            <h2>
              {category} across {departments.length} departments · {plan.name}
            </h2>
          </div>
        </div>
        <p className="info-note">
          Each department is scoped to its own backlog and its own roster — no
          interdepartmental transfers. Metric tiles, the chart and the scan in
          each panel are that department alone. Click a department name to drop
          back to the single-department dashboard.
        </p>
      </section>
      <section className="dept-compare-strip">
        {panels.map((p, i) => (
          <article
            key={p.department}
            className={`dept-compare-strip-card${i === 0 ? ' dept-compare-lead' : ''}`}
          >
            <div className="dept-compare-strip-head">
              <span
                className="dept-picker-dot"
                style={{ background: departmentColor(i) }}
                aria-hidden="true"
              />
              <button
                type="button"
                className="text-link"
                onClick={() => focusDepartment(p.department)}
              >
                {departmentShortLabel(p.department)}
              </button>
            </div>
            <strong
              className={p.metrics.peak > 0.05 ? 'danger' : 'success'}
              style={{ fontSize: 22 }}
            >
              {display(p.metrics.peak)}
            </strong>
            <span className="dept-compare-strip-label">PEAK UNRESOLVED</span>
            <div className="dept-compare-strip-rows">
              <div>
                <span>First constrained</span>
                <b>{p.metrics.firstMonth}</b>
              </div>
              <div>
                <span>Constrained months</span>
                <b>{p.metrics.duration}</b>
              </div>
              <div>
                <span>Worst category</span>
                <b>{p.worst ? p.worst.category : 'None'}</b>
              </div>
            </div>
            <small className="dept-compare-strip-footer">
              {p.projects} {p.projects === 1 ? 'project' : 'projects'}
            </small>
          </article>
        ))}
      </section>
      {panels.map((p, i) => (
        <section className="chart-card dept-compare-panel" key={p.department}>
          <div className="dept-compare-panel-head">
            <span
              className="dept-compare-panel-accent"
              style={{ background: departmentColor(i) }}
            />
            <div>
              <h3>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => focusDepartment(p.department)}
                >
                  {departmentShortLabel(p.department)}
                </button>
              </h3>
              <p>
                {p.projects} {p.projects === 1 ? 'project' : 'projects'} ·
                roster not yet split by department
              </p>
            </div>
            <p className="dept-compare-constraint-line">
              {p.worst
                ? `${p.worst.category} is the binding constraint here, peaking at ${display(p.worst.peak)} in ${p.worst.peakMonth}.`
                : `No labor category is constrained in this department under ${plan.name}.`}
            </p>
          </div>
          <section className="metric-grid dept-compare-tiles">
            <Metric
              label="FIRST CONSTRAINED"
              value={p.metrics.firstMonth}
              tone={p.metrics.firstIndex < 0 ? 'success' : 'danger'}
            />
            <Metric
              label="PEAK UNRESOLVED"
              value={display(p.metrics.peak)}
              tone={p.metrics.peak > 0.05 ? 'danger' : 'success'}
            />
            <Metric
              label="CONSTRAINED MONTHS"
              value={String(p.metrics.duration)}
              tone=""
            />
            <Metric
              label="WORST CATEGORY"
              value={p.worst ? p.worst.category : 'None'}
              tone={p.worst ? 'danger' : 'success'}
            />
          </section>
          <MiniChart result={p.result} />
          <div className="dept-compare-scan">
            <div className="section-title">
              <span>CONSTRAINED CATEGORIES IN THIS DEPARTMENT</span>
              {p.constrainedTotal > 6 && (
                <small>
                  Showing the six worst of {p.constrainedTotal} constrained
                  categories.
                </small>
              )}
            </div>
            {p.constrained.length ? (
              p.constrained.map((c) => (
                <div className="dept-compare-scan-row" key={c.category}>
                  <span className="dept-compare-scan-name">{c.category}</span>
                  <div className="dept-compare-scan-cells">
                    {c.cells.map((cell, idx) => (
                      <span
                        key={idx}
                        title={cell.title}
                        style={{
                          background:
                            rampColor(cell.t / p.sharedMax) || 'transparent',
                        }}
                      />
                    ))}
                  </div>
                  <span className="dept-compare-scan-peak">
                    {display(c.peak)}
                    <small>{c.peakMonth}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="info-note">
                No labor category is constrained in this department.
              </p>
            )}
          </div>
          <div className="dept-compare-deadlines">
            <span className="field-label">CAPACITY ACTION DEADLINES</span>
            {p.deadlines.length ? (
              p.deadlines.map((d) => (
                <div className="deadline" key={d.id}>
                  <div>
                    <i className={d.date < TODAY ? 'red' : ''} />
                    <strong>
                      {d.kind === 'hire'
                        ? 'Begin recruiting'
                        : 'Begin subcontract sourcing'}{' '}
                      — {d.quantity} FTE
                    </strong>
                  </div>
                  <b className={d.date < TODAY ? 'red' : ''}>
                    {d.date < TODAY ? 'OVERDUE · ' : ''}
                    {d.date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </b>
                </div>
              ))
            ) : (
              <p className="info-note">
                No capacity action is planned for {category} in this department.
              </p>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </article>
  );
}
