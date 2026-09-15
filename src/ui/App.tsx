import { useEffect, useMemo, useRef, useState } from 'react';
import upchurchLogo from '../assets/upchurch-horizontal-reversed.png';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  HelpCircle,
  Plus,
  RotateCcw,
  Save,
  Upload,
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
  addRuntimeProject,
  DEPARTMENTS,
  getActivePlannerData,
  getRuntimeDataInfo,
  INITIAL_PLANS,
  LABOR_CATEGORIES,
  MONTH_KEYS,
  MONTHS,
  PROJECTS,
  PROPOSED_PROJECT_ARCHETYPES,
  updateRuntimeProject,
} from '../data/runtimeData';
import {
  blankSoftBacklogDraft,
  editSoftBacklogDraft,
  generateSoftBacklogForecast,
  parseEstimateFile,
  type SoftBacklogDraft,
} from '../data/estimateParser';
import { LABOR_SOURCE_MAP } from '../data/sampleData';
import {
  createProposedProject,
  resizeProposedProjectSchedule,
  type ProposedProjectIntake,
} from '../data/proposedProjectBuilder';
import type {
  AssumptionFlag,
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
  activeRange,
  analyze,
  assumptionFlagsForProject,
  datePosition,
  forecastFreshness,
  formatDate,
  formatValue,
  metrics,
  monthlyComposition,
  peopleMetricsForProject,
  recommendations,
  rollupProjectCurve,
  validateWorkPackages,
} from '../planning/engine';
import { loadPlanState, resetPlans, savePlans } from '../persistence/planStore';
import { GuidedTour, TOUR_SEEN_KEY } from './GuidedTour';
import { LaborCategoryPicker } from './LaborCategoryPicker';
import { BottleneckHeatmap } from './BottleneckHeatmap';
import { CategoryOverlayGapChart } from './CategoryOverlayGapChart';
import { sortCategoriesByBottleneck } from './categoryStatus';

export type Tab =
  | 'dashboard'
  | 'projects'
  | 'scenario'
  | 'capacity'
  | 'plans'
  | 'help';
type Modal =
  | null
  | 'add-project'
  | 'soft-backlog'
  | 'proposed-intake'
  | 'proposed'
  | 'action'
  | 'compare';
