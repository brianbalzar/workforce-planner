import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  HelpCircle,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DEPARTMENTS,
  LABOR_CATEGORIES,
  MONTHS,
  PROJECTS,
} from '../data/sampleData';
import type {
  CapacityAction,
  LaborCategory,
  PlanStatus,
  Project,
  ScenarioConfig,
  StaffingCurve,
  Unit,
  WorkforcePlan,
  WorkPackage,
} from '../domain/types';
import {
  actionMilestones,
  actionStartDate,
  analyze,
  datePosition,
  formatDate,
  formatValue,
  metrics,
  recommendations,
  validateWorkPackages,
} from '../planning/engine';
import { loadPlans, resetPlans, savePlans } from '../persistence/planStore';

type Tab =
  | 'dashboard'
  | 'projects'
  | 'scenario'
  | 'capacity'
  | 'plans'
  | 'help';
type Modal = null | 'proposed' | 'action' | 'compare';
const TODAY = new Date(Date.UTC(2026, 8, 2));
const tabList: [Tab, string][] = [
  ['dashboard', 'Bottleneck Dashboard'],
  ['projects', 'Projects & Forecasts'],
  ['scenario', 'Scenario Builder'],
  ['capacity', 'Workforce Capacity'],
  ['plans', 'Saved Plans'],
  ['help', 'Help'],
];
const clone = <T,>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function App() {
  const [plans, setPlans] = useState<WorkforcePlan[]>(() => loadPlans());
  const initial = plans.find((p) => p.id === 'growth') || plans[0];
  const [planId, setPlanId] = useState(initial.id);
  const [saved, setSaved] = useState<ScenarioConfig>(() =>
    clone(initial.config),
  );
  const [live, setLive] = useState<ScenarioConfig>(() => clone(initial.config));
  const [undo, setUndo] = useState<ScenarioConfig[]>([]);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [category, setCategory] = useState<LaborCategory>('Plumber');
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [unit, setUnit] = useState<Unit>('People');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<Project | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [actionDraft, setActionDraft] = useState<CapacityAction | null>(null);
  const [modalSnapshot, setModalSnapshot] = useState<ScenarioConfig | null>(
    null,
  );
  const [step, setStep] = useState(4);
  const [compareIds, setCompareIds] = useState<string[]>(['current', 'growth']);
  const [toast, setToast] = useState('');
  const plan = plans.find((p) => p.id === planId) || plans[0];
  const result = useMemo(() => analyze(live, category), [live, category]);
  const summary = useMemo(() => metrics(result), [result]);
  const savedResult = useMemo(
    () => analyze(saved, category),
    [saved, category],
  );
  const dirty = !same(live, saved);
  const assumptions = live.capacity[category];
  const display = (value: number) =>
    formatValue(
      value,
      unit,
      assumptions.productiveHours,
      assumptions.hourlyRate,
    );

  useEffect(() => {
    savePlans(plans);
  }, [plans]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  const mutate = (fn: (draft: ScenarioConfig) => void) => {
    setUndo((history) => [clone(live), ...history].slice(0, 25));
    setLive((current) => {
      const next = clone(current);
      fn(next);
      return next;
    });
  };
  const choosePlan = (id: string) => {
    const next = plans.find((p) => p.id === id);
    if (!next) return;
    setPlanId(id);
    setLive(clone(next.config));
    setSaved(clone(next.config));
    setUndo([]);
    setSelectedMonth(null);
  };
  const saveCurrent = () => {
    setPlans((items) =>
      items.map((p) =>
        p.id === planId
          ? { ...p, config: clone(live), updatedDate: 'Sep 2, 2026' }
          : p,
      ),
    );
    setSaved(clone(live));
    setUndo([]);
    setToast(`“${plan.name}” saved.`);
  };
  const saveAsNewPlan = (name: string) => {
    const id = `plan-${Date.now()}`;
    const created: WorkforcePlan = {
      id,
      name,
      status: 'Draft',
      department: plan.department,
      owner: plan.owner,
      description: `Saved from “${plan.name}” in the Scenario Builder.`,
      sourceDate: plan.sourceDate,
      updatedDate: 'Sep 2, 2026',
      config: clone(live),
    };
    setPlans((items) => [...items, created]);
    setPlanId(id);
    setSaved(clone(live));
    setUndo([]);
    setToast(`“${name}” created.`);
  };
  const openProposed = () => {
    setModalSnapshot(clone(live));
    setModal('proposed');
  };
  const openNewAction = (kind: CapacityAction['kind']) => {
    const draft: CapacityAction = {
      id: `action-${Date.now()}`,
      kind,
      category,
      quantity: kind === 'overtime' ? 1 : 2,
      fromIndex: Math.max(0, summary.firstIndex),
      toIndex: Math.min(17, Math.max(0, summary.firstIndex) + 3),
      status: 'Proposed',
      confirmed: false,
      notes: 'Added in scenario preview.',
      sourceType: 'External',
      hourlyRate: assumptions.hourlyRate,
      cost: Math.round(assumptions.hourlyRate * 1.55),
      costBasis: 'per hour',
      leadDays: {
        recruit: assumptions.recruitDays,
        interview: assumptions.interviewDays,
        offer: assumptions.offerDays,
        onboard: assumptions.onboardingDays,
        ramp: assumptions.rampDays,
        source: assumptions.subcontractSourceDays,
        vet: assumptions.subcontractVettingDays,
        mobilize: assumptions.subcontractMobilizationDays,
      },
    };
    setModalSnapshot(clone(live));
    mutate((c) => c.actions.push(draft));
    setActionDraft(draft);
    setModal('action');
  };
  const updateAction = (next: CapacityAction) => {
    setActionDraft(next);
    setLive((c) => ({
      ...c,
      actions: c.actions.map((a) => (a.id === next.id ? next : a)),
    }));
  };

  return (
    <div className="app-shell">
      <div className="status-strip">
        <div>
          <strong>UPCHURCH</strong>
          <span />
          WORKFORCE PLANNER
        </div>
        <div className="sample">
          <i />
          PROTOTYPE — SAMPLE DATA ONLY
        </div>
      </div>
      <header className="page-header">
        <div>
          <h1>{tab === 'help' ? 'Help & Pilot Guide' : 'Workforce Planner'}</h1>
          <p>
            {tab === 'help'
              ? 'Learn the workflow, calculations and visual language'
              : '18-month bottleneck analysis and execution planning'}
          </p>
        </div>
        <div className="header-actions">
          <button
            onClick={() => {
              setTab('plans');
              setModal('compare');
            }}
          >
            COMPARE PLANS
          </button>
          <button className="primary" onClick={openProposed}>
            ADD PROPOSED PROJECT
          </button>
        </div>
      </header>
      <nav className="tabs" aria-label="Primary navigation">
        {tabList.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {key === 'help' && <HelpCircle size={14} />} {label}
          </button>
        ))}
      </nav>
      {['dashboard', 'projects', 'scenario'].includes(tab) && (
        <ControlBar
          department={department}
          setDepartment={setDepartment}
          category={category}
          setCategory={setCategory}
          unit={unit}
          setUnit={setUnit}
          plans={plans}
          planId={planId}
          choosePlan={choosePlan}
          dirty={dirty}
          undo={() => {
            const previous = undo[0];
            if (previous) {
              setLive(previous);
              setUndo((h) => h.slice(1));
            }
          }}
          reset={() => {
            setLive(clone(saved));
            setUndo([]);
          }}
          save={saveCurrent}
        />
      )}
      <main className={tab === 'help' ? 'help-main' : ''}>
        {tab === 'dashboard' && (
          <Dashboard
            result={result}
            summary={summary}
            display={display}
            unit={unit}
            selectedMonth={selectedMonth}
            setSelectedMonth={setSelectedMonth}
            plan={plan}
            category={category}
            actions={live.actions}
            dirty={dirty}
            savedScenario={savedResult.scenario}
          />
        )}
        {tab === 'projects' && (
          <Projects
            config={live}
            mutate={mutate}
            display={display}
            drawer={drawer}
            setDrawer={setDrawer}
            openProposed={openProposed}
          />
        )}
        {tab === 'scenario' && (
          <Scenario
            step={step}
            setStep={setStep}
            plans={plans}
            planId={planId}
            choosePlan={choosePlan}
            config={live}
            mutate={mutate}
            result={result}
            summary={summary}
            display={display}
            openProposed={openProposed}
            openNewAction={openNewAction}
            editAction={(action) => {
              setActionDraft(action);
              setModalSnapshot(clone(live));
              setModal('action');
            }}
            save={saveCurrent}
            saveAsNew={saveAsNewPlan}
            cancel={() => {
              setLive(clone(saved));
              setUndo([]);
            }}
          />
        )}
        {tab === 'capacity' && (
          <Capacity
            config={live}
            category={category}
            setCategory={setCategory}
            mutate={mutate}
          />
        )}
        {tab === 'plans' && (
          <Plans
            plans={plans}
            setPlans={setPlans}
            open={choosePlan}
            setTab={setTab}
            compareIds={compareIds}
            setCompareIds={setCompareIds}
            openCompare={() => setModal('compare')}
            toast={toast}
            setToast={setToast}
          />
        )}
        {tab === 'help' && <Help setTab={setTab} openProposed={openProposed} />}
      </main>
      {drawer && (
        <ProjectDrawer
          project={drawer}
          config={live}
          mutate={mutate}
          display={display}
          close={() => setDrawer(null)}
        />
      )}
      {modal === 'proposed' && (
        <ProposedModal
          config={live}
          setLive={setLive}
          result={result}
          category={category}
          display={display}
          close={(discard) => {
            if (discard && modalSnapshot) setLive(modalSnapshot);
            setModal(null);
            setModalSnapshot(null);
          }}
        />
      )}
      {modal === 'action' && actionDraft && (
        <ActionModal
          action={actionDraft}
          update={updateAction}
          close={(discard) => {
            if (discard && modalSnapshot) setLive(modalSnapshot);
            setModal(null);
            setActionDraft(null);
            setModalSnapshot(null);
          }}
        />
      )}
      {modal === 'compare' && (
        <CompareModal
          plans={plans.filter((p) => compareIds.includes(p.id))}
          category={category}
          close={() => setModal(null)}
        />
      )}
      {toast && <output className="toast">{toast}</output>}
    </div>
  );
}

