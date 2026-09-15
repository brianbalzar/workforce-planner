import {
  CATEGORY_FACTORS,
  MONTH_KEYS,
  MONTHS,
  PROJECTS,
} from '../data/runtimeData';
import type {
  AnalysisResult,
  AssumptionFlag,
  CapacityAction,
  DemandResult,
  FreshnessStatus,
  LaborCategory,
  PeopleBasis,
  PeopleMetrics,
  Project,
  ScenarioConfig,
  Unit,
  WorkPackage,
  WorkweekHours,
} from '../domain/types';

const N = 18;
const zeros = () => Array(N).fill(0) as number[];
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const defaultWpValues: Record<string, number> = {
  'atlas-w1': 20,
  'atlas-w2': 60,
  'atlas-w3': 20,
};

// Nearest-neighbour resample of a reference shape to n slots, per
// CALCULATIONS.md §2.
export function resample(reference: number[], n: number): number[] {
  if (n <= 0) return [];
  if (!reference.length) return zeros().slice(0, n).fill(0);
  if (reference.length === n) return [...reference];
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.min(
      reference.length - 1,
      Math.round((i / Math.max(1, n - 1)) * (reference.length - 1)),
    );
    return reference[idx];
  });
}

// 0-28% ramp up, 28-62% plateau at 1, then taper to 0, per CALCULATIONS.md §2.
export function ramp(n: number): number[] {
  const rampEnd = Math.round(n * 0.28);
  const plateauEnd = Math.max(rampEnd, Math.round(n * 0.62));
  return Array.from({ length: n }, (_, i) => {
    if (i < rampEnd) return (i + 1) / (rampEnd + 1);
    if (i < plateauEnd) return 1;
    const tail = n - plateauEnd;
    return tail > 0 ? Math.max(0, 1 - (i - plateauEnd + 1) / (tail + 1)) : 0;
  });
}

const COMPARABLE_PROJECT_SHAPE = [
  0.2, 0.4, 0.6, 0.8, 1, 1, 0.8, 0.5, 0.2, 0, 0, 0,
];

// A normalized (peak ~1) shape of length n for a staffing-curve choice.
export function shapeFor(
  curve: WorkPackage['staffingCurve'],
  n: number,
  manual?: number[],
): number[] {
  if (curve === 'Manual monthly forecast')
    return manual?.length ? resample(manual, n) : Array(n).fill(1);
  if (curve === 'Even distribution') return Array(n).fill(0.6);
  if (curve === 'Standard ramp / peak / taper') return ramp(n);
  return resample(COMPARABLE_PROJECT_SHAPE, n);
}

// The work package's authored shape, isolated from its 18-slot padding, as
// it existed at the plan's baseline (before any scenario edits).
function baselineShape(w: WorkPackage): number[] {
  const len = w.baselineDurationMonths ?? w.durationMonths;
  return w.curve.slice(w.startIndex, w.startIndex + len);
}

// Resolve a work package's live 18-slot curve. When neither its duration
// nor its staffing-curve selection has moved from the plan's baseline, this
// returns the exact authored curve unchanged — so editing unrelated fields
// (value, cost mix, probability, self-perform %) never perturbs the shape,
// and the specified baseline numbers stay exact. Changing duration alone
// stretches/compresses the authored shape; changing the staffing-curve
// selection switches to the matching generic template, rescaled to the
// package's baseline peak, then placed at its (possibly shifted) start.
export function resolveWorkPackageCurve(w: WorkPackage): number[] {
  const n = Math.max(1, Math.round(w.durationMonths));
  const curveUnchanged =
    (w.baselineStaffingCurve ?? w.staffingCurve) === w.staffingCurve;
  const durationUnchanged =
    (w.baselineDurationMonths ?? w.durationMonths) === w.durationMonths;
  let shape: number[];
  if (curveUnchanged && durationUnchanged) return [...w.curve];
  if (curveUnchanged) {
    shape = resample(baselineShape(w), n);
  } else {
    const peak = Math.max(0, ...baselineShape(w));
    const template = shapeFor(w.staffingCurve, n, w.manualMonthly);
    const templatePeak = Math.max(0, ...template) || 1;
    shape = template.map((v) => (v / templatePeak) * peak);
  }
  const out = zeros();
  const placeAt = w.startIndex + w.scenarioShift;
  shape.forEach((v, k) => {
    const i = placeAt + k;
    if (i >= 0 && i < N) out[i] = v;
  });
  return out;
}

