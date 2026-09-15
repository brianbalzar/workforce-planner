import { describe, expect, it } from 'vitest';
import {
  ATLAS,
  INITIAL_PLANS,
  LABOR_SOURCE_MAP,
  PROJECTS,
} from '../data/sampleData';
import { DEPARTMENTS, PROJECTS as RUNTIME_PROJECTS } from '../data/runtimeData';
import {
  actionStartDate,
  activeRange,
  analyze,
  assumptionFlagsForProject,
  combineResults,
  demand,
  forecastFreshness,
  formatValue,
  hireRampFactors,
  impliedPeopleFromHours,
  metrics,
  monthlyComposition,
  peakCrewFromWeekly,
  peopleMetricsForProject,
  proposedCurve,
  resolveWorkPackageCurve,
  rollupProjectCurve,
  totalForecastHours,
  validateWorkPackages,
} from './engine';

const growth = () =>
  structuredClone(INITIAL_PLANS.find((p) => p.id === 'growth')!.config);
const rounded = (values: number[]) => values.map(Math.round);

describe('planning demand', () => {
  it('splits an estimate-imported total FTE curve by labor allocation', () => {
    const cfg = growth();
    const imported = {
      ...structuredClone(PROJECTS[0]),
      id: 'estimate-total-fte-test',
      name: 'Estimate total FTE test',
      type: 'Soft' as const,
      planningProbability: 100,
      sourceProbability: 100,
      curveBasis: 'total-internal-labor' as const,
      curve: [10, ...Array(17).fill(0)],
      workPackages: undefined,
      laborAllocation: { Plumber: 80, Foreman: 20 },
    };
    const beforePlumber = demand(cfg, 'Plumber').scenario[0];
    const beforeForeman = demand(cfg, 'Foreman').scenario[0];
    RUNTIME_PROJECTS.push(imported);
    try {
      expect(demand(cfg, 'Plumber').scenario[0] - beforePlumber).toBeCloseTo(8);
      expect(demand(cfg, 'Foreman').scenario[0] - beforeForeman).toBeCloseTo(2);
    } finally {
      RUNTIME_PROJECTS.pop();
    }
  });

  it('reproduces the specified hard, expected, and scenario demand', () => {
    const result = demand(growth(), 'Plumber');
    expect(rounded(result.hard)).toEqual([
      18, 19, 20, 20, 21, 22, 22, 21, 20, 19, 20, 21, 21, 20, 19, 18, 18, 17,
    ]);
    expect(rounded(result.expected)).toEqual([
      19, 20, 21, 22, 23, 25, 25, 24, 23, 22, 24, 25, 24, 23, 22, 21, 20, 19,
    ]);
    expect(rounded(result.scenario)).toEqual([
      19, 20, 21, 22, 23, 25, 25, 26, 27, 28, 32, 35, 34, 31, 27, 23, 20, 19,
    ]);
  });

  it('supports zero and 100% probability overrides without changing hard backlog', () => {
    const base = demand(growth(), 'Plumber');
    const zero = growth();
    zero.probabilities.s1 = 0;
    const full = growth();
    full.probabilities.s1 = 100;
    expect(demand(zero, 'Plumber').expected[6]).toBeLessThan(base.expected[6]);
    expect(demand(full, 'Plumber').expected[6]).toBeGreaterThan(
      base.expected[6],
    );
    expect(demand(zero, 'Plumber').hard).toEqual(base.hard);
  });

  it('shifts schedules without reshaping values', () => {
    const base = growth();
    const shifted = growth();
    shifted.shifts.p2 = 2;
    const p2 = PROJECTS.find((p) => p.id === 'p2')!;
    const baseDemand = demand(base, 'Plumber').hard,
      shiftedDemand = demand(shifted, 'Plumber').hard;
    expect(shiftedDemand.map((v, i) => v - baseDemand[i])).toEqual(
      p2.curve.map((v, i) => (i >= 2 ? p2.curve[i - 2] : 0) - v),
    );
    const shiftedCurve = p2.curve.map((_, i) => (i >= 2 ? p2.curve[i - 2] : 0));
    expect(shiftedCurve.slice(2, 17)).toEqual(p2.curve.slice(0, 15));
  });

  it('builds the proposed curve and handles zero labor allocation', () => {
    const cfg = growth();
    expect(Math.max(...proposedCurve(cfg, 'Plumber'))).toBeCloseTo(10, 1);
    cfg.proposedProjects[0].laborAllocation.Plumber = 0;
    expect(proposedCurve(cfg, 'Plumber').every((v) => v === 0)).toBe(true);
  });

  it('combines multiple proposed projects and can scope demand by department', () => {
    const cfg = growth();
    const second = structuredClone(cfg.proposedProjects[0]);
    second.id = 'second-proposed';
    second.name = 'Second proposed project';
    cfg.proposedProjects.push(second);
    cfg.proposedIncluded[second.id] = true;
    const oneProject = proposedCurve(growth(), 'Plumber');
    const twoProjects = proposedCurve(cfg, 'Plumber');
    expect(Math.max(...twoProjects)).toBeCloseTo(
      Math.max(...oneProject) * 2,
      5,
    );
    expect(
      demand(cfg, 'Plumber', 'Electrical — Central').scenario.every(
        (value) => value === 0,
      ),
    ).toBe(true);
  });

  it('leaves a work package curve exactly as authored when nothing changed', () => {
    const w = ATLAS.workPackages[0];
    expect(resolveWorkPackageCurve(w)).toEqual(w.curve);
  });

  it('stretches a work package curve live when only its duration changes', () => {
    const cfg = growth();
    const before = proposedCurve(cfg, 'Plumber');
    cfg.proposedProjects[0].workPackages[1].durationMonths = 16; // atlas-w2: 8 -> 16 months
    const after = proposedCurve(cfg, 'Plumber');
    expect(after).not.toEqual(before);
    // total person-months of work is conserved-ish (same peak-derived scale,
    // just spread across roughly double the months), and the change is live.
    expect(after.filter((v) => v > 0).length).toBeGreaterThan(
      before.filter((v) => v > 0).length,
    );
  });

  it('switches to a generic template, rescaled to the same peak, when the staffing curve changes', () => {
    const w = ATLAS.workPackages[0]; // atlas-w1: baseline 'Comparable-project curve'
    const changed = { ...w, staffingCurve: 'Even distribution' as const };
    const curve = resolveWorkPackageCurve(changed);
    const nonZero = curve.filter((v) => v > 0);
    expect(nonZero.length).toBe(w.durationMonths);
    expect(Math.max(...curve)).toBeCloseTo(Math.max(...w.curve), 5);
  });
});

