import { describe, expect, it } from 'vitest';
import { ATLAS, INITIAL_PLANS, PROJECTS } from '../data/sampleData';
import {
  actionStartDate,
  analyze,
  demand,
  formatValue,
  hireRampFactors,
  metrics,
  proposedCurve,
  rollupProjectCurve,
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
});