export function rollupProjectCurve(
  project: Project,
  overrides?: Record<string, boolean>,
): number[] {
  if (!project.workPackages?.length) return [...project.curve];
  const out = zeros();
  project.workPackages
    .filter((w) => overrides?.[w.id] ?? w.included)
    .forEach((w) => w.curve.forEach((v, i) => (out[i] += v)));
  return out.map(round3);
}

export function proposedCurve(
  cfg: ScenarioConfig,
  category: LaborCategory,
  department?: string,
): number[] {
  const out = zeros();
  cfg.proposedProjects
    .filter((project) => cfg.proposedIncluded[project.id] !== false)
    .filter((project) => !department || project.department === department)
    .forEach((a) => {
      const baselineStart = a.workPackages.length
        ? Math.min(
            ...a.workPackages.map((workPackage) => workPackage.startIndex),
          )
        : a.startIndex;
      const globalShare =
        (a.laborAllocation[category] || 0) /
        (category === 'Plumber'
          ? 85
          : Math.max(1, (CATEGORY_FACTORS[category] || 1) * 85));
      if (globalShare <= 0) return;
      a.workPackages
        .filter((w) => w.included)
        .forEach((w) => {
          const valueScale =
            w.valuePercent / (defaultWpValues[w.id] || w.valuePercent || 1);
          const selfScale =
            w.selfPerformPercent / (w.baselineSelfPerformPercent || 100);
          resolveWorkPackageCurve(w).forEach((v, i) => {
            if (!v) return;
            const target = i + (a.startIndex - baselineStart);
            if (target >= 0 && target < N)
              out[target] +=
                v *
                (a.value / 10) *
                (a.costMix.internalLabor / 35) *
                (a.probability / 100) *
                globalShare *
                valueScale *
                selfScale;
          });
        });
    });
  return out.map(round3);
}

export function proposedProjectCurve(
  cfg: ScenarioConfig,
  projectId: string,
  category: LaborCategory,
): number[] {
  const included = cfg.proposedIncluded[projectId];
  const isolated = {
    ...cfg,
    proposedProjects: cfg.proposedProjects.filter((p) => p.id === projectId),
    proposedIncluded: { [projectId]: included },
  };
  return proposedCurve(isolated, category);
}

export function demand(
  cfg: ScenarioConfig,
  category: LaborCategory,
  department?: string,
): DemandResult {
  const hard = zeros(),
    expected = zeros(),
    scenario = zeros(),
    drivers = Array.from(
      { length: N },
      () => [] as Array<{ name: string; type: string; fte: number }>,
    );
  PROJECTS.forEach((p) => {
    if (department && p.department !== department) return;
    if (cfg.included[p.id] === false) return;
    const factor =
        p.curveBasis === 'total-internal-labor'
          ? (p.laborAllocation[category] ?? 0) / 100
          : CATEGORY_FACTORS[category] || 1,
      source = rollupProjectCurve(p, cfg.packageIncluded),
      shift = cfg.shifts[p.id] || 0,
      prob =
        p.type === 'Hard'
          ? 100
          : (cfg.probabilities[p.id] ?? p.planningProbability);
    for (let i = 0; i < N; i++) {
      const j = i - shift;
      if (j < 0 || j >= N) continue;
      const raw = source[j] * factor;
      if (raw <= 0) continue;
      const weighted = (raw * prob) / 100;
      if (p.type === 'Hard') hard[i] += raw;
      expected[i] += weighted;
      scenario[i] += weighted;
      if (weighted > 0.02)
        drivers[i].push({
          name: p.name,
          type:
            p.type === 'Hard'
              ? 'Hard backlog · awarded'
              : `Soft backlog · ${prob}% planning`,
          fte: weighted,
        });
    }
  });
  const proposed = zeros();
  cfg.proposedProjects
    .filter((project) => cfg.proposedIncluded[project.id] !== false)
    .filter((project) => !department || project.department === department)
    .forEach((project) => {
      proposedProjectCurve(cfg, project.id, category).forEach((v, i) => {
        proposed[i] += v;
        scenario[i] += v;
        if (v > 0.02)
          drivers[i].push({
            name: project.name,
            type: 'Proposed scenario work',
            fte: v,
          });
      });
    });
  drivers.forEach((d) => d.sort((a, b) => b.fte - a.fte));
  return {
    hard: hard.map(round3),
    expected: expected.map(round3),
    scenario: scenario.map(round3),
    proposed,
    drivers,
  };
}