describe('capacity and bottlenecks', () => {
  it('applies hires, subcontract, leave, attrition, and overtime on the correct dates', () => {
    const result = analyze(growth(), 'Plumber');
    expect(result.total[5]).toBe(22);
    expect(result.total[6]).toBe(25);
    expect(result.total[10]).toBe(31);
    expect(result.total[11]).toBe(33);
    expect(result.existing[15]).toBe(19);
  });

  it('computes residual bottlenecks', () => {
    const summary = metrics(analyze(growth(), 'Plumber'));
    expect(summary.firstIndex).toBe(2);
    expect(summary.peak).toBeCloseTo(3.3, 1);
    expect(summary.duration).toBe(10);
  });

  it('matches the specified peak-shortage and subcontract person-month figures', () => {
    const summary = metrics(analyze(growth(), 'Plumber'));
    expect(summary.peakVsExistingMonth).toBe('Aug 2027');
    expect(summary.existingAtPeakVsExisting).toBe(20);
    expect(summary.subcontractPersonMonths).toBe(35);
  });

  it('supports optional pre-productive ramp capacity', () => {
    const action = { ...growth().actions[0], enableRampCapacity: true };
    expect(hireRampFactors(action)).toEqual({ 4: 0.5, 5: 0.75 });
  });

  it('clips actions beginning outside the planning window', () => {
    const cfg = growth();
    cfg.actions.push({
      id: 'outside',
      kind: 'hire',
      category: 'Plumber',
      quantity: 99,
      fromIndex: 20,
      toIndex: 20,
      status: 'Proposed',
      confirmed: false,
      notes: '',
    });
    expect(Math.max(...analyze(cfg, 'Plumber').plannedHires)).toBe(4);
  });

  it('handles no available capacity', () => {
    const cfg = growth();
    cfg.capacity.Plumber.headcount = 0;
    cfg.actions = [];
    expect(metrics(analyze(cfg, 'Plumber')).peak).toBeGreaterThan(30);
  });

  it('defaults every category to zero pre-fab capacity, leaving the baseline scenario unchanged', () => {
    const cfg = growth();
    expect(cfg.capacity.Plumber.prefabCapacity).toBe(0);
    const result = analyze(cfg, 'Plumber');
    expect(result.prefab.every((v) => v === 0)).toBe(true);
  });

  it('applies the pre-fab shop as a first source that only ever reduces the gap', () => {
    const cfg = growth();
    const without = analyze(cfg, 'Plumber');
    cfg.capacity.Plumber.prefabCapacity = 2;
    const withPrefab = analyze(cfg, 'Plumber');
    // Demand itself is untouched — pre-fab offsets coverage, not workload.
    expect(withPrefab.scenario).toEqual(without.scenario);
    withPrefab.gap.forEach((g, i) => {
      expect(g).toBeLessThanOrEqual(without.gap[i] + 1e-9);
    });
    expect(Math.max(...withPrefab.prefab)).toBeLessThanOrEqual(2);
    // Never consumes more pre-fab capacity than that month actually needs.
    withPrefab.prefab.forEach((v, i) => {
      expect(v).toBeLessThanOrEqual(withPrefab.scenario[i] + 1e-9);
    });
  });
});

