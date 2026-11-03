import { describe, expect, it } from 'vitest';
import { getDemoPlannerData } from '../data/runtimeData';
import { adaptMonthly, spreadMonthHours } from './monthlyAdapter';
import { compute, sum, total } from './engine';
import { validateDataset } from './dataset';

describe('monthly dataset compatibility', () => {
  it('conserves monthly hours across week boundaries', () => {
    // October 2026 starts Thursday. Its 31 days span five Monday weeks.
    const totals = [
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ].map((w) => spreadMonthHours(['2026-10'], [310], w));
    expect(sum(totals)).toBeCloseTo(310, 8);
    expect(totals[0]).toBe(40);
  });
  it('converts the existing contract without inserting sample service or actuals', () => {
    const source = getDemoPlannerData(),
      d = adaptMonthly(source);
    expect(d.projects.projects).toHaveLength(source.projects.length);
    expect(d.service.agreements).toEqual([]);
    expect(d.service.openJobs).toEqual([]);
    expect(Object.keys(d.dispatch_actuals)).toEqual([]);
    expect(d.reference.departments.map((v) => v.name)).toEqual(
      expect.arrayContaining(source.departments),
    );
    expect(d.metadata?.sample).toBe(false);
    expect(d.metadata?.notes.join(' ')).toContain('estimates');
    const { cube } = compute(d, d.scenarios[0].snap);
    expect(sum(cube.HLS.HS.map(total))).toBe(0);
    expect(sum(cube.HLS.HS.map((c) => c.capConf))).toBe(0);
    expect(validateDataset(d).weeks).toHaveLength(60);
  });
  it('preserves all source labor categories, including roles outside the demo trades', () => {
    const source = getDemoPlannerData();
    const d = adaptMonthly(source);
    expect(d.reference.trades.some((t) => t.name === 'Project Manager')).toBe(
      true,
    );
    expect(
      d.reference.trades.some((t) => t.name === 'BIM/VDC Specialist'),
    ).toBe(true);
  });
});