export function hireRampFactors(
  action: CapacityAction,
): Record<number, number> {
  if (!action.enableRampCapacity) return {};
  return { [action.fromIndex - 2]: 0.5, [action.fromIndex - 1]: 0.75 };
}

export function analyze(
  cfg: ScenarioConfig,
  category: LaborCategory,
  department?: string,
): AnalysisResult {
  const d = demand(cfg, category, department),
    existing = zeros(),
    confirmedHires = zeros(),
    plannedHires = zeros(),
    subcontract = zeros(),
    confirmedSub = zeros(),
    overtime = zeros(),
    departures = zeros(),
    leave = zeros();
  cfg.actions
    .filter((a) => a.category === category && a.status !== 'Cancelled')
    .forEach((a) => {
      if (a.kind === 'hire') {
        for (let i = Math.max(0, a.fromIndex); i < N; i++)
          (a.confirmed ? confirmedHires : plannedHires)[i] += a.quantity;
        Object.entries(hireRampFactors(a)).forEach(([key, factor]) => {
          const i = Number(key);
          if (i >= 0 && i < N)
            (a.confirmed ? confirmedHires : plannedHires)[i] +=
              a.quantity * factor;
        });
      } else if (a.kind === 'subcontract')
        for (
          let i = Math.max(0, a.fromIndex);
          i <= Math.min(N - 1, a.toIndex);
          i++
        ) {
          subcontract[i] += a.quantity;
          if (a.confirmed) confirmedSub[i] += a.quantity;
        }
      else if (a.kind === 'overtime')
        for (
          let i = Math.max(0, a.fromIndex);
          i <= Math.min(N - 1, a.toIndex);
          i++
        )
          overtime[i] += a.quantity;
      else if (a.kind === 'leave')
        for (
          let i = Math.max(0, a.fromIndex);
          i <= Math.min(N - 1, a.toIndex);
          i++
        )
          leave[i] += a.quantity;
      else if (a.kind === 'attrition')
        for (let i = Math.max(0, a.fromIndex); i < N; i++)
          departures[i] += a.quantity;
    });
  const k = cfg.capacity[category],
    total = zeros(),
    gap = zeros(),
    unconfirmed = zeros(),
    prefab = zeros();
  for (let i = 0; i < N; i++) {
    existing[i] = Math.max(
      0,
      k.headcount * (1 - (k.leavePercent + k.attritionPercent) / 100) -
        leave[i] -
        departures[i],
    );
    // The pre-fab shop is a first source: it offsets demand before any
    // onsite capacity is counted. It never "banks" unused shop capacity —
    // a month that needs less than the shop can produce only uses what it
    // needs.
    prefab[i] = Math.min(k.prefabCapacity, d.scenario[i]);
    total[i] =
      prefab[i] +
      existing[i] +
      confirmedHires[i] +
      plannedHires[i] +
      subcontract[i] +
      overtime[i];
    gap[i] = Math.max(0, d.scenario[i] - total[i]);
    unconfirmed[i] =
      plannedHires[i] + subcontract[i] - confirmedSub[i] + overtime[i];
  }
  return {
    ...d,
    prefab,
    existing,
    confirmedHires,
    plannedHires,
    subcontract,
    overtime,
    total,
    gap,
    unconfirmed,
  };
}

export function metrics(r: AnalysisResult) {
  const first = r.gap.findIndex((g) => g > 0.05),
    peak = Math.max(...r.gap),
    peakIndex = r.gap.indexOf(peak),
    shortages = r.scenario.map((v, i) => Math.max(0, v - r.existing[i])),
    peakVsExisting = Math.max(...shortages),
    peakVsExistingIndex = shortages.indexOf(peakVsExisting);
  return {
    firstIndex: first,
    firstMonth: first < 0 ? 'None' : MONTHS[first],
    peak,
    peakIndex,
    peakMonth: MONTHS[peakIndex],
    duration: r.gap.filter((g) => g > 0.05).length,
    personMonths: r.gap.reduce((s, g) => s + g, 0),
    peakVsExisting,
    peakVsExistingMonth: MONTHS[peakVsExistingIndex],
    existingAtPeakVsExisting: r.existing[peakVsExistingIndex],
    subcontractPersonMonths: r.subcontract.reduce((s, v) => s + v, 0),
    prefabPersonMonths: r.prefab.reduce((s, v) => s + v, 0),
    prefabPeak: Math.max(...r.prefab),
    temporaryCapacityPeak: Math.max(...r.subcontract),
    overtimePeak: Math.max(...r.overtime),
    addedCapacityFteMonths:
      r.confirmedHires.reduce((s, v) => s + v, 0) +
      r.plannedHires.reduce((s, v) => s + v, 0) +
      r.subcontract.reduce((s, v) => s + v, 0),
    unconfirmedPeak: Math.max(...r.unconfirmed),
    confidence:
      peak > 0.05
        ? 'At risk'
        : Math.max(...r.unconfirmed) > 0.05
          ? 'Conditional'
          : 'Executable',
  };
}