describe('dates, units, and work packages', () => {
  it('converts people to hours and labor cost consistently', () => {
    expect(formatValue(2, 'People', 148, 92)).toBe('2.0');
    expect(formatValue(2, 'Hours', 148, 92)).toBe('296');
    expect(formatValue(2, 'Labor Cost', 148, 92)).toBe('$27k');
  });

  it('calculates hiring and subcontract lead-time dates backward', () => {
    const cfg = growth();
    expect(
      actionStartDate(cfg.actions.find((a) => a.id === 'a1')!)
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-10-24');
    expect(
      actionStartDate(cfg.actions.find((a) => a.id === 'a3')!)
        .toISOString()
        .slice(0, 10),
    ).toBe('2026-08-20');
  });

  it('rolls child packages into the parent exactly once', () => {
    const parent = PROJECTS.find((p) => p.id === 'p1')!;
    expect(rollupProjectCurve(parent)).toEqual(parent.curve);
    expect(rollupProjectCurve(parent).reduce((a, b) => a + b, 0)).toBe(
      parent.curve.reduce((a, b) => a + b, 0),
    );
  });

  it('lets a scenario exclude one work package without double-counting the rest', () => {
    const parent = PROJECTS.find((p) => p.id === 'p1')!;
    const w1 = parent.workPackages!.find((w) => w.id === 'p1-w1')!;
    const withAllIncluded = rollupProjectCurve(parent);
    const withW1Excluded = rollupProjectCurve(parent, { 'p1-w1': false });
    expect(withW1Excluded).toEqual(
      withAllIncluded.map(
        (v, i) => Math.round((v - w1.curve[i]) * 1000) / 1000,
      ),
    );
    const cfg = growth();
    cfg.packageIncluded['p1-w1'] = false;
    expect(demand(cfg, 'Plumber').hard[0]).toBeLessThan(
      demand(growth(), 'Plumber').hard[0],
    );
  });

  it('validates package value reconciliation and hybrid execution', () => {
    expect(validateWorkPackages(ATLAS.workPackages)).toEqual([]);
    const bad = structuredClone(ATLAS.workPackages);
    bad[0].valuePercent = 25;
    bad[1].selfPerformPercent = 50;
    expect(validateWorkPackages(bad)).toHaveLength(2);
  });

  it('sums added capacity and overtime peak from the same per-month arrays reported in the result', () => {
    const result = analyze(growth(), 'Plumber');
    const m = metrics(result);
    const expectedAdded =
      result.confirmedHires.reduce((s, v) => s + v, 0) +
      result.plannedHires.reduce((s, v) => s + v, 0) +
      result.subcontract.reduce((s, v) => s + v, 0);
    expect(m.addedCapacityFteMonths).toBeCloseTo(expectedAdded, 6);
    expect(m.addedCapacityFteMonths).toBeGreaterThan(0);
    expect(m.overtimePeak).toBeCloseTo(Math.max(...result.overtime), 6);
  });
});

describe('portfolio-planning rollups', () => {
  const p1 = PROJECTS.find((p) => p.id === 'p1')!;
  const p3 = PROJECTS.find((p) => p.id === 'p3')!;
  const p4 = PROJECTS.find((p) => p.id === 'p4')!;
  const p5 = PROJECTS.find((p) => p.id === 'p5')!;
  const TODAY = new Date(Date.UTC(2026, 8, 2));

  it('rolls weekly crew up to a monthly PEAK, not an average (10/10/25/10 -> 25)', () => {
    expect(peakCrewFromWeekly([10, 10, 25, 10])).toEqual([25]);
    // A second month appended still resolves independently.
    expect(peakCrewFromWeekly([10, 10, 25, 10, 8, 8, 8, 8])).toEqual([25, 8]);
  });

  it('derives implied headcount from hours, which falls as the assumed workweek lengthens', () => {
    const at40 = impliedPeopleFromHours(1000, 1, 40);
    const at50 = impliedPeopleFromHours(1000, 1, 50);
    const at60 = impliedPeopleFromHours(1000, 1, 60);
    expect(at40).toBeGreaterThan(at50);
    expect(at50).toBeGreaterThan(at60);
  });

  it('keeps peak crew and average/implied people distinct and clearly sourced', () => {
    const m1 = peopleMetricsForProject(p1);
    expect(m1.basis).toBe('weekly-peak');
    expect(m1.peakCrew).toBe(9); // from weeklyCrew [5, 5, 9, 5], not the FTE curve peak.
    expect(m1.peakCrew).not.toBe(m1.averageImpliedPeople);

    const m5 = peopleMetricsForProject(p5);
    expect(m5.basis).toBe('even-spread-estimate');
    expect(m5.monthlyPlannedPeople).toBeUndefined();

    const m4 = peopleMetricsForProject(p4);
    expect(m4.basis).toBe('monthly-planned');
    expect(m4.monthlyPlannedPeople).toBe(m4.averageImpliedPeople);
  });

  it('total forecast hours at the 40-hour baseline reconcile with the implied-people formula', () => {
    const p2 = PROJECTS.find((p) => p.id === 'p2')!;
    const hours = totalForecastHours(p2, 40);
    const activeMonths = p2.curve.filter((v) => v > 0).length;
    const implied = impliedPeopleFromHours(hours, activeMonths, 40);
    const p2Metrics = peopleMetricsForProject(p2);
    expect(implied).toBeCloseTo(p2Metrics.averageImpliedPeople, 3);
  });

  it('classifies forecast freshness against a configurable threshold', () => {
    expect(forecastFreshness(p1.lastRevisionDate, TODAY)).toBe('Current');
    expect(forecastFreshness('2026-07-20', TODAY)).toBe('Approaching stale');
    expect(forecastFreshness('2026-06-15', TODAY)).toBe('Stale');
    expect(forecastFreshness(p4.lastRevisionDate, TODAY)).toBe('Missing');
  });

  it('flags stale, missing, review-quality, and even-spread projects without hiding them behind one score', () => {
    expect(assumptionFlagsForProject(p1, TODAY)).toEqual([]);
    const p3Flags = assumptionFlagsForProject(p3, TODAY);
    expect(p3Flags.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        `${p3.id}-even-spread`,
        `${p3.id}-freshness-stale`,
      ]),
    );
    expect(
      p3Flags.find((f) => f.id === `${p3.id}-freshness-stale`)?.severity,
    ).toBe('critical');
    const p4Flags = assumptionFlagsForProject(p4, TODAY);
    expect(p4Flags.map((f) => f.id)).toEqual(
      expect.arrayContaining([`${p4.id}-freshness-missing`]),
    );
    const p5Flags = assumptionFlagsForProject(p5, TODAY);
    expect(p5Flags.map((f) => f.id)).toEqual(
      expect.arrayContaining([`${p5.id}-quality-review`]),
    );
  });

  it('never silently drops an unmapped source labor label into a generic bucket', () => {
    expect(LABOR_SOURCE_MAP['Miscellaneous Labor']).toBeNull();
    expect(LABOR_SOURCE_MAP.Plumbing).toBe('Plumber');
    const unmapped = Object.entries(LABOR_SOURCE_MAP).filter(
      ([, category]) => category === null,
    );
    expect(unmapped.length).toBeGreaterThan(0);
  });

  it("reconciles monthly composition series to each month's total scenario demand", () => {
    const cfg = growth();
    const result = demand(cfg, 'Plumber');
    const { rows, series } = monthlyComposition(result);
    expect(rows).toHaveLength(18);
    expect(series).toContain('Other');
    rows.forEach((row, i) => {
      const total = series.reduce((s, key) => s + (row[key] as number), 0);
      // Drivers below the 0.02 FTE inclusion threshold in demand() are the
      // only source of rounding difference against the reported total.
      expect(total).toBeCloseTo(result.scenario[i], 0);
    });
  });
});

