import { describe, expect, it } from 'vitest';
import {
  ATLAS,
  INITIAL_PLANS,
  LABOR_SOURCE_MAP,
  PROJECTS,
} from '../data/sampleData';
import {
  actionStartDate,
  activeRange,
  analyze,
  assumptionFlagsForProject,
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
    cfg.proposed.laborAllocation.Plumber = 0;
    expect(proposedCurve(cfg, 'Plumber').every((v) => v === 0)).toBe(true);
  });

  it('leaves a work package curve exactly as authored when nothing changed', () => {
    const w = ATLAS.workPackages[0];
    expect(resolveWorkPackageCurve(w)).toEqual(w.curve);
  });

  it('stretches a work package curve live when only its duration changes', () => {
    const cfg = growth();
    const before = proposedCurve(cfg, 'Plumber');
    cfg.proposed.workPackages[1].durationMonths = 16; // atlas-w2: 8 -> 16 months
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