/**
 * When combining categories with different capacity assumptions under
 * Hours or Labor Cost, each category's values must be scaled by a weight so
 * a single unit conversion against the primary category's own rates is
 * correct — People needs no weighting since it's category-agnostic.
 */
export function categoryUnitWeight(
  unit: Unit,
  primary: { productiveHours: number; hourlyRate: number },
  category: { productiveHours: number; hourlyRate: number },
): number {
  if (unit === 'Hours')
    return category.productiveHours / primary.productiveHours;
  if (unit === 'Labor Cost')
    return (
      (category.productiveHours * category.hourlyRate) /
      (primary.productiveHours * primary.hourlyRate)
    );
  return 1;
}

/**
 * Pools two or more analyze() results (e.g. several labor categories, or
 * several departments) into one, per the design handoff's `sumSeries`.
 * Demand arrays and gap are scaled by each entry's own weight and summed;
 * capacity arrays are additionally clamped by that entry's own
 * total-vs-scenario ratio first, so capacity beyond what that entry's own
 * demand needed is never counted — a surplus in one category/department
 * never covers a shortage in another. `gap` is summed directly (scaled,
 * never recomputed from the summed totals). Pass `weight: 1` for every
 * entry when combining same-unit entries (e.g. departments under the same
 * category) — this is a strict generalization of a plain unweighted sum.
 */
export function combineWeightedResults(
  entries: Array<{ result: AnalysisResult; weight: number }>,
): AnalysisResult {
  if (entries.length === 1 && entries[0].weight === 1) return entries[0].result;
  const sums = {
    hard: zeros(),
    expected: zeros(),
    scenario: zeros(),
    proposed: zeros(),
    prefab: zeros(),
    existing: zeros(),
    confirmedHires: zeros(),
    plannedHires: zeros(),
    subcontract: zeros(),
    overtime: zeros(),
    total: zeros(),
    gap: zeros(),
    unconfirmed: zeros(),
  };
  const driverMaps = Array.from(
    { length: N },
    () => new Map<string, { name: string; type: string; fte: number }>(),
  );
  entries.forEach(({ result: r, weight: w }) => {
    for (let i = 0; i < N; i++) {
      const f =
        r.total[i] > r.scenario[i] && r.total[i] > 0
          ? r.scenario[i] / r.total[i]
          : 1;
      sums.hard[i] += r.hard[i] * w;
      sums.expected[i] += r.expected[i] * w;
      sums.scenario[i] += r.scenario[i] * w;
      sums.proposed[i] += r.proposed[i] * w;
      sums.prefab[i] += r.prefab[i] * f * w;
      sums.existing[i] += r.existing[i] * f * w;
      sums.confirmedHires[i] += r.confirmedHires[i] * f * w;
      sums.plannedHires[i] += r.plannedHires[i] * f * w;
      sums.subcontract[i] += r.subcontract[i] * f * w;
      sums.overtime[i] += r.overtime[i] * f * w;
      sums.total[i] += r.total[i] * f * w;
      sums.gap[i] += r.gap[i] * w;
      sums.unconfirmed[i] += r.unconfirmed[i] * f * w;
      r.drivers[i].forEach((d) => {
        const existing = driverMaps[i].get(d.name);
        const fte = d.fte * w;
        if (existing) existing.fte += fte;
        else driverMaps[i].set(d.name, { ...d, fte });
      });
    }
  });
  const drivers = driverMaps.map((m) =>
    [...m.values()].sort((a, b) => b.fte - a.fte),
  );
  return {
    hard: sums.hard.map(round3),
    expected: sums.expected.map(round3),
    scenario: sums.scenario.map(round3),
    proposed: sums.proposed.map(round3),
    drivers,
    prefab: sums.prefab.map(round3),
    existing: sums.existing.map(round3),
    confirmedHires: sums.confirmedHires.map(round3),
    plannedHires: sums.plannedHires.map(round3),
    subcontract: sums.subcontract.map(round3),
    overtime: sums.overtime.map(round3),
    total: sums.total.map(round3),
    gap: sums.gap.map(round3),
    unconfirmed: sums.unconfirmed.map(round3),
  };
}