describe('portfolio overlap timeline', () => {
  it('finds the first and last active month of a curve, inclusive', () => {
    expect(activeRange([0, 0, 3, 4, 0, 5, 0, 0])).toEqual({
      start: 2,
      end: 5,
    });
    expect(activeRange([0, 0, 0])).toBeNull();
    expect(activeRange([7])).toEqual({ start: 0, end: 0 });
  });

  it("rolls a project's own work-package inclusion into its overlap range", () => {
    const p1 = PROJECTS.find((p) => p.id === 'p1')!;
    const full = activeRange(rollupProjectCurve(p1));
    const withoutFirstPackage = activeRange(
      rollupProjectCurve(p1, { [p1.workPackages![0].id]: false }),
    );
    expect(full).not.toBeNull();
    // Excluding a package can only shrink or keep the active window the same,
    // never grow it beyond the fully-included case.
    expect(withoutFirstPackage!.start).toBeGreaterThanOrEqual(full!.start);
    expect(withoutFirstPackage!.end).toBeLessThanOrEqual(full!.end);
  });

  it('gives every sample hard-backlog project a fabricated job-site location', () => {
    const hardProjects = PROJECTS.filter((p) => p.type === 'Hard');
    hardProjects.forEach((p) => {
      expect(p.location).toBeTruthy();
    });
  });
});

