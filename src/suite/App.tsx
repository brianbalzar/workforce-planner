import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Download,
  FileUp,
  Plus,
  Save,
  X,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import logo from '../assets/upchurch-light.png';
import { validatePlannerData } from '../data/plannerDataLoader';
import { adaptMonthly } from './monthlyAdapter';
import type {
  Agreement,
  ArchKey,
  CapacityAction,
  DeptKey,
  Project,
  ScenarioSnapshot,
  TradeKey,
  UserProjectArgs,
  WorkforceSample,
} from './types';
import {
  actionCost,
  actionsFor,
  aggregate,
  bucket,
  burn,
  capFor,
  clone,
  compute,
  createProject,
  dateAt,
  displayDate,
  makeAction,
  negative,
  projectsFor,
  recommendations,
  reforecast,
  route,
  secured,
  serviceSettings,
  sum,
  timeline,
  total,
  uid,
  weight,
  type Basis,
  type Cube,
  type Recommendation,
} from './engine';
import {
  datasetId,
  importScenario,
  readScenarios,
  sampleDataset,
  storageKey,
  validateDataset,
  type SavedScenario,
} from './dataset';
import {
  Chart,
  ShortfallChart,
  fmt,
  Metric,
  money,
  Segments,
  Timeline,
  type Units,
} from './Charts';
import './suite.css';

type Area = 'projects' | 'service' | 'hiring';
type Page =
  | 'overview'
  | 'actions'
  | 'projects'
  | 'forecast'
  | 'outlook'
  | 'queue'
  | 'roadmap';
const pages: Record<Area, [Page, string][]> = {
  projects: [
    ['overview', 'Overview'],
    ['actions', 'Action plan'],
    ['projects', 'Projects'],
    ['forecast', 'Forecast update'],
    ['roadmap', 'Roadmap'],
  ],
  service: [
    ['outlook', 'Service outlook'],
    ['actions', 'Action plan'],
    ['roadmap', 'Roadmap'],
  ],
  hiring: [
    ['queue', 'Hiring queue'],
    ['roadmap', 'Roadmap'],
  ],
};
function currentRoute(): { area: Area; page: Page } {
  const [a, p] = location.hash.replace(/^#\/?/, '').split('/');
  const area: Area =
    a === 'service'
      ? 'service'
      : a === 'hiring' || a === 'talent-acquisition'
        ? 'hiring'
        : 'projects';
  const page = pages[area].find(([key]) => key === p)?.[0] ?? pages[area][0][0];
  return { area, page };
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Card({
  title,
  subtitle,
  tools,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  tools?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="ws-card" id={id}>
      <div className="ws-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {tools && <div className="ws-tools">{tools}</div>}
      </div>
      {children}
    </section>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ws-empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab') return;
      const elements = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length);
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', listener);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', listener);
      document.body.style.overflow = overflow;
      old?.focus();
    };
  }, []);
  return (
    <div className="ws-overlay">
      <div
        ref={ref}
        className={`ws-modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="ws-eyebrow">WORKFORCE PLANNER</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="ws-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function WorkforceSuite() {
  const [dataset, setDataset] = useState<WorkforceSample | null>(null);
  const [session, setSession] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  async function openFile(f: File) {
    setError('');
    try {
      if (f.size > 20e6)
        throw new Error('Choose a workforce dataset smaller than 20 MB.');
      const value = JSON.parse(await f.text());
      // Keep the existing monthly import and its data contract available unchanged.
      const d =
        value.schemaVersion === 1
          ? adaptMonthly(validatePlannerData(value))
          : validateDataset(value);
      d.metadata = {
        ...d.metadata,
        id: datasetId(d),
        label: f.name,
        sample: false,
        notes: d.metadata?.notes ?? [
          'Opened locally in this browser session. No connected feeds.',
        ],
      };
      setSession(true);
      setDataset(d);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'The dataset could not be opened.',
      );
    }
  }
  if (!dataset)
    return (
      <div className="ws-app ws-welcome">
        <header className="ws-top">
          <img src={logo} alt="Upchurch" />
          <span>WORKFORCE PLANNER</span>
        </header>
        <main>
          <span className="ws-eyebrow">
            ONE PLAN · THREE CONNECTED WORKFLOWS
          </span>
          <h1>
            Plan the work.
            <br />
            Have the people ready.
          </h1>
          <p>
            Projects, Service and Talent Acquisition, together. Find the
            shortfall, choose a response, and work backward to when it needs to
            start.
          </p>
          <div className="ws-welcome-actions">
            <button
              className="primary"
              onClick={() => {
                setSession(false);
                setDataset(sampleDataset());
              }}
            >
              Explore the sample plan <ArrowRight size={17} />
            </button>
            <button onClick={() => file.current?.click()}>
              <FileUp size={17} />
              Open workforce dataset
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Open workforce dataset"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = '';
            }}
          />
          {error && (
            <p role="alert" className="ws-error">
              {error}
            </p>
          )}
          <div className="ws-welcome-grid">
            <div>
              <b>Projects</b>
              <p>Workload, capacity, forecast review and action dates.</p>
            </div>
            <div>
              <b>Service</b>
              <p>Maintenance, calls, renewals and technician coverage.</p>
            </div>
            <div>
              <b>Talent Acquisition</b>
              <p>One hiring queue, dated from productive capacity.</p>
            </div>
          </div>
          <p className="ws-fine">
            The sample is fabricated. Uploaded datasets stay in this browser
            session. Scenario export lets you take your work with you.
          </p>
          <a
            href="#/legacy"
            onClick={() =>
              location.assign(`${location.pathname}${location.search}#/legacy`)
            }
          >
            Monthly planner & existing imports →
          </a>
        </main>
      </div>
    );
  return (
    <Suite
      key={datasetId(dataset)}
      data={dataset}
      sessionOnly={session}
      onExit={() => setDataset(null)}
    />
  );
}