export function formatValue(
  fte: number,
  unit: Unit,
  hours: number,
  rate: number,
) {
  if (unit === 'People') return fte.toFixed(1);
  if (unit === 'Hours') return Math.round(fte * hours).toLocaleString('en-US');
  const dollars = fte * hours * rate;
  return dollars >= 1e6
    ? `$${(dollars / 1e6).toFixed(2)}M`
    : `$${Math.round(dollars / 1000)}k`;
}

export function monthStart(index: number) {
  const [year, month] = MONTH_KEYS[0].split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + index, 1));
}
export function subtractDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
export function actionStartDate(action: CapacityAction) {
  const lead = action.leadDays;
  if (!lead) return monthStart(action.fromIndex);
  const days =
    action.kind === 'hire'
      ? lead.recruit + lead.interview + lead.offer + lead.onboard + lead.ramp
      : action.kind === 'subcontract'
        ? lead.source + lead.vet + lead.mobilize
        : 0;
  return subtractDays(monthStart(action.fromIndex), days);
}
export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
// Fractional month index of a date on the same continuous Sep-2026-based
// scale as monthIndex(), for positioning milestones between whole months.
export function datePosition(date: Date): number {
  for (let i = -12; i < 30; i++) {
    const start = monthStart(i).getTime();
    const end = monthStart(i + 1).getTime();
    if (date.getTime() >= start && date.getTime() < end) {
      return i + (date.getTime() - start) / (end - start);
    }
  }
  return date.getTime() < monthStart(-12).getTime() ? -12 : 30;
}
export interface ActionPhase {
  label: string;
  start: Date;
  end: Date;
}
export interface ActionTimeline {
  phases: ActionPhase[];
  milestones: Array<{ label: string; date: Date; final?: boolean }>;
  productiveStart: Date;
  productiveEnd: Date | null; // null = open-ended (runs to the end of the window)
}
// The full backward-calculated phase/milestone breakdown for a hire or
// subcontract action, per CALCULATIONS.md §5. Returns null for action kinds
// with no lead-time structure (overtime, leave, attrition).
export function actionMilestones(
  action: CapacityAction,
): ActionTimeline | null {
  const lead = action.leadDays;
  if (!lead) return null;
  const productiveStart = monthStart(action.fromIndex);
  if (action.kind === 'hire') {
    const recruitingStart = subtractDays(
      productiveStart,
      lead.recruit + lead.interview + lead.offer + lead.onboard + lead.ramp,
    );
    const interviewsStart = addDays(recruitingStart, lead.recruit);
    const offerAccepted = addDays(interviewsStart, lead.interview);
    const hireStarts = addDays(offerAccepted, lead.offer);
    const onboardingEnds = addDays(hireStarts, lead.onboard);
    return {
      phases: [
        { label: 'Recruiting', start: recruitingStart, end: interviewsStart },
        {
          label: 'Interviewing and selection',
          start: interviewsStart,
          end: offerAccepted,
        },
        { label: 'Offer / notice', start: offerAccepted, end: hireStarts },
        { label: 'Onboarding', start: hireStarts, end: onboardingEnds },
        { label: 'Ramp-up', start: onboardingEnds, end: productiveStart },
      ],
      milestones: [
        { label: 'Begin recruiting', date: recruitingStart },
        { label: 'Offer accepted', date: offerAccepted },
        { label: 'Hire starts', date: hireStarts },
        { label: 'Fully productive', date: productiveStart, final: true },
      ],
      productiveStart,
      productiveEnd: null,
    };
  }
  if (action.kind === 'subcontract') {
    const sourcingStart = subtractDays(
      productiveStart,
      lead.source + lead.vet + lead.mobilize,
    );
    const sourcingComplete = addDays(sourcingStart, lead.source);
    const contractExecuted = addDays(sourcingComplete, lead.vet);
    return {
      phases: [
        { label: 'Sourcing', start: sourcingStart, end: sourcingComplete },
        {
          label: 'Vetting and contracting',
          start: sourcingComplete,
          end: contractExecuted,
        },
        {
          label: 'Mobilization',
          start: contractExecuted,
          end: productiveStart,
        },
      ],
      milestones: [
        { label: 'Begin subcontract sourcing', date: sourcingStart },
        { label: 'Subcontract executed', date: contractExecuted },
        {
          label: 'Mobilized and productive',
          date: productiveStart,
          final: true,
        },
      ],
      productiveStart,
      productiveEnd: monthStart(action.toIndex + 1),
    };
  }
  return null;
}
export const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Contiguous runs of months where `values[i] > epsilon` — a gap window. */
export function contiguousWindows(
  values: number[],
  epsilon = 0.05,
): Array<{ start: number; end: number; values: number[] }> {
  const groups: Array<{ start: number; end: number; values: number[] }> = [];
  let active: null | { start: number; end: number; values: number[] } = null;
  values.forEach((v, i) => {
    if (v > epsilon) {
      if (!active) active = { start: i, end: i, values: [] };
      active.end = i;
      active.values.push(v);
    } else if (active) {
      groups.push(active);
      active = null;
    }
  });
  if (active) groups.push(active);
  return groups;
}