function ControlBar(p: {
  department: string;
  setDepartment: (v: string) => void;
  category: LaborCategory;
  setCategory: (v: LaborCategory) => void;
  unit: Unit;
  setUnit: (v: Unit) => void;
  plans: WorkforcePlan[];
  planId: string;
  choosePlan: (v: string) => void;
  dirty: boolean;
  undo: () => void;
  reset: () => void;
  save: () => void;
}) {
  return (
    <section className="controls">
      <Field label="DEPARTMENT">
        <select
          value={p.department}
          onChange={(e) => p.setDepartment(e.target.value)}
        >
          {DEPARTMENTS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="LABOR CATEGORY">
        <select
          value={p.category}
          onChange={(e) => p.setCategory(e.target.value as LaborCategory)}
        >
          {LABOR_CATEGORIES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="PLANNING WINDOW">
        <input readOnly value="Sep 2026 — Feb 2028 · rolling 18 months" />
      </Field>
      <div className="unit-control">
        <span>VIEW AS</span>
        <div>
          {(['People', 'Hours', 'Labor Cost'] as Unit[]).map((v) => (
            <button
              key={v}
              className={p.unit === v ? 'on' : ''}
              onClick={() => p.setUnit(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <Field label="PLAN">
        <select value={p.planId} onChange={(e) => p.choosePlan(e.target.value)}>
          {p.plans
            .filter((x) => x.status !== 'Archived')
            .map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
        </select>
      </Field>
      {p.dirty && (
        <div className="dirty">
          <strong>PREVIEWING UNSAVED CHANGES</strong>
          <button onClick={p.undo}>Undo</button>
          <button onClick={p.reset}>Cancel preview</button>
          <button onClick={p.save}>Save plan</button>
        </div>
      )}
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function Metric({
  label,
  value,
  detail,
  tone = '',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Dashboard({
  result,
  summary,
  display,
  unit,
  selectedMonth,
  setSelectedMonth,
  plan,
  category,
  actions,
  dirty,
  savedScenario,
}: {
  result: ReturnType<typeof analyze>;
  summary: ReturnType<typeof metrics>;
  display: (v: number) => string;
  unit: Unit;
  selectedMonth: number | null;
  setSelectedMonth: (v: number | null) => void;
  plan: WorkforcePlan;
  category: LaborCategory;
  actions: CapacityAction[];
  dirty: boolean;
  savedScenario: number[];
}) {
  const data = MONTHS.map((month, i) => ({
    month,
    hard: result.hard[i],
    expected: result.expected[i],
    scenario: result.scenario[i],
    existing: result.existing[i],
    confirmed: result.confirmedHires[i],
    planned: result.plannedHires[i],
    subcontract: result.subcontract[i],
    overtime: result.overtime[i],
    gap: result.gap[i],
    ghost: savedScenario[i],
  }));
  const recs = recommendations(result);
  const hires = actions
    .filter((a) => a.kind === 'hire')
    .reduce((s, a) => s + a.quantity, 0);
  const subPeak = Math.max(
    0,
    ...actions.filter((a) => a.kind === 'subcontract').map((a) => a.quantity),
  );
  const deadlines = actions
    .filter((a) => ['hire', 'subcontract'].includes(a.kind) && !a.confirmed)
    .map((a) => ({ ...a, date: actionStartDate(a) }))
    .sort((a, b) => +a.date - +b.date);
  const overdue = deadlines.filter((d) => d.date < TODAY);
  const nextDeadline = deadlines.find((d) => d.date >= TODAY);
  const convert = (v: number) =>
    unit === 'People' ? v : unit === 'Hours' ? v * 148 : v * 148 * 92;
  const chartData = data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        k === 'month' ? v : convert(v as number),
      ]),
    ),
  );
  return (
    <>
      <section className="metric-grid">
        <Metric
          label="FIRST CONSTRAINED MONTH"
          value={summary.firstMonth}
          tone="danger"
          detail="Scenario workload first exceeds executable capacity here."
        />
        <Metric
          label="PEAK SHORTAGE VS EXISTING"
          value={display(summary.peakVsExisting)}
          detail={`In ${summary.peakVsExistingMonth}, against ${summary.existingAtPeakVsExisting.toFixed(1)} existing internal FTE.`}
        />
        <Metric
          label="PEAK UNRESOLVED GAP"
          value={display(summary.peak)}
          tone="danger"
          detail={`In ${summary.peakMonth}, after all planned capacity.`}
        />
        <Metric
          label="BOTTLENECK DURATION"
          value={`${summary.duration} months`}
          detail={`${summary.personMonths.toFixed(0)} unresolved person-months`}
        />
        <Metric
          label="PERMANENT HIRES IN PLAN"
          value={`${hires}`}
          tone="success"
          detail="Confirmed and planned additions."
        />
        <Metric
          label="TEMPORARY CAPACITY REQUIRED"
          value={`${subPeak} peak`}
          tone="warning"
          detail={`${summary.subcontractPersonMonths.toFixed(0)} subcontract person-months across the window.`}
        />
        <Metric
          label="NEXT ACTION DEADLINE"
          value={nextDeadline ? formatDate(nextDeadline.date) : 'None'}
          detail={`${overdue.length} ${overdue.length === 1 ? 'action' : 'actions'} past the start date.`}
        />
        <Metric
          label="PLAN STATUS / CONFIDENCE"
          value={summary.confidence}
          tone={
            summary.confidence === 'Executable'
              ? 'success'
              : summary.confidence === 'Conditional'
                ? 'warning'
                : 'danger'
          }
          detail={`${plan.name} · ${plan.status} · ${summary.unconfirmedPeak.toFixed(1)} FTE unconfirmed at peak.`}
        />
      </section>
      <section className="chart-card">
        <div className="card-heading">
          <div>
            <span>DEMAND VERSUS EXECUTABLE CAPACITY</span>
            <h2>
              {category} — Mechanical — Metro · {plan.name}
            </h2>
          </div>
          <ChartLegend />
        </div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={430}>
            <ComposedChart
              data={chartData}
              margin={{ top: 22, right: 24, left: 10, bottom: 48 }}
              onClick={(state) => {
                if (state?.activeTooltipIndex != null)
                  setSelectedMonth(Number(state.activeTooltipIndex));
              }}
            >
              <defs>
                <pattern
                  id="plannedHatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="#8acc8a" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="#009500"
                    strokeWidth="1"
                  />
                </pattern>
                <pattern
                  id="gapHatch"
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="#fbecec" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="#b91d1d"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <CartesianGrid stroke="#efeeec" vertical />
              <XAxis
                dataKey="month"
                interval={0}
                angle={-45}
                textAnchor="end"
                tick={(props) => {
                  const constrained = result.gap[props.index] > 0.05;
                  return (
                    <Text
                      {...props}
                      fontSize={10}
                      fontWeight={constrained ? 700 : 400}
                      fill={constrained ? '#b91d1d' : '#6e6c68'}
                    >
                      {props.payload.value}
                    </Text>
                  );
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) =>
                  unit === 'Labor Cost'
                    ? `$${Math.round(v / 1000)}k`
                    : unit === 'Hours'
                      ? `${Math.round(v / 1000)}k`
                      : v
                }
              />
              <Tooltip
                content={<PlannerTooltip result={result} display={display} />}
              />
              <ReferenceLine
                x="Sep 2026"
                stroke="#161514"
                strokeDasharray="3 3"
                label={{ value: 'TODAY', position: 'top', fontSize: 9 }}
              />
              <Bar dataKey="existing" stackId="capacity" fill="#8ac3ff" />
              <Bar dataKey="confirmed" stackId="capacity" fill="#009500" />
              <Bar
                dataKey="planned"
                stackId="capacity"
                fill="url(#plannedHatch)"
              />
              <Bar dataKey="subcontract" stackId="capacity" fill="#b8740b" />
              <Bar dataKey="overtime" stackId="capacity" fill="#6e4b9e" />
              <Bar
                dataKey="gap"
                stackId="capacity"
                fill="url(#gapHatch)"
                stroke="#b91d1d"
              />
              {dirty && (
                <Line
                  dataKey="ghost"
                  name="Saved plan (previewing unsaved changes)"
                  stroke="#8e2da8"
                  strokeOpacity={0.16}
                  strokeWidth={4}
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              )}
              <Line
                dataKey="hard"
                stroke="#000"
                dot={false}
                strokeWidth={2.2}
              />
              <Line
                dataKey="expected"
                stroke="#0068cc"
                dot={false}
                strokeDasharray="7 4"
                strokeWidth={2.2}
              />
              <Line
                dataKey="scenario"
                stroke="#8e2da8"
                dot={false}
                strokeWidth={2.8}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      {selectedMonth !== null && (
        <MonthDetail
          index={selectedMonth}
          result={result}
          display={display}
          close={() => setSelectedMonth(null)}
        />
      )}
      <Timeline actions={actions} />
      <div className="summary-grid">
        <section className="black-card">
          <span>WHAT THIS PLAN REQUIRES</span>
          <h2>
            {plan.name} creates a {category.toLowerCase()} shortage beginning in{' '}
            {summary.firstMonth}, peaking at {display(summary.peak)} unresolved
            in {summary.peakMonth} after every planned action is counted.
          </h2>
          {deadlines.map((d) => (
            <div className="deadline" key={d.id}>
              <div>
                <i className={d.date < TODAY ? 'red' : ''} />
                <strong>
                  {d.kind === 'hire'
                    ? 'Begin recruiting'
                    : 'Begin subcontract sourcing'}{' '}
                  — {d.quantity} FTE
                </strong>
                <small>{d.notes}</small>
              </div>
              <b className={d.date < TODAY ? 'red' : ''}>
                {d.date < TODAY ? 'OVERDUE · ' : ''}
                {formatDate(d.date)}
              </b>
            </div>
          ))}
        </section>
        <section className="recommend-card">
          <span>RECOMMENDATIONS — RULE-BASED, NOT A MANAGEMENT DECISION</span>
          {recs.length ? (
            recs.map((r, i) => (
              <article className={r.mode} key={i}>
                <strong>{r.title}</strong>
                <p>
                  <b>Why:</b> {r.why}
                </p>
                <small>
                  Need begins {MONTHS[r.start]}. Add or edit an action to
                  override this recommendation.
                </small>
              </article>
            ))
          ) : (
            <p>
              No action required. Scenario workload stays within executable
              capacity.
            </p>
          )}
          <footer>
            Rules favor hiring for sustained gaps, subcontracting for short
            peaks, and overtime for small one-month gaps. Management retains the
            decision.
          </footer>
        </section>
      </div>
    </>
  );
}
function ChartLegend() {
  return (
    <div className="legend">
      <div className="legend-lines">
        <span className="line-hard">Hard backlog</span>
        <span className="line-expected">Expected workload</span>
        <span className="line-scenario">Scenario workload</span>
      </div>
      <div className="legend-capacity">
        <span className="sw-existing">Existing</span>
        <span className="sw-confirmed">Confirmed hires</span>
        <span className="sw-planned">Planned / unconfirmed</span>
        <span className="sw-subcontract">Subcontract</span>
        <span className="sw-overtime">Overtime</span>
        <span className="sw-gap">Unresolved gap</span>
      </div>
    </div>
  );
}
function PlannerTooltip({
  active,
  label,
  result,
  display,
}: {
  active?: boolean;
  label?: string;
  result: ReturnType<typeof analyze>;
  display: (v: number) => string;
}) {
  const i = label ? MONTHS.indexOf(label) : -1;
  if (!active || i < 0) return null;
  const rows: Array<[string, number, string, boolean?]> = [
    ['Hard backlog', result.hard[i], '#000'],
    ['Expected workload', result.expected[i], '#0068cc'],
    ['Proposed contribution', result.proposed[i], '#8e2da8'],
    ['Scenario workload', result.scenario[i], '#8e2da8', true],
    ['Existing capacity', result.existing[i], '#8ac3ff'],
    ['Confirmed additions', result.confirmedHires[i], '#009500'],
    ['Planned / unconfirmed', result.unconfirmed[i], '#b8740b'],
  ];
  const gap = result.gap[i];
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {rows.map(([name, value, color, bold]) => (
        <div key={name} className={bold ? 'bold' : ''}>
          <span>{name}</span>
          <b style={{ color }}>{display(value)}</b>
        </div>
      ))}
      <div className="bold">
        <span>Remaining gap</span>
        <b className={gap > 0.05 ? 'red' : 'green'}>{display(gap)}</b>
      </div>
      {result.drivers[i].length > 0 && (
        <>
          <small className="tooltip-heading">PROJECTS DRIVING DEMAND</small>
          {result.drivers[i].slice(0, 4).map((d) => (
            <div key={d.name}>
              <span>{d.name}</span>
              <b>{display(d.fte)}</b>
            </div>
          ))}
        </>
      )}
      <small>Click the month for full detail</small>
    </div>
  );
}
function MonthDetail({
  index,
  result,
  display,
  close,
}: {
  index: number;
  result: ReturnType<typeof analyze>;
  display: (v: number) => string;
  close: () => void;
}) {
  const rows = [
    ['Existing internal', result.existing[index], '#8ac3ff'],
    ['Confirmed hires', result.confirmedHires[index], '#009500'],
    ['Planned hires', result.plannedHires[index], '#8acc8a'],
    ['Subcontract', result.subcontract[index], '#b8740b'],
    ['Overtime', result.overtime[index], '#6e4b9e'],
    ['Total executable', result.total[index], '#161514'],
    ['Unresolved gap', result.gap[index], '#b91d1d'],
  ] as const;
  return (
    <section className="month-detail">
      <header>
        <h2>
          {MONTHS[index]} —{' '}
          {result.gap[index] > 0.05
            ? `unresolved gap of ${display(result.gap[index])}`
            : 'covered by planned capacity'}
        </h2>
        <button onClick={close}>
          <X size={16} /> Close
        </button>
      </header>
      <div>
        <article>
          <h3>Projects driving demand</h3>
          {result.drivers[index].map((d) => (
            <div className="detail-row" key={d.name}>
              <span>
                <strong>{d.name}</strong>
                <small>{d.type}</small>
              </span>
              <b>{display(d.fte)}</b>
            </div>
          ))}
        </article>
        <article>
          <h3>Capacity bridge</h3>
          {rows.map(([name, value, color]) => (
            <div className="detail-row" key={name}>
              <span>
                <i style={{ background: color }} />
                {name}
              </span>
              <b>{display(value)}</b>
            </div>
          ))}
          <p>
            Lead times make the responsible decision date earlier than the month
            shown.
          </p>
        </article>
      </div>
    </section>
  );
}
function Timeline({ actions }: { actions: CapacityAction[] }) {
  const pct = (d: Date) =>
    Math.min(100, Math.max(0, (datePosition(d) / 18) * 100));
  return (
    <section className="timeline-card">
      <div className="card-heading">
        <div>
          <span>ACTION WORKFLOW TIMELINE</span>
          <h2>What must happen before capacity is productive</h2>
        </div>
      </div>
      <div className="timeline-months">
        <b>CAPACITY ACTION</b>
        {MONTHS.map((m) => (
          <span key={m}>{m.slice(0, 3)}</span>
        ))}
      </div>
      {actions.map((action) => {
        const timeline = actionMilestones(action);
        const overdue = !action.confirmed && actionStartDate(action) < TODAY;
        if (!timeline) {
          const start = Math.max(0, action.fromIndex);
          const width = Math.max(1, action.toIndex + 1 - start);
          return (
            <div className="timeline-row" key={action.id}>
              <div>
                <strong>
                  {action.quantity} {action.category}
                </strong>
                <small>
                  {action.kind} · {action.status}
                </small>
              </div>
              <div className="timeline-grid">
                {MONTHS.map((_, i) => (
                  <i key={i} />
                ))}
                <span
                  className={`timeline-bar ${action.kind}`}
                  style={{
                    gridColumn: `${start + 1} / span ${Math.min(width, 18 - start)}`,
                  }}
                >
                  Active period
                </span>
              </div>
            </div>
          );
        }
        const productiveEndPct = timeline.productiveEnd
          ? pct(timeline.productiveEnd)
          : 100;
        return (
          <div className="timeline-row" key={action.id}>
            <div>
              <strong>
                {action.quantity} {action.category}
              </strong>
              <small>
                {action.kind} · {action.status}
              </small>
            </div>
            <div className="timeline-grid">
              {MONTHS.map((_, i) => (
                <i key={i} />
              ))}
              {overdue && (
                <span className="timeline-overdue-label">
                  OVERDUE · WAS DUE {formatDate(actionStartDate(action))}
                </span>
              )}
              {timeline.phases.map((phase, i) => {
                const left = pct(phase.start);
                const right = pct(phase.end);
                return (
                  <span
                    key={phase.label}
                    className={`phase phase-${i} ${action.kind === 'subcontract' ? 'subcontract' : ''}`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(right - left, 0.3)}%`,
                    }}
                    title={`${phase.label}: ${formatDate(phase.start)} – ${formatDate(phase.end)}`}
                  />
                );
              })}
              <span
                className={`productive-segment ${action.confirmed ? '' : 'planned'}`}
                style={{
                  left: `${pct(timeline.productiveStart)}%`,
                  width: `${Math.max(productiveEndPct - pct(timeline.productiveStart), 0.3)}%`,
                }}
                title="Productive"
              />
              {timeline.milestones.map((ms) => (
                <span
                  key={ms.label}
                  className={`milestone ${ms.date < TODAY && !action.confirmed && !ms.final ? 'overdue' : ''} ${ms.final ? 'final' : ''}`}
                  style={{ left: `${pct(ms.date)}%` }}
                  title={`${ms.label}: ${formatDate(ms.date)}`}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Projects({
  config,
  mutate,
  display,
  drawer,
  setDrawer,
  openProposed,
}: {
  config: ScenarioConfig;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
  display: (v: number) => string;
  drawer: Project | null;
  setDrawer: (p: Project | null) => void;
  openProposed: () => void;
}) {
  return (
    <section className="screen-card">
      <div className="section-title">
        <div>
          <span>PROJECT DEMAND INPUTS</span>
          <h2>Backlog and opportunity forecasts feeding this plan</h2>
          <p>
            {PROJECTS.length} backlog projects · 1 proposed scenario project
          </p>
        </div>
        <button
          onClick={() =>
            mutate((c) => {
              PROJECTS.forEach((p) => {
                c.probabilities[p.id] = p.planningProbability;
                c.shifts[p.id] = 0;
                c.included[p.id] = true;
              });
            })
          }
        >
          <RotateCcw size={14} /> RESTORE ALL BASELINES
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>IN</th>
              <th>PROJECT</th>
              <th>TYPE</th>
              <th>VALUE</th>
              <th>PLANNING PROBABILITY</th>
              <th>SOURCE</th>
              <th>EXPECTED START</th>
              <th>PEAK</th>
              <th>FORECAST</th>
              <th>SCENARIO</th>
            </tr>
          </thead>
          <tbody>
            {PROJECTS.map((p) => {
              const prob = config.probabilities[p.id] ?? p.planningProbability,
                shift = config.shifts[p.id] || 0,
                peak = Math.max(...p.curve);
              return (
                <tr
                  key={p.id}
                  className={config.included[p.id] === false ? 'excluded' : ''}
                >
                  <td>
                    <CheckButton
                      checked={config.included[p.id] !== false}
                      onClick={() =>
                        mutate((c) => {
                          c.included[p.id] = c.included[p.id] === false;
                        })
                      }
                    />
                  </td>
                  <td>
                    <button className="text-link" onClick={() => setDrawer(p)}>
                      {p.name}
                    </button>
                    <small>
                      {p.department} · {p.primaryLabor}
                    </small>
                  </td>
                  <td>{p.type}</td>
                  <td className="num">${p.value.toFixed(1)}M</td>
                  <td>
                    {p.type === 'Hard' ? (
                      <b>100% — awarded</b>
                    ) : (
                      <div className="probability">
                        <input
                          aria-label={`${p.name} probability`}
                          type="range"
                          min="0"
                          max="100"
                          step="5"
                          value={prob}
                          onChange={(e) =>
                            mutate((c) => {
                              c.probabilities[p.id] = +e.target.value;
                            })
                          }
                        />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={prob}
                          onChange={(e) =>
                            mutate((c) => {
                              c.probabilities[p.id] = Math.max(
                                0,
                                Math.min(100, +e.target.value),
                              );
                            })
                          }
                        />
                        <div>
                          {[0, 25, 50, 75, 100].map((v) => (
                            <button
                              className={prob === v ? 'on' : ''}
                              key={v}
                              onClick={() =>
                                mutate((c) => {
                                  c.probabilities[p.id] = v;
                                })
                              }
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>{p.sourceProbability}%</td>
                  <td>
                    <div className="stepper">
                      <button
                        onClick={() =>
                          mutate((c) => {
                            c.shifts[p.id] = (c.shifts[p.id] || 0) - 1;
                          })
                        }
                      >
                        <ChevronLeft />
                      </button>
                      <span>
                        {
                          MONTHS[
                            Math.max(0, Math.min(17, p.startIndex + shift))
                          ]
                        }
                      </span>
                      <button
                        onClick={() =>
                          mutate((c) => {
                            c.shifts[p.id] = (c.shifts[p.id] || 0) + 1;
                          })
                        }
                      >
                        <ChevronRight />
                      </button>
                    </div>
                    {shift !== 0 && (
                      <small>
                        {shift > 0 ? '+' : ''}
                        {shift} mo shift · curve preserved
                      </small>
                    )}
                  </td>
                  <td className="num">
                    <b>{display(peak)}</b>
                  </td>
                  <td>
                    {p.method}
                    <small
                      className={
                        p.quality.startsWith('Review') ? 'warning' : 'success'
                      }
                    >
                      {p.quality}
                    </small>
                  </td>
                  <td>
                    {prob !== p.planningProbability || shift !== 0 ? (
                      <b className="warning">OVERRIDDEN</b>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="proposed-row">
              <td>
                <CheckButton
                  checked={config.proposedIncluded}
                  onClick={() =>
                    mutate((c) => {
                      c.proposedIncluded = !c.proposedIncluded;
                    })
                  }
                />
              </td>
              <td>
                <button className="text-link magenta" onClick={openProposed}>
                  {config.proposed.name}
                </button>
                <small>{config.proposed.department}</small>
              </td>
              <td>Proposed</td>
              <td>${config.proposed.value.toFixed(1)}M</td>
              <td>100% when included</td>
              <td>Scenario only</td>
              <td>{MONTHS[config.proposed.startIndex]}</td>
              <td>{display(10)}</td>
              <td>{config.proposed.staffingCurve}</td>
              <td>
                <button className="magenta-button" onClick={openProposed}>
                  EDIT
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {drawer && null}
    </section>
  );
}
function CheckButton({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`check ${checked ? 'checked' : ''}`}
      onClick={onClick}
      aria-label={checked ? 'Exclude' : 'Include'}
    >
      {checked && <Check size={13} />}
    </button>
  );
}

function ProjectDrawer({
  project,
  config,
  mutate,
  display,
  close,
}: {
  project: Project;
  config: ScenarioConfig;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
  display: (v: number) => string;
  close: () => void;
}) {
  const prob =
    project.type === 'Hard'
      ? 100
      : (config.probabilities[project.id] ?? project.planningProbability);
  return (
    <div
      className="overlay drawer-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside className="drawer">
        <header>
          <span>PROJECT FORECAST · {project.type}</span>
          <h2>{project.name}</h2>
          <p>
            ${project.value.toFixed(1)}M · {project.department}
          </p>
          <button onClick={close}>
            <X /> Close
          </button>
        </header>
        <div className="drawer-body">
          <div className="fact-grid">
            <Metric
              label="PLANNING PROBABILITY"
              value={`${prob}%`}
              detail="Scenario-specific"
            />
            <Metric
              label="SOURCE PROBABILITY"
              value={`${project.sourceProbability}%`}
              detail="Read-only source"
            />
            <Metric
              label="FORECAST SOURCE"
              value={project.method}
              detail="Baseline method"
            />
            <Metric
              label="CONFIDENCE"
              value={project.quality}
              detail="Forecast health"
            />
          </div>
          <div className="drawer-cols">
            <section>
              <h3>Contract cost mix</h3>
              {Object.entries(project.costMix).map(([k, v]) => (
                <div className="detail-row" key={k}>
                  <span>
                    {k.replace(/[A-Z]/g, (m) => ` ${m}`).toLowerCase()}
                  </span>
                  <b>{v}%</b>
                </div>
              ))}
            </section>
            <section>
              <h3>Internal labor allocation</h3>
              {Object.entries(project.laborAllocation).map(([k, v]) => (
                <div key={k} className="allocation">
                  <span>{k}</span>
                  <b>{v}%</b>
                  <i>
                    <em style={{ width: `${v}%` }} />
                  </i>
                </div>
              ))}
            </section>
          </div>
          {project.workPackages && (
            <section>
              <h3>Work packages — rolled into parent exactly once</h3>
              {project.workPackages.map((w) => (
                <div className="package-line" key={w.id}>
                  <CheckButton
                    checked={config.packageIncluded[w.id] ?? w.included}
                    onClick={() =>
                      mutate((c) => {
                        c.packageIncluded[w.id] = !(
                          c.packageIncluded[w.id] ?? w.included
                        );
                      })
                    }
                  />
                  <span>
                    <strong>{w.name}</strong>
                    <small>
                      {w.valuePercent}% of parent · {w.execution}
                    </small>
                  </span>
                  <b>{display(Math.max(...w.curve))} peak</b>
                </div>
              ))}
              <p className="info-note">
                Package curves replace—not add to—the parent curve, preventing
                double-counting.
              </p>
            </section>
          )}
          <section>
            <h3>Monthly forecast</h3>
            {project.curve.map((v, i) => (
              <div className="forecast-row" key={i}>
                <span>{MONTHS[i]}</span>
                <i>
                  <em
                    style={{
                      width: `${Math.min(100, (v / Math.max(...project.curve)) * 100)}%`,
                    }}
                  />
                </i>
                <small>{display(v)}</small>
                <b>{display((v * prob) / 100)}</b>
              </div>
            ))}
          </section>
          <div className="modal-actions">
            <button
              onClick={() =>
                mutate((c) => {
                  c.probabilities[project.id] = project.planningProbability;
                  c.shifts[project.id] = 0;
                })
              }
            >
              RESTORE BASELINE ASSUMPTIONS
            </button>
            <button className="primary" onClick={close}>
              DONE
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

const scenarioSteps = [
  'Select baseline',
  'Adjust soft backlog',
  'Add proposed projects',
  'Review bottlenecks',
  'Add capacity actions',
  'Review residual gaps',
  'Save workforce plan',
];
function Scenario({
  step,
  setStep,
  plans,
  planId,
  choosePlan,
  config,
  mutate,
  result,
  summary,
  display,
  openProposed,
  openNewAction,
  editAction,
  save,
  saveAsNew,
  cancel,
}: {
  step: number;
  setStep: (v: number) => void;
  plans: WorkforcePlan[];
  planId: string;
  choosePlan: (id: string) => void;
  config: ScenarioConfig;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
  result: ReturnType<typeof analyze>;
  summary: ReturnType<typeof metrics>;
  display: (v: number) => string;
  openProposed: () => void;
  openNewAction: (k: CapacityAction['kind']) => void;
  editAction: (a: CapacityAction) => void;
  save: () => void;
  saveAsNew: (name: string) => void;
  cancel: () => void;
}) {
  return (
    <div className="scenario-layout">
      <aside className="step-rail">
        {scenarioSteps.map((label, i) => (
          <button
            className={step === i + 1 ? 'active' : ''}
            onClick={() => setStep(i + 1)}
            key={label}
          >
            <b>{i + 1}</b>
            <span>{label}</span>
          </button>
        ))}
      </aside>
      <section className="scenario-panel">
        <span>STEP {step} OF 7</span>
        <h2>{scenarioSteps[step - 1]}</h2>
        {step === 1 && (
          <div className="plan-cards">
            {plans
              .filter((p) => p.status !== 'Archived')
              .map((p) => (
                <button
                  className={p.id === planId ? 'selected' : ''}
                  onClick={() => choosePlan(p.id)}
                  key={p.id}
                >
                  <strong>{p.name}</strong>
                  <small>{p.status}</small>
                  <p>{p.description}</p>
                </button>
              ))}
          </div>
        )}
        {step === 2 &&
          PROJECTS.filter((p) => p.type === 'Soft').map((p) => {
            const prob = config.probabilities[p.id] ?? p.planningProbability;
            return (
              <div className="soft-row" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    ${p.value}M · source {p.sourceProbability}% ·{' '}
                    {p.primaryLabor}
                  </small>
                </div>
                <div className="quick-chips">
                  {[0, 25, 50, 75, 100].map((v) => (
                    <button
                      className={prob === v ? 'on' : ''}
                      key={v}
                      onClick={() =>
                        mutate((c) => {
                          c.probabilities[p.id] = v;
                        })
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={prob}
                  onChange={(e) =>
                    mutate((c) => {
                      c.probabilities[p.id] = +e.target.value;
                    })
                  }
                />
                <b>{prob}%</b>
              </div>
            );
          })}
        {step === 3 && (
          <div className="proposed-card">
            <div>
              <span>PROPOSED SCENARIO WORK</span>
              <h3>{config.proposed.name}</h3>
              <p>
                ${config.proposed.value.toFixed(1)}M ·{' '}
                {config.proposed.workPackages.length} work packages ·{' '}
                {config.proposed.staffingCurve}
              </p>
            </div>
            <b className={config.proposedIncluded ? 'success' : 'muted'}>
              {config.proposedIncluded
                ? 'Included in this scenario'
                : 'Not included'}
            </b>
            <button
              onClick={() =>
                mutate((c) => {
                  c.proposedIncluded = !c.proposedIncluded;
                })
              }
            >
              TOGGLE
            </button>
            <button className="magenta-button" onClick={openProposed}>
              OPEN IMPACT MODEL
            </button>
          </div>
        )}
        {step === 4 && (
          <div className="bottleneck-list">
            {result.gap.map(
              (g, i) =>
                g > 0.05 && (
                  <div key={i}>
                    <strong>{MONTHS[i]}</strong>
                    <span>
                      {result.drivers[i]
                        .slice(0, 2)
                        .map((d) => d.name)
                        .join(' · ')}
                    </span>
                    <small>Demand {display(result.scenario[i])}</small>
                    <small>Capacity {display(result.total[i])}</small>
                    <b>{display(g)} gap</b>
                  </div>
                ),
            )}
          </div>
        )}
        {step === 5 && (
          <>
            <div className="add-actions">
              {(
                [
                  ['hire', 'PERMANENT HIRE'],
                  ['subcontract', 'SUBCONTRACT'],
                  ['overtime', 'OVERTIME'],
                  ['leave', 'LEAVE'],
                  ['attrition', 'ATTRITION'],
                ] as [CapacityAction['kind'], string][]
              ).map(([k, label]) => (
                <button className={k} key={k} onClick={() => openNewAction(k)}>
                  <Plus size={13} />
                  {label}
                </button>
              ))}
            </div>
            <div className="action-list">
              {config.actions.map((a) => (
                <div key={a.id}>
                  <i className={a.confirmed ? 'confirmed' : a.kind} />
                  <span>
                    <strong>
                      {a.quantity} {a.category} · {a.kind}
                    </strong>
                    <small>
                      {MONTHS[a.fromIndex]}
                      {a.toIndex !== a.fromIndex
                        ? ` — ${MONTHS[a.toIndex]}`
                        : ''}{' '}
                      · {a.notes}
                    </small>
                  </span>
                  <b>{a.status}</b>
                  <button onClick={() => editAction(a)}>Edit</button>
                  <button
                    onClick={() =>
                      mutate((c) => {
                        const copy = { ...a, id: `${a.id}-copy-${Date.now()}` };
                        c.actions.push(copy);
                      })
                    }
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                  <button
                    onClick={() =>
                      mutate((c) => {
                        c.actions = c.actions.filter((x) => x.id !== a.id);
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {step === 6 && (
          <>
            {
              <Metric
                label="PEAK RELIANCE ON UNCONFIRMED CAPACITY"
                value={display(summary.unconfirmedPeak)}
                detail="Planned hires, proposed subcontract, and overtime"
              />
            }
            <div className="recommend-list">
              {recommendations(result).map((r, i) => (
                <article key={i}>
                  <strong>{r.title}</strong>
                  <p>{r.why}</p>
                  <button
                    onClick={() =>
                      openNewAction(
                        r.mode === 'hire'
                          ? 'hire'
                          : r.mode === 'subcontract'
                            ? 'subcontract'
                            : 'overtime',
                      )
                    }
                  >
                    ADD OVERRIDE ACTION
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {step === 7 && (
          <div className="save-step">
            <p>
              Saving commits the live preview to a managed plan. It does not
              start the calculation—the analysis has already been running as you
              worked.
            </p>
            <button onClick={save} className="primary">
              <Save size={14} /> UPDATE PLAN
            </button>
            <button
              onClick={() => {
                const name = prompt('New plan name', 'New Workforce Plan');
                if (!name) return;
                saveAsNew(name);
              }}
            >
              SAVE AS NEW PLAN
            </button>
            <button onClick={cancel}>CANCEL PREVIEW</button>
            <small>
              Draft → Under Review → Approved Operating Plan → Superseded /
              Archived
            </small>
          </div>
        )}
        <div className="scenario-nav">
          <button disabled={step === 1} onClick={() => setStep(step - 1)}>
            <ArrowLeft /> Previous
          </button>
          <button disabled={step === 7} onClick={() => setStep(step + 1)}>
            Next <ArrowRight />
          </button>
        </div>
      </section>
      <aside className="impact-rail">
        <span>LIVE IMPACT</span>
        <p>Updates as you type. Nothing to submit.</p>
        <Metric
          label="FIRST BOTTLENECK"
          value={summary.firstMonth}
          detail="Scenario versus capacity"
        />
        <Metric
          label="PEAK GAP"
          value={display(summary.peak)}
          detail={summary.peakMonth}
        />
        <Metric
          label="BOTTLENECK MONTHS"
          value={`${summary.duration}`}
          detail="Within 18-month window"
        />
        <Metric
          label="PLAN CONFIDENCE"
          value={summary.confidence}
          detail={`${display(summary.unconfirmedPeak)} unconfirmed at peak`}
        />
      </aside>
    </div>
  );
}

function Capacity({
  config,
  category,
  setCategory,
  mutate,
}: {
  config: ScenarioConfig;
  category: LaborCategory;
  setCategory: (c: LaborCategory) => void;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
}) {
  const selected = config.capacity[category];
  const fields: [keyof typeof selected, string][] = [
    ['headcount', 'Headcount'],
    ['productiveHours', 'Prod hrs/person/mo'],
    ['hourlyRate', 'Std cost/hour'],
    ['overtimeLimit', 'OT limit %'],
    ['recruitDays', 'Recruit days'],
    ['onboardingDays', 'Onboard days'],
    ['rampDays', 'Ramp days'],
    ['subcontractSourceDays', 'Sub source days'],
    ['subcontractMobilizationDays', 'Sub mobilize days'],
    ['leavePercent', 'Leave %'],
    ['attritionPercent', 'Attrition %'],
  ];
  return (
    <div className="capacity-layout">
      <section className="screen-card">
        <div className="section-title">
          <div>
            <span>WORKFORCE ASSUMPTIONS</span>
            <h2>Department-owned capacity by labor category</h2>
            <p>Inputs update every analysis view immediately.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="capacity-table">
            <thead>
              <tr>
                <th>LABOR CATEGORY</th>
                {fields.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
                <th>EFFECTIVE CAPACITY</th>
              </tr>
            </thead>
            <tbody>
              {LABOR_CATEGORIES.map((cat) => {
                const row = config.capacity[cat];
                return (
                  <tr className={cat === category ? 'selected' : ''} key={cat}>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => setCategory(cat)}
                      >
                        {cat}
                      </button>
                    </td>
                    {fields.map(([key, fieldLabel]) => (
                      <td key={key}>
                        <input
                          type="number"
                          min="0"
                          aria-label={`${cat} ${fieldLabel}`}
                          value={row[key]}
                          onChange={(e) =>
                            mutate((c) => {
                              c.capacity[cat][key] = Math.max(
                                0,
                                +e.target.value,
                              );
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <b>
                        {(
                          row.headcount *
                          (1 - (row.leavePercent + row.attritionPercent) / 100)
                        ).toFixed(1)}{' '}
                        FTE
                      </b>
                      <small>
                        {Math.round(
                          row.headcount * row.productiveHours,
                        ).toLocaleString()}{' '}
                        hrs · $
                        {Math.round(
                          (row.headcount *
                            row.productiveHours *
                            row.hourlyRate) /
                            1000,
                        )}
                        k
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <aside className="capacity-preview">
        <header>
          <span>SELECTED CATEGORY</span>
          <h2>{category}</h2>
        </header>
        <Metric
          label="RAW HEADCOUNT"
          value={`${selected.headcount}`}
          detail="Department-owned workforce"
        />
        <Metric
          label="EXECUTABLE CAPACITY"
          value={`${(selected.headcount * (1 - (selected.leavePercent + selected.attritionPercent) / 100)).toFixed(1)} FTE`}
          detail="After planned leave and attrition"
        />
        <Metric
          label="PRODUCTIVE HOURS"
          value={`${Math.round(selected.headcount * selected.productiveHours).toLocaleString()}`}
          detail="Per month at current assumptions"
        />
        <Metric
          label="STANDARD LABOR COST"
          value={`$${Math.round((selected.headcount * selected.productiveHours * selected.hourlyRate) / 1000)}k`}
          detail="Loaded monthly labor cost"
        />
        <p>
          <strong>
            {selected.recruitDays +
              selected.interviewDays +
              selected.offerDays +
              selected.onboardingDays +
              selected.rampDays}{' '}
            days
          </strong>{' '}
          from decision to fully productive.
        </p>
        <p>
          <strong>
            {selected.subcontractSourceDays +
              selected.subcontractVettingDays +
              selected.subcontractMobilizationDays}{' '}
            days
          </strong>{' '}
          from decision to mobilized.
        </p>
      </aside>
    </div>
  );
}

function Plans({
  plans,
  setPlans,
  open,
  setTab,
  compareIds,
  setCompareIds,
  openCompare,
  toast,
  setToast,
}: {
  plans: WorkforcePlan[];
  setPlans: React.Dispatch<React.SetStateAction<WorkforcePlan[]>>;
  open: (id: string) => void;
  setTab: (t: Tab) => void;
  compareIds: string[];
  setCompareIds: (ids: string[]) => void;
  openCompare: () => void;
  toast: string;
  setToast: (s: string) => void;
}) {
  const status = (id: string, next: PlanStatus) => {
    setPlans((items) =>
      items.map((p) =>
        p.id === id
          ? { ...p, status: next }
          : next === 'Approved Operating Plan' &&
              p.department === items.find((x) => x.id === id)?.department &&
              p.status === 'Approved Operating Plan'
            ? { ...p, status: 'Superseded' }
            : p,
      ),
    );
    setToast(
      `Plan status updated to ${next}. Capacity-action statuses are unchanged.`,
    );
  };
  return (
    <section className="screen-card plans-screen">
      <div className="section-title">
        <div>
          <span>MANAGED WORKFORCE PLANS</span>
          <h2>Saved plans and operating-plan workflow</h2>
          <p>Compare assumptions, commitments, costs and residual risk.</p>
        </div>
        <div>
          <button onClick={openCompare}>COMPARE SELECTED PLANS</button>
          <button
            onClick={() => {
              if (confirm('Reset all locally saved prototype plans?')) {
                setPlans(resetPlans());
                setToast('Prototype plans reset to fabricated defaults.');
              }
            }}
          >
            <RotateCcw size={14} /> RESET ALL PROTOTYPE DATA
          </button>
        </div>
      </div>
      {toast && <div className="info-banner">{toast}</div>}
      <div className="plans-list">
        {plans.map((p) => {
          const r = analyze(p.config, 'Plumber'),
            m = metrics(r);
          return (
            <article
              className={p.status === 'Archived' ? 'archived' : ''}
              key={p.id}
            >
              <CheckButton
                checked={compareIds.includes(p.id)}
                onClick={() => {
                  if (compareIds.includes(p.id))
                    setCompareIds(compareIds.filter((x) => x !== p.id));
                  else setCompareIds([...compareIds, p.id].slice(-3));
                }}
              />
              <div className="plan-name">
                <h3>{p.name}</h3>
                <b
                  className={`status ${p.status.toLowerCase().replaceAll(' ', '-')}`}
                >
                  {p.status}
                </b>
                <p>
                  {p.description} · Owner: {p.owner} · Source data{' '}
                  {p.sourceDate} · Updated {p.updatedDate}
                </p>
              </div>
              <div className="plan-actions">
                <button
                  className="primary"
                  onClick={() => {
                    open(p.id);
                    setTab('dashboard');
                  }}
                >
                  OPEN
                </button>
                <button
                  onClick={() => {
                    const name = prompt(
                      'Duplicate plan name',
                      `${p.name} Copy`,
                    );
                    if (!name) return;
                    const copy = {
                      ...clone(p),
                      id: `plan-${Date.now()}`,
                      name,
                      status: 'Draft' as PlanStatus,
                    };
                    setPlans((x) => [...x, copy]);
                    setToast(`“${name}” created.`);
                  }}
                >
                  Duplicate
                </button>
                <button
                  onClick={() => {
                    const name = prompt('Rename plan', p.name);
                    if (name)
                      setPlans((x) =>
                        x.map((y) => (y.id === p.id ? { ...y, name } : y)),
                      );
                  }}
                >
                  Rename
                </button>
                <button onClick={() => status(p.id, 'Under Review')}>
                  Submit for Review
                </button>
                <button onClick={() => status(p.id, 'Approved Operating Plan')}>
                  Mark as Approved
                </button>
                <button onClick={() => status(p.id, 'Superseded')}>
                  Supersede
                </button>
                <button onClick={() => status(p.id, 'Archived')}>
                  <Archive size={13} /> Archive
                </button>
                <button
                  onClick={() => {
                    setPlans((x) =>
                      x.map((y) =>
                        y.id === p.id ? { ...y, stale: false } : y,
                      ),
                    );
                    setToast(
                      `Rebased "${p.name}" against the Sep 1, 2026 source refresh. Capacity action statuses were preserved.`,
                    );
                  }}
                >
                  Rebase
                </button>
              </div>
              {p.stale && (
                <div className="stale">
                  Source forecasts have changed since this plan was approved.
                  Review six affected projects.
                </div>
              )}
              <div className="plan-metrics">
                <Metric
                  label="FIRST BOTTLENECK"
                  value={m.firstMonth}
                  detail="Scenario view"
                />
                <Metric
                  label="PEAK UNRESOLVED"
                  value={`${m.peak.toFixed(1)} FTE`}
                  detail={m.peakMonth}
                />
                <Metric
                  label="PROPOSED HIRES"
                  value={`${p.config.actions.filter((a) => a.kind === 'hire').reduce((s, a) => s + a.quantity, 0)}`}
                  detail="Permanent additions"
                />
                <Metric
                  label="SUBCONTRACT"
                  value={`${p.config.actions.filter((a) => a.kind === 'subcontract').reduce((s, a) => s + a.quantity * (a.toIndex - a.fromIndex + 1), 0)} PM`}
                  detail="Person-months"
                />
                <Metric
                  label="NEXT ACTION"
                  value={(() => {
                    const deadlines = p.config.actions
                      .filter(
                        (a) =>
                          ['hire', 'subcontract'].includes(a.kind) &&
                          !a.confirmed,
                      )
                      .map((a) => actionStartDate(a))
                      .sort((a, b) => +a - +b);
                    const next = deadlines.find((d) => d >= TODAY);
                    return next ? formatDate(next) : 'None';
                  })()}
                  detail={(() => {
                    const overdue = p.config.actions
                      .filter(
                        (a) =>
                          ['hire', 'subcontract'].includes(a.kind) &&
                          !a.confirmed,
                      )
                      .map((a) => actionStartDate(a))
                      .filter((d) => d < TODAY).length;
                    return `${overdue} overdue`;
                  })()}
                />
                <Metric
                  label="CONFIDENCE"
                  value={m.confidence}
                  detail={p.status}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Help({
  setTab,
  openProposed,
}: {
  setTab: (t: Tab) => void;
  openProposed: () => void;
}) {
  const cards = [
    [
      '1',
      'Start with the dashboard',
      'Read the first constrained month, peak gap, project drivers, and the action timeline. Click any month for its demand and capacity bridge.',
      () => setTab('dashboard'),
    ],
    [
      '2',
      'Tune the forecast',
      'In Projects & Forecasts, include or exclude work, change a soft-project planning probability, or shift its expected start. The plan updates immediately.',
      () => setTab('projects'),
    ],
    [
      '3',
      'Test proposed work',
      'Open the Atlas impact model. Change value, dates, labor mix, work packages, or self-perform strategy and see execution impact before adding it.',
      openProposed,
    ],
    [
      '4',
      'Build the execution plan',
      'Use Scenario Builder to add hires, subcontractors, overtime, leave, or attrition. Dates are calculated backward from when capacity must be ready.',
      () => setTab('scenario'),
    ],
    [
      '5',
      'Save and compare',
      'Commit a preview to a workforce plan, then compare two or three plans. Approval changes the plan status, not the status of individual actions.',
      () => setTab('plans'),
    ],
  ] as const;
  return (
    <>
      <section className="help-intro">
        <span>PILOT GUIDE</span>
        <h2>From forecast uncertainty to an executable workforce plan</h2>
        <p>
          This pilot helps operations leaders see when demand exceeds capacity,
          understand what creates the gap, and test responsible actions before
          committing a plan.
        </p>
        <div>
          <button className="primary" onClick={() => setTab('dashboard')}>
            START WITH THE DASHBOARD <ArrowRight />
          </button>
          <button onClick={openProposed}>TRY A PROPOSED PROJECT</button>
        </div>
      </section>
      <section className="help-grid">
        {cards.map(([n, title, body, go]) => (
          <article key={n}>
            <b>{n}</b>
            <h3>{title}</h3>
            <p>{body}</p>
            <button onClick={go}>
              OPEN FEATURE <ArrowRight />
            </button>
          </article>
        ))}
      </section>
      <div className="help-columns">
        <section>
          <span>HOW TO READ THE CHART</span>
          <h2>Demand, capacity, and risk at a glance</h2>
          <dl>
            <dt>
              <i className="line-hard" />
              Hard backlog
            </dt>
            <dd>Awarded work at 100% of its forecast labor requirement.</dd>
            <dt>
              <i className="line-expected" />
              Expected workload
            </dt>
            <dd>Hard backlog plus probability-weighted soft backlog.</dd>
            <dt>
              <i className="line-scenario" />
              Scenario workload
            </dt>
            <dd>Expected work plus included proposed projects or packages.</dd>
            <dt>
              <i className="block-capacity" />
              Capacity layers
            </dt>
            <dd>
              Existing staff, confirmed hires, planned hires, subcontract, and
              overtime.
            </dd>
            <dt>
              <i className="block-gap" />
              Unresolved gap
            </dt>
            <dd>Demand the current action plan still cannot execute.</dd>
          </dl>
        </section>
        <section>
          <span>IMPORTANT PILOT RULES</span>
          <h2>What this prototype does—and does not do</h2>
          <ul>
            <li>
              All visible data is fabricated and safe for public demonstration.
            </li>
            <li>
              Recommendations are transparent rules, not management decisions.
            </li>
            <li>Planned capacity remains distinct from confirmed capacity.</li>
            <li>Plans are saved only in this browser on this device.</li>
            <li>
              There are no uploads, integrations, employee schedules, or real
              company data.
            </li>
            <li>
              Other departments reuse demonstration assumptions; Mechanical —
              Metro is the complete example.
            </li>
          </ul>
        </section>
      </div>
      <section className="help-faq">
        <span>COMMON QUESTIONS</span>
        <details open>
          <summary>
            Why can a plan have no gap but still be Conditional?
          </summary>
          <p>
            Planned hires or subcontractors may mathematically cover demand
            without being confirmed. The plan remains dependent on that
            uncommitted capacity.
          </p>
        </details>
        <details>
          <summary>Why is an action already overdue?</summary>
          <p>
            The planner works backward through recruiting, selection, notice,
            onboarding and ramp-up—or sourcing, contracting and mobilization.
            The responsible start date can precede the visible need by months.
          </p>
        </details>
        <details>
          <summary>How do work packages avoid double-counting?</summary>
          <p>
            When a parent project has work packages, the calculation uses
            included package curves in place of the parent curve. It never adds
            both.
          </p>
        </details>
        <details>
          <summary>Can I recover the original demonstration?</summary>
          <p>
            Yes. Saved Plans includes Reset All Prototype Data, which clears
            local changes and restores the fabricated defaults.
          </p>
        </details>
      </section>
    </>
  );
}

function ProposedModal({
  config,
  setLive,
  result,
  category,
  display,
  close,
}: {
  config: ScenarioConfig;
  setLive: React.Dispatch<React.SetStateAction<ScenarioConfig>>;
  result: ReturnType<typeof analyze>;
  category: LaborCategory;
  display: (v: number) => string;
  close: (discard: boolean) => void;
}) {
  const a = config.proposed,
    issues = [
      ...(Object.values(a.costMix).reduce((s, v) => s + v, 0) === 100
        ? []
        : ['Contract cost mix must total 100%.']),
      ...(Object.values(a.laborAllocation).reduce((s, v) => s + v, 0) === 100
        ? []
        : ['Internal labor allocation must total 100%.']),
      ...validateWorkPackages(a.workPackages),
    ];
  const update = <K extends keyof typeof a>(key: K, value: (typeof a)[K]) =>
    setLive((c) => ({ ...c, proposed: { ...c.proposed, [key]: value } }));
  const analysis = metrics(result);
  return (
    <div className="overlay">
      <section className="modal proposed-modal">
        <header>
          <div>
            <span>PROPOSED PROJECT — LIVE EXECUTION IMPACT</span>
            <h2>Can we execute it, and how?</h2>
          </div>
          <button onClick={() => close(true)}>
            <X /> Cancel
          </button>
        </header>
        <div className="proposed-body">
          <div className="modal-inputs">
            <div className="form-grid">
              <Field label="PROJECT NAME">
                <input
                  value={a.name}
                  onChange={(e) => update('name', e.target.value)}
                />
              </Field>
              <Field label="DEPARTMENT / LOCATION">
                <select
                  value={a.department}
                  onChange={(e) => update('department', e.target.value)}
                >
                  {DEPARTMENTS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="CONTRACT VALUE ($M)">
                <input
                  type="number"
                  min="0"
                  value={a.value}
                  onChange={(e) =>
                    update('value', Math.max(0, +e.target.value))
                  }
                />
              </Field>
              <Field label="EXPECTED START">
                <select
                  value={a.startIndex}
                  onChange={(e) => update('startIndex', +e.target.value)}
                >
                  {MONTHS.map((v, i) => (
                    <option value={i} key={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="DURATION (MONTHS)">
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={a.durationMonths}
                  onChange={(e) =>
                    update('durationMonths', Math.max(1, +e.target.value))
                  }
                />
              </Field>
              <Field label="PROBABILITY">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={a.probability}
                  onChange={(e) =>
                    update(
                      'probability',
                      Math.max(0, Math.min(100, +e.target.value)),
                    )
                  }
                />
              </Field>
            </div>
            <section>
              <h3>Contract cost mix</h3>
              <div className="form-grid four">
                {Object.entries(a.costMix).map(([key, value]) => (
                  <Field
                    key={key}
                    label={key.replace(/[A-Z]/g, (m) => ` ${m}`).toUpperCase()}
                  >
                    <input
                      type="number"
                      min="0"
                      value={value}
                      onChange={(e) =>
                        update('costMix', {
                          ...a.costMix,
                          [key]: Math.max(0, +e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <Validation
                total={Object.values(a.costMix).reduce((s, v) => s + v, 0)}
                label="Cost mix"
              />
            </section>
            <section>
              <h3>Internal labor allocation</h3>
              <div className="labor-grid">
                {LABOR_CATEGORIES.map((cat) => (
                  <Field key={cat} label={cat.toUpperCase()}>
                    <input
                      type="number"
                      min="0"
                      value={a.laborAllocation[cat]}
                      onChange={(e) =>
                        update('laborAllocation', {
                          ...a.laborAllocation,
                          [cat]: Math.max(0, +e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <Validation
                total={Object.values(a.laborAllocation).reduce(
                  (s, v) => s + v,
                  0,
                )}
                label="Labor allocation"
              />
            </section>
            <section>
              <h3>Work packages</h3>
              <p className="section-copy">
                Included packages replace the parent forecast and roll up
                exactly once.
              </p>
              {a.workPackages.map((w) => (
                <WorkPackageEditor
                  key={w.id}
                  item={w}
                  update={(next) =>
                    update(
                      'workPackages',
                      a.workPackages.map((x) => (x.id === w.id ? next : x)),
                    )
                  }
                />
              ))}
            </section>
          </div>
          <aside className="live-preview">
            <div
              className={`execution-status ${analysis.confidence.toLowerCase().replace(' ', '-')}`}
            >
              {analysis.peak > 0.05
                ? 'UNRESOLVED'
                : analysis.unconfirmedPeak > 0.05
                  ? 'FEASIBLE · UNCONFIRMED'
                  : 'FEASIBLE WITH EXISTING CAPACITY'}
            </div>
            <span>LIVE IMPACT PREVIEW</span>
            <h3>{a.name}</h3>
            <div className="mini-chart">
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart
                  data={MONTHS.map((m, i) => ({
                    m,
                    current: result.expected[i],
                    with: result.scenario[i],
                    capacity: result.total[i],
                  }))}
                >
                  <XAxis dataKey="m" hide />
                  <YAxis hide domain={[0, 'dataMax+5']} />
                  <Line dataKey="current" stroke="#9c9a95" dot={false} />
                  <Line
                    dataKey="with"
                    stroke="#8e2da8"
                    strokeWidth={2.4}
                    dot={false}
                  />
                  <Line
                    dataKey="capacity"
                    stroke="#0082ff"
                    strokeDasharray="5 4"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="impact-list">
              <Metric
                label="INTERNAL LABOR BUDGET"
                value={`$${((a.value * a.costMix.internalLabor) / 100).toFixed(2)}M`}
                detail="Contract value × internal labor mix"
              />
              <Metric
                label="MOST CONSTRAINED CATEGORY"
                value={category}
                detail={`${display(analysis.peak)} unresolved at peak`}
              />
              <Metric
                label="FIRST AFFECTED MONTH"
                value={analysis.firstMonth}
                detail="Selected labor-category view"
              />
              <Metric
                label="PEAK UNRESOLVED SHORTAGE"
                value={display(analysis.peak)}
                detail={analysis.peakMonth}
              />
              <Metric
                label="PEAK UNCONFIRMED RELIANCE"
                value={display(analysis.unconfirmedPeak)}
                detail="Planned capacity at risk"
              />
            </div>
            {issues.length > 0 && (
              <div className="validation-box">
                <strong>Needs attention</strong>
                {issues.map((i) => (
                  <p key={i}>{i}</p>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="primary"
                disabled={issues.length > 0}
                onClick={() => {
                  setLive((c) => ({ ...c, proposedIncluded: true }));
                  close(false);
                }}
              >
                {config.proposedIncluded
                  ? 'UPDATE IN SCENARIO'
                  : 'ADD TO SCENARIO'}
              </button>
              <button
                onClick={() =>
                  setLive((c) => ({ ...c, proposedIncluded: false }))
                }
              >
                REMOVE FROM SCENARIO
              </button>
            </div>
            <p className="fine-print">
              Impacts are shown before the project is added. Recommendations
              follow documented rules and are not a management decision.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
function Validation({ total, label }: { total: number; label: string }) {
  const ok = Math.abs(total - 100) < 0.01;
  return (
    <p className={`validation ${ok ? 'ok' : 'bad'}`}>
      {ok ? <Check size={14} /> : <X size={14} />} {label}: {total.toFixed(1)}%
      — must equal 100%
    </p>
  );
}
function WorkPackageEditor({
  item,
  update,
}: {
  item: WorkPackage;
  update: (w: WorkPackage) => void;
}) {
  return (
    <article className={`work-package ${item.included ? '' : 'disabled'}`}>
      <header>
        <CheckButton
          checked={item.included}
          onClick={() => update({ ...item, included: !item.included })}
        />
        <div>
          <strong>{item.name}</strong>
          <small>
            {item.execution} · confidence {item.confidence}%
          </small>
        </div>
      </header>
      <div className="package-fields">
        <Field label="VALUE % OF PARENT">
          <input
            type="number"
            min="0"
            value={item.valuePercent}
            onChange={(e) =>
              update({ ...item, valuePercent: Math.max(0, +e.target.value) })
            }
          />
        </Field>
        <Field label="START">
          <select
            value={item.startIndex + item.scenarioShift}
            onChange={(e) =>
              update({
                ...item,
                scenarioShift: +e.target.value - item.startIndex,
              })
            }
          >
            {MONTHS.map((m, i) => (
              <option value={i} key={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="EXECUTION">
          <select
            value={item.execution}
            onChange={(e) => {
              const execution = e.target.value as WorkPackage['execution'];
              update({
                ...item,
                execution,
                selfPerformPercent:
                  execution === 'Subcontract'
                    ? 0
                    : execution === 'Self-perform'
                      ? 100
                      : item.selfPerformPercent,
                subcontractPercent:
                  execution === 'Subcontract'
                    ? 100
                    : execution === 'Self-perform'
                      ? 0
                      : item.subcontractPercent,
              });
            }}
          >
            <option>Self-perform</option>
            <option>Subcontract</option>
            <option>Hybrid</option>
          </select>
        </Field>
        <Field label="SELF-PERFORM %">
          <input
            type="number"
            min="0"
            max="100"
            value={item.selfPerformPercent}
            onChange={(e) =>
              update({
                ...item,
                selfPerformPercent: Math.max(0, Math.min(100, +e.target.value)),
                subcontractPercent:
                  100 - Math.max(0, Math.min(100, +e.target.value)),
              })
            }
          />
        </Field>
        <Field label="SUBCONTRACT %">
          <input
            type="number"
            min="0"
            max="100"
            value={item.subcontractPercent}
            onChange={(e) =>
              update({
                ...item,
                subcontractPercent: Math.max(0, Math.min(100, +e.target.value)),
                selfPerformPercent:
                  100 - Math.max(0, Math.min(100, +e.target.value)),
              })
            }
          />
        </Field>
        <Field label="CONFIDENCE">
          <input
            type="number"
            min="0"
            max="100"
            value={item.confidence}
            onChange={(e) =>
              update({
                ...item,
                confidence: Math.max(0, Math.min(100, +e.target.value)),
              })
            }
          />
        </Field>
        <Field label="DURATION (MONTHS)">
          <input
            type="number"
            min="1"
            max="18"
            value={item.durationMonths}
            onChange={(e) =>
              update({
                ...item,
                durationMonths: Math.max(1, Math.round(+e.target.value)),
              })
            }
          />
        </Field>
        <Field label="STAFFING CURVE">
          <select
            value={item.staffingCurve}
            onChange={(e) =>
              update({
                ...item,
                staffingCurve: e.target.value as StaffingCurve,
              })
            }
          >
            <option>Comparable-project curve</option>
            <option>Standard ramp / peak / taper</option>
            <option>Even distribution</option>
            <option>Manual monthly forecast</option>
          </select>
        </Field>
      </div>
      {item.staffingCurve === 'Manual monthly forecast' && (
        <div className="manual-forecast">
          <small>
            Manual monthly forecast — enter this package&apos;s own FTE for each
            month of its {item.durationMonths}-month duration, starting{' '}
            {MONTHS[Math.min(17, item.startIndex + item.scenarioShift)]}.
          </small>
          <div className="manual-forecast-grid">
            {Array.from({ length: item.durationMonths }, (_, k) => {
              const monthIndex = item.startIndex + item.scenarioShift + k;
              const values = item.manualMonthly?.length
                ? item.manualMonthly
                : Array(item.durationMonths).fill(
                    Math.max(0, ...item.curve) || 1,
                  );
              return (
                <label key={k}>
                  <span>{MONTHS[monthIndex] ?? `Month ${k + 1}`}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={values[k] ?? 0}
                    onChange={(e) => {
                      const next = [...values];
                      next[k] = Math.max(0, +e.target.value);
                      update({ ...item, manualMonthly: next });
                    }}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

function ActionModal({
  action,
  update,
  close,
}: {
  action: CapacityAction;
  update: (a: CapacityAction) => void;
  close: (discard: boolean) => void;
}) {
  const date = actionStartDate(action),
    overdue = !action.confirmed && date < TODAY,
    timeline = actionMilestones(action);
  const leadFields = (
    action.kind === 'hire'
      ? [
          ['recruit', 'RECRUITING DAYS'],
          ['interview', 'SELECTION DAYS'],
          ['offer', 'OFFER / NOTICE DAYS'],
          ['onboard', 'ONBOARDING DAYS'],
          ['ramp', 'RAMP-UP DAYS'],
        ]
      : [
          ['source', 'SOURCING DAYS'],
          ['vet', 'VETTING DAYS'],
          ['mobilize', 'MOBILIZATION DAYS'],
        ]
  ) as [keyof NonNullable<CapacityAction['leadDays']>, string][];
  return (
    <div className="overlay">
      <section className="modal action-modal">
        <header>
          <div>
            <span>CAPACITY ACTION — LIVE PREVIEW</span>
            <h2>
              {action.kind === 'hire'
                ? 'Permanent hire'
                : action.kind === 'subcontract'
                  ? 'Subcontract labor'
                  : action.kind}
            </h2>
          </div>
          <button onClick={() => close(true)}>
            <X /> Discard changes
          </button>
        </header>
        <div className="action-body">
          <div className="modal-inputs">
            <div className="form-grid">
              <Field label="LABOR CATEGORY">
                <select
                  value={action.category}
                  onChange={(e) =>
                    update({
                      ...action,
                      category: e.target.value as LaborCategory,
                    })
                  }
                >
                  {LABOR_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="QUANTITY">
                <input
                  type="number"
                  min="0"
                  value={action.quantity}
                  onChange={(e) =>
                    update({
                      ...action,
                      quantity: Math.max(0, +e.target.value),
                    })
                  }
                />
              </Field>
              <Field
                label={
                  action.kind === 'hire'
                    ? 'FULLY PRODUCTIVE MONTH'
                    : 'PRODUCTIVE START'
                }
              >
                <select
                  value={action.fromIndex}
                  onChange={(e) =>
                    update({
                      ...action,
                      fromIndex: +e.target.value,
                      toIndex: Math.max(+e.target.value, action.toIndex),
                    })
                  }
                >
                  {MONTHS.map((m, i) => (
                    <option value={i} key={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              {action.kind !== 'hire' && action.kind !== 'attrition' && (
                <Field label="PRODUCTIVE END">
                  <select
                    value={action.toIndex}
                    onChange={(e) =>
                      update({
                        ...action,
                        toIndex: Math.max(action.fromIndex, +e.target.value),
                      })
                    }
                  >
                    {MONTHS.map((m, i) => (
                      <option value={i} key={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="STATUS">
                <select
                  value={action.status}
                  onChange={(e) => {
                    const status = e.target.value;
                    update({
                      ...action,
                      status,
                      confirmed: [
                        'Offer Accepted',
                        'Onboarding',
                        'Productive',
                        'Contracted',
                        'Mobilized',
                        'Executed',
                      ].includes(status),
                    });
                  }}
                >
                  {[
                    'Proposed',
                    'Approved to Recruit',
                    'Recruiting',
                    'Offer Accepted',
                    'Onboarding',
                    'Productive',
                    'Sourcing',
                    'Vetting',
                    'Contracted',
                    'Mobilized',
                    'Executed',
                    'Delayed',
                    'Cancelled',
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            {action.leadDays && (
              <div className="form-grid four">
                {leadFields.map(([key, label]) => (
                  <Field label={label} key={key}>
                    <input
                      type="number"
                      min="0"
                      value={action.leadDays![key]}
                      onChange={(e) =>
                        update({
                          ...action,
                          leadDays: {
                            ...action.leadDays!,
                            [key]: Math.max(0, +e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            {action.kind === 'hire' && (
              <div className="form-grid">
                <Field label="LOADED HOURLY RATE">
                  <input
                    type="number"
                    min="0"
                    value={action.hourlyRate ?? 0}
                    onChange={(e) =>
                      update({
                        ...action,
                        hourlyRate: Math.max(0, +e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            )}
            {action.kind === 'subcontract' && (
              <div className="form-grid">
                <Field label="COST">
                  <input
                    type="number"
                    min="0"
                    value={action.cost ?? 0}
                    onChange={(e) =>
                      update({ ...action, cost: Math.max(0, +e.target.value) })
                    }
                  />
                </Field>
                <Field label="COST BASIS">
                  <select
                    value={action.costBasis ?? 'per hour'}
                    onChange={(e) =>
                      update({
                        ...action,
                        costBasis: e.target.value as 'per hour' | 'per month',
                      })
                    }
                  >
                    <option value="per hour">Per hour</option>
                    <option value="per month">Per month</option>
                  </select>
                </Field>
                <Field label="SOURCE TYPE">
                  <select
                    value={action.sourceType ?? 'External'}
                    onChange={(e) =>
                      update({
                        ...action,
                        sourceType: e.target
                          .value as CapacityAction['sourceType'],
                      })
                    }
                  >
                    <option value="External">External</option>
                    <option value="Another Department">
                      Another Department
                    </option>
                    <option value="Undetermined">Undetermined</option>
                  </select>
                </Field>
              </div>
            )}
            <Field label="NOTES">
              <textarea
                value={action.notes}
                onChange={(e) => update({ ...action, notes: e.target.value })}
              />
            </Field>
          </div>
          <aside className="date-preview">
            <span>
              {action.kind === 'hire'
                ? 'BEGIN RECRUITING BY'
                : 'BEGIN SOURCING BY'}
            </span>
            <h2 className={overdue ? 'red' : ''}>{formatDate(date)}</h2>
            {overdue && <b>STANDARD LEAD TIME IS ALREADY PAST</b>}
            <p>
              The date recalculates immediately from the required productive
              month and every lead-time assumption.
            </p>
            {timeline && (
              <ul className="milestone-list">
                {timeline.milestones.map((ms) => {
                  const past = ms.date < TODAY && !action.confirmed;
                  return (
                    <li key={ms.label} className={past ? 'red' : ''}>
                      <span>{ms.label}</span>
                      <b>{formatDate(ms.date)}</b>
                    </li>
                  );
                })}
              </ul>
            )}
            {action.kind === 'hire' && (
              <small className="rail-note">
                Productive ramp: Month 1 50%, Month 2 75%, Month 3 onward 100%.
                Displayed for planning — default sample capacity begins at the
                fully productive month.
              </small>
            )}
            {action.kind === 'subcontract' && (
              <small className="rail-note">
                Labor supplied by another internal department is modeled exactly
                like subcontract capacity in this department&apos;s plan.
              </small>
            )}
            <button className="primary" onClick={() => close(false)}>
              KEEP IN SCENARIO
            </button>
          </aside>
        </div>
      </section>
    </div>
  );
}

function CompareModal({
  plans,
  category,
  close,
}: {
  plans: WorkforcePlan[];
  category: LaborCategory;
  close: () => void;
}) {
  return (
    <div className="overlay">
      <section className="modal compare-modal">
        <header>
          <div>
            <span>PLAN COMPARISON — {category}, MECHANICAL — METRO</span>
            <h2>Compare execution risk and capacity commitments</h2>
          </div>
          <button onClick={close}>
            <X /> Close
          </button>
        </header>
        <div className="compare-grid">
          {plans.map((p) => {
            const r = analyze(p.config, category),
              m = metrics(r),
              cap = p.config.capacity[category],
              perm = p.config.actions
                .filter((a) => a.kind === 'hire')
                .reduce((s, a) => s + a.quantity, 0),
              sub = p.config.actions
                .filter((a) => a.kind === 'subcontract')
                .reduce(
                  (s, a) => s + a.quantity * (a.toIndex - a.fromIndex + 1),
                  0,
                ),
              deadlines = p.config.actions
                .filter(
                  (a) =>
                    ['hire', 'subcontract'].includes(a.kind) && !a.confirmed,
                )
                .map((a) => actionStartDate(a))
                .sort((a, b) => +a - +b),
              overdueCount = deadlines.filter((d) => d < TODAY).length,
              nextDate = deadlines.find((d) => d >= TODAY);
            return (
              <article key={p.id}>
                <span>{p.status}</span>
                <h3>{p.name}</h3>
                {[
                  ['First bottleneck', m.firstMonth],
                  ['Peak shortage', `${m.peak.toFixed(1)} FTE`],
                  ['Bottleneck person-months', m.personMonths.toFixed(1)],
                  ['Permanent hires', perm],
                  ['Subcontract person-months', sub],
                  ['Overtime', `${m.overtimePeak.toFixed(1)} FTE peak`],
                  [
                    'Added labor cost (18 mo)',
                    formatValue(
                      m.addedCapacityFteMonths,
                      'Labor Cost',
                      cap.productiveHours,
                      cap.hourlyRate,
                    ),
                  ],
                  [
                    'Proposed-project coverage',
                    p.config.proposedIncluded
                      ? 'Atlas included'
                      : 'Atlas excluded',
                  ],
                  [
                    'Unconfirmed capacity',
                    `${m.unconfirmedPeak.toFixed(1)} FTE at peak`,
                  ],
                  [
                    'Action dates',
                    `${overdueCount} overdue${nextDate ? ` · next ${formatDate(nextDate)}` : ''}`,
                  ],
                  [
                    'Remaining unresolved gap',
                    m.peak > 0.05 ? `${m.peak.toFixed(1)} FTE` : 'None',
                  ],
                ].map(([k, v]) => (
                  <div className="detail-row" key={k}>
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