function Suite({
  data: d,
  sessionOnly,
  onExit,
}: {
  data: WorkforceSample;
  sessionOnly: boolean;
  onExit: () => void;
}) {
  const [routeState, setRoute] = useState(currentRoute);
  const { area, page } = routeState;
  useEffect(() => {
    const fn = () => setRoute(currentRoute());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  const [saved, setSaved] = useState<SavedScenario[]>(() =>
    sessionOnly ? [] : readScenarios(d),
  );
  const seeds = d.scenarios;
  const [scenarioId, setScenarioId] = useState(seeds[0].id);
  const [snap, setSnap] = useState(() => clone(seeds[0].snap));
  const [history, setHistory] = useState<ScenarioSnapshot[]>([]);
  const [views, setViews] = useState<
    Partial<Record<Area, { basis: Basis; units: Units; horizon: number }>>
  >({});
  const view = views[area] ?? {
    basis: 'confirmed' as const,
    units: 'People' as const,
    horizon: area === 'service' ? 13 : 52,
  };
  const { basis, units, horizon } = view;
  const setBasis = (basis: Basis) =>
    setViews((v) => ({ ...v, [area]: { ...view, basis } }));
  const setUnits = (units: Units) =>
    setViews((v) => ({ ...v, [area]: { ...view, units } }));
  const setHorizon = (horizon: number) =>
    setViews((v) => ({ ...v, [area]: { ...view, horizon } }));
  const [chartMode, setChartMode] = useState<'Summary' | 'Components'>(
    'Summary',
  );
  const [deptSelection, setDeptSelection] = useState<
    Partial<Record<Area, DeptKey[]>>
  >({});
  const [tradeSelection, setTradeSelection] = useState<
    Partial<Record<Area, TradeKey[]>>
  >({});
  const [picker, setPicker] = useState<'departments' | 'trades' | null>(null);
  const [actionModal, setActionModal] = useState<CapacityAction | null>(null);
  const [projectModal, setProjectModal] = useState<
    UserProjectArgs | 'new' | null
  >(null);
  const [forecastModal, setForecastModal] = useState<{
    project: Project;
    trade: TradeKey;
  } | null>(null);
  const [agreementModal, setAgreementModal] = useState<Agreement | null>(null);
  const [saveModal, setSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectType, setProjectType] = useState('All');
  const [reviewFilter, setReviewFilter] = useState<'Needs review' | 'All'>(
    'Needs review',
  );
  const [serviceDetail, setServiceDetail] = useState(
    'Agreements and burn rate',
  );
  const [selected, setSelected] = useState<{
    dk: DeptKey;
    tk: TradeKey;
    i: number;
  } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { PAST, HPF } = d.reference.constants;
  const deptName = (k: DeptKey) =>
    d.reference.departments.find((v) => v.k === k)?.name ?? k;
  const tradeName = (k: TradeKey) =>
    d.reference.trades.find((v) => v.k === k)?.name ?? k;
  const kindName = (k: CapacityAction['kind']) =>
    d.reference.actionKinds.find((v) => v[0] === k)?.[1] ?? k;
  const availableDepts = d.reference.departments
    .filter((v) =>
      area === 'projects'
        ? v.group !== 'Service'
        : area === 'service'
          ? v.group === 'Service'
          : true,
    )
    .map((v) => v.k);
  const availableTrades = d.reference.trades
    .filter((v) =>
      area === 'service'
        ? ['HS', 'PS'].includes(v.k)
        : area === 'projects'
          ? !['HS', 'PS'].includes(v.k)
          : true,
    )
    .map((v) => v.k);
  const depts = deptSelection[area] ?? availableDepts;
  const trades = tradeSelection[area] ?? availableTrades;
  const currentSaved = saved.find((s) => s.id === scenarioId);
  const baseline =
    currentSaved?.snapshot ??
    seeds.find((s) => s.id === scenarioId)?.snap ??
    seeds[0].snap;
  const dirty = JSON.stringify(snap) !== JSON.stringify(baseline);
  const change = (fn: (s: ScenarioSnapshot) => void) => {
    setSnap((prev) => {
      const next = clone(prev);
      fn(next);
      return next;
    });
    setHistory((prev) => [...prev.slice(-19), clone(snap)]);
  };
  const service = serviceSettings(snap);
  const changeService = (fn: (s: ReturnType<typeof serviceSettings>) => void) =>
    change((s) => {
      s.service = clone(serviceSettings(s));
      fn(s.service);
    });
  const calculation = useMemo(() => compute(d, snap, basis), [d, snap, basis]);
  const { cube } = calculation;
  const projects = useMemo(() => projectsFor(d, snap), [d, snap]);
  const recs = useMemo(
    () =>
      recommendations(
        d,
        snap,
        cube,
        basis,
        d.reference.departments.map((v) => v.k),
        d.reference.trades.map((v) => v.k),
      ),
    [d, snap, cube, basis],
  );
  const scopedRecs = recs.filter(
    (r) => depts.includes(r.action.dk) && trades.includes(r.action.tk),
  );
  const allActions = actionsFor(d, snap);
  const scopedActions = allActions.filter(
    (a) => depts.includes(a.dk) && trades.includes(a.tk),
  );
  const rows = aggregate(d, cube, depts, trades);
  const allCells = depts.flatMap((dk) =>
    trades.flatMap((tk) =>
      (cube[dk]?.[tk] ?? [])
        .slice(PAST)
        .map((c, w) => ({ c, dk, tk, i: w + PAST })),
    ),
  );
  const largest = [...allCells].sort((a, b) => b.c.gap - a.c.gap)[0];
  const shortWeeks = allCells.filter(
    (v) => v.c.gap / HPF > d.reference.constants.SHORT_TE,
  ).length;
  const pendingLines = projects
    .filter(
      (p) =>
        (p.type === 'hard' && depts.includes(p.dept)) ||
        (p.type === 'hard' && depts.includes('BAS')),
    )
    .flatMap((p) =>
      (Object.keys(p.plan) as TradeKey[])
        .filter((tk) => trades.includes(tk) && depts.includes(route(p, tk)))
        .map((tk) => ({ p, tk, f: reforecast(d, snap, p, tk) })),
    );
  const pending = pendingLines.filter((r) => r.f.status === 'pending');
  const netReforecast = sum(
    pendingLines.filter((r) => weight(snap, r.p) > 0).map((r) => sum(r.f.add)),
  );
  const selectedCell =
    selected && cube[selected.dk]?.[selected.tk]?.[selected.i];
  const selectWeek = (i: number, dk?: DeptKey, tk?: TradeKey) => {
    const candidates = depts
      .flatMap((a) =>
        trades.map((b) => ({ dk: a, tk: b, c: cube[a]?.[b]?.[i] })),
      )
      .filter((v) => v.c);
    const worst = candidates.sort((a, b) => b.c.gap - a.c.gap)[0];
    if (worst) setSelected({ dk: dk ?? worst.dk, tk: tk ?? worst.tk, i });
  };
  const selectedContrib = selected
    ? selected.dk === 'HLS' && (selected.tk === 'HS' || selected.tk === 'PS')
      ? calculation.services[selected.tk].detail[selected.i].map((r) => ({
          id: r.id,
          name: r.name,
          source: r.source,
          hours: r.hours,
          type: r.layer,
        }))
      : projects
          .filter(
            (p) =>
              p.plan[selected.tk] &&
              route(p, selected.tk) === selected.dk &&
              weight(snap, p),
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            source: p.job ? `BuildOps ${p.job} · PM ${p.pm}` : p.src,
            hours:
              (p.type !== 'hard' && snap.manual[`${p.id}|${selected.tk}`]
                ? (snap.manual[`${p.id}|${selected.tk}`][selected.i] ?? 0)
                : (p.plan[selected.tk]?.[selected.i] ?? 0)) *
                weight(snap, p) +
              (p.type === 'hard'
                ? reforecast(d, snap, p, selected.tk).add[selected.i]
                : 0),
            type: p.type,
          }))
          .filter((p) => p.hours > 0.01)
          .sort((a, b) => b.hours - a.hours)
    : [];

  function chooseScenario(id: string) {
    const next =
      saved.find((s) => s.id === id)?.snapshot ??
      seeds.find((s) => s.id === id)?.snap;
    if (!next) return;
    setSnap(clone(next));
    setScenarioId(id);
    setHistory([]);
    setNotice(
      'Scenario loaded across Projects, Service and Talent Acquisition.',
    );
  }
  function persist(next: SavedScenario[]) {
    setSaved(next);
    if (!sessionOnly)
      try {
        localStorage.setItem(storageKey(d), JSON.stringify(next));
      } catch {
        setError(
          'Browser storage is unavailable. Export the scenario to keep your work.',
        );
      }
  }
  function saveScenario(name: string, overwrite = false) {
    const next: SavedScenario = {
      schemaVersion: 2,
      datasetId: datasetId(d),
      id: overwrite && currentSaved ? currentSaved.id : uid(),
      name: name.trim() || 'My workforce plan',
      savedAt: new Date().toISOString(),
      snapshot: clone(snap),
    };
    persist([...saved.filter((s) => s.id !== next.id), next]);
    setScenarioId(next.id);
    setSaveModal(false);
    setNotice(
      sessionOnly
        ? 'Scenario saved for this session. Export it before closing the page.'
        : 'Scenario saved in this browser.',
    );
  }
  function addRec(r: Recommendation) {
    change((s) => {
      s.actions.push({ ...clone(r.action), id: uid(), src: 'plan' });
    });
    setNotice(
      `${kindName(r.action.kind)} added to the shared plan. ${r.action.kind === 'hire' ? 'It now appears in Talent Acquisition; no external requisition has been submitted.' : 'No change was sent to BuildOps.'}`,
    );
  }
  function saveAction(a: CapacityAction) {
    change((s) => {
      const i = s.actions.findIndex((v) => v.id === a.id);
      if (i < 0) s.actions.push(a);
      else s.actions[i] = a;
    });
    setActionModal(null);
    setNotice('Capacity action updated across all three areas.');
  }
  const addAction = () =>
    setActionModal(
      makeAction(d, {
        kind: 'hire',
        dk: depts[0] ?? 'GW',
        tk: trades[0] ?? 'PF',
        qty: 1,
        from: 16,
      }),
    );
  const pageLink = (a: Area, p: Page) => `#/${a}/${p}`;
  const scenarioName =
    currentSaved?.name ??
    seeds.find((s) => s.id === scenarioId)?.name ??
    'Base plan';
  const countBucket = (name: string, list = scopedActions) =>
    sum(list.filter((a) => bucket(d, a) === name).map((a) => a.qty));
  const drilldown = selected && selectedCell && (
    <Card
      title={`${deptName(selected.dk)} · ${tradeName(selected.tk)}`}
      subtitle={`Week of ${displayDate(d.weeks[selected.i].weekStart)} · workload contributors`}
      id="workload-detail"
      tools={<button onClick={() => setSelected(null)}>Close detail</button>}
    >
      <div className="ws-mini-metrics">
        <span>
          Demand <b>{fmt(total(selectedCell) / HPF, 1)} people</b>
        </span>
        <span>
          Secured <b>{fmt(selectedCell.capConf / HPF, 1)}</b>
        </span>
        <span>
          Planned additions <b>{fmt(selectedCell.planned / HPF, 1)}</b>
        </span>
        <span className="danger">
          Short on selected basis <b>{fmt(selectedCell.gap / HPF, 1)}</b>
        </span>
      </div>
      <div className="ws-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Job / work</th>
              <th>Source</th>
              <th>Hours</th>
              <th>People</th>
            </tr>
          </thead>
          <tbody>
            {selectedContrib.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>{p.source}</small>
                </td>
                <td>{p.type}</td>
                <td>{fmt(p.hours, 1)}</td>
                <td>{fmt(p.hours / HPF, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!selectedContrib.length && (
        <Empty title="No workload in this week">
          Select a future week with demand to see contributing work.
        </Empty>
      )}
      <p className="ws-fine">
        People are productive equivalents, not named workers. Department
        surpluses do not cover another department’s gap.
      </p>
      <button
        onClick={() =>
          setActionModal(
            makeAction(d, {
              kind: 'subcontract',
              dk: selected.dk,
              tk: selected.tk,
              qty: Math.max(1, Math.ceil(selectedCell.gap / HPF)),
              from: Math.max(selected.i - PAST, 6),
              to: Math.max(selected.i - PAST + 7, 13),
            }),
          )
        }
      >
        Plan coverage for this gap
      </button>
    </Card>
  );

  return (
    <div className="ws-app">
      <header className="ws-top">
        <a href={pageLink('projects', 'overview')} className="ws-brand">
          <img src={logo} alt="Upchurch" />
        </a>
        <span className="ws-product">WORKFORCE PLANNER</span>
        <nav aria-label="Workforce areas">
          {(['projects', 'service', 'hiring'] as const).map((a) => (
            <a
              key={a}
              href={pageLink(a, pages[a][0][0])}
              aria-current={area === a ? 'page' : undefined}
            >
              {a === 'hiring'
                ? 'Talent Acquisition'
                : a === 'service'
                  ? 'Service'
                  : 'Projects'}
            </a>
          ))}
        </nav>
        <span className="ws-data-badge">
          {sessionOnly ? 'Session data' : 'Sample data'}
        </span>
        <button className="ws-top-button" onClick={onExit}>
          Change dataset
        </button>
      </header>
      <div className="ws-subnav">
        <nav aria-label={`${area} sections`}>
          {pages[area].map(([key, name]) => (
            <a
              key={key}
              href={pageLink(area, key)}
              aria-current={page === key ? 'page' : undefined}
            >
              {name}
            </a>
          ))}
        </nav>
        <a href="#/legacy">Monthly planner ↗</a>
      </div>
      <div className="ws-data-strip">
        <span>
          <b>{sessionOnly ? 'SESSION ONLY' : 'SAMPLE PLAN'}</b> · As of{' '}
          {displayDate(d.reference.constants.WEEK0)} ·{' '}
          {sessionOnly
            ? 'No data is uploaded or saved automatically.'
            : 'Fabricated data. No live BuildOps, HR or Talent Acquisition connection.'}
        </span>
        <details>
          <summary>Sources & assumptions</summary>
          <div>
            {d.metadata?.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            <p>
              Productive capacity: {HPF} hours/person/week. Average
              nonproductive allowances cover routine time; named events
              represent additional unavailability. Roster reductions are never
              counted as secured replacement coverage.
            </p>
            <p>
              All rates and lead times in the sample are illustrative. Hiring
              milestones marked “target” are calculated estimates.
              Cross-department labor transfers require an explicit plan action.
            </p>
          </div>
        </details>
      </div>
      {page !== 'roadmap' && (
        <div className="ws-controls">
          <label>
            <span className="ws-eyebrow">
              Scenario · shared across all areas
            </span>
            <select
              aria-label="Scenario"
              value={scenarioId}
              onChange={(e) => chooseScenario(e.target.value)}
            >
              {seeds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ws-control-actions">
            <button
              onClick={() => {
                setSaveName(`${scenarioName} copy`);
                setSaveModal(true);
              }}
            >
              Save as…
            </button>
            {currentSaved && (
              <button
                disabled={!dirty}
                onClick={() => saveScenario(currentSaved.name, true)}
              >
                <Save size={14} />
                Save
              </button>
            )}
          </div>
          <div className="ws-picker">
            <span className="ws-eyebrow">Department</span>
            <button
              aria-expanded={picker === 'departments'}
              onClick={() =>
                setPicker(picker === 'departments' ? null : 'departments')
              }
            >
              {depts.length === availableDepts.length
                ? 'All departments'
                : depts.map(deptName).join(', ')}
              <ChevronDown size={14} />
              <small>{depts.length} selected · gaps kept separate</small>
            </button>
            {picker === 'departments' && (
              <div className="ws-picker-menu">
                <button
                  onClick={() =>
                    setDeptSelection((p) => ({ ...p, [area]: availableDepts }))
                  }
                >
                  Select all
                </button>
                {availableDepts.map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={depts.includes(k)}
                      onChange={(e) =>
                        setDeptSelection((p) => ({
                          ...p,
                          [area]: e.target.checked
                            ? [...depts, k]
                            : depts.length > 1
                              ? depts.filter((v) => v !== k)
                              : depts,
                        }))
                      }
                    />
                    {deptName(k)}
                  </label>
                ))}
                <button onClick={() => setPicker(null)}>Done</button>
              </div>
            )}
          </div>
          <div className="ws-picker">
            <span className="ws-eyebrow">Labor categories</span>
            <button
              aria-expanded={picker === 'trades'}
              onClick={() => setPicker(picker === 'trades' ? null : 'trades')}
            >
              {trades.length === availableTrades.length
                ? 'All labor categories'
                : trades.map(tradeName).join(', ')}
              <ChevronDown size={14} />
              <small>{trades.length} selected</small>
            </button>
            {picker === 'trades' && (
              <div className="ws-picker-menu">
                <button
                  onClick={() =>
                    setTradeSelection((p) => ({
                      ...p,
                      [area]: availableTrades,
                    }))
                  }
                >
                  Select all
                </button>
                {availableTrades.map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={trades.includes(k)}
                      onChange={(e) =>
                        setTradeSelection((p) => ({
                          ...p,
                          [area]: e.target.checked
                            ? [...trades, k]
                            : trades.length > 1
                              ? trades.filter((v) => v !== k)
                              : trades,
                        }))
                      }
                    />
                    {tradeName(k)}
                  </label>
                ))}
                <button onClick={() => setPicker(null)}>Done</button>
              </div>
            )}
          </div>
          <Segments
            label="Soft backlog"
            values={['Off', 'At confidence', 'At 100%'] as const}
            value={
              snap.softMode === 'off'
                ? 'Off'
                : snap.softMode === 'all'
                  ? 'At 100%'
                  : 'At confidence'
            }
            onChange={(v) =>
              change((s) => {
                s.softMode =
                  v === 'Off' ? 'off' : v === 'At 100%' ? 'all' : 'weighted';
              })
            }
          />
          <label className="ws-check">
            <input
              type="checkbox"
              checked={snap.includeProposed}
              onChange={(e) =>
                change((s) => {
                  s.includeProposed = e.target.checked;
                })
              }
            />
            Proposed jobs <small>separate from soft backlog</small>
          </label>
          <div className="ws-control-actions">
            <button
              title="Export current scenario"
              onClick={() =>
                downloadJson('workforce-scenario.json', {
                  schemaVersion: 2,
                  datasetId: datasetId(d),
                  name: scenarioName,
                  snapshot: snap,
                })
              }
            >
              <Download size={14} />
              Export
            </button>
            <button onClick={() => importRef.current?.click()}>
              <FileUp size={14} />
              Import
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import scenario"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  if (f.size > 5e6)
                    throw new Error(
                      'Scenario files must be smaller than 5 MB.',
                    );
                  const next = importScenario(JSON.parse(await f.text()), d);
                  persist([...saved, next]);
                  setScenarioId(next.id);
                  setSnap(next.snapshot);
                  setHistory([]);
                  setNotice('Scenario imported into all three areas.');
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Import failed.',
                  );
                }
              }}
            />
          </div>
        </div>
      )}
      {dirty && (
        <div className="ws-unsaved">
          <span>
            <b>Unsaved changes</b> · Preview applies across all three areas.
          </span>
          <div>
            <button
              disabled={!history.length}
              onClick={() => {
                const prev = history.at(-1);
                if (prev) {
                  setSnap(prev);
                  setHistory(history.slice(0, -1));
                }
              }}
            >
              Undo
            </button>
            <button
              onClick={() => {
                setSnap(clone(baseline));
                setHistory([]);
              }}
            >
              Revert to saved
            </button>
            <button
              onClick={() => {
                if (currentSaved) saveScenario(currentSaved.name, true);
                else {
                  setSaveName('My workforce plan');
                  setSaveModal(true);
                }
              }}
            >
              Save plan
            </button>
          </div>
        </div>
      )}
      {notice && (
        <div className="ws-notice" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="ws-error" role="alert">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      <main className="ws-main">
        {page === 'overview' && (
          <>
            <div className="ws-metrics">
              <Metric
                label="Largest gap · selected basis"
                value={`${fmt((largest?.c.gap ?? 0) / HPF, 1)} people`}
                detail={
                  largest
                    ? `${tradeName(largest.tk)} · ${deptName(largest.dk)} · ${displayDate(d.weeks[largest.i].weekStart)}`
                    : 'No shortage in this selection'
                }
                tone="danger"
                onClick={() => largest && setSelected(largest)}
              />
              <Metric
                label="Category-weeks over capacity"
                value={`${fmt(shortWeeks)} / ${fmt(allCells.length)}`}
                detail="Next 52 weeks · counted per department and trade"
                tone="warning"
              />
              <Metric
                label="Applied hours re-forecast"
                value={`${netReforecast >= 0 ? '+' : ''}${fmt(netReforecast)} hrs`}
                detail={`${pending.length} job/category lines waiting for review`}
              />
              <Metric
                label="Signed-work runway"
                value={(() => {
                  const fut = rows.slice(PAST);
                  const index = fut.findIndex(
                    (r, i) =>
                      r.hard <
                        (basis === 'confirmed' ? r.secured : r.capacity) *
                          0.6 &&
                      fut
                        .slice(i)
                        .every(
                          (a) =>
                            a.hard <
                            (basis === 'confirmed' ? a.secured : a.capacity) *
                              0.6,
                        ),
                  );
                  return index < 0 ? '52+ weeks' : `${index} weeks`;
                })()}
                detail="When signed workload stays below 60% of selected capacity"
              />
            </div>
            <Card
              title="Labor capacity vs. workload"
              subtitle="Eight weeks of dispatch history, then the forecast. Select a week to inspect the jobs behind it."
              tools={
                <>
                  <button onClick={addAction}>
                    <Plus size={14} />
                    Add capacity action
                  </button>
                  <button onClick={() => setProjectModal('new')}>
                    Add project
                  </button>
                </>
              }
            >
              <div className="ws-chart-controls">
                <Segments
                  label="View"
                  values={['Summary', 'Components'] as const}
                  value={chartMode}
                  onChange={setChartMode}
                />
                <Segments
                  label="Count gaps against"
                  values={['Confirmed capacity', 'If plan succeeds'] as const}
                  value={
                    basis === 'confirmed'
                      ? 'Confirmed capacity'
                      : 'If plan succeeds'
                  }
                  onChange={(v) =>
                    setBasis(v === 'Confirmed capacity' ? 'confirmed' : 'plan')
                  }
                />
                <Segments
                  label="Units"
                  values={['People', 'Hours', 'Cost'] as const}
                  value={units}
                  onChange={setUnits}
                />
                <Segments
                  label="Weeks"
                  values={[13, 26, 52]}
                  value={horizon}
                  onChange={setHorizon}
                />
              </div>
              <Chart
                data={d}
                rows={rows}
                units={units}
                horizon={horizon}
                components={chartMode === 'Components'}
                onSelect={(i) => selectWeek(i)}
                selected={selected?.i}
              />
              <p className="ws-fine">
                Departments keep separate crews. The combined chart can show
                both a shortage and spare capacity in the same week. People =
                productive hours ÷ {HPF}. Cost is an indicative $50/hour blended
                display; action costs use trade-specific rates.
              </p>
              {snap.actions.length > 0 && (
                <div className="ws-plan-strip">
                  <b>{snap.actions.length} changes in this plan</b>
                  <span>
                    Local planning actions · not submitted to BuildOps or a
                    hiring system.
                  </span>
                  <a href={pageLink('projects', 'actions')}>
                    Review action plan →
                  </a>
                </div>
              )}
            </Card>
            {drilldown}
            <Card
              title="Shortfall by labor category"
              subtitle="People short each week, summed department by department. Surplus in another department never cancels a shortage."
            >
              <ShortfallChart
                data={d}
                cube={cube}
                depts={depts}
                trades={trades}
                horizon={horizon}
                onSelect={(i, tk) => selectWeek(i, undefined, tk)}
              />
            </Card>
            <Card
              title="Where the pinch is"
              subtitle="Tightest selected labor category in each department and week. Select a cell for its contributing jobs."
              tools={
                <button
                  onClick={() => {
                    if (largest) setSelected(largest);
                  }}
                >
                  Jump to largest gap
                </button>
              }
            >
              <div className="ws-table-scroll">
                <table className="ws-heatmap">
                  <thead>
                    <tr>
                      <th>Department</th>
                      {d.weeks.slice(PAST, PAST + horizon).map((w) => (
                        <th key={w.i}>
                          {new Date(w.weekStart).getUTCDate() <= 7
                            ? new Date(w.weekStart).toLocaleDateString(
                                'en-US',
                                { timeZone: 'UTC', month: 'short' },
                              )
                            : ''}
                        </th>
                      ))}
                      <th>Peak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map((dk) => {
                      const best = d.weeks.slice(PAST, PAST + horizon).map(
                        (w) =>
                          trades
                            .map((tk) => {
                              const c = cube[dk]?.[tk]?.[w.i];
                              return {
                                tk,
                                c,
                                util: c
                                  ? capFor(c, basis)
                                    ? total(c) / capFor(c, basis)
                                    : total(c)
                                      ? 2
                                      : 0
                                  : 0,
                              };
                            })
                            .sort((a, b) => b.util - a.util)[0],
                      );
                      return (
                        <tr key={dk}>
                          <th>{deptName(dk)}</th>
                          {best.map((b, n) => (
                            <td key={n}>
                              <button
                                className={`level-${b.util > 1.1 ? 4 : b.util > 1 ? 3 : b.util > 0.9 ? 2 : b.util > 0.7 ? 1 : 0}`}
                                aria-label={`${deptName(dk)}, ${tradeName(b.tk)}, ${d.weeks[PAST + n].weekStart}, ${fmt(b.util * 100)} percent`}
                                title={`${tradeName(b.tk)} · ${d.weeks[PAST + n].weekStart} · ${fmt(b.util * 100)}%`}
                                onClick={() =>
                                  setSelected({ dk, tk: b.tk, i: PAST + n })
                                }
                              />
                            </td>
                          ))}
                          <td>
                            {fmt(Math.max(0, ...best.map((b) => b.util)) * 100)}
                            %
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="ws-fine">
                Gray &lt;70% · green 70–90% · yellow 90–100% · orange 100–110% ·
                red &gt;110%.
              </p>
            </Card>
            <Card
              title="Next decisions"
              subtitle="Recommendations reserve existing requisitions to avoid requesting the same hire twice. Any capacity still awaiting confirmation remains a visible risk."
            >
              <RecommendationList
                recs={scopedRecs.slice(0, 5)}
                d={d}
                add={addRec}
              />
              <a href={pageLink('projects', 'actions')}>
                See every action and recommendation →
              </a>
            </Card>
          </>
        )}

        {page === 'actions' && (
          <>
            <div className="ws-intro">
              <span className="ws-eyebrow">
                ACTION PLAN ·{' '}
                {depts.length === 1
                  ? deptName(depts[0])
                  : 'ALL SELECTED DEPARTMENTS'}
              </span>
              <h1>Start in time to have people ready.</h1>
              <p>
                Act-by dates include recruiting, onboarding and ramp-up. Source
                records are read-only; planning actions can be edited here.
              </p>
              <button onClick={addAction}>
                <Plus size={14} />
                Add capacity action
              </button>
            </div>
            <div className="ws-metrics">
              <Metric
                label="Overdue"
                value={fmt(countBucket('Overdue'), 1)}
                detail="Unstarted actions past their act-by date"
                tone="danger"
              />
              <Metric
                label="Start this week"
                value={fmt(countBucket('Start this week'), 1)}
                detail={`Planning week of ${displayDate(d.reference.constants.WEEK0)}`}
                tone="warning"
              />
              <Metric
                label="In progress"
                value={fmt(countBucket('In progress'), 1)}
                detail="Recruiting, sourcing or vetting already underway"
              />
              <Metric
                label="Secured additions"
                value={fmt(countBucket('Secured'), 1)}
                detail="Known absences and departures excluded"
              />
            </div>
            <Card
              title="Gaps and the actions that cover them"
              subtitle="Every timeline uses the same milestones as Talent Acquisition."
            >
              <Timeline
                data={d}
                actions={scopedActions.filter((a) => !negative(a))}
                onSelect={setActionModal}
              />
            </Card>
            <Card
              title="Every capacity action"
              subtitle="Shared by Projects, Service and Talent Acquisition."
            >
              <ActionTable
                actions={scopedActions.filter((a) => !negative(a))}
                d={d}
                onSelect={setActionModal}
              />
            </Card>
            <Card
              title="Recommendations for uncovered work"
              subtitle="Existing unfilled requisitions are reserved. Suggested actions are local until you explicitly enter them in the system of record."
            >
              <RecommendationList recs={scopedRecs} d={d} add={addRec} />
            </Card>
            <Card
              title="Known capacity reductions"
              subtitle="Leave, training and departures reduce available crew. They do not mean coverage has been secured."
            >
              <ActionTable
                actions={scopedActions.filter(negative)}
                d={d}
                onSelect={setActionModal}
              />
            </Card>
          </>
        )}

        {page === 'projects' && (
          <>
            <div className="ws-metrics">
              {(['hard', 'soft', 'proposed'] as const).map((type) => {
                const ps = projects.filter(
                  (p) => p.type === type && depts.includes(p.dept),
                );
                return (
                  <Metric
                    key={type}
                    label={
                      type === 'hard'
                        ? 'Signed work'
                        : type === 'soft'
                          ? 'Soft backlog'
                          : 'Proposed'
                    }
                    value={money(
                      sum(
                        ps
                          .filter((p) => weight(snap, p) > 0)
                          .map((p) => p.value * 1e6),
                      ),
                    )}
                    detail={`${ps.filter((p) => weight(snap, p) > 0).length} of ${ps.length} included · ${type === 'hard' ? 'signed' : 'confidence-weighted demand'}`}
                  />
                );
              })}
              <Metric
                label="Total projects"
                value={projects.filter((p) => depts.includes(p.dept)).length}
                detail="Include/exclude is specific to this scenario"
              />
            </div>
            <Card
              title="Projects"
              subtitle="Each job keeps its own weekly plan and trade mix. Confidence weights expected workload; winning a job requires its full crew."
              tools={
                <button
                  className="primary"
                  onClick={() => setProjectModal('new')}
                >
                  <Plus size={14} />
                  Add project
                </button>
              }
            >
              <div className="ws-chart-controls">
                <Segments
                  label="Project type"
                  values={['All', 'Signed', 'Soft backlog', 'Proposed']}
                  value={projectType}
                  onChange={setProjectType}
                />
                <label className="ws-search">
                  <span className="ws-eyebrow">Find a project</span>
                  <input
                    type="search"
                    placeholder="Name, job number or project manager"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="ws-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>In</th>
                      <th>Project</th>
                      <th>Type</th>
                      <th>Department</th>
                      <th>Value</th>
                      <th>Schedule</th>
                      <th>Confidence</th>
                      <th>Peak crew</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {projects
                      .filter(
                        (p) =>
                          depts.includes(p.dept) &&
                          (projectType === 'All' ||
                            p.type ===
                              (
                                {
                                  Signed: 'hard',
                                  'Soft backlog': 'soft',
                                  Proposed: 'proposed',
                                } as Record<string, string>
                              )[projectType]) &&
                          `${p.name} ${p.job ?? ''} ${p.pm ?? ''}`
                            .toLowerCase()
                            .includes(projectSearch.toLowerCase()),
                      )
                      .map((p) => {
                        const series = d.weeks.map((w) =>
                          sum(Object.values(p.plan).map((v) => v?.[w.i] ?? 0)),
                        );
                        const fullPeak =
                          Math.max(0, ...series.slice(PAST)) / HPF;
                        return (
                          <tr key={p.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Include ${p.name}`}
                                checked={snap.on[p.id] ?? p.on !== false}
                                onChange={(e) =>
                                  change((s) => {
                                    s.on[p.id] = e.target.checked;
                                  })
                                }
                              />
                            </td>
                            <td>
                              <b>{p.name}</b>
                              <small>
                                {p.job ? `Job ${p.job} · PM ${p.pm}` : p.src}
                              </small>
                            </td>
                            <td>
                              <span className={`ws-tag ${p.type}`}>
                                {p.type === 'hard'
                                  ? 'SIGNED'
                                  : p.type.toUpperCase()}
                              </span>
                            </td>
                            <td>{deptName(p.dept)}</td>
                            <td>{money(p.value * 1e6)}</td>
                            <td>
                              {displayDate(dateAt(d, p.start))}
                              <small>
                                to {displayDate(dateAt(d, p.start + p.dur - 1))}
                              </small>
                            </td>
                            <td>
                              {p.type === 'hard' ? (
                                'Signed'
                              ) : (
                                <label className="ws-prob">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    aria-label={`Confidence for ${p.name}`}
                                    value={Math.round(
                                      (snap.prob[p.id] ?? p.prob) * 100,
                                    )}
                                    onChange={(e) =>
                                      change((s) => {
                                        s.prob[p.id] =
                                          Math.max(
                                            0,
                                            Math.min(
                                              100,
                                              Number(e.target.value),
                                            ),
                                          ) / 100;
                                      })
                                    }
                                  />
                                  %
                                </label>
                              )}
                            </td>
                            <td>
                              {fmt(fullPeak * weight(snap, p), 1)}
                              <small>{fmt(fullPeak, 1)} at 100%</small>
                            </td>
                            <td>
                              {p.user ? (
                                <>
                                  <button
                                    onClick={() =>
                                      setProjectModal(
                                        snap.extra.find((v) => v.id === p.id) ??
                                          'new',
                                      )
                                    }
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() =>
                                      change((s) => {
                                        s.extra = s.extra.filter(
                                          (v) => v.id !== p.id,
                                        );
                                        delete s.on[p.id];
                                        delete s.prob[p.id];
                                      })
                                    }
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() =>
                                    setForecastModal({
                                      project: p,
                                      trade: Object.keys(p.plan)[0] as TradeKey,
                                    })
                                  }
                                >
                                  Edit forecast
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="ws-fine">
                Proposed jobs have their own inclusion control. Turning soft
                backlog Off does not exclude proposed jobs. Controls and BAS
                programming scope routes to Building Automation.
              </p>
            </Card>
          </>
        )}

        {page === 'forecast' && (
          <>
            <div className="ws-intro">
              <span className="ws-eyebrow">
                FORECAST UPDATE · DISPATCH THROUGH{' '}
                {displayDate(dateAt(d, -1 / 7))}
              </span>
              <h1>Reconcile hours. Confirm what changed.</h1>
              <p>
                Planned minus dispatched hours are spread over each job’s
                remaining curve. Budget stays fixed and finish dates hold.
                Above-plan hours require a progress-versus-overrun decision.
              </p>
            </div>
            <div className="ws-metrics">
              <Metric
                label="Applied hours re-forecast"
                value={`${netReforecast >= 0 ? '+' : ''}${fmt(netReforecast)} hrs`}
                detail="Same applied total as the Overview"
              />
              <Metric
                label="Needs PM review"
                value={pending.length}
                detail="Over-dispatch or variance of 12% or more"
                tone="warning"
              />
              <Metric
                label="Remaining workload"
                value={fmt(sum(pendingLines.map((v) => v.f.remPlan)))}
                detail="Planned hours before accepted adjustments"
              />
              <Metric
                label="Review decisions"
                value={Object.keys(snap.review).length}
                detail="Stored in this scenario, shared across the app"
              />
            </div>
            <Card
              title="Forecast changes by job and labor category"
              subtitle="Pending changes do not affect workload until accepted. Review each overrun individually."
              tools={
                <Segments
                  label="Show"
                  values={['Needs review', 'All'] as const}
                  value={reviewFilter}
                  onChange={setReviewFilter}
                />
              }
            >
              <div className="ws-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Job · category</th>
                      <th>History plan / actual</th>
                      <th>To re-spread</th>
                      <th>Remaining hours</th>
                      <th>Status</th>
                      <th>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingLines
                      .filter(
                        (r) =>
                          reviewFilter === 'All' || r.f.status === 'pending',
                      )
                      .sort((a, b) => Math.abs(b.f.delta) - Math.abs(a.f.delta))
                      .map(({ p, tk, f }) => (
                        <tr key={f.key}>
                          <td>
                            <b>{p.name}</b>
                            <small>
                              {deptName(route(p, tk))} · {tradeName(tk)} ·{' '}
                              {p.job}
                            </small>
                          </td>
                          <td>
                            {fmt(f.planned)} / {fmt(f.done)}
                          </td>
                          <td className={f.delta > 0 ? 'danger' : ''}>
                            {f.delta >= 0 ? '+' : ''}
                            {fmt(f.delta)} hrs
                          </td>
                          <td>
                            {fmt(f.remPlan)} →{' '}
                            {fmt(
                              Math.max(
                                0,
                                f.remPlan + (f.applied ? sum(f.add) : f.delta),
                              ),
                            )}
                            <small>
                              {f.applied ? 'Applied' : 'Proposed, not applied'}
                            </small>
                          </td>
                          <td>
                            <span className="ws-tag">{f.status}</span>
                          </td>
                          <td>
                            <div className="ws-row-buttons">
                              {f.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() =>
                                      change((s) => {
                                        s.review[f.key] = 'accepted';
                                      })
                                    }
                                  >
                                    {f.delta < 0
                                      ? 'Progress matches · reduce remaining'
                                      : 'Accept carryover'}
                                  </button>
                                  <button
                                    onClick={() =>
                                      change((s) => {
                                        s.review[f.key] = 'held';
                                      })
                                    }
                                  >
                                    {f.delta < 0
                                      ? 'Overrun · keep remaining'
                                      : 'Keep original'}
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() =>
                                  setForecastModal({ project: p, trade: tk })
                                }
                              >
                                Edit forecast
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {pending.length === 0 && reviewFilter === 'Needs review' && (
                <Empty title="Review complete">
                  All forecast changes have been reviewed or applied
                  automatically.
                </Empty>
              )}
            </Card>
          </>
        )}

        {page === 'outlook' &&
          !d.service.agreements.length &&
          !d.service.openJobs.length && (
            <Card title="Service data has not been supplied">
              <Empty title="No Service feed in this dataset">
                Open a weekly dataset containing agreements, visits, open jobs
                and technician rosters to use the Service outlook. The imported
                monthly project data remains available in Projects. Missing
                Service data is not treated as zero workload or available crew.
              </Empty>
            </Card>
          )}
        {page === 'outlook' &&
          (d.service.agreements.length > 0 ||
            d.service.openJobs.length > 0) && (
            <>
              <div className="ws-intro">
                <span className="ws-eyebrow">SERVICE WORKFORCE OUTLOOK</span>
                <h1>Can we cover maintenance and expected calls?</h1>
                <p>
                  Horn Lake Service · HVAC and plumbing are separate technician
                  pools. Dispatch, work orders, billing and renewals remain in
                  BuildOps.
                </p>
                <div className="ws-chart-controls">
                  <Segments
                    label="Call volume"
                    values={['Expected', 'High demand'] as const}
                    value={
                      service.demand === 'high' ? 'High demand' : 'Expected'
                    }
                    onChange={(v) =>
                      changeService((s) => {
                        s.demand = v === 'Expected' ? 'expected' : 'high';
                      })
                    }
                  />
                  <Segments
                    label="Renewals"
                    values={['Include pending', 'Signed only'] as const}
                    value={service.renewals ? 'Include pending' : 'Signed only'}
                    onChange={(v) =>
                      changeService((s) => {
                        s.renewals = v === 'Include pending';
                      })
                    }
                  />
                  <Segments
                    label="Leveling"
                    values={['Current schedule', 'Preview moves'] as const}
                    value={
                      service.leveling ? 'Preview moves' : 'Current schedule'
                    }
                    onChange={(v) =>
                      changeService((s) => {
                        s.leveling = v === 'Preview moves';
                      })
                    }
                  />
                </div>
              </div>
              <div className="ws-metrics">
                {(['HS', 'PS'] as const).map((tk) => {
                  const col = cube.HLS[tk].slice(PAST, PAST + 13);
                  const max = Math.max(
                    0,
                    ...col.map((c) => Math.max(0, total(c) - c.capConf)),
                  );
                  const idx = col.findIndex(
                    (c) => total(c) - c.capConf === max,
                  );
                  return (
                    <Metric
                      key={tk}
                      label={`${tk === 'HS' ? 'HVAC' : 'Plumbing'} coverage · 13 weeks`}
                      value={`${col.filter((c) => (total(c) - c.capConf) / HPF > d.reference.constants.SHORT_TE).length} of 13 short`}
                      detail={`Largest gap ${fmt(max)} hrs (${fmt(max / HPF, 1)} tech equivalents)`}
                      tone={max > 0 ? 'danger' : ''}
                      onClick={() =>
                        setSelected({
                          dk: 'HLS',
                          tk,
                          i: PAST + Math.max(0, idx),
                        })
                      }
                    />
                  );
                })}
                <Metric
                  label="Overdue maintenance"
                  value={`${d.service.agreements.flatMap((a) => a.visits).filter((v) => v.status === 'overdue').length} visits`}
                  detail={`${fmt(sum((['HS', 'PS'] as const).flatMap((tk) => calculation.services[tk].layers.carry)))} hrs in the forecast`}
                  tone="warning"
                  onClick={() => setServiceDetail('Carryover and leveling')}
                />
                <Metric
                  label="Renewals at expected likelihood"
                  value={`${fmt(sum((['HS', 'PS'] as const).flatMap((tk) => calculation.services[tk].layers.renE.slice(PAST, PAST + 13))))} hrs`}
                  detail="Next 13 weeks · respects the shared soft-backlog setting"
                  onClick={() => setServiceDetail('Renewals')}
                />
              </div>
              <Card
                title="Weekly demand vs. technician capacity"
                subtitle="Select a week to see the work behind it."
                tools={
                  <>
                    <Segments
                      label="Weeks"
                      values={[13, 52]}
                      value={horizon === 26 ? 13 : horizon}
                      onChange={setHorizon}
                    />
                    <Segments
                      label="Units"
                      values={['People', 'Hours'] as const}
                      value={units === 'Cost' ? 'Hours' : units}
                      onChange={setUnits}
                    />
                  </>
                }
              >
                {(['HS', 'PS'] as const)
                  .filter((tk) => trades.includes(tk))
                  .map((tk) => (
                    <div key={tk}>
                      <h3>
                        {tradeName(tk)}{' '}
                        <small>
                          {fmt(d.crews.headcount.HLS[tk] ?? 0)} on the roster
                        </small>
                      </h3>
                      <Chart
                        data={d}
                        rows={aggregate(d, cube, ['HLS'], [tk])}
                        units={units === 'Cost' ? 'Hours' : units}
                        horizon={horizon === 26 ? 13 : horizon}
                        service
                        onSelect={(i) => setSelected({ dk: 'HLS', tk, i })}
                        selected={selected?.tk === tk ? selected.i : undefined}
                      />
                    </div>
                  ))}
                <p className="ws-fine">
                  Technician equivalents = hours ÷ {HPF}; 2.4 means about{' '}
                  {fmt(2.4 * HPF)} hours of work. Missing timesheets are shown
                  as incomplete data, never as zero actual hours.
                </p>
              </Card>
              {drilldown}
              <Card
                title="Decisions"
                subtitle="Each recommendation shows its estimated effect before you add it to the plan."
              >
                <RecommendationList
                  recs={scopedRecs.slice(0, 6)}
                  d={d}
                  add={addRec}
                />
                <div className="ws-decision">
                  <div>
                    <b>Move eligible maintenance into quieter weeks</b>
                    <p>
                      Visits stay within their allowed service windows. Total
                      hours are preserved; changes are previews until Dispatch
                      reschedules them.
                    </p>
                    {service.leveling && (
                      <p>
                        <b>
                          {fmt(
                            sum(
                              (['HS', 'PS'] as const).map(
                                (tk) => calculation.services[tk].moves.length,
                              ),
                            ),
                          )}{' '}
                          visits ·{' '}
                          {fmt(
                            sum(
                              (['HS', 'PS'] as const).flatMap((tk) =>
                                calculation.services[tk].moves.map(
                                  (m) => m.hours,
                                ),
                              ),
                            ),
                          )}{' '}
                          hours moved
                        </b>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      changeService((s) => {
                        s.leveling = !s.leveling;
                      });
                      setServiceDetail('Carryover and leveling');
                    }}
                  >
                    {service.leveling ? 'Clear preview' : 'Preview the moves'}
                  </button>
                </div>
                <a href={pageLink('service', 'actions')}>
                  See the Service action plan →
                </a>
              </Card>
              <Card
                title="Supporting detail"
                subtitle="Evidence behind the coverage cards and decisions."
              >
                <div
                  className="ws-detail-tabs"
                  role="tablist"
                  aria-label="Service supporting detail"
                >
                  {[
                    'Agreements and burn rate',
                    'Renewals',
                    'Carryover and leveling',
                    'Open jobs and calls',
                    'Assumptions and sources',
                  ].map((tab) => (
                    <button
                      role="tab"
                      aria-selected={serviceDetail === tab}
                      key={tab}
                      onClick={() => setServiceDetail(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {serviceDetail === 'Agreements and burn rate' && (
                  <>
                    <div className="ws-mini-metrics">
                      <span>
                        Actual logged{' '}
                        <b>
                          {fmt(
                            sum(
                              d.service.agreements.map(
                                (a) => burn(d, snap, a).actual,
                              ),
                            ),
                          )}{' '}
                          hrs
                        </b>
                      </span>
                      <span>
                        Incomplete data{' '}
                        <b>
                          {fmt(
                            sum(
                              d.service.agreements.map(
                                (a) => burn(d, snap, a).missingHours,
                              ),
                            ),
                          )}{' '}
                          budgeted hrs
                        </b>
                      </span>
                      <span>
                        Projected total{' '}
                        <b>
                          {fmt(
                            sum(
                              d.service.agreements.map(
                                (a) => burn(d, snap, a).projected,
                              ),
                            ),
                          )}{' '}
                          hrs
                        </b>
                      </span>
                    </div>
                    <div className="ws-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Agreement</th>
                            <th>Completed budget</th>
                            <th>Actual logged</th>
                            <th>Burn</th>
                            <th>Missing visits</th>
                            <th>Remaining forecast</th>
                            <th>Projected / budget</th>
                            <th aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {d.service.agreements
                            .map((a) => ({ a, b: burn(d, snap, a) }))
                            .sort((a, b) => b.b.ratio - a.b.ratio)
                            .map(({ a, b }) => (
                              <tr key={a.id}>
                                <td>
                                  <b>{a.name}</b>
                                  <small>
                                    {a.id} ·{' '}
                                    {d.service.visitPlans[a.tier]
                                      ? d.reference.serviceTiers[a.tier]
                                      : a.tier}{' '}
                                    · {a.trade}
                                  </small>
                                </td>
                                <td>{fmt(b.budgetDone, 1)}</td>
                                <td>{fmt(b.actual, 1)}</td>
                                <td className={b.ratio >= 1.15 ? 'danger' : ''}>
                                  {fmt(b.ratio * 100)}%
                                </td>
                                <td>{b.missing || '—'}</td>
                                <td>{fmt(b.remaining, 1)}</td>
                                <td>
                                  {fmt(b.projected)} / {fmt(b.budget)}
                                </td>
                                <td>
                                  <button onClick={() => setAgreementModal(a)}>
                                    Review
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="ws-fine">
                      Burn compares completed visits with complete timesheets.
                      Forecast factors are capped at 0.8–1.5 after two complete
                      visits. Missing visits retain their budget in the
                      projection. Each agreement uses its current contract year.
                    </p>
                  </>
                )}
                {serviceDetail === 'Renewals' && (
                  <div className="ws-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Agreement</th>
                          <th>Expiry</th>
                          <th>Act by</th>
                          <th>Owner</th>
                          <th>Status</th>
                          <th>Likelihood</th>
                          <th>Next-year hours</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {d.service.agreements
                          .filter((a) => a.ren && a.end >= -30 && a.end < 365)
                          .sort((a, b) => a.end - b.end)
                          .map((a) => (
                            <tr key={a.id}>
                              <td>
                                <b>{a.name}</b>
                                <small>{a.id}</small>
                              </td>
                              <td>{displayDate(dateAt(d, a.end / 7))}</td>
                              <td>
                                {displayDate(dateAt(d, a.ren!.deadline / 7))}
                              </td>
                              <td>{a.ren!.owner}</td>
                              <td>{a.ren!.label}</td>
                              <td>{fmt(a.ren!.p * 100)}%</td>
                              <td>
                                {fmt(
                                  sum(
                                    a.visits
                                      .filter((v) => v.ren && v.due < 365)
                                      .map((v) => v.bud),
                                  ),
                                )}
                              </td>
                              <td>
                                <button onClick={() => setAgreementModal(a)}>
                                  Scenario options
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {serviceDetail === 'Carryover and leveling' && (
                  <>
                    <h3>Overdue visits</h3>
                    <div className="ws-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Agreement / visit</th>
                            <th>Originally due</th>
                            <th>Hours</th>
                            <th>Scenario move</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.service.agreements.flatMap((a) =>
                            a.visits
                              .filter((v) => v.status === 'overdue')
                              .map((v) => (
                                <tr key={v.id}>
                                  <td>
                                    <b>{a.name}</b>
                                    <small>{v.id}</small>
                                  </td>
                                  <td>{displayDate(dateAt(d, v.due / 7))}</td>
                                  <td>
                                    {fmt(v.bud * burn(d, snap, a).factor, 1)}
                                  </td>
                                  <td>
                                    <button
                                      onClick={() => setAgreementModal(a)}
                                    >
                                      Review visit
                                    </button>
                                  </td>
                                </tr>
                              )),
                          )}
                        </tbody>
                      </table>
                    </div>
                    <h3>Leveling preview</h3>
                    {!service.leveling ? (
                      <p>
                        Choose Preview moves to calculate eligible shifts. No
                        BuildOps schedules will change.
                      </p>
                    ) : (
                      <div className="ws-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Agreement</th>
                              <th>From</th>
                              <th>To</th>
                              <th>Hours preserved</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(['HS', 'PS'] as const).flatMap((tk) =>
                              calculation.services[tk].moves.map((m) => (
                                <tr key={m.id}>
                                  <td>
                                    {m.name}
                                    <small>{m.id}</small>
                                  </td>
                                  <td>
                                    {displayDate(d.weeks[m.from].weekStart)}
                                  </td>
                                  <td>
                                    {displayDate(d.weeks[m.to].weekStart)}
                                  </td>
                                  <td>{fmt(m.hours, 1)}</td>
                                </tr>
                              )),
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
                {serviceDetail === 'Open jobs and calls' && (
                  <>
                    <div className="ws-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Open job</th>
                            <th>Site</th>
                            <th>Trade</th>
                            <th>Week</th>
                            <th>Hours</th>
                            <th>Billing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.service.openJobs.map((j) => (
                            <tr key={j.id}>
                              <td>
                                <b>{j.desc}</b>
                                <small>
                                  {j.id}
                                  {j.callback ? ' · Callback revisit' : ''}
                                </small>
                              </td>
                              <td>{j.site}</td>
                              <td>{tradeName(j.tk)}</td>
                              <td>{displayDate(dateAt(d, j.wk))}</td>
                              <td>{fmt(j.hrs)}</td>
                              <td>{j.bill}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="ws-fine">
                      Known jobs consume the call allowance first: additional
                      calls = max(0, historical expected calls − known jobs).
                      High demand uses the dataset’s{' '}
                      {fmt(d.service.highDemandMultiplier, 2)}× multiplier; it
                      is an illustrative stress case, not a validated
                      percentile.
                    </p>
                  </>
                )}
                {serviceDetail === 'Assumptions and sources' && (
                  <>
                    <h3>Hours to technician equivalents</h3>
                    <p>
                      {d.reference.constants.SV_PAID} paid hours less routine
                      allowances = {HPF} productive hours/week. Named extended
                      leave, departures and special training events are
                      additional deductions. Overtime is explicit.
                    </p>
                    <h3>Forecast rules</h3>
                    <ul>
                      <li>
                        Overdue visits: 60% this planning week, 40% next, unless
                        moved in the scenario.
                      </li>
                      <li>
                        Renewals use likelihood, or 100% when the shared
                        soft-backlog control is At 100%.
                      </li>
                      <li>
                        Leveling shifts flexible visits within each visit’s
                        permitted window. Hours are conserved.
                      </li>
                      <li>
                        Hiring and temp labor observe sourcing lead times.
                        Shortfalls inside lead time retain uncovered hours.
                      </li>
                    </ul>
                    <h3>Sources</h3>
                    <p>{d.metadata?.notes.join(' ')}</p>
                    <p>
                      No automatic sync, AI plan generation, renewal pricing,
                      callback scoring or system write-back is connected.
                    </p>
                  </>
                )}
              </Card>
            </>
          )}

        {page === 'queue' &&
          (() => {
            const existing = scopedActions.filter((a) => a.kind === 'hire');
            const recommended = scopedRecs.filter(
              (r) => r.action.kind === 'hire',
            );
            const queue = [...existing, ...recommended.map((r) => r.action)];
            const fill =
              sum(existing.filter((a) => !secured(d, a)).map((a) => a.qty)) +
              sum(recommended.map((r) => r.action.qty));
            const joining = sum(
              existing.filter((a) => secured(d, a)).map((a) => a.qty),
            );
            const groups = [
              'Overdue',
              'Start this week',
              'Next 4 weeks',
              'In progress',
              'Later',
              'Secured',
            ];
            return (
              <>
                <div className="ws-intro">
                  <span className="ws-eyebrow">TALENT ACQUISITION</span>
                  <h1>When to start hiring.</h1>
                  <p>
                    One hiring queue from Projects and Service. Recruiting dates
                    work backward from when each person must be productive.
                  </p>
                  <div className="ws-source-pills">
                    <span>Projects · Mechanical + Building Automation</span>
                    <span>Service · Horn Lake technician coverage</span>
                    <span>Requisitions · source records + this plan</span>
                  </div>
                </div>
                <div className="ws-metrics">
                  <Metric
                    label="Should have started"
                    value={fmt(
                      sum(
                        queue
                          .filter((a) => bucket(d, a) === 'Overdue')
                          .map((a) => a.qty),
                      ),
                    )}
                    detail="Unstarted recruiting past its act-by date"
                    tone="danger"
                  />
                  <Metric
                    label="Start within 4 weeks"
                    value={fmt(
                      sum(
                        queue
                          .filter((a) =>
                            ['Start this week', 'Next 4 weeks'].includes(
                              bucket(d, a),
                            ),
                          )
                          .map((a) => a.qty),
                      ),
                    )}
                    detail={`Through ${displayDate(dateAt(d, 4))}`}
                    tone="warning"
                  />
                  <Metric
                    label="Recruiting now"
                    value={fmt(
                      sum(
                        existing
                          .filter((a) => a.status === 'Recruiting')
                          .map((a) => a.qty),
                      ),
                    )}
                    detail="Already posted; not counted as unstarted"
                  />
                  <Metric
                    label="Accepted / onboarding"
                    value={fmt(joining)}
                    detail="Secured additions, including people already starting"
                  />
                </div>
                <Card
                  title="Recruiting starts by month"
                  subtitle="Openings still to post. Recruiting already underway and accepted offers are excluded."
                >
                  <div className="ws-months">
                    {Array.from({ length: 6 }, (_, n) => {
                      const base = new Date(d.reference.constants.WEEK0);
                      const month = new Date(
                        Date.UTC(
                          base.getUTCFullYear(),
                          base.getUTCMonth() + n,
                          1,
                        ),
                      );
                      const items = queue
                        .filter(
                          (a) =>
                            !['Secured', 'In progress'].includes(bucket(d, a)),
                        )
                        .filter((a) => {
                          const date = new Date(
                            dateAt(d, Math.max(0, timeline(a, d).actBy)),
                          );
                          return (
                            date.getUTCMonth() === month.getUTCMonth() &&
                            date.getUTCFullYear() === month.getUTCFullYear()
                          );
                        });
                      return (
                        <div key={n}>
                          <b>
                            {month.toLocaleDateString('en-US', {
                              timeZone: 'UTC',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </b>
                          <strong>{sum(items.map((a) => a.qty)) || '—'}</strong>
                          <span>openings</span>
                          {items.map((a) => (
                            <small key={a.id}>
                              {fmt(a.qty)} × {tradeName(a.tk)} ·{' '}
                              {deptName(a.dk)}
                            </small>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <Card
                  title="Hiring queue"
                  subtitle={`${fmt(fill)} openings to fill, plus ${fmt(joining)} accepted/onboarding hires. Recommendations do not duplicate existing requisitions.`}
                >
                  {groups.map((group) => {
                    const list = queue
                      .filter((a) => bucket(d, a) === group)
                      .sort(
                        (a, b) => timeline(a, d).actBy - timeline(b, d).actBy,
                      );
                    return (
                      list.length > 0 && (
                        <div key={group}>
                          <h3 className="ws-group-title">
                            {group}{' '}
                            <span>
                              {fmt(sum(list.map((a) => a.qty)))} people
                            </span>
                          </h3>
                          <div className="ws-table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th>Position</th>
                                  <th>Begin recruiting by</th>
                                  <th>Offer</th>
                                  <th>Start</th>
                                  <th>Productive</th>
                                  <th>Source / status</th>
                                  <th aria-label="Actions" />
                                </tr>
                              </thead>
                              <tbody>
                                {list.map((a) => {
                                  const t = timeline(a, d);
                                  return (
                                    <tr key={a.id}>
                                      <td>
                                        <b>
                                          {fmt(a.qty)} × {tradeName(a.tk)}
                                        </b>
                                        <small>
                                          {deptName(a.dk)} · {a.notes}
                                        </small>
                                      </td>
                                      <td>
                                        {[
                                          'Recruiting',
                                          'Onboarding',
                                          'Offer Accepted',
                                          'Productive',
                                        ].includes(a.status)
                                          ? 'Already underway'
                                          : displayDate(dateAt(d, t.actBy))}
                                      </td>
                                      <td>
                                        {displayDate(dateAt(d, t.offer))}
                                        <small>
                                          {a.actualOffer ? 'Actual' : 'Target'}
                                        </small>
                                      </td>
                                      <td>
                                        {displayDate(dateAt(d, t.start))}
                                        <small>
                                          {a.actualStart
                                            ? 'Confirmed start'
                                            : 'Target'}
                                        </small>
                                      </td>
                                      <td>
                                        {displayDate(dateAt(d, t.productive))}
                                        <small>
                                          Includes onboarding and ramp-up
                                        </small>
                                      </td>
                                      <td>
                                        <span className="ws-tag">
                                          {a.src === 'rec'
                                            ? 'Recommended'
                                            : a.src === 'data'
                                              ? 'Requisition'
                                              : 'This plan'}
                                        </span>
                                        <small>{a.status}</small>
                                      </td>
                                      <td>
                                        {a.src === 'rec' ? (
                                          <button
                                            onClick={() => {
                                              const r = recommended.find(
                                                (r) => r.action.id === a.id,
                                              );
                                              if (r) addRec(r);
                                            }}
                                          >
                                            Add to plan
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => setActionModal(a)}
                                          >
                                            {a.src === 'data' ? 'View' : 'Edit'}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    );
                  })}
                  {queue.length === 0 && (
                    <Empty title="No permanent hires in this selection">
                      Temporary labor and overtime remain in the department
                      action plans.
                    </Empty>
                  )}
                  <p className="ws-fine">
                    Adding a recommendation creates a shared planning action,
                    not an external requisition. Source requisitions are
                    read-only; update their authoritative hiring system and
                    refresh the dataset.
                  </p>
                </Card>
                <Card
                  title="Hiring timeline"
                  subtitle="Targets use the same phase boundaries and actual dates as the queue."
                >
                  <Timeline
                    data={d}
                    actions={queue}
                    onSelect={setActionModal}
                  />
                </Card>
                <Card
                  title="Lead times used"
                  subtitle="Illustrative defaults in the sample; editable per planning action."
                >
                  <div className="ws-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Trade</th>
                          <th>Recruiting</th>
                          <th>Selection</th>
                          <th>Offer / notice</th>
                          <th>Onboarding</th>
                          <th>Ramp-up</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.reference.trades
                          .filter((t) => !['AP', 'FM'].includes(t.k))
                          .map((t) => {
                            const l =
                              d.reference.leadTimeDefaultsDays.hire[t.k];
                            return (
                              <tr key={t.k}>
                                <td>{t.name}</td>
                                {[
                                  'recruit',
                                  'interview',
                                  'offer',
                                  'onboard',
                                  'ramp',
                                ].map((k) => (
                                  <td key={k}>
                                    {fmt(l[k as keyof typeof l] / 7, 1)} wk
                                  </td>
                                ))}
                                <td>{fmt(sum(Object.values(l)) / 7, 1)} wk</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            );
          })()}

        {page === 'roadmap' && (
          <>
            <div className="ws-intro">
              <span className="ws-eyebrow">
                AVAILABLE HERE · CONNECTIONS NEXT
              </span>
              <h1>One planning tool. Clear boundaries.</h1>
              <p>
                The three workflows share a dataset, scenario and capacity
                actions. External feeds and write-back require authenticated
                services beyond GitHub Pages.
              </p>
            </div>
            <Card title="Capabilities and delivery status">
              <div className="ws-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Capability</th>
                      <th>Available in this app</th>
                      <th>Next dependency</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        'Three connected areas',
                        'Projects, Service and Talent Acquisition share the same scenario and actions.',
                        'None',
                        'Available',
                      ],
                      [
                        'Weekly project planning',
                        'Weekly demand by job and trade, capacity bases, department gaps, drill-down and project inclusion.',
                        'Reviewed weekly hour plans and roster data',
                        'Available',
                      ],
                      [
                        'Forecast update',
                        'Budget-fixed re-spread, individual PM review, manual weekly forecast editing.',
                        'Validated timesheet coverage from BuildOps',
                        'Available',
                      ],
                      [
                        'Service outlook',
                        'Agreement burn, expected calls, renewals, overdue carryover and leveling previews.',
                        'Live agreements, visits, timesheets and roster',
                        'Available',
                      ],
                      [
                        'Hiring queue',
                        'Shared hires, recruiting dates, actual milestones and productivity ramp-up.',
                        'Live requisition statuses and time-to-fill history',
                        'Available',
                      ],
                      [
                        'Scenarios',
                        'Named plans; export/import; all service settings preserved. Uploaded data stays session-only.',
                        'Shared server storage for collaboration',
                        'Available',
                      ],
                      [
                        'Monthly planning & imports',
                        'Existing monthly planner and BuildOps/estimate imports remain available.',
                        'Use Monthly planner in the navigation',
                        'Available',
                      ],
                      [
                        'Live data sync',
                        'No automated connection; sample data or explicit local file import.',
                        'Authenticated BuildOps / Snowflake / HR feeds',
                        'Not connected',
                      ],
                      [
                        'External submissions',
                        'All capacity actions are local planning changes.',
                        'Approved hiring and BuildOps write-back services',
                        'Not connected',
                      ],
                      [
                        'AI plan drafting',
                        'Transparent rule-based recommendations.',
                        'Approved AI service and reviewed prompt/data scope',
                        'Not connected',
                      ],
                      [
                        'Rates, renewal pricing & callbacks',
                        'Illustrative trade rates; open callback jobs consume hours.',
                        'Accounting rate tables and validated visit classification',
                        'Data dependency',
                      ],
                    ].map((row) => (
                      <tr key={row[0]}>
                        {row.map((v, i) => (
                          <td key={i}>
                            {i === 0 ? (
                              <b>{v}</b>
                            ) : i === 3 ? (
                              <span
                                className={`ws-tag ${v === 'Available' ? 'ok' : ''}`}
                              >
                                {v}
                              </span>
                            ) : (
                              v
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="What makes the plan dependable">
              <ul>
                <li>
                  Job hours and roster headcounts come from data. No demo curve
                  calibration or automatic attrition is applied.
                </li>
                <li>
                  Known absences reduce capacity; they never count as secured
                  backfills.
                </li>
                <li>
                  Each department and trade keeps its own gap. Existing
                  requisitions remain visible and reserve demand so
                  recommendations do not request them twice.
                </li>
                <li>
                  Sample targets are estimates. Actual offer and start dates
                  replace the corresponding target milestones.
                </li>
                <li>
                  Scenario files are versioned and tied to their dataset.
                  Uploaded data and plans are not written to browser storage.
                </li>
              </ul>
            </Card>
          </>
        )}
      </main>
      <footer className="ws-footer">
        <b>Upchurch Workforce Planner</b>
        <span>
          {scenarioName} ·{' '}
          {sessionOnly
            ? 'Session data — export before closing'
            : 'Sample data for illustration'}{' '}
          · Planning as of {displayDate(d.reference.constants.WEEK0)}
        </span>
      </footer>
      {saveModal && (
        <Modal title="Save scenario" onClose={() => setSaveModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveScenario(saveName);
            }}
          >
            <label>
              Plan name
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <p>
              Projects, Service, hiring actions, forecast decisions and service
              overrides are saved together.
            </p>
            <p className="ws-fine">
              {sessionOnly
                ? 'This uploaded dataset stays session-only. Export your scenario to keep it after closing the app.'
                : 'Saved in this browser only. Export to share the plan or use another device.'}
            </p>
            <div className="ws-form-footer">
              <button type="button" onClick={() => setSaveModal(false)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Save plan
              </button>
            </div>
          </form>
        </Modal>
      )}
      {actionModal && (
        <ActionEditor
          data={d}
          action={actionModal}
          snapshot={snap}
          onClose={() => setActionModal(null)}
          onSave={saveAction}
          onRemove={() => {
            change((s) => {
              s.actions = s.actions.filter((v) => v.id !== actionModal.id);
            });
            setActionModal(null);
          }}
        />
      )}
      {projectModal && (
        <ProjectEditor
          data={d}
          initial={projectModal === 'new' ? undefined : projectModal}
          onClose={() => setProjectModal(null)}
          onSave={(p) => {
            change((s) => {
              const i = s.extra.findIndex((v) => v.id === p.id);
              if (i < 0) s.extra.push(p);
              else s.extra[i] = p;
              s.on[p.id] = true;
              s.prob[p.id] = p.prob;
            });
            setProjectModal(null);
          }}
        />
      )}
      {forecastModal && (
        <ForecastEditor
          data={d}
          snapshot={snap}
          project={forecastModal.project}
          initialTrade={forecastModal.trade}
          onClose={() => setForecastModal(null)}
          onSave={(updates) => {
            change((s) => {
              Object.assign(s.manual, updates);
            });
            setForecastModal(null);
          }}
          onReset={(key) => {
            change((s) => {
              delete s.manual[key];
            });
            setForecastModal(null);
          }}
        />
      )}
      {agreementModal && (
        <AgreementEditor
          data={d}
          snapshot={snap}
          agreement={agreementModal}
          onClose={() => setAgreementModal(null)}
          onSave={(ov) => {
            changeService((s) => {
              s.overrides[agreementModal.id] = ov;
            });
            setAgreementModal(null);
          }}
        />
      )}
    </div>
  );
}

function RecommendationList({
  recs,
  d,
  add,
}: {
  recs: Recommendation[];
  d: WorkforceSample;
  add: (r: Recommendation) => void;
}) {
  if (!recs.length)
    return (
      <Empty title="No additional action recommended">
        Existing crew and planned actions cover actionable gaps in this
        selection. Unsecured actions still carry execution risk.
      </Empty>
    );
  return (
    <div className="ws-decisions">
      {recs.map((r) => (
        <div className="ws-decision" key={r.key}>
          <div>
            <span className="ws-eyebrow">
              ACT BY {displayDate(dateAt(d, timeline(r.action, d).actBy))} ·{' '}
              {d.reference.departments.find((v) => v.k === r.action.dk)?.name}
            </span>
            <h3>
              {r.action.kind === 'hire'
                ? `Recruit ${fmt(r.action.qty)} permanent`
                : r.action.kind === 'subcontract'
                  ? `Source ${fmt(r.action.qty)} temporary`
                  : `Schedule ${fmt(r.action.qty * d.reference.constants.HPF)} overtime hrs/week`}{' '}
              · {d.reference.trades.find((v) => v.k === r.action.tk)?.name}
            </h3>
            <p>{r.reason}</p>
            <p className="ws-effect">
              If added: {fmt(r.covered)} shortage hours covered ·{' '}
              {fmt(r.uncovered)} remain in this window · estimated{' '}
              {money(r.cost)}
            </p>
            <small>
              {displayDate(dateAt(d, r.action.from))} –{' '}
              {displayDate(dateAt(d, r.action.to))} · {r.action.owner}
            </small>
          </div>
          <button onClick={() => add(r)}>Add to plan</button>
        </div>
      ))}
    </div>
  );
}
function ActionTable({
  actions,
  d,
  onSelect,
}: {
  actions: CapacityAction[];
  d: WorkforceSample;
  onSelect: (a: CapacityAction) => void;
}) {
  if (!actions.length)
    return <p className="ws-fine">No actions in this selection.</p>;
  return (
    <div className="ws-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Act by</th>
            <th>Action</th>
            <th>Department / trade</th>
            <th>Productive / effective</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Source</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {[...actions]
            .sort((a, b) => timeline(a, d).actBy - timeline(b, d).actBy)
            .map((a) => {
              const tl = timeline(a, d);
              return (
                <tr key={a.id}>
                  <td>{displayDate(dateAt(d, a.due ?? tl.actBy))}</td>
                  <td>
                    <b>
                      {
                        d.reference.actionKinds.find(
                          (v) => v[0] === a.kind,
                        )?.[1]
                      }{' '}
                      ·{' '}
                      {a.kind === 'overtime'
                        ? `${fmt(a.qty * d.reference.constants.HPF)} hrs/week`
                        : `${fmt(a.qty, 1)} people`}
                    </b>
                    <small>{a.notes}</small>
                  </td>
                  <td>
                    {d.reference.departments.find((v) => v.k === a.dk)?.name}
                    <small>
                      {d.reference.trades.find((v) => v.k === a.tk)?.name}
                    </small>
                  </td>
                  <td>
                    {displayDate(dateAt(d, tl.productive))}
                    {a.kind !== 'hire' && a.kind !== 'attrition' && (
                      <small>through {displayDate(dateAt(d, a.to))}</small>
                    )}
                  </td>
                  <td>{a.owner}</td>
                  <td>
                    <span
                      className={`ws-tag ${negative(a) ? 'reduction' : secured(d, a) ? 'ok' : ''}`}
                    >
                      {bucket(d, a)}
                    </span>
                    <small>{a.status}</small>
                  </td>
                  <td>{a.src === 'data' ? 'Source record' : 'This plan'}</td>
                  <td>
                    <button onClick={() => onSelect(a)}>
                      {a.src === 'data' ? 'View' : 'Edit'}
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function ActionEditor({
  data: d,
  action,
  snapshot,
  onClose,
  onSave,
  onRemove,
}: {
  data: WorkforceSample;
  action: CapacityAction;
  snapshot: ScenarioSnapshot;
  onClose: () => void;
  onSave: (a: CapacityAction) => void;
  onRemove: () => void;
}) {
  const [a, set] = useState(() => clone(action));
  const [error, setError] = useState('');
  const readOnly = a.src === 'data' || a.src === 'rec';
  const update = (patch: Partial<CapacityAction>) =>
    set((prev) => ({ ...prev, ...patch }));
  const tl = timeline(a, d);
  const baseline = useMemo(() => compute(d, snapshot), [d, snapshot]);
  const preview = useMemo(
    () =>
      compute(d, {
        ...snapshot,
        actions: [
          ...snapshot.actions.filter((x) => x.id !== a.id),
          ...(readOnly ? [] : [a]),
        ],
      }),
    [d, snapshot, a, readOnly],
  );
  const shortage = (c: Cube) =>
    sum(
      (c[a.dk]?.[a.tk] ?? [])
        .slice(d.reference.constants.PAST)
        .map((x) => Math.max(0, total(x) - x.cap)),
    );
  function save() {
    if (
      !Number.isFinite(a.qty) ||
      a.qty <= 0 ||
      a.to < a.from ||
      !a.owner.trim() ||
      !Object.values(a.lead).every((n) => Number.isFinite(n) && n >= 0) ||
      a.rate < 0 ||
      a.cost < 0
    ) {
      setError(
        'Enter positive capacity, valid dates, an owner and nonnegative lead times and rates.',
      );
      return;
    }
    onSave({ ...a, src: 'plan', confirmed: secured(d, a) });
  }
  return (
    <Modal
      title={`${readOnly ? 'View' : 'Plan'} ${d.reference.actionKinds.find((v) => v[0] === a.kind)?.[1].toLowerCase()}`}
      onClose={onClose}
      wide
    >
      <div className="ws-editor-grid">
        <div>
          <fieldset disabled={readOnly}>
            <div className="ws-form-grid">
              <label>
                Action type
                <select
                  value={a.kind}
                  onChange={(e) => {
                    const kind = e.target.value as CapacityAction['kind'];
                    const next = makeAction(d, { ...a, kind, lead: undefined });
                    set(next);
                  }}
                >
                  {d.reference.actionKinds.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Department
                <select
                  value={a.dk}
                  onChange={(e) => update({ dk: e.target.value as DeptKey })}
                >
                  {d.reference.departments.map((v) => (
                    <option key={v.k} value={v.k}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Labor category
                <select
                  value={a.tk}
                  onChange={(e) => {
                    const tk = e.target.value as TradeKey;
                    set(makeAction(d, { ...a, tk, lead: undefined }));
                  }}
                >
                  {d.reference.trades.map((v) => (
                    <option key={v.k} value={v.k}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {a.kind === 'overtime' ? 'Extra hours per week' : 'People'}
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={
                    a.kind === 'overtime'
                      ? Math.round(a.qty * d.reference.constants.HPF * 100) /
                        100
                      : a.qty
                  }
                  onChange={(e) =>
                    update({
                      qty:
                        Number(e.target.value) /
                        (a.kind === 'overtime' ? d.reference.constants.HPF : 1),
                    })
                  }
                />
              </label>
              <label>
                {a.kind === 'hire' ? 'Fully productive week' : 'Effective from'}
                <select
                  value={a.from}
                  onChange={(e) =>
                    update({
                      from: Number(e.target.value),
                      to: Math.max(a.to, Number(e.target.value)),
                    })
                  }
                >
                  {d.weeks.map((w) => (
                    <option value={w.offset} key={w.i}>
                      {displayDate(w.weekStart)}
                    </option>
                  ))}
                </select>
              </label>
              {a.kind !== 'hire' && a.kind !== 'attrition' && (
                <label>
                  Through week
                  <select
                    value={a.to}
                    onChange={(e) => update({ to: Number(e.target.value) })}
                  >
                    {d.weeks
                      .filter((w) => w.offset >= a.from)
                      .map((w) => (
                        <option value={w.offset} key={w.i}>
                          {displayDate(w.weekStart)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Status
                <select
                  value={a.status}
                  onChange={(e) =>
                    update({
                      status: e.target.value as CapacityAction['status'],
                    })
                  }
                >
                  {d.reference.statuses.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Owner
                <input
                  value={a.owner}
                  onChange={(e) => update({ owner: e.target.value })}
                />
              </label>
              <label>
                Loaded rate ($/hour)
                <input
                  type="number"
                  min="0"
                  value={a.rate}
                  onChange={(e) => update({ rate: Number(e.target.value) })}
                />
              </label>
              {a.kind === 'subcontract' && (
                <>
                  <label>
                    Contract cost
                    <input
                      type="number"
                      min="0"
                      value={a.cost}
                      onChange={(e) => update({ cost: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Cost basis
                    <select
                      value={a.costBasis}
                      onChange={(e) =>
                        update({
                          costBasis: e.target
                            .value as CapacityAction['costBasis'],
                        })
                      }
                    >
                      <option>per hour</option>
                      <option>per month</option>
                    </select>
                  </label>
                </>
              )}
            </div>
            <h3>Lead times · calendar days</h3>
            <div className="ws-form-grid">
              {Object.entries(a.lead).map(([k, v]) => (
                <label key={k}>
                  {k === 'interview' ? 'Selection' : k}
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={v}
                    onChange={(e) =>
                      update({
                        lead: { ...a.lead, [k]: Number(e.target.value) },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {a.kind === 'hire' && (
              <div className="ws-form-grid">
                <label>
                  Actual offer accepted (optional)
                  <input
                    type="date"
                    value={a.actualOffer ?? ''}
                    onChange={(e) =>
                      update({ actualOffer: e.target.value || undefined })
                    }
                  />
                </label>
                <label>
                  Confirmed start (optional)
                  <input
                    type="date"
                    value={a.actualStart ?? ''}
                    onChange={(e) =>
                      update({ actualStart: e.target.value || undefined })
                    }
                  />
                </label>
              </div>
            )}
            <label>
              Notes
              <textarea
                rows={3}
                value={a.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
          </fieldset>
          {readOnly && (
            <p className="ws-callout">
              {a.src === 'rec'
                ? 'This is a recommendation. Add it from the queue or action plan to edit it.'
                : 'This record comes from the dataset and is read-only. Update it in the authoritative hiring or HR system, then refresh the dataset.'}
            </p>
          )}
        </div>
        <aside className="ws-preview">
          <span className="ws-eyebrow">LIVE PREVIEW</span>
          <h3>
            {negative(a)
              ? 'Known reduction'
              : secured(d, a)
                ? 'Capacity secured'
                : 'Planned, not secured'}
          </h3>
          <dl>
            <dt>Begin action by</dt>
            <dd>{displayDate(dateAt(d, tl.actBy))}</dd>
            {a.kind === 'hire' && (
              <>
                <dt>Offer accepted · {a.actualOffer ? 'actual' : 'target'}</dt>
                <dd>{displayDate(dateAt(d, tl.offer))}</dd>
                <dt>Hire starts · {a.actualStart ? 'confirmed' : 'target'}</dt>
                <dd>{displayDate(dateAt(d, tl.start))}</dd>
              </>
            )}
            <dt>{negative(a) ? 'Effective' : 'Fully productive'}</dt>
            <dd>{displayDate(dateAt(d, tl.productive))}</dd>
            <dt>Estimated cost in horizon</dt>
            <dd>{money(actionCost(d, a))}</dd>
            {!readOnly && (
              <>
                <dt>Residual shortage · if plan succeeds</dt>
                <dd>
                  {fmt(shortage(baseline.cube))} → {fmt(shortage(preview.cube))}{' '}
                  hrs
                </dd>
              </>
            )}
          </dl>
          <p className="ws-fine">
            Hire payroll starts at the hire’s start date and includes onboarding
            and ramp-up. Productive capacity ramps at 50%, then 75%, then 100%.
            Source and plan views share these dates.
          </p>
        </aside>
      </div>
      {error && (
        <p role="alert" className="ws-error">
          {error}
        </p>
      )}
      <div className="ws-form-footer">
        {!readOnly && snapshot.actions.some((x) => x.id === a.id) && (
          <button type="button" className="danger" onClick={onRemove}>
            Remove from plan
          </button>
        )}
        <button onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</button>
        {!readOnly && (
          <button className="primary" onClick={save}>
            Save action
          </button>
        )}
      </div>
    </Modal>
  );
}

function ProjectEditor({
  data: d,
  initial,
  onClose,
  onSave,
}: {
  data: WorkforceSample;
  initial?: UserProjectArgs;
  onClose: () => void;
  onSave: (p: UserProjectArgs) => void;
}) {
  const [p, set] = useState<UserProjectArgs>(() =>
    clone(
      initial ?? {
        id: uid(),
        kind: 'proposed',
        dept: 'NAT',
        arch: 'DC',
        value: 3,
        start: 12,
        end: 35,
        prob: 0.5,
        name: '',
        shape: 'curve',
      },
    ),
  );
  const [error, setError] = useState('');
  const update = (patch: Partial<UserProjectArgs>) =>
    set((v) => ({ ...v, ...patch }));
  const preview = createProject(d, p);
  const hours = sum(Object.values(preview.plan).flatMap((v) => v ?? []));
  return (
    <Modal
      title={initial ? 'Edit project' : 'Add project'}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const mixTotal = sum(
            Object.values(p.mix ?? d.reference.archetypes[p.arch].mix).map(
              (n) => n ?? 0,
            ),
          );
          if (
            !p.name.trim() ||
            p.value <= 0 ||
            (p.end !== undefined && p.end < p.start) ||
            Math.abs(mixTotal - 1) > 0.01
          ) {
            setError(
              'Enter a name, positive value, valid schedule, and a trade mix totaling 100%.',
            );
            return;
          }
          onSave(p);
        }}
      >
        <div className="ws-editor-grid">
          <div>
            <div className="ws-form-grid">
              <label>
                Project name
                <input
                  value={p.name}
                  onChange={(e) => update({ name: e.target.value })}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Type
                <select
                  value={p.kind}
                  onChange={(e) =>
                    update({ kind: e.target.value as UserProjectArgs['kind'] })
                  }
                >
                  <option value="proposed">Proposed</option>
                  <option value="soft">Soft backlog</option>
                </select>
              </label>
              <label>
                Department
                <select
                  value={p.dept}
                  onChange={(e) => update({ dept: e.target.value as DeptKey })}
                >
                  {d.reference.departments
                    .filter((v) => v.group !== 'Service')
                    .map((v) => (
                      <option key={v.k} value={v.k}>
                        {v.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Archetype
                <select
                  value={p.arch}
                  onChange={(e) =>
                    update({ arch: e.target.value as ArchKey, mix: undefined })
                  }
                >
                  {Object.entries(d.reference.archetypes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Contract value ($ millions)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={p.value}
                  onChange={(e) => update({ value: Number(e.target.value) })}
                />
              </label>
              <label>
                Confidence (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(p.prob * 100)}
                  onChange={(e) =>
                    update({
                      prob:
                        Math.max(0, Math.min(100, Number(e.target.value))) /
                        100,
                    })
                  }
                />
              </label>
              <label>
                Start week
                <select
                  value={p.start}
                  onChange={(e) => update({ start: Number(e.target.value) })}
                >
                  {d.weeks
                    .filter((w) => w.offset >= 0)
                    .map((w) => (
                      <option value={w.offset} key={w.i}>
                        {displayDate(w.weekStart)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Finish week
                <select
                  value={p.end ?? p.start + preview.dur - 1}
                  onChange={(e) => update({ end: Number(e.target.value) })}
                >
                  {d.weeks
                    .filter((w) => w.offset >= 0)
                    .map((w) => (
                      <option value={w.offset} key={w.i}>
                        {displayDate(w.weekStart)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Curve shape
                <select
                  value={p.shape ?? 'curve'}
                  onChange={(e) =>
                    update({
                      shape: e.target.value as UserProjectArgs['shape'],
                    })
                  }
                >
                  <option value="curve">Bell curve</option>
                  <option value="flat">Even distribution</option>
                </select>
              </label>
              <label>
                Override total labor hours
                <input
                  type="number"
                  min="0"
                  placeholder="Use archetype estimate"
                  value={p.hours ?? ''}
                  onChange={(e) =>
                    update({
                      hours:
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <details>
              <summary>Adjust labor mix</summary>
              <p className="ws-fine">
                Percentages must total 100%. Controls and programming are routed
                to Building Automation.
              </p>
              <div className="ws-form-grid">
                {d.reference.trades
                  .filter((t) => !['HS', 'PS'].includes(t.k))
                  .map((t) => (
                    <label key={t.k}>
                      {t.name} (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={
                          Math.round(
                            (p.mix ?? d.reference.archetypes[p.arch].mix)[
                              t.k
                            ]! * 1000,
                          ) / 10 || 0
                        }
                        onChange={(e) =>
                          update({
                            mix: {
                              ...(p.mix ?? d.reference.archetypes[p.arch].mix),
                              [t.k]: Number(e.target.value) / 100,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            </details>
            <p className="ws-fine">
              For an estimating workbook, use the existing estimate import in
              Monthly planner. This form does not pretend to parse an uploaded
              workbook.
            </p>
          </div>
          <aside className="ws-preview">
            <span className="ws-eyebrow">
              LIVE SIZING · ILLUSTRATIVE ARCHETYPE
            </span>
            <h3>{p.name || 'New project'}</h3>
            <dl>
              <dt>Hours within planning horizon</dt>
              <dd>{fmt(hours)}</dd>
              <dt>Peak crew at 100%</dt>
              <dd>
                {fmt(
                  Math.max(
                    ...d.weeks.map((w) =>
                      sum(
                        Object.values(preview.plan).map((ns) => ns?.[w.i] ?? 0),
                      ),
                    ),
                  ) / d.reference.constants.HPF,
                  1,
                )}
              </dd>
              <dt>Expected peak at confidence</dt>
              <dd>
                {fmt(
                  (Math.max(
                    ...d.weeks.map((w) =>
                      sum(
                        Object.values(preview.plan).map((ns) => ns?.[w.i] ?? 0),
                      ),
                    ),
                  ) /
                    d.reference.constants.HPF) *
                    p.prob,
                  1,
                )}
              </dd>
              <dt>Duration</dt>
              <dd>{preview.dur} weeks</dd>
            </dl>
          </aside>
        </div>
        {error && (
          <p role="alert" className="ws-error">
            {error}
          </p>
        )}
        <div className="ws-form-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {initial ? 'Save project' : 'Add to shared scenario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ForecastEditor({
  data: d,
  snapshot,
  project: p,
  initialTrade,
  onClose,
  onSave,
  onReset,
}: {
  data: WorkforceSample;
  snapshot: ScenarioSnapshot;
  project: Project;
  initialTrade: TradeKey;
  onClose: () => void;
  onSave: (updates: Record<string, number[]>) => void;
  onReset: (key: string) => void;
}) {
  const [trade, setTrade] = useState(initialTrade);
  const [edits, setEdits] = useState<Record<string, number[]>>({});
  const f = reforecast(d, snapshot, p, trade),
    plan = p.plan[trade] ?? [];
  const base =
    snapshot.manual[f.key] ??
    plan.map((v, i) =>
      Math.max(
        0,
        v +
          (i >= d.reference.constants.PAST
            ? f.remPlan > 0
              ? (f.delta * v) / f.remPlan
              : i === d.reference.constants.PAST
                ? Math.max(0, f.delta)
                : 0
            : 0),
      ),
    );
  const values = edits[trade] ?? base;
  const remaining = sum(values.slice(d.reference.constants.PAST));
  return (
    <Modal title="Edit weekly forecast" onClose={onClose} wide>
      <h3>{p.name}</h3>
      <label>
        Labor category
        <select
          value={trade}
          onChange={(e) => setTrade(e.target.value as TradeKey)}
        >
          {Object.keys(p.plan).map((tk) => (
            <option key={tk} value={tk}>
              {d.reference.trades.find((t) => t.k === tk)?.name}
            </option>
          ))}
        </select>
      </label>
      <div className="ws-mini-metrics">
        <span>
          Remaining fixed-budget target{' '}
          <b>{fmt(Math.max(0, f.remPlan + f.delta))} hrs</b>
        </span>
        <span>
          Edited remaining <b>{fmt(remaining)} hrs</b>
        </span>
        <span>
          Budget difference{' '}
          <b>{fmt(remaining - Math.max(0, f.remPlan + f.delta), 1)} hrs</b>
        </span>
      </div>
      <p className="ws-fine">
        Manual edits override this job/category’s future forecast. The budget
        difference remains visible; review changes before saving.
      </p>
      <div className="ws-week-inputs">
        {d.weeks
          .filter((w) => w.i >= d.reference.constants.PAST)
          .map((w) => (
            <label key={w.i}>
              {displayDate(w.weekStart)}
              <input
                aria-label={`Hours for ${w.weekStart}`}
                type="number"
                min="0"
                step="0.1"
                value={Math.round((values[w.i] ?? 0) * 10) / 10}
                onChange={(e) => {
                  const next = [...values];
                  next[w.i] = Math.max(0, Number(e.target.value));
                  setEdits((v) => ({ ...v, [trade]: next }));
                }}
              />
              <small>original {fmt(plan[w.i] ?? 0, 1)}</small>
            </label>
          ))}
      </div>
      <div className="ws-form-footer">
        <button onClick={() => onReset(f.key)}>Reset manual forecast</button>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          onClick={() =>
            onSave(
              Object.fromEntries(
                Object.entries({ ...edits, [trade]: values }).map(
                  ([tk, hours]) => [`${p.id}|${tk}`, hours],
                ),
              ),
            )
          }
        >
          Apply weekly forecast
        </button>
      </div>
    </Modal>
  );
}

function AgreementEditor({
  data: d,
  snapshot,
  agreement: a,
  onClose,
  onSave,
}: {
  data: WorkforceSample;
  snapshot: ScenarioSnapshot;
  agreement: Agreement;
  onClose: () => void;
  onSave: (ov: ReturnType<typeof serviceSettings>['overrides'][string]) => void;
}) {
  const [ov, set] = useState(() =>
    clone(serviceSettings(snapshot).overrides[a.id] ?? {}),
  );
  const preview = clone(snapshot);
  preview.service = clone(serviceSettings(snapshot));
  preview.service.overrides[a.id] = ov;
  const b = burn(d, preview, a);
  return (
    <Modal title={a.name} onClose={onClose} wide>
      <p>
        {a.id} · {a.trade} · {d.reference.serviceTiers[a.tier]} · owner{' '}
        {a.owner}
      </p>
      <div className="ws-form-grid">
        <label>
          Remaining-visit forecast
          <select
            value={ov.basis ?? 'burn'}
            onChange={(e) =>
              set((v) => ({
                ...v,
                basis: e.target.value as 'burn' | 'budget' | 'custom',
              }))
            }
          >
            <option value="burn">Actual burn rate (capped)</option>
            <option value="budget">Budgeted hours</option>
            <option value="custom">Custom factor</option>
          </select>
        </label>
        {ov.basis === 'custom' && (
          <label>
            Custom factor
            <input
              type="number"
              min="0"
              max="5"
              step="0.05"
              value={ov.factor ?? 1}
              onChange={(e) =>
                set((v) => ({
                  ...v,
                  factor: Math.max(0, Math.min(5, Number(e.target.value))),
                }))
              }
            />
          </label>
        )}
        {a.ren && (
          <>
            <label>
              Renewal treatment
              <select
                value={ov.renewal ?? 'source'}
                onChange={(e) =>
                  set((v) => ({
                    ...v,
                    renewal: e.target.value as
                      | 'source'
                      | 'signed'
                      | 'expected'
                      | 'none',
                  }))
                }
              >
                <option value="source">Use source status</option>
                <option value="signed">Assume signed</option>
                <option value="expected">At confidence</option>
                <option value="none">Exclude renewal</option>
              </select>
            </label>
            {ov.renewal === 'expected' && (
              <label>
                Renewal confidence (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round((ov.probability ?? a.ren.p) * 100)}
                  onChange={(e) =>
                    set((v) => ({
                      ...v,
                      probability:
                        Math.max(0, Math.min(100, Number(e.target.value))) /
                        100,
                    }))
                  }
                />
              </label>
            )}
          </>
        )}
      </div>
      <div className="ws-mini-metrics">
        <span>
          Actual burn <b>{fmt(b.ratio * 100)}%</b>
        </span>
        <span>
          Forecast factor <b>{fmt(b.factor, 2)}×</b>
        </span>
        <span>
          Projected / annual budget{' '}
          <b>
            {fmt(b.projected)} / {fmt(b.budget)} hrs
          </b>
        </span>
        <span>
          Missing timesheet budgets <b>{fmt(b.missingHours)} hrs</b>
        </span>
      </div>
      <h3>Visits</h3>
      <div className="ws-table-scroll ws-visits">
        <table>
          <thead>
            <tr>
              <th>Visit / due</th>
              <th>Status</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Scenario week</th>
            </tr>
          </thead>
          <tbody>
            {a.visits.map((v) => {
              const i0 =
                d.reference.constants.PAST + Math.floor((v.to ?? v.due) / 7);
              return (
                <tr key={v.id}>
                  <td>
                    {v.id}
                    <small>
                      {displayDate(dateAt(d, v.due / 7))}
                      {v.ren ? ' · Renewal term' : ''}
                    </small>
                  </td>
                  <td>{v.status}</td>
                  <td>{fmt(v.bud, 1)}</td>
                  <td>
                    {v.status === 'missing'
                      ? 'Missing'
                      : v.act === undefined
                        ? '—'
                        : fmt(v.act, 1)}
                  </td>
                  <td>
                    {['sched', 'overdue', 'resched'].includes(v.status) ? (
                      <select
                        aria-label={`Scenario week for ${v.id}`}
                        value={ov.moves?.[v.id] ?? ''}
                        onChange={(e) =>
                          set((prev) => {
                            const moves = { ...prev.moves };
                            if (e.target.value === '') delete moves[v.id];
                            else moves[v.id] = Number(e.target.value);
                            return { ...prev, moves };
                          })
                        }
                      >
                        <option value="">
                          Source schedule
                          {v.status === 'overdue' ? ' · carry forward' : ''}
                        </option>
                        {d.weeks
                          .filter(
                            (w) =>
                              w.i >= d.reference.constants.PAST &&
                              (v.status === 'overdue' ||
                                (v.flex && Math.abs(w.i - i0) <= v.win) ||
                                w.i === i0),
                          )
                          .map((w) => (
                            <option key={w.i} value={w.i}>
                              {displayDate(w.weekStart)}
                            </option>
                          ))}
                      </select>
                    ) : (
                      'Complete / data missing'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ws-callout">
        All changes here are scenario assumptions. They do not renew an
        agreement, change a quote or reschedule a BuildOps visit.
      </p>
      <div className="ws-form-footer">
        <button onClick={() => set({})}>Reset assumptions</button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => onSave(ov)}>
          Save scenario assumptions
        </button>
      </div>
    </Modal>
  );
}