export function recommendations(r: AnalysisResult) {
  const groups = contiguousWindows(r.gap);
  return groups.map((group) => {
    const sorted = [...group.values].sort((a, b) => a - b),
      median = sorted[Math.floor(sorted.length / 2)],
      peak = Math.max(...group.values),
      length = group.end - group.start + 1,
      softShare =
        r.scenario
          .slice(group.start, group.end + 1)
          .reduce((sum, v, i) => sum + (v - r.hard[group.start + i]), 0) /
        Math.max(
          0.01,
          r.scenario
            .slice(group.start, group.end + 1)
            .reduce((a, b) => a + b, 0),
        );
    const mode =
      length >= 6
        ? 'hire'
        : length >= 2 || peak > 1
          ? 'subcontract'
          : 'overtime';
    const qty =
      mode === 'hire'
        ? Math.max(1, Math.round(median))
        : mode === 'subcontract'
          ? Math.ceil(peak)
          : 1;
    const title =
      mode === 'hire'
        ? `${qty} permanent ${qty === 1 ? 'hire' : 'hires'}`
        : mode === 'subcontract'
          ? `${qty} subcontract FTE`
          : 'Use approved overtime';
    const why =
      mode === 'hire'
        ? `The gap persists ${length} consecutive months (${MONTHS[group.start]} through ${MONTHS[group.end]}) and peaks at ${peak.toFixed(1)} FTE. Sustained demand is treated as structural.`
        : mode === 'subcontract'
          ? `The gap lasts ${length} ${length === 1 ? 'month' : 'months'} and peaks at ${peak.toFixed(1)} FTE. This temporary window favors flexible capacity.`
          : `A single-month gap of ${peak.toFixed(1)} FTE is within the overtime allowance.`;
    return {
      mode,
      title,
      why:
        why +
        (softShare > 0.5
          ? ` ${(softShare * 100).toFixed(0)}% of demand is soft or proposed; treat the action as contingent on award.`
          : ''),
      start: group.start,
      end: group.end,
    };
  });
}

export function validateWorkPackages(packages: WorkPackage[]) {
  const valueTotal = packages.reduce((s, p) => s + p.valuePercent, 0),
    issues: string[] = [];
  if (Math.abs(valueTotal - 100) > 0.01)
    issues.push(
      `Work-package values total ${valueTotal.toFixed(1)}%; they must reconcile to 100%.`,
    );
  packages.forEach((p) => {
    if (p.selfPerformPercent + p.subcontractPercent !== 100)
      issues.push(`${p.name}: self-perform and subcontract must total 100%.`);
    if (
      p.startIndex + p.scenarioShift < 0 ||
      p.startIndex + p.scenarioShift >= MONTHS.length
    )
      issues.push(`${p.name}: start date is outside the planning window.`);
  });
  return issues;
}

// --- Portfolio-planning rollups (source forecast -> department view) ------
// A single project's own weekly/monthly labor forecast rolls up here. These
// functions are intentionally simple and stop at what the department
// planner needs — they are not a re-implementation of a project-level
// labor-tracking tool.

