import { CATEGORY_FACTORS, MONTHS, PROJECTS } from '../data/sampleData';
import type {
  AnalysisResult,
  CapacityAction,
  DemandResult,
  LaborCategory,
  Project,
  ScenarioConfig,
  Unit,
  WorkPackage,
} from '../domain/types';

const N = 18;
const zeros = () => Array(N).fill(0) as number[];
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const defaultWpValues: Record<string, number> = {
  'atlas-w1': 20,
  'atlas-w2': 60,
  'atlas-w3': 20,
};

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
): number[] {
  const a = cfg.proposed;
  const out = zeros();
  const globalShare =
    (a.laborAllocation[category] || 0) /
    (category === 'Plumber'
      ? 85
      : Math.max(1, CATEGORY_FACTORS[category] * 85));
  if (globalShare <= 0) return out;
  a.workPackages
    .filter((w) => w.included)
    .forEach((w) => {
      const valueScale =
        w.valuePercent / (defaultWpValues[w.id] || w.valuePercent || 1);
      const selfScale =
        w.selfPerformPercent / (w.baselineSelfPerformPercent || 100);
      w.curve.forEach((v, i) => {
        const target = i + w.scenarioShift + (a.startIndex - 7);
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
  return out.map(round3);
}

export function demand(
  cfg: ScenarioConfig,
  category: LaborCategory,
): DemandResult {
  const hard = zeros(),
    expected = zeros(),
    scenario = zeros(),
    drivers = Array.from(
      { length: N },
      () => [] as Array<{ name: string; type: string; fte: number }>,
    );
  const factor = CATEGORY_FACTORS[category] || 1;
  PROJECTS.forEach((p) => {
    if (cfg.included[p.id] === false) return;
    const source = rollupProjectCurve(p, cfg.packageIncluded),
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
  const proposed = cfg.proposedIncluded
    ? proposedCurve(cfg, category)
    : zeros();
  proposed.forEach((v, i) => {
    scenario[i] += v;
    if (v > 0.02)
      drivers[i].push({
        name: cfg.proposed.name,
        type: 'Proposed scenario work',
        fte: v,
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
): AnalysisResult {
  const d = demand(cfg, category),
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
    unconfirmed = zeros();
  for (let i = 0; i < N; i++) {
    existing[i] = Math.max(
      0,
      k.headcount * (1 - (k.leavePercent + k.attritionPercent) / 100) -
        leave[i] -
        departures[i],
    );
    total[i] =
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
    temporaryCapacityPeak: Math.max(...r.subcontract),
    unconfirmedPeak: Math.max(...r.unconfirmed),
    confidence:
      peak > 0.05
        ? 'At risk'
        : Math.max(...r.unconfirmed) > 0.05
          ? 'Conditional'
          : 'Executable',
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
  return new Date(Date.UTC(2026, 8 + index, 1));
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
export const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function recommendations(r: AnalysisResult) {
  const groups: Array<{ start: number; end: number; values: number[] }> = [];
  let active: null | { start: number; end: number; values: number[] } = null;
  r.gap.forEach((g, i) => {
    if (g > 0.05) {
      if (!active) active = { start: i, end: i, values: [] };
      active.end = i;
      active.values.push(g);
    } else if (active) {
      groups.push(active);
      active = null;
    }
  });
  if (active) groups.push(active);
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
      p.startIndex + p.scenarioShift >= 18
    )
      issues.push(`${p.name}: start date is outside the planning window.`);
  });
  return issues;
}