const TODAY = new Date();
const TODAY_MONTH_KEY = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}`;
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

/**
 * Basic accessibility wiring shared by every modal/drawer: focuses the panel
 * on open so keyboard and screen-reader users land inside it, and closes on
 * Escape. Combined with role="dialog"/aria-modal on the panel element this
 * covers REVIEW_RECOMMENDATIONS item 12.
 */
function useDialogA11y<T extends HTMLElement>(onEscape: () => void) {
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  // Keep the ref pointed at the latest callback from an effect (not render)
  // so the mount-only effect below always calls the current close handler.
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscapeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // Mount-only: focuses the panel once. Re-renders while the dialog is
    // open never steal focus from whatever the user is doing.
  }, []);
  return ref;
}

export function App() {
  const runtimeData = getRuntimeDataInfo();
  const [loadedPlanState] = useState(() =>
    runtimeData.mode === 'uploaded'
      ? { plans: clone(INITIAL_PLANS), sourceChanged: false }
      : loadPlanState(runtimeData.sourceRevision),
  );
  const [plans, setPlans] = useState<WorkforcePlan[]>(loadedPlanState.plans);
  const [sourceChanged, setSourceChanged] = useState(
    runtimeData.mode === 'published' && loadedPlanState.sourceChanged,
  );
  const initial = plans.find((p) => p.id === 'growth') || plans[0];
  const [planId, setPlanId] = useState(initial.id);
  const [saved, setSaved] = useState<ScenarioConfig>(() =>
    clone(initial.config),
  );
  const [live, setLive] = useState<ScenarioConfig>(() => clone(initial.config));
  const [undo, setUndo] = useState<ScenarioConfig[]>([]);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [selectedCategories, setSelectedCategories] = useState<
    Set<LaborCategory>
  >(
    () =>
      new Set([
        LABOR_CATEGORIES.includes('Plumber') ? 'Plumber' : LABOR_CATEGORIES[0],
      ]),
  );
  const setCategory = (c: LaborCategory) => setSelectedCategories(new Set([c]));
  const [department, setDepartment] = useState(DEPARTMENTS[0]);
  const [unit, setUnit] = useState<Unit>('People');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<Project | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [proposedProjectId, setProposedProjectId] = useState(
    initial.config.proposedProjects[0]?.id ?? '',
  );
  const [proposedIntake, setProposedIntake] =
    useState<ProposedProjectIntake | null>(null);
  const [creatingProposedProject, setCreatingProposedProject] = useState(false);
  const [softBacklogDraft, setSoftBacklogDraft] =
    useState<SoftBacklogDraft | null>(null);
  const [editingSoftBacklogId, setEditingSoftBacklogId] = useState<
    string | null
  >(null);
  const [actionDraft, setActionDraft] = useState<CapacityAction | null>(null);
  const [modalSnapshot, setModalSnapshot] = useState<ScenarioConfig | null>(
    null,
  );
  const [step, setStep] = useState(4);
  const [compareIds, setCompareIds] = useState<string[]>(['current', 'growth']);
  const [toast, setToast] = useState('');
  const [tourActive, setTourActive] = useState(() => {
    try {
      return !localStorage.getItem(TOUR_SEEN_KEY);
    } catch {
      // best-effort only — a private-mode/blocked-storage browser simply
      // never auto-shows the tour, but it stays reachable from the Help menu.
      return false;
    }
  });
  const plan = plans.find((p) => p.id === planId) || plans[0];
  // Every category's analyze() result, computed once here rather than per
  // component, so the heatmap and the picker widget's status dots/sparklines
  // never recompute what the other already has.
  const allCategoryResults = useMemo(
    () =>
      new Map(
        LABOR_CATEGORIES.map((cat) => [cat, analyze(live, cat, department)]),
      ),
    [live, department],
  );
  // Every single-category consumer (the main bottleneck chart, assumptions,
  // Capacity, ProposedModal, CompareModal, etc.) still needs one category —
  // use the worst-bottleneck category among those checked, so checking just
  // one behaves exactly like today and checking several still shows the most
  // urgent one everywhere that can only show one.
  const category = useMemo(
    () =>
      sortCategoriesByBottleneck([...selectedCategories], (c) =>
        allCategoryResults.get(c)!,
      )[0] ?? LABOR_CATEGORIES[0],
    [selectedCategories, allCategoryResults],
  );
  const result = useMemo(
    () =>
      allCategoryResults.get(category) ?? analyze(live, category, department),
    [allCategoryResults, category, live, department],
  );
  const summary = useMemo(() => metrics(result), [result]);
  const savedResult = useMemo(
    () => analyze(saved, category, department),
    [saved, category, department],
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
    if (!sourceChanged && runtimeData.mode !== 'uploaded') savePlans(plans);
  }, [plans, sourceChanged, runtimeData.mode]);
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
    setToast(
      runtimeData.mode === 'uploaded'
        ? `“${plan.name}” saved for this session.`
        : `“${plan.name}” saved.`,
    );
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
  const openProposed = (id?: string) => {
    const nextId = id ?? live.proposedProjects[0]?.id;
    if (!nextId) return;
    setProposedProjectId(nextId);
    setCreatingProposedProject(false);
    setModalSnapshot(clone(live));
    setModal('proposed');
  };
  const openProposedIntake = () => {
    const archetype = PROPOSED_PROJECT_ARCHETYPES[0];
    const startIndex = Math.min(3, MONTHS.length - 1);
    setProposedIntake({
      name: '',
      department,
      archetypeId: archetype?.id ?? '',
      value: 0,
      startIndex,
      endIndex: Math.min(
        MONTHS.length - 1,
        startIndex + (archetype?.defaultDurationMonths ?? 6) - 1,
      ),
      probability: 50,
    });
    setModal('proposed-intake');
  };
  const continueProposedIntake = (intake: ProposedProjectIntake) => {
    const archetype = PROPOSED_PROJECT_ARCHETYPES.find(
      (item) => item.id === intake.archetypeId,
    );
    if (!archetype) return;
    const baseId =
      intake.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'proposed-project';
    let projectId = baseId;
    let suffix = 2;
    const usedIds = new Set(live.proposedProjects.map((item) => item.id));
    while (usedIds.has(projectId)) projectId = `${baseId}-${suffix++}`;
    const template = live.proposedProjects.find(
      (item) => item.projectType === archetype.projectType,
    );
    const project = createProposedProject(
      intake,
      archetype,
      template,
      LABOR_CATEGORIES,
      projectId,
      MONTHS.length,
    );
    setModalSnapshot(clone(live));
    setLive((config) => ({
      ...config,
      proposedProjects: [...config.proposedProjects, project],
      proposedIncluded: {
        ...config.proposedIncluded,
        [project.id]: true,
      },
    }));
    setProposedProjectId(project.id);
    setProposedIntake(null);
    setCreatingProposedProject(true);
    setModal('proposed');
  };
  const openManualSoftBacklog = () => {
    setEditingSoftBacklogId(null);
    setSoftBacklogDraft(blankSoftBacklogDraft(department));
    setModal('soft-backlog');
  };
  const editSoftBacklog = (project: Project) => {
    setDrawer(null);
    setEditingSoftBacklogId(project.id);
    setSoftBacklogDraft(editSoftBacklogDraft(project));
    setModal('soft-backlog');
  };
  const saveSoftBacklog = (draft: SoftBacklogDraft) => {
    const project = clone({
      ...draft.project,
      softBacklogForecast: draft.forecastSetup,
    });
    if (!project.primaryLabor) {
      project.primaryLabor =
        Object.entries(project.laborAllocation).sort(
          (a, b) => (b[1] ?? 0) - (a[1] ?? 0),
        )[0]?.[0] ?? 'Unspecified';
    }
    if (editingSoftBacklogId) {
      updateRuntimeProject(editingSoftBacklogId, project);
    } else {
      addRuntimeProject(project);
    }
    mutate((config) => {
      config.included[project.id] = true;
      config.probabilities[project.id] = project.planningProbability;
      config.shifts[project.id] = editingSoftBacklogId
        ? (config.shifts[project.id] ?? 0)
        : 0;
    });
    const wasEditing = Boolean(editingSoftBacklogId);
    setEditingSoftBacklogId(null);
    setSoftBacklogDraft(null);
    setModal(null);
    setTab('projects');
    setToast(
      wasEditing
        ? `“${project.name}” updated in Soft Backlog.`
        : `“${project.name}” added to Soft Backlog.`,
    );
  };
  const exportDataset = () => {
    const data = getActivePlannerData();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    data.publishedAt = now.toISOString();
    data.source.softBacklogAsOf = date;
    data.source.notes = [
      data.source.notes,
      'Soft Backlog and workforce-plan changes exported from a session-only app.',
    ]
      .filter(Boolean)
      .join(' ');
    data.initialPlans = plans.map((item) =>
      item.id === planId ? { ...item, config: clone(live) } : clone(item),
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `workforce-planner-${date}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast('Updated dataset downloaded.');
  };
  const openNewAction = (kind: CapacityAction['kind']) => {
    const draft: CapacityAction = {
      id: `action-${Date.now()}`,
      kind,
      category,
      quantity: kind === 'overtime' ? 1 : 2,
      fromIndex: Math.max(0, summary.firstIndex),
      toIndex: Math.min(MONTHS.length - 1, Math.max(0, summary.firstIndex) + 3),
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
          <img src={upchurchLogo} alt="Upchurch" className="brand-mark" />
          <span />
          WORKFORCE PLANNER
        </div>
        <div className="sample" data-tour="banner" title={runtimeData.warning}>
          <i />
          {runtimeData.mode === 'published'
            ? `PUBLISHED DATA — ${new Date(runtimeData.publishedAt).toLocaleDateString('en-US')}`
            : runtimeData.mode === 'uploaded'
              ? 'SESSION DATA — NOT SAVED'
              : runtimeData.mode === 'development-fallback'
                ? 'DEVELOPMENT — SAMPLE DATA FALLBACK'
                : 'PROTOTYPE — SAMPLE DATA ONLY'}
        </div>
      </div>
      {sourceChanged && (
        <div className="source-update-notice" role="status">
          <div>
            <strong>New published source data is available.</strong>
            <span>
              Your working plans were created from an older Hard or Soft Backlog
              and have not been combined with the new forecast.
            </span>
          </div>
          <button
            onClick={() => {
              const next = resetPlans();
              setPlans(next);
              const preferred = next.find((p) => p.id === 'growth') || next[0];
              setPlanId(preferred.id);
              setSaved(clone(preferred.config));
              setLive(clone(preferred.config));
              setUndo([]);
              setSourceChanged(false);
            }}
          >
            RELOAD PUBLISHED PLAN
          </button>
        </div>
      )}
      {!sourceChanged &&
        runtimeData.mode === 'published' &&
        runtimeData.stale && (
          <div className="source-update-notice stale-source" role="status">
            <div>
              <strong>Published Hard Backlog is more than 45 days old.</strong>
              <span>
                Source date: {runtimeData.hardBacklogAsOf}. Confirm the monthly
                BuildOps refresh before relying on hiring decisions.
              </span>
            </div>
          </div>
        )}
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
          <HelpMenu
            onTour={() => setTourActive(true)}
            onGuide={() => setTab('help')}
          />
          <button
            onClick={() => {
              setTab('plans');
              setModal('compare');
            }}
          >
            COMPARE PLANS
          </button>
          {runtimeData.mode === 'uploaded' && (
            <button
              onClick={exportDataset}
              title="Download this session's data"
            >
              <Download size={14} /> EXPORT DATASET
            </button>
          )}
          <div className="quick-actions" data-tour="quick-add">
            <CapacityActionMenu onSelect={openNewAction} />
            <button className="primary" onClick={() => setModal('add-project')}>
              ADD PROJECT
            </button>
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="Primary navigation" data-tour="tabs">
        {tabList.map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            aria-current={tab === key ? 'page' : undefined}
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
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          allCategoryResults={allCategoryResults}
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
            department={department}
            actions={live.actions}
            dirty={dirty}
            savedScenario={savedResult.scenario}
            selectedCategories={selectedCategories}
            allCategoryResults={allCategoryResults}
          />
        )}
        {tab === 'projects' && (
          <Projects
            config={live}
            department={department}
            category={category}
            result={result}
            mutate={mutate}
            display={display}
            drawer={drawer}
            setDrawer={setDrawer}
            editSoftBacklog={editSoftBacklog}
            openProposed={openProposed}
            setTab={setTab}
            setSelectedMonth={setSelectedMonth}
            selectedCategories={selectedCategories}
            setSelectedCategories={setSelectedCategories}
            allCategoryResults={allCategoryResults}
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
            department={department}
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
      {modal === 'add-project' && (
        <AddProjectModal
          department={department}
          close={() => setModal(null)}
          manual={openManualSoftBacklog}
          proposed={() => {
            openProposedIntake();
          }}
          imported={(draft) => {
            setEditingSoftBacklogId(null);
            setSoftBacklogDraft(draft);
            setModal('soft-backlog');
          }}
        />
      )}
      {modal === 'soft-backlog' && softBacklogDraft && (
        <SoftBacklogModal
          draft={softBacklogDraft}
          setDraft={setSoftBacklogDraft}
          existingProjectIds={PROJECTS.map((project) => project.id)}
          editingProjectId={editingSoftBacklogId}
          close={() => {
            setEditingSoftBacklogId(null);
            setSoftBacklogDraft(null);
            setModal(null);
          }}
          save={saveSoftBacklog}
        />
      )}
      {modal === 'proposed-intake' && proposedIntake && (
        <ProposedIntakeModal
          draft={proposedIntake}
          setDraft={setProposedIntake}
          close={() => {
            setProposedIntake(null);
            setModal(null);
          }}
          next={continueProposedIntake}
        />
      )}
      {modal === 'proposed' && (
        <ProposedModal
          config={live}
          projectId={proposedProjectId}
          setLive={setLive}
          result={result}
          category={category}
          display={display}
          isNew={creatingProposedProject}
          close={(discard) => {
            if (discard && modalSnapshot) setLive(modalSnapshot);
            if (!discard && creatingProposedProject)
              setToast('Proposed project added to the scenario.');
            setCreatingProposedProject(false);
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
          department={department}
          close={() => setModal(null)}
        />
      )}
      {toast && <output className="toast">{toast}</output>}
      <GuidedTour
        active={tourActive}
        tab={tab}
        setTab={setTab}
        onFinish={() => setTourActive(false)}
      />
    </div>
  );
}

function HelpMenu({
  onTour,
  onGuide,
}: {
  onTour: () => void;
  onGuide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="header-menu" ref={ref}>
      <button
        data-tour="help-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        HELP <ChevronDown size={14} />
      </button>
      {open && (
        <div className="header-menu-list" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onTour();
            }}
          >
            Take the guided tour
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onGuide();
            }}
          >
            Open the pilot guide
          </button>
        </div>
      )}
    </div>
  );
}