const WEEKS_PER_MONTH = 4.33;

/**
 * Rolls weekly crew counts up into a monthly PEAK per the required rule:
 * a month's People-view figure is the highest single week within it, never
 * an hours-style average. Example: [10, 10, 25, 10] (one month) -> [25].
 */
export function peakCrewFromWeekly(
  weeklyCrew: number[],
  weeksPerMonth = 4,
): number[] {
  const months: number[] = [];
  for (let i = 0; i < weeklyCrew.length; i += weeksPerMonth) {
    months.push(Math.max(...weeklyCrew.slice(i, i + weeksPerMonth)));
  }
  return months;
}

/**
 * Average/implied headcount from a total-hours commitment: the same hours
 * imply fewer concurrent people as the assumed workweek gets longer. This
 * does NOT mean a longer workweek proportionally increases capacity — it
 * only changes how many people that many hours implies.
 */
export function impliedPeopleFromHours(
  totalHours: number,
  activeMonths: number,
  workweekHours: WorkweekHours = 40,
): number {
  if (activeMonths <= 0 || workweekHours <= 0) return 0;
  return round3(totalHours / (activeMonths * WEEKS_PER_MONTH * workweekHours));
}

/**
 * A fabricated-but-consistent hours figure for a project, back-computed
 * from its existing (already-FTE-scaled) demand curve at a 40-hour
 * baseline workweek. Lets the workweek assumption below demonstrably move
 * the implied-people figure without inventing a whole separate hours
 * dataset per project.
 */
export function totalForecastHours(
  p: Project,
  baselineWorkweek: WorkweekHours = 40,
): number {
  return round3(
    p.curve.reduce((s, v) => s + v, 0) * baselineWorkweek * WEEKS_PER_MONTH,
  );
}

/**
 * The three People-view metrics for a project, kept distinct per the
 * portfolio-planning requirements: never present the average/implied
 * figure as if it were a confirmed peak crew.
 */
export function peopleMetricsForProject(p: Project): PeopleMetrics {
  const activeCurve = p.curve.filter((v) => v > 0);
  const averageImpliedPeople = activeCurve.length
    ? round3(activeCurve.reduce((s, v) => s + v, 0) / activeCurve.length)
    : 0;

  const curvePeak = Math.max(0, ...p.curve);
  let peakCrew = round3(curvePeak);
  let peakCrewIndex = p.curve.indexOf(curvePeak);
  let basis: PeopleBasis =
    p.method === 'Comparable-project curve'
      ? 'even-spread-estimate'
      : 'monthly-planned';

  if (p.weeklyCrew?.length) {
    const monthlyPeaks = peakCrewFromWeekly(p.weeklyCrew);
    const truePeak = Math.max(...monthlyPeaks);
    peakCrew = round3(truePeak);
    peakCrewIndex = p.startIndex + monthlyPeaks.indexOf(truePeak);
    basis = 'weekly-peak';
  }

  return {
    peakCrew,
    peakCrewMonth: MONTHS[Math.max(0, Math.min(N - 1, peakCrewIndex))],
    averageImpliedPeople,
    monthlyPlannedPeople:
      basis === 'even-spread-estimate' ? undefined : averageImpliedPeople,
    basis,
  };
}

const DEFAULT_FRESHNESS_THRESHOLDS = { approachingDays: 30, staleDays: 60 };