describe('combineResults (department/category pooling)', () => {
  const N = 18;
  const zeros = () => Array(N).fill(0);
  // Every field defaults to 18 zero months; `at0` overrides just month 0 so
  // tests can state a single number without hand-building 18-slot arrays.
  const at0 = (value: number) => zeros().map((_, i) => (i === 0 ? value : 0));
  const fakeResult = (over: Partial<ReturnType<typeof analyze>>) => ({
    hard: zeros(),
    expected: zeros(),
    scenario: zeros(),
    proposed: zeros(),
    drivers: zeros().map(() => []),
    prefab: zeros(),
    existing: zeros(),
    confirmedHires: zeros(),
    plannedHires: zeros(),
    subcontract: zeros(),
    overtime: zeros(),
    total: zeros(),
    gap: zeros(),
    unconfirmed: zeros(),
    ...over,
  });

  it('returns the single result unchanged when there is only one', () => {
    const r = fakeResult({ scenario: at0(5) });
    expect(combineResults([r])).toBe(r);
  });

  it('sums demand arrays as-is, and gap directly rather than recomputing', () => {
    const a = fakeResult({
      hard: at0(1),
      expected: at0(2),
      scenario: at0(10),
      existing: at0(4),
      total: at0(4),
      gap: at0(6),
    });
    const b = fakeResult({
      hard: at0(3),
      expected: at0(4),
      scenario: at0(5),
      existing: at0(5),
      total: at0(5),
      gap: at0(0),
    });
    const combined = combineResults([a, b]);
    expect(combined.hard[0]).toBe(4);
    expect(combined.expected[0]).toBe(6);
    expect(combined.scenario[0]).toBe(15);
    // gap summed directly (6 + 0), not recomputed from summed scenario/total.
    expect(combined.gap[0]).toBe(6);
  });

  it('clamps each result’s capacity by its own total-vs-scenario ratio before summing, so a surplus in one never covers a shortage in another', () => {
    // a: needs 10, only has 4 of capacity -> fully used, f = 1.
    const a = fakeResult({
      scenario: at0(10),
      existing: at0(4),
      total: at0(4),
      gap: at0(6),
    });
    // b: needs 5, has 20 of capacity -> only 5 of it "counts", f = 5/20 = 0.25.
    const b = fakeResult({
      scenario: at0(5),
      existing: at0(20),
      total: at0(20),
      gap: at0(0),
    });
    const combined = combineResults([a, b]);
    // existing: 4*1 + 20*0.25 = 4 + 5 = 9
    expect(combined.existing[0]).toBeCloseTo(9, 3);
    expect(combined.total[0]).toBeCloseTo(9, 3);
    // The combined gap is the sum of the per-result gaps (6 + 0 = 6), which
    // also matches scenario(15) - clamped total(9) exactly in this case.
    expect(combined.gap[0]).toBeCloseTo(6, 3);
    expect(combined.scenario[0]).toBe(15);
  });

  it('merges month drivers by project name, adding values', () => {
    type Driver = { name: string; type: string; fte: number };
    const drivers = () => zeros().map(() => [] as Driver[]);
    const aDrivers = drivers();
    aDrivers[0] = [{ name: 'Project X', type: 'Hard backlog', fte: 2 }];
    const bDrivers = drivers();
    bDrivers[0] = [
      { name: 'Project X', type: 'Hard backlog', fte: 1 },
      { name: 'Project Y', type: 'Soft backlog', fte: 3 },
    ];
    const a = fakeResult({ drivers: aDrivers });
    const b = fakeResult({ drivers: bDrivers });
    const combined = combineResults([a, b]);
    // Project X: 2 + 1 = 3 total, tied with Project Y's 3 — insertion order
    // (X first) breaks the tie since the sort is stable.
    expect(combined.drivers[0]).toEqual([
      { name: 'Project X', type: 'Hard backlog', fte: 3 },
      { name: 'Project Y', type: 'Soft backlog', fte: 3 },
    ]);
  });

  it('combining a department with itself doubles demand but never double-counts spare capacity', () => {
    const cfg = growth();
    const dept = DEPARTMENTS[0];
    const r = analyze(cfg, 'Plumber', dept);
    const combined = combineResults([r, r]);
    r.scenario.forEach((v, i) => {
      expect(combined.scenario[i]).toBeCloseTo(v * 2, 6);
      expect(combined.gap[i]).toBeCloseTo(r.gap[i] * 2, 6);
    });
  });
});