const CAPACITY_ACTION_KINDS: [CapacityAction['kind'], string][] = [
  ['hire', 'Permanent hire'],
  ['subcontract', 'Subcontract'],
  ['overtime', 'Overtime'],
  ['leave', 'Leave'],
  ['attrition', 'Attrition'],
];

function CapacityActionMenu({
  onSelect,
}: {
  onSelect: (kind: CapacityAction['kind']) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="header-menu" ref={ref}>
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ADD CAPACITY ACTION <ChevronDown size={14} />
      </button>
      {open && (
        <div className="header-menu-list" role="menu">
          {CAPACITY_ACTION_KINDS.map(([kind, label]) => (
            <button
              key={kind}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect(kind);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlBar(p: {
  department: string;
  setDepartment: (v: string) => void;
  selectedCategories: Set<LaborCategory>;
  setSelectedCategories: (v: Set<LaborCategory>) => void;
  allCategoryResults: Map<LaborCategory, ReturnType<typeof analyze>>;
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
      <Field
        label="DEPARTMENT"
        hint="Demand is filtered to the selected published department."
      >
        <select
          value={p.department}
          onChange={(e) => p.setDepartment(e.target.value)}
        >
          {DEPARTMENTS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <LaborCategoryPicker
        categories={LABOR_CATEGORIES}
        allResults={p.allCategoryResults}
        selected={p.selectedCategories}
        setSelected={p.setSelectedCategories}
      />
      <Field
        label="PLANNING WINDOW"
        hint="Rolling 18-month window supplied by the published data."
      >
        <input
          readOnly
          title={`${MONTHS[0]} — ${MONTHS[MONTHS.length - 1]} · ${MONTHS.length}-month window`}
          value={`${MONTHS[0]} — ${MONTHS[MONTHS.length - 1]} · ${MONTHS.length}-month window`}
        />
      </Field>
      <div className="unit-control" data-tour="unit-toggle">
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
        <select
          value={p.planId}
          title={p.plans.find((plan) => plan.id === p.planId)?.name}
          onChange={(e) => p.choosePlan(e.target.value)}
        >
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
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
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
  department,
  actions,
  dirty,
  savedScenario,
  selectedCategories,
  allCategoryResults,
}: {
  result: ReturnType<typeof analyze>;
  summary: ReturnType<typeof metrics>;
  display: (v: number) => string;
  unit: Unit;
  selectedMonth: number | null;
  setSelectedMonth: (v: number | null) => void;
  plan: WorkforcePlan;
  category: LaborCategory;
  department: string;
  actions: CapacityAction[];
  dirty: boolean;
  savedScenario: number[];
  selectedCategories: Set<LaborCategory>;
  allCategoryResults: Map<LaborCategory, ReturnType<typeof analyze>>;
}) {
  const data = MONTHS.map((month, i) => ({
    month,
    hard: result.hard[i],
    expected: result.expected[i],
    scenario: result.scenario[i],
    prefab: result.prefab[i],
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
      {selectedCategories.size > 1 && (
        <p className="info-note multi-category-note">
          {selectedCategories.size} labor categories selected — the tiles above
          and the chart below still reflect <strong>{category}</strong>, the
          worst bottleneck among them. Use the overlay chart further down, or
          the all-categories heatmap on the Projects tab, to compare across all
          selected categories.
        </p>
      )}
      <section className="chart-card" data-tour="bottleneck-chart">
        <div className="card-heading">
          <div>
            <span>DEMAND VERSUS EXECUTABLE CAPACITY</span>
            <h2>
              {category} — {department} · {plan.name}
            </h2>
          </div>
          <div className="chart-heading-controls">
            <label className="chart-month-jump" data-tour="month-jump">
              <span className="field-label">JUMP TO MONTH</span>
              <select
                aria-label="Select a month to inspect (keyboard-accessible alternative to clicking the chart)"
                value={selectedMonth ?? ''}
                onChange={(e) =>
                  setSelectedMonth(
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
              >
                <option value="">Choose a month…</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <ChartLegend />
          </div>
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
              {MONTH_KEYS.includes(TODAY_MONTH_KEY) && (
                <ReferenceLine
                  x={MONTHS[MONTH_KEYS.indexOf(TODAY_MONTH_KEY)]}
                  stroke="#161514"
                  strokeDasharray="3 3"
                  label={{ value: 'TODAY', position: 'top', fontSize: 9 }}
                />
              )}
              <Bar dataKey="prefab" stackId="capacity" fill="#1f8a70" />
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
      {selectedCategories.size > 1 ? (
        <CategoryOverlayGapChart
          categories={LABOR_CATEGORIES}
          selected={selectedCategories}
          months={MONTHS}
          allResults={allCategoryResults}
        />
      ) : (
        <MonthlyCompositionChart
          result={result}
          display={display}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
        />
      )}
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
function MonthlyCompositionChart({
  result,
  display,
  selectedMonth,
  setSelectedMonth,
}: {
  result: ReturnType<typeof analyze>;
  display: (value: number) => string;
  selectedMonth: number | null;
  setSelectedMonth: (v: number | null) => void;
}) {
  const { rows, series } = useMemo(() => monthlyComposition(result), [result]);
  const colors = ['#0068cc', '#8e2da8', '#009500', '#b8740b', '#c9c7c2'];
  return (
    <section
      className="chart-card composition-card"
      data-tour="composition-chart"
    >
      <div className="card-heading">
        <div>
          <span>MONTHLY COMPOSITION OF DEMAND</span>
          <h2>Which projects make up each month&apos;s total</h2>
        </div>
        <div className="composition-legend">
          {series.map((name, i) => (
            <span key={name} className="composition-legend-item">
              <i style={{ background: colors[i % colors.length] }} />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={rows}
            margin={{ top: 10, right: 24, left: 10, bottom: 48 }}
            onClick={(state) => {
              if (state?.activeTooltipIndex != null)
                setSelectedMonth(Number(state.activeTooltipIndex));
            }}
          >
            <CartesianGrid stroke="#efeeec" vertical={false} />
            <XAxis
              dataKey="month"
              interval={0}
              angle={-45}
              textAnchor="end"
              tick={{ fontSize: 9 }}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value) => display(Number(value))}
              labelFormatter={(label) => String(label)}
            />
            {selectedMonth !== null && (
              <ReferenceLine
                x={MONTHS[selectedMonth]}
                stroke="#161514"
                strokeDasharray="3 3"
              />
            )}
            {series.map((name, i) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="composition"
                fill={colors[i % colors.length]}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="info-note">
        Click a month to open the same month detail used by the bottleneck chart
        above. &quot;Other&quot; groups every contributor outside the largest
        few so the legend stays readable.
      </p>
    </section>
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
        <span className="sw-prefab">Prefab shop</span>
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
    ['Prefab shop', result.prefab[i], '#1f8a70'],
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
    ['Prefab shop', result.prefab[index], '#1f8a70'],
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
        <div>
          <span>WHO IS ON SITE IN {MONTHS[index].toUpperCase()}?</span>
          <h2>
            {MONTHS[index]} —{' '}
            {result.gap[index] > 0.05
              ? `unresolved gap of ${display(result.gap[index])}`
              : 'covered by planned capacity'}
          </h2>
        </div>
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
  department,
  category,
  result,
  mutate,
  display,
  drawer,
  setDrawer,
  editSoftBacklog,
  openProposed,
  setTab,
  setSelectedMonth,
  selectedCategories,
  setSelectedCategories,
  allCategoryResults,
}: {
  config: ScenarioConfig;
  department: string;
  category: LaborCategory;
  result: ReturnType<typeof analyze>;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
  display: (v: number) => string;
  drawer: Project | null;
  setDrawer: (p: Project | null) => void;
  editSoftBacklog: (project: Project) => void;
  openProposed: (id?: string) => void;
  setTab: (t: Tab) => void;
  setSelectedMonth: (v: number | null) => void;
  selectedCategories: Set<LaborCategory>;
  setSelectedCategories: (v: Set<LaborCategory>) => void;
  allCategoryResults: Map<LaborCategory, ReturnType<typeof analyze>>;
}) {
  const visibleProjects = PROJECTS.filter(
    (project) => project.department === department,
  );
  const visibleProposed = config.proposedProjects.filter(
    (project) => project.department === department,
  );
  return (
    <section className="screen-card">
      <div className="section-title">
        <div>
          <span>PROJECT DEMAND INPUTS</span>
          <h2>Backlog and opportunity forecasts feeding this plan</h2>
          <p>
            {visibleProjects.length} backlog projects · {visibleProposed.length}{' '}
            proposed scenario{' '}
            {visibleProposed.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        <button
          onClick={() =>
            mutate((c) => {
              visibleProjects.forEach((p) => {
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
      <div className="table-scroll" data-tour="projects-table">
        <table>
          <thead>
            <tr>
              <th>IN</th>
              <th>PROJECT</th>
              <th>TYPE</th>
              <th>VALUE</th>
              <th>COMPLETION</th>
              <th>PLANNING PROBABILITY</th>
              <th>SOURCE</th>
              <th>EXPECTED START</th>
              <th>PEAK</th>
              <th>FORECAST</th>
              <th>SCENARIO</th>
            </tr>
          </thead>
          <tbody>
            {visibleProjects.map((p) => {
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
                    <button
                      className="text-link"
                      onClick={() =>
                        p.type === 'Soft' ? editSoftBacklog(p) : setDrawer(p)
                      }
                    >
                      {p.name}
                    </button>
                    <small>
                      {p.department} · {p.primaryLabor}
                    </small>
                  </td>
                  <td>{p.type}</td>
                  <td className="num">${p.value.toFixed(1)}M</td>
                  <td>
                    {p.percentComplete !== undefined ? (
                      <div className="completion">
                        <b>
                          <i style={{ width: `${p.percentComplete}%` }} />
                        </b>
                        <span>{p.percentComplete}%</span>
                      </div>
                    ) : (
                      <span className="muted">Not started</span>
                    )}
                  </td>
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
                        aria-label={`Shift ${p.name} start one month earlier`}
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
                            Math.max(
                              0,
                              Math.min(MONTHS.length - 1, p.startIndex + shift),
                            )
                          ]
                        }
                      </span>
                      <button
                        aria-label={`Shift ${p.name} start one month later`}
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
            {visibleProposed.map((proposed) => (
              <tr className="proposed-row" key={proposed.id}>
                <td>
                  <CheckButton
                    checked={config.proposedIncluded[proposed.id] !== false}
                    onClick={() =>
                      mutate((c) => {
                        c.proposedIncluded[proposed.id] =
                          c.proposedIncluded[proposed.id] === false;
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="text-link magenta"
                    onClick={() => openProposed(proposed.id)}
                  >
                    {proposed.name}
                  </button>
                  <small>{proposed.department}</small>
                </td>
                <td>Proposed</td>
                <td>${proposed.value.toFixed(1)}M</td>
                <td>
                  <span className="muted">Not started</span>
                </td>
                <td>{proposed.probability}% when included</td>
                <td>Scenario only</td>
                <td>{MONTHS[proposed.startIndex]}</td>
                <td>{display(10)}</td>
                <td>{proposed.staffingCurve}</td>
                <td>
                  <button
                    className="magenta-button"
                    onClick={() => openProposed(proposed.id)}
                  >
                    EDIT
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BottleneckHeatmap
        categories={LABOR_CATEGORIES}
        months={MONTHS}
        allResults={allCategoryResults}
        selected={selectedCategories}
        setSelected={setSelectedCategories}
        setTab={setTab}
        setSelectedMonth={setSelectedMonth}
      />
      <PortfolioOverlap
        config={config}
        department={department}
        category={category}
        result={result}
        setDrawer={setDrawer}
        setTab={setTab}
        setSelectedMonth={setSelectedMonth}
      />
      {drawer && null}
    </section>
  );
}
function PortfolioOverlap({
  config,
  department,
  category,
  result,
  setDrawer,
  setTab,
  setSelectedMonth,
}: {
  config: ScenarioConfig;
  department: string;
  category: LaborCategory;
  result: ReturnType<typeof analyze>;
  setDrawer: (p: Project | null) => void;
  setTab: (t: Tab) => void;
  setSelectedMonth: (v: number | null) => void;
}) {
  const [groupBy, setGroupBy] = useState<'trade' | 'location'>('trade');
  const rows = PROJECTS.filter(
    (p) => p.department === department && config.included[p.id] !== false,
  )
    .map((p) => ({
      project: p,
      range: activeRange(rollupProjectCurve(p, config.packageIncluded)),
      people: peopleMetricsForProject(p),
    }))
    .filter((r) => r.range !== null);

  const groups: [string, typeof rows][] =
    groupBy === 'location'
      ? Object.entries(
          rows.reduce<Record<string, typeof rows>>((acc, r) => {
            const key = r.project.location ?? 'Unspecified location';
            (acc[key] ??= []).push(r);
            return acc;
          }, {}),
        ).sort(([a], [b]) => a.localeCompare(b))
      : [['All projects', rows]];

  // One status per month for the summary heatmap: whether that month's
  // total demand for the selected labor category is covered by standing
  // capacity — existing staff plus the pre-fab shop, neither of which needs
  // a new decision — ('good'), only by also counting discretionary actions
  // like planned hires, subcontract, or overtime ('watch'), or not at all
  // ('critical').
  const EPSILON = 0.05;
  const monthlyStatus = MONTHS.map((_, i) => {
    const need = result.scenario[i];
    if (need <= EPSILON) return { need, status: 'none' as const };
    if (need <= result.existing[i] + result.prefab[i] + EPSILON)
      return { need, status: 'good' as const };
    if (need <= result.total[i] + EPSILON)
      return { need, status: 'watch' as const };
    return { need, status: 'critical' as const };
  });

  return (
    <section className="chart-card overlap-card" data-tour="overlap">
      <div className="card-heading">
        <div>
          <span>PORTFOLIO OVERLAP</span>
          <h2>Who is on site, month by month</h2>
        </div>
        <div
          className="overlap-toggle"
          role="group"
          aria-label="Group Portfolio Overlap rows"
        >
          <button
            className={groupBy === 'trade' ? 'on' : ''}
            onClick={() => setGroupBy('trade')}
          >
            By trade
          </button>
          <button
            className={groupBy === 'location' ? 'on' : ''}
            onClick={() => setGroupBy('location')}
          >
            By location
          </button>
        </div>
      </div>
      <div className="overlap-scroll">
        <div className="overlap-row overlap-months">
          <div />
          {MONTHS.map((m, i) => (
            <button
              key={m}
              className="overlap-month"
              aria-label={`Inspect ${m} on the bottleneck dashboard`}
              onClick={() => {
                setSelectedMonth(i);
                setTab('dashboard');
              }}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
        {groups.map(([label, groupRows]) => (
          <div className="overlap-group" key={label}>
            {groupBy === 'location' && (
              <div className="overlap-group-label">
                {label} · {groupRows.length}{' '}
                {groupRows.length === 1 ? 'project' : 'projects'}
              </div>
            )}
            {groupRows.map(({ project: p, range, people }) => (
              <div className="overlap-row" key={p.id}>
                <div className="overlap-row-label">
                  <button className="text-link" onClick={() => setDrawer(p)}>
                    {p.name}
                  </button>
                  <small>
                    {p.location ?? p.department} · {p.workweekHours ?? 40}-hr
                    week
                  </small>
                </div>
                {range && (
                  <button
                    className="overlap-bar"
                    style={{
                      gridColumnStart: range.start + 2,
                      gridColumnEnd: range.end + 3,
                    }}
                    onClick={() => setDrawer(p)}
                    aria-label={`${p.name}: open project detail, peak ${people.peakCrew.toFixed(1)}`}
                  >
                    {people.peakCrew.toFixed(1)} peak
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        <div className="overlap-group overlap-heat-group">
          <div className="overlap-group-label">
            {category.toUpperCase()} — MONTHLY LABOR NEEDED
          </div>
          <div className="overlap-row overlap-heat-row">
            <div className="overlap-row-label">
              <strong>Total {category.toLowerCase()} needed</strong>
              <small>
                Across every included project · change LABOR CATEGORY above
              </small>
            </div>
            {monthlyStatus.map((m, i) => (
              <div
                key={MONTHS[i]}
                className={`overlap-heat-cell status-${m.status}`}
                style={{ gridColumnStart: i + 2, gridColumnEnd: i + 3 }}
                title={`${MONTHS[i]}: ${m.need.toFixed(1)} ${category} needed`}
              >
                {m.need > 0.05 ? m.need.toFixed(1) : '—'}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="info-note">
        Bars span each project&apos;s active months with its peak crew labeled.
        Click a bar to open that project, or a month header to inspect that
        month on the bottleneck dashboard. This complements — it does not
        replace — the bottleneck chart there.
      </p>
      <p className="info-note heat-legend">
        Heatmap: total {category.toLowerCase()} demand each month, colored by
        how it&apos;s covered.
        <span className="heat-legend-swatch status-good" />
        Existing staff and/or the pre-fab shop
        <span className="heat-legend-swatch status-watch" />
        Needs planned hires, subcontract, or overtime
        <span className="heat-legend-swatch status-critical" />
        Unresolved gap
      </p>
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

function PeopleViewSection({ project }: { project: Project }) {
  const people = peopleMetricsForProject(project);
  const freshness = forecastFreshness(project.lastRevisionDate, TODAY);
  const flags = assumptionFlagsForProject(project, TODAY);
  const workweek = project.workweekHours ?? 40;
  const mapped = project.sourceLaborLabels?.map((label) => ({
    label,
    category: LABOR_SOURCE_MAP[label],
  }));
  return (
    <section className="people-view">
      <h3>People view — three distinct metrics</h3>
      <div className="people-metrics">
        <Metric
          label="PEAK CREW"
          value={people.peakCrew.toFixed(1)}
          detail={`Highest concurrent requirement \u00b7 ${people.peakCrewMonth}`}
          tone={people.basis === 'weekly-peak' ? 'success' : ''}
        />
        <Metric
          label="AVERAGE / IMPLIED PEOPLE"
          value={people.averageImpliedPeople.toFixed(1)}
          detail={`Hours spread evenly across the schedule at a ${workweek}-hour workweek`}
        />
        <Metric
          label="MONTHLY PLANNED PEOPLE"
          value={
            people.monthlyPlannedPeople !== undefined
              ? people.monthlyPlannedPeople.toFixed(1)
              : 'Not available'
          }
          detail={
            people.basis === 'even-spread-estimate'
              ? 'No time-phased staffing plan on file \u2014 see flags below'
              : "From this project's own time-phased forecast"
          }
        />
      </div>
      <p className="info-note">
        {people.basis === 'weekly-peak'
          ? 'Peak crew is a measured weekly count for this project \u2014 the department bottleneck view can rely on it directly.'
          : people.basis === 'even-spread-estimate'
            ? 'No weekly staffing histogram is on file for this project. Peak crew is estimated from monthly-resolution data and may understate a short, sharp staffing peak.'
            : "Peak crew comes from this project's own monthly time-phased forecast, not a weekly histogram."}
      </p>
      <div className="fact-grid">
        <Metric
          label="WORKWEEK ASSUMPTION"
          value={`${workweek} hrs/week`}
          detail="A longer workweek implies fewer people for the same hours, not more capacity"
        />
        <Metric
          label="FORECAST FRESHNESS"
          value={freshness}
          tone={
            freshness === 'Current'
              ? 'success'
              : freshness === 'Stale'
                ? 'danger'
                : 'warning'
          }
          detail={
            project.lastRevisionDate
              ? `Last revised ${project.lastRevisionDate}`
              : 'No revision date on file'
          }
        />
      </div>
      {mapped && mapped.length > 0 && (
        <div className="labor-mapping">
          <h4>Source labor labels \u2192 standardized category</h4>
          {mapped.map(({ label, category }) => (
            <div className="detail-row" key={label}>
              <span>{label}</span>
              <b className={category ? '' : 'warning'}>
                {category ?? 'UNMAPPED \u2014 needs review'}
              </b>
            </div>
          ))}
        </div>
      )}
      {flags.length > 0 && (
        <div className="assumption-flags">
          <h4>Data-quality &amp; assumption flags</h4>
          {flags.map((flag) => (
            <AssumptionFlagRow key={flag.id} flag={flag} />
          ))}
        </div>
      )}
    </section>
  );
}

function AssumptionFlagRow({ flag }: { flag: AssumptionFlag }) {
  return (
    <details className={`flag-row flag-${flag.severity}`}>
      <summary>
        <b className="flag-severity">{flag.severity}</b>
        {flag.summary}
      </summary>
      <p>{flag.detail}</p>
      <p>
        <strong>Effect: </strong>
        {flag.effect}
      </p>
      <p>
        <strong>Recommended action: </strong>
        {flag.recommendation}
      </p>
    </details>
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
  const dialogRef = useDialogA11y<HTMLElement>(close);
  return (
    <div
      className="overlay drawer-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <aside
        className="drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${project.name} project forecast`}
        tabIndex={-1}
      >
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
          <PeopleViewSection project={project} />
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
                    checked={config.packageIncluded?.[w.id] ?? w.included}
                    onClick={() =>
                      mutate((c) => {
                        c.packageIncluded ??= {};
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
  department,
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
  department: string;
  mutate: (fn: (c: ScenarioConfig) => void) => void;
  result: ReturnType<typeof analyze>;
  summary: ReturnType<typeof metrics>;
  display: (v: number) => string;
  openProposed: (id?: string) => void;
  openNewAction: (k: CapacityAction['kind']) => void;
  editAction: (a: CapacityAction) => void;
  save: () => void;
  saveAsNew: (name: string) => void;
  cancel: () => void;
}) {
  return (
    <div className="scenario-layout" data-tour="scenario">
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
          PROJECTS.filter(
            (p) => p.type === 'Soft' && p.department === department,
          ).map((p) => {
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
          <div className="proposed-project-list">
            {config.proposedProjects
              .filter((proposed) => proposed.department === department)
              .map((proposed) => {
                const included = config.proposedIncluded[proposed.id] !== false;
                return (
                  <div className="proposed-card" key={proposed.id}>
                    <div>
                      <span>PROPOSED SCENARIO WORK</span>
                      <h3>{proposed.name}</h3>
                      <p>
                        ${proposed.value.toFixed(1)}M ·{' '}
                        {proposed.workPackages.length} work packages ·{' '}
                        {proposed.staffingCurve}
                      </p>
                    </div>
                    <b className={included ? 'success' : 'muted'}>
                      {included ? 'Included in this scenario' : 'Not included'}
                    </b>
                    <button
                      onClick={() =>
                        mutate((c) => {
                          c.proposedIncluded[proposed.id] =
                            c.proposedIncluded[proposed.id] === false;
                        })
                      }
                    >
                      TOGGLE
                    </button>
                    <button
                      className="magenta-button"
                      onClick={() => openProposed(proposed.id)}
                    >
                      OPEN IMPACT MODEL
                    </button>
                  </div>
                );
              })}
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
    ['prefabCapacity', 'Prefab shop cap.'],
    ['productiveHours', 'Prod hrs/person/mo'],
    ['hourlyRate', 'Std cost/hour'],
    ['overtimeLimit', 'OT limit %'],
    ['recruitDays', 'Recruit days'],
    ['interviewDays', 'Interview days'],
    ['offerDays', 'Offer days'],
    ['onboardingDays', 'Onboard days'],
    ['rampDays', 'Ramp days'],
    ['subcontractSourceDays', 'Sub source days'],
    ['subcontractVettingDays', 'Sub vetting days'],
    ['subcontractMobilizationDays', 'Sub mobilize days'],
    ['leavePercent', 'Leave %'],
    ['attritionPercent', 'Attrition %'],
  ];
  return (
    <div className="capacity-layout" data-tour="capacity">
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
          label="PRE-FAB SHOP CAPACITY"
          value={`${selected.prefabCapacity.toFixed(1)} FTE-equiv/mo`}
          tone="prefab"
          detail="Used first, before existing staff, hires, subcontract, or overtime."
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
    <section className="screen-card plans-screen" data-tour="plans">
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
              if (confirm('Reset all locally saved working plans?')) {
                setPlans(resetPlans());
                setToast('Working plans reset to the published defaults.');
              }
            }}
          >
            <RotateCcw size={14} /> RESET WORKING PLANS
          </button>
        </div>
      </div>
      {toast && <div className="info-banner">{toast}</div>}
      <div className="plans-list">
        {plans.map((p) => {
          const planCategory = LABOR_CATEGORIES.includes('Plumber')
              ? 'Plumber'
              : LABOR_CATEGORIES[0],
            r = analyze(p.config, planCategory, p.department),
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
                {p.status === 'Draft' && (
                  <button onClick={() => status(p.id, 'Under Review')}>
                    Submit for Review
                  </button>
                )}
                {p.status === 'Under Review' && (
                  <button
                    onClick={() => status(p.id, 'Approved Operating Plan')}
                  >
                    Mark as Approved
                  </button>
                )}
                {p.status === 'Approved Operating Plan' && (
                  <button onClick={() => status(p.id, 'Superseded')}>
                    Supersede
                  </button>
                )}
                {p.status !== 'Archived' && (
                  <button onClick={() => status(p.id, 'Archived')}>
                    <Archive size={13} /> Archive
                  </button>
                )}
                {p.status === 'Archived' && (
                  <button onClick={() => status(p.id, 'Draft')}>
                    Reopen as Draft
                  </button>
                )}
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
  const sessionOnly = getRuntimeDataInfo().mode === 'uploaded';
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
      'Open a proposed-project impact model. Change value, dates, labor mix, work packages, or self-perform strategy and see execution impact before adding it.',
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
          <button onClick={() => openProposed()}>TRY A PROPOSED PROJECT</button>
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
          <h2>What this planner does—and does not do</h2>
          <ul>
            <li>
              The top banner identifies whether the app loaded published,
              session-only, demonstration, or development-fallback data.
            </li>
            <li>
              Recommendations are transparent rules, not management decisions.
            </li>
            <li>Planned capacity remains distinct from confirmed capacity.</li>
            <li>
              {sessionOnly
                ? 'Uploaded data and plan changes last only for this page session.'
                : 'Plans are saved only in this browser on this device.'}
            </li>
            <li>
              {sessionOnly
                ? 'Refreshing or closing the page clears the workforce data.'
                : 'Shared source data is published separately from browser-local working scenarios.'}
            </li>
            <li>
              Labor categories, departments, and planning assumptions come from
              the loaded data file.
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
          <summary>Can I recover the published starting plan?</summary>
          <p>
            Yes. Saved Plans includes Reset Working Plans, which clears local
            changes and restores the current published defaults.
          </p>
        </details>
      </section>
    </>
  );
}

function AddProjectModal({
  department,
  close,
  manual,
  proposed,
  imported,
}: {
  department: string;
  close: () => void;
  manual: () => void;
  proposed: () => void;
  imported: (draft: SoftBacklogDraft) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(close);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      imported(await parseEstimateFile(file, department));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The estimate could not be read.',
      );
      setLoading(false);
      event.target.value = '';
    }
  };
  return (
    <div className="overlay">
      <section
        className="modal add-project-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>ADD PROJECT</span>
            <h2>What kind of planning input do you have?</h2>
          </div>
          <button onClick={close}>
            <X /> Cancel
          </button>
        </header>
        <div className="add-project-options">
          <button onClick={manual}>
            <Plus />
            <strong>Enter Soft Backlog manually</strong>
            <span>
              Add an estimated project, cost mix, labor allocation, and monthly
              staffing forecast.
            </span>
          </button>
          <label className={loading ? 'loading' : ''}>
            <Upload />
            <strong>
              {loading ? 'Reading estimate…' : 'Upload detailed estimate'}
            </strong>
            <span>
              Parse the Upchurch Accubid/Trimble workbook, then review every
              extracted value before adding it.
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.xlsm"
              disabled={loading}
              onChange={upload}
            />
          </label>
          <button onClick={proposed}>
            <ArrowRight />
            <strong>Insert Proposed Project</strong>
            <span>
              Start with a basic opportunity and configurable rule-of-thumb
              assumptions.
            </span>
          </button>
        </div>
        {error && (
          <div className="data-import-error add-project-error" role="alert">
            <strong>The estimate could not be imported.</strong>
            <span>{error}</span>
          </div>
        )}
      </section>
    </div>
  );
}

function SoftBacklogModal({
  draft,
  setDraft,
  existingProjectIds,
  editingProjectId,
  close,
  save,
}: {
  draft: SoftBacklogDraft;
  setDraft: React.Dispatch<React.SetStateAction<SoftBacklogDraft | null>>;
  existingProjectIds: string[];
  editingProjectId: string | null;
  close: () => void;
  save: (draft: SoftBacklogDraft) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(close);
  const project = draft.project;
  const forecastSetup = draft.forecastSetup ?? {
    totalLaborHours: 0,
    startMonth: MONTH_KEYS[Math.max(0, project.startIndex)] ?? MONTH_KEYS[0],
    endMonth: MONTH_KEYS[Math.max(0, project.startIndex)] ?? MONTH_KEYS[0],
    method: 'straight-line' as const,
    productiveHoursPerFteMonth: 173,
    generated: false,
  };
  const [forecastError, setForecastError] = useState('');
  const update = <K extends keyof Project>(key: K, value: Project[K]) =>
    setDraft((current) =>
      current
        ? { ...current, project: { ...current.project, [key]: value } }
        : current,
    );
  const updateForecastSetup = (
    patch: Partial<SoftBacklogDraft['forecastSetup']>,
  ) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            forecastSetup: {
              ...(current.forecastSetup ?? forecastSetup),
              ...patch,
              generated: false,
            },
          }
        : current,
    );
  const costTotal = Object.values(project.costMix).reduce(
    (sum, value) => sum + value,
    0,
  );
  const laborTotal = Object.values(project.laborAllocation).reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const issues = [
    ...(!project.id.trim() ? ['Project number is required.'] : []),
    ...(existingProjectIds.some(
      (id) =>
        id.toLowerCase() === project.id.trim().toLowerCase() &&
        id !== editingProjectId,
    )
      ? ['That project number already exists.']
      : []),
    ...(!project.name.trim() ? ['Project name is required.'] : []),
    ...(project.value <= 0
      ? ['Contract value must be greater than zero.']
      : []),
    ...(Math.abs(costTotal - 100) > 0.01
      ? ['Contract cost mix must total 100%.']
      : []),
    ...(Math.abs(laborTotal - 100) > 0.01
      ? ['Internal labor allocation must total 100%.']
      : []),
    ...(!project.curve.some((value) => value > 0)
      ? ['Enter staffing demand in at least one month.']
      : []),
  ];
  return (
    <div className="overlay">
      <section
        className="modal soft-backlog-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Review Soft Backlog project"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>
              {editingProjectId
                ? 'SOFT BACKLOG — EDIT PROJECT'
                : 'SOFT BACKLOG — REVIEW BEFORE ADDING'}
            </span>
            <h2>
              {editingProjectId
                ? 'Edit Soft Backlog project'
                : draft.sourceFileName
                  ? 'Review imported estimate'
                  : 'Add Soft Backlog project'}
            </h2>
          </div>
          <button onClick={close}>
            <X /> Cancel
          </button>
        </header>
        <div className="soft-backlog-body">
          {draft.sourceFileName && !editingProjectId && (
            <section className="estimate-import-summary">
              <div>
                <strong>{draft.sourceFileName}</strong>
                <span>
                  Extracted: {draft.extractedFields.join(', ') || 'No fields'}
                </span>
              </div>
              <b>{draft.extractedFields.length} fields recognized</b>
            </section>
          )}
          {draft.warnings.length > 0 && (
            <section className="estimate-warnings">
              <strong>Review these assumptions</strong>
              {draft.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </section>
          )}
          <section className="soft-form-section">
            <h3>Project details</h3>
            <div className="form-grid">
              <Field label="PROJECT NUMBER">
                <input
                  value={project.id}
                  disabled={Boolean(editingProjectId)}
                  title={
                    editingProjectId
                      ? 'Project Number is the stable identifier and cannot be changed while editing.'
                      : undefined
                  }
                  onChange={(event) =>
                    update('id', event.target.value.trimStart())
                  }
                />
              </Field>
              <Field label="PROJECT NAME">
                <input
                  value={project.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>
              <Field label="DEPARTMENT">
                <select
                  value={project.department}
                  onChange={(event) => update('department', event.target.value)}
                >
                  {DEPARTMENTS.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="LOCATION">
                <input
                  value={project.location ?? ''}
                  onChange={(event) => update('location', event.target.value)}
                />
              </Field>
              <Field label="PROJECT TYPE">
                <input
                  value={project.projectType ?? ''}
                  onChange={(event) =>
                    update('projectType', event.target.value)
                  }
                />
              </Field>
              <Field label="BID DATE">
                <input
                  value={project.bidDate ?? ''}
                  onChange={(event) => update('bidDate', event.target.value)}
                />
              </Field>
              <Field label="CONTRACT VALUE ($M)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={project.value}
                  onChange={(event) =>
                    update(
                      'value',
                      Math.round(Math.max(0, +event.target.value) * 100) / 100,
                    )
                  }
                />
              </Field>
              <Field label="PLANNING PROBABILITY (%)">
                <div className="percent-input">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={project.planningProbability}
                    onChange={(event) => {
                      const probability = Math.max(
                        0,
                        Math.min(100, Math.round(+event.target.value)),
                      );
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              project: {
                                ...current.project,
                                planningProbability: probability,
                                sourceProbability: probability,
                              },
                            }
                          : current,
                      );
                    }}
                  />
                  <span>%</span>
                </div>
              </Field>
            </div>
          </section>
          <section className="soft-form-section">
            <h3>Contract cost mix</h3>
            <div className="form-grid four">
              {Object.entries(project.costMix).map(([key, value]) => (
                <Field
                  key={key}
                  label={`${key.replace(/[A-Z]/g, (m) => ` ${m}`).toUpperCase()} (%)`}
                >
                  <div className="percent-input">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={value}
                      onChange={(event) =>
                        update('costMix', {
                          ...project.costMix,
                          [key]:
                            Math.round(Math.max(0, +event.target.value) * 10) /
                            10,
                        })
                      }
                    />
                    <span>%</span>
                  </div>
                </Field>
              ))}
            </div>
            <Validation total={costTotal} label="Cost mix" />
          </section>
          <section className="soft-form-section">
            <h3>Internal labor allocation (% of internal labor hours)</h3>
            <p className="section-copy">
              These values are percentages, not hours or people. Together they
              must equal 100%. They split the generated total FTE forecast into
              the labor-category views.
            </p>
            <div className="labor-grid">
              {LABOR_CATEGORIES.map((category) => (
                <Field key={category} label={`${category.toUpperCase()} (%)`}>
                  <div className="percent-input">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={project.laborAllocation[category] ?? 0}
                      onChange={(event) =>
                        update('laborAllocation', {
                          ...project.laborAllocation,
                          [category]:
                            Math.round(Math.max(0, +event.target.value) * 10) /
                            10,
                        })
                      }
                    />
                    <span>%</span>
                  </div>
                </Field>
              ))}
            </div>
            <Validation total={laborTotal} label="Labor allocation" />
          </section>
          <section className="soft-form-section">
            <div className="soft-forecast-heading">
              <div>
                <h3>
                  {project.curveBasis === 'total-internal-labor'
                    ? 'Monthly staffing forecast (total internal FTE people)'
                    : 'Monthly staffing forecast (legacy labor-category FTE)'}
                </h3>
                <p>
                  {project.curveBasis === 'total-internal-labor'
                    ? 'Generate a starting curve from estimate hours, then adjust individual months if needed.'
                    : 'This older curve keeps its original calculation basis when saved. Generating a new forecast converts it to total internal FTE.'}
                </p>
              </div>
              <span>{project.method}</span>
            </div>
            <div className="forecast-generator">
              <Field label="TOTAL LABOR HOURS">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={Math.round(forecastSetup.totalLaborHours)}
                  onChange={(event) =>
                    updateForecastSetup({
                      totalLaborHours: Math.round(
                        Math.max(0, +event.target.value),
                      ),
                    })
                  }
                />
              </Field>
              <Field label="FORECAST START MONTH">
                <input
                  type="month"
                  value={forecastSetup.startMonth}
                  onChange={(event) =>
                    updateForecastSetup({ startMonth: event.target.value })
                  }
                />
              </Field>
              <Field label="FORECAST END MONTH">
                <input
                  type="month"
                  value={forecastSetup.endMonth}
                  onChange={(event) =>
                    updateForecastSetup({ endMonth: event.target.value })
                  }
                />
              </Field>
              <Field label="FORECAST METHOD">
                <select
                  value={forecastSetup.method}
                  onChange={(event) =>
                    updateForecastSetup({
                      method: event.target.value as
                        | 'straight-line'
                        | 'bell-curve',
                    })
                  }
                >
                  <option value="straight-line">Straight-line</option>
                  <option value="bell-curve">Bell curve</option>
                </select>
              </Field>
              <Field label="PRODUCTIVE HOURS / FTE-MONTH">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={forecastSetup.productiveHoursPerFteMonth}
                  onChange={(event) =>
                    updateForecastSetup({
                      productiveHoursPerFteMonth: Math.round(
                        Math.max(0, +event.target.value),
                      ),
                    })
                  }
                />
              </Field>
              <button
                className="primary forecast-button"
                onClick={() => {
                  try {
                    setDraft(
                      generateSoftBacklogForecast({
                        ...draft,
                        forecastSetup,
                      }),
                    );
                    setForecastError('');
                  } catch (cause) {
                    setForecastError(
                      cause instanceof Error
                        ? cause.message
                        : 'The monthly forecast could not be generated.',
                    );
                  }
                }}
              >
                GENERATE MONTHLY FORECAST
              </button>
            </div>
            <p className="forecast-formula-note">
              FTE people = labor hours ÷{' '}
              {forecastSetup.productiveHoursPerFteMonth || 0} productive hours
              per FTE-month. Straight-line spreads work evenly; Bell curve ramps
              up, peaks near the middle, and tapers.
            </p>
            {forecastError && (
              <p className="forecast-error" role="alert">
                {forecastError}
              </p>
            )}
            {!forecastSetup.generated &&
              forecastSetup.totalLaborHours > 0 &&
              !project.curve.some((value) => value > 0) && (
                <p className="forecast-pending">
                  Confirm the dates and method, then generate the monthly
                  forecast.
                </p>
              )}
            <div className="soft-monthly-grid">
              {MONTHS.map((month, index) => (
                <label key={month}>
                  <span>{month}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={project.curve[index] ?? 0}
                    onChange={(event) => {
                      const curve = [...project.curve];
                      curve[index] =
                        Math.round(Math.max(0, +event.target.value) * 10) / 10;
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              forecastSetup: {
                                ...(current.forecastSetup ?? forecastSetup),
                                generated: false,
                              },
                              project: {
                                ...current.project,
                                curve,
                                method: 'Manual monthly forecast',
                              },
                            }
                          : current,
                      );
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
        <footer className="soft-backlog-footer">
          <div
            className={
              issues.length ? 'validation-box' : 'validation-box ready'
            }
          >
            <strong>
              {issues.length
                ? editingProjectId
                  ? 'Complete before saving'
                  : 'Complete before adding'
                : editingProjectId
                  ? 'Ready to save'
                  : 'Ready to add'}
            </strong>
            {issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
          <div>
            <button onClick={close}>CANCEL</button>
            <button
              className="primary"
              disabled={issues.length > 0}
              onClick={() =>
                save({
                  ...draft,
                  project: { ...project, id: project.id.trim() },
                })
              }
            >
              {editingProjectId
                ? 'SAVE SOFT BACKLOG CHANGES'
                : 'ADD TO SOFT BACKLOG'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ProposedIntakeModal({
  draft,
  setDraft,
  close,
  next,
}: {
  draft: ProposedProjectIntake;
  setDraft: React.Dispatch<React.SetStateAction<ProposedProjectIntake | null>>;
  close: () => void;
  next: (draft: ProposedProjectIntake) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(close);
  const archetype = PROPOSED_PROJECT_ARCHETYPES.find(
    (item) => item.id === draft.archetypeId,
  );
  const update = (patch: Partial<ProposedProjectIntake>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const issues = [
    ...(!draft.name.trim() ? ['Project name is required.'] : []),
    ...(!archetype ? ['Choose a project type.'] : []),
    ...(draft.value <= 0 ? ['Contract value must be greater than zero.'] : []),
    ...(draft.endIndex < draft.startIndex
      ? ['Expected completion must be on or after the start month.']
      : []),
  ];
  return (
    <div className="overlay">
      <section
        className="modal proposed-intake-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add Proposed Project"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>ADD PROPOSED PROJECT — BASIC INFORMATION</span>
            <h2>Describe the opportunity</h2>
          </div>
          <button onClick={close}>
            <X /> Cancel
          </button>
        </header>
        <div className="proposed-intake-body">
          <p className="section-copy">
            The selected project type supplies the initial cost, labor, and
            staffing assumptions. You can review and change them on the next
            screen.
          </p>
          <div className="form-grid">
            <Field label="PROJECT NAME">
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </Field>
            <Field label="PROJECT TYPE / ASSUMPTION SET">
              <select
                value={draft.archetypeId}
                onChange={(event) => {
                  const nextArchetype = PROPOSED_PROJECT_ARCHETYPES.find(
                    (item) => item.id === event.target.value,
                  );
                  update({
                    archetypeId: event.target.value,
                    endIndex: Math.min(
                      MONTHS.length - 1,
                      draft.startIndex +
                        (nextArchetype?.defaultDurationMonths ?? 1) -
                        1,
                    ),
                  });
                }}
              >
                {PROPOSED_PROJECT_ARCHETYPES.length === 0 && (
                  <option value="">No assumption sets available</option>
                )}
                {PROPOSED_PROJECT_ARCHETYPES.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="DEPARTMENT">
              <select
                value={draft.department}
                onChange={(event) => update({ department: event.target.value })}
              >
                {DEPARTMENTS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="CONTRACT VALUE ($M)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.value}
                onChange={(event) =>
                  update({
                    value:
                      Math.round(Math.max(0, +event.target.value) * 100) / 100,
                  })
                }
              />
            </Field>
            <Field label="EXPECTED START">
              <select
                value={draft.startIndex}
                onChange={(event) => {
                  const startIndex = +event.target.value;
                  const duration = draft.endIndex - draft.startIndex;
                  update({
                    startIndex,
                    endIndex: Math.min(
                      MONTHS.length - 1,
                      startIndex + Math.max(0, duration),
                    ),
                  });
                }}
              >
                {MONTHS.map((value, index) => (
                  <option value={index} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="EXPECTED COMPLETION">
              <select
                value={draft.endIndex}
                onChange={(event) => update({ endIndex: +event.target.value })}
              >
                {MONTHS.map((value, index) => (
                  <option
                    value={index}
                    key={value}
                    disabled={index < draft.startIndex}
                  >
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="PLANNING PROBABILITY (%)">
              <div className="percent-input">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.probability}
                  onChange={(event) =>
                    update({
                      probability: Math.max(
                        0,
                        Math.min(100, Math.round(+event.target.value)),
                      ),
                    })
                  }
                />
                <span>%</span>
              </div>
            </Field>
          </div>
          {archetype?.notes && (
            <div className="estimate-warnings proposed-archetype-note">
              <strong>About this assumption set</strong>
              <p>{archetype.notes}</p>
            </div>
          )}
        </div>
        <footer className="soft-backlog-footer">
          <div
            className={
              issues.length ? 'validation-box' : 'validation-box ready'
            }
          >
            <strong>
              {issues.length ? 'Complete before continuing' : 'Ready'}
            </strong>
            {issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
          <div>
            <button onClick={close}>CANCEL</button>
            <button
              className="primary"
              disabled={issues.length > 0}
              onClick={() => next(draft)}
            >
              BUILD INITIAL FORECAST
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ProposedModal({
  config,
  projectId,
  setLive,
  result,
  category,
  display,
  isNew,
  close,
}: {
  config: ScenarioConfig;
  projectId: string;
  setLive: React.Dispatch<React.SetStateAction<ScenarioConfig>>;
  result: ReturnType<typeof analyze>;
  category: LaborCategory;
  display: (v: number) => string;
  isNew: boolean;
  close: (discard: boolean) => void;
}) {
  const a =
    config.proposedProjects.find((project) => project.id === projectId) ??
    config.proposedProjects[0];
  const dialogRef = useDialogA11y<HTMLElement>(() => close(true));
  if (!a) return null;
  const issues = [
    ...(!a.name.trim() ? ['Project name is required.'] : []),
    ...(a.value <= 0 ? ['Contract value must be greater than zero.'] : []),
    ...(Object.values(a.costMix).reduce((s, v) => s + v, 0) === 100
      ? []
      : ['Contract cost mix must total 100%.']),
    ...(Object.values(a.laborAllocation).reduce((s, v) => s + v, 0) === 100
      ? []
      : ['Internal labor allocation must total 100%.']),
    ...validateWorkPackages(a.workPackages),
  ];
  const update = <K extends keyof typeof a>(key: K, value: (typeof a)[K]) =>
    setLive((c) => ({
      ...c,
      proposedProjects: c.proposedProjects.map((project) =>
        project.id === a.id ? { ...project, [key]: value } : project,
      ),
    }));
  const analysis = metrics(result);
  return (
    <div className="overlay">
      <section
        className="modal proposed-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Proposed project — live execution impact"
        tabIndex={-1}
      >
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
              <Field label="PROJECT TYPE / ASSUMPTION SET">
                <input readOnly value={a.projectType} />
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
                  step="0.01"
                  value={a.value}
                  onChange={(e) =>
                    update(
                      'value',
                      Math.round(Math.max(0, +e.target.value) * 100) / 100,
                    )
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
                  step="1"
                  value={a.durationMonths}
                  onChange={(e) =>
                    setLive((config) => ({
                      ...config,
                      proposedProjects: config.proposedProjects.map(
                        (project) =>
                          project.id === a.id
                            ? resizeProposedProjectSchedule(
                                project,
                                +e.target.value,
                                MONTHS.length,
                              )
                            : project,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="PLANNING PROBABILITY (%)">
                <div className="percent-input">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={a.probability}
                    onChange={(e) =>
                      update(
                        'probability',
                        Math.max(0, Math.min(100, Math.round(+e.target.value))),
                      )
                    }
                  />
                  <span>%</span>
                </div>
              </Field>
            </div>
            <section>
              <h3>Contract cost mix</h3>
              <div className="form-grid four">
                {Object.entries(a.costMix).map(([key, value]) => (
                  <Field
                    key={key}
                    label={`${key.replace(/[A-Z]/g, (m) => ` ${m}`).toUpperCase()} (%)`}
                  >
                    <div className="percent-input">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={value}
                        onChange={(e) =>
                          update('costMix', {
                            ...a.costMix,
                            [key]:
                              Math.round(Math.max(0, +e.target.value) * 10) /
                              10,
                          })
                        }
                      />
                      <span>%</span>
                    </div>
                  </Field>
                ))}
              </div>
              <Validation
                total={Object.values(a.costMix).reduce((s, v) => s + v, 0)}
                label="Cost mix"
              />
            </section>
            <section>
              <h3>Internal labor allocation (% of internal labor hours)</h3>
              <div className="labor-grid">
                {LABOR_CATEGORIES.map((cat) => (
                  <Field key={cat} label={`${cat.toUpperCase()} (%)`}>
                    <div className="percent-input">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={a.laborAllocation[cat]}
                        onChange={(e) =>
                          update('laborAllocation', {
                            ...a.laborAllocation,
                            [cat]:
                              Math.round(Math.max(0, +e.target.value) * 10) /
                              10,
                          })
                        }
                      />
                      <span>%</span>
                    </div>
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
                  setLive((c) => ({
                    ...c,
                    proposedIncluded: {
                      ...c.proposedIncluded,
                      [a.id]: true,
                    },
                  }));
                  close(false);
                }}
              >
                {isNew
                  ? 'ADD TO SCENARIO'
                  : config.proposedIncluded[a.id] !== false
                    ? 'UPDATE IN SCENARIO'
                    : 'ADD TO SCENARIO'}
              </button>
              {!isNew && (
                <button
                  onClick={() =>
                    setLive((c) => ({
                      ...c,
                      proposedIncluded: {
                        ...c.proposedIncluded,
                        [a.id]: false,
                      },
                    }))
                  }
                >
                  REMOVE FROM SCENARIO
                </button>
              )}
            </div>
            <p className="fine-print">
              The preview includes this project. Recommendations follow
              documented rules and are not a management decision.
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
            {
              MONTHS[
                Math.min(
                  MONTHS.length - 1,
                  item.startIndex + item.scenarioShift,
                )
              ]
            }
            .
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
  const dialogRef = useDialogA11y<HTMLElement>(() => close(true));
  return (
    <div className="overlay">
      <section
        className="modal action-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Capacity action — live preview"
        tabIndex={-1}
      >
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
  department,
  close,
}: {
  plans: WorkforcePlan[];
  category: LaborCategory;
  department: string;
  close: () => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(close);
  return (
    <div className="overlay">
      <section
        className="modal compare-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Plan comparison — ${category}, ${department}`}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>
              PLAN COMPARISON — {category}, {department}
            </span>
            <h2>Compare execution risk and capacity commitments</h2>
          </div>
          <button onClick={close}>
            <X /> Close
          </button>
        </header>
        <div className="compare-grid">
          {plans.map((p) => {
            const r = analyze(p.config, category, department),
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
                  ['Peak shortage', `${m.peakVsExisting.toFixed(1)} FTE`],
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
                    `${
                      p.config.proposedProjects.filter(
                        (project) =>
                          p.config.proposedIncluded[project.id] !== false,
                      ).length
                    } of ${p.config.proposedProjects.length} included`,
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