/** Current/Approaching stale/Stale/Missing, per a configurable threshold. */
export function forecastFreshness(
  lastRevisionDate: string | undefined,
  today: Date,
  thresholds: {
    approachingDays: number;
    staleDays: number;
  } = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessStatus {
  if (!lastRevisionDate) return 'Missing';
  const revised = new Date(lastRevisionDate);
  if (Number.isNaN(revised.getTime())) return 'Missing';
  const ageDays = Math.floor(
    (today.getTime() - revised.getTime()) / 86_400_000,
  );
  if (ageDays <= thresholds.approachingDays) return 'Current';
  if (ageDays <= thresholds.staleDays) return 'Approaching stale';
  return 'Stale';
}

/**
 * A representative subset of the data-quality/assumption flag taxonomy:
 * enough to demonstrate the pattern (severity, explanation, effect,
 * recommended action) without hiding uncertainty behind one confidence
 * score. Not the full flag catalog described in the portfolio-planning
 * requirements — see the final report for what is deferred.
 */
export function assumptionFlagsForProject(
  p: Project,
  today: Date,
): AssumptionFlag[] {
  const flags: AssumptionFlag[] = [];
  if (!p.weeklyCrew?.length) {
    flags.push({
      id: `${p.id}-even-spread`,
      severity: p.method === 'Comparable-project curve' ? 'warning' : 'info',
      summary:
        'Peak crew is an even-spread estimate, not a confirmed weekly peak',
      detail: `${p.name} has no weekly staffing histogram, so its People-view peak comes from monthly-resolution data rather than a measured weekly count. A short, sharp staffing peak within a month would not show up here.`,
      effect:
        'A peak-month bottleneck driven by this project may be understated.',
      recommendation:
        'Request a weekly (or at least bi-weekly) crew forecast if this project is a material contributor to a bottleneck month.',
    });
  }
  const freshness = forecastFreshness(p.lastRevisionDate, today);
  if (freshness === 'Missing') {
    flags.push({
      id: `${p.id}-freshness-missing`,
      severity: 'warning',
      summary: 'No forecast revision date on file',
      detail: `${p.name} has no recorded last-revision date for its source forecast.`,
      effect:
        'This project cannot be checked for staleness or scored for confidence.',
      recommendation:
        "Record the date this project's forecast was last reviewed with its owning PM.",
    });
  } else if (freshness === 'Stale') {
    flags.push({
      id: `${p.id}-freshness-stale`,
      severity: 'critical',
      summary: 'Source forecast is stale',
      detail: `${p.name}'s forecast was last revised ${p.lastRevisionDate} and is now more than ${DEFAULT_FRESHNESS_THRESHOLDS.staleDays} days old.`,
      effect:
        'Demand and staffing figures for this project may no longer reflect current schedule or scope.',
      recommendation:
        'Request a refreshed forecast before relying on this project for hiring or subcontract decisions.',
    });
  } else if (freshness === 'Approaching stale') {
    flags.push({
      id: `${p.id}-freshness-approaching`,
      severity: 'info',
      summary: 'Source forecast is approaching stale',
      detail: `${p.name}'s forecast was last revised ${p.lastRevisionDate}.`,
      effect:
        'No effect yet — confidence will degrade if this forecast is not refreshed soon.',
      recommendation:
        "Confirm this project is still on the PM's refresh cadence.",
    });
  }
  if (p.quality.startsWith('Review')) {
    flags.push({
      id: `${p.id}-quality-review`,
      severity: 'warning',
      summary: 'Forecast method flagged for review by its own source',
      detail: `${p.name} uses "${p.method}" (${p.quality}).`,
      effect:
        'Demand attributed to this project carries more uncertainty than a cost-loaded schedule.',
      recommendation:
        'Prioritize this project for a scheduling/estimating review.',
    });
  }
  return flags;
}

/**
 * Buckets each month's demand drivers into a fixed set of series (the
 * overall top contributors plus "Other") so a stacked chart has stable
 * dataKeys across the whole window. Every month's series sum reconciles to
 * that month's total scenario demand (drivers below the 0.02 FTE inclusion
 * threshold in `demand()` are the only rounding difference).
 */
export function monthlyComposition(result: DemandResult, topN = 4) {
  const totals = new Map<string, number>();
  result.drivers.forEach((month) =>
    month.forEach((d) => totals.set(d.name, (totals.get(d.name) || 0) + d.fte)),
  );
  const topNames = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);

  const rows = result.drivers.map((month, i) => {
    const row: Record<string, number | string> = { month: MONTHS[i] };
    topNames.forEach((name) => (row[name] = 0));
    row.Other = 0;
    month.forEach((d) => {
      const key = topNames.includes(d.name) ? d.name : 'Other';
      row[key] = (row[key] as number) + d.fte;
    });
    return row;
  });
  return { rows, series: [...topNames, 'Other'] };
}

/**
 * The first and last month a curve is active (nonzero), inclusive. Used to
 * position a project's bar in the Portfolio Overlap timeline. Returns null
 * for a curve that's zero everywhere (e.g. fully excluded work packages).
 */
export function activeRange(
  curve: number[],
): { start: number; end: number } | null {
  const start = curve.findIndex((v) => v > 0);
  if (start < 0) return null;
  let end = start;
  for (let i = curve.length - 1; i >= 0; i--) {
    if (curve[i] > 0) {
      end = i;
      break;
    }
  }
  return { start, end };
}
