import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../domain/types';
import {
  categoryColor,
  criticalMonthCount,
  monthStatus,
  sortCategoriesByBottleneck,
  worstStatus,
} from './categoryStatus';

function fakeResult(overrides: {
  scenario: number[];
  existing: number[];
  prefab?: number[];
  total: number[];
}): AnalysisResult {
  const n = overrides.scenario.length;
  const zeros = () => Array(n).fill(0);
  return {
    hard: zeros(),
    expected: zeros(),
    scenario: overrides.scenario,
    proposed: zeros(),
    drivers: overrides.scenario.map(() => []),
    prefab: overrides.prefab ?? zeros(),
    existing: overrides.existing,
    confirmedHires: zeros(),
    plannedHires: zeros(),
    subcontract: zeros(),
    overtime: zeros(),
    total: overrides.total,
    gap: overrides.scenario.map((v, i) => Math.max(0, v - overrides.total[i])),
    unconfirmed: zeros(),
  };
}

describe('monthStatus', () => {
  it('is "none" when there is no demand that month', () => {
    const r = fakeResult({ scenario: [0], existing: [0], total: [0] });
    expect(monthStatus(r, 0)).toBe('none');
  });

  it('is "good" when existing + prefab already covers demand', () => {
    const r = fakeResult({
      scenario: [5],
      existing: [6],
      prefab: [0],
      total: [6],
    });
    expect(monthStatus(r, 0)).toBe('good');
  });

  it('is "watch" when planned capacity (hires/sub/OT) is needed beyond existing', () => {
    const r = fakeResult({
      scenario: [8],
      existing: [5],
      prefab: [0],
      total: [9],
    });
    expect(monthStatus(r, 0)).toBe('watch');
  });

  it('is "critical" when demand exceeds every planned capacity source', () => {
    const r = fakeResult({
      scenario: [10],
      existing: [5],
      prefab: [0],
      total: [7],
    });
    expect(monthStatus(r, 0)).toBe('critical');
  });

  it('treats values within epsilon of a boundary as the covered side', () => {
    const r = fakeResult({
      scenario: [5.02],
      existing: [5],
      prefab: [0],
      total: [5],
    });
    expect(monthStatus(r, 0)).toBe('good');
  });
});

describe('worstStatus / criticalMonthCount', () => {
  it('picks the worst status across the window, not the first or last', () => {
    const r = fakeResult({
      scenario: [0, 5, 10],
      existing: [0, 5, 5],
      prefab: [0, 0, 0],
      total: [0, 5, 7],
    });
    expect(worstStatus(r)).toBe('critical');
    expect(criticalMonthCount(r)).toBe(1);
  });

  it('is "none" only when every month is none', () => {
    const r = fakeResult({ scenario: [0, 0], existing: [0, 0], total: [0, 0] });
    expect(worstStatus(r)).toBe('none');
  });
});

describe('sortCategoriesByBottleneck', () => {
  it('sorts worst-first, breaking ties by number of critical months', () => {
    const results: Record<string, AnalysisResult> = {
      // critical in 1 month
      a: fakeResult({
        scenario: [10, 0],
        existing: [5, 0],
        prefab: [0, 0],
        total: [7, 0],
      }),
      // critical in 2 months — should sort ahead of "a"
      b: fakeResult({
        scenario: [10, 10],
        existing: [5, 5],
        prefab: [0, 0],
        total: [7, 7],
      }),
      // never a bottleneck — should sort last
      c: fakeResult({ scenario: [0, 0], existing: [0, 0], total: [0, 0] }),
    };
    const sorted = sortCategoriesByBottleneck(
      ['a', 'b', 'c'],
      (k) => results[k],
    );
    expect(sorted).toEqual(['b', 'a', 'c']);
  });
});

describe('categoryColor', () => {
  it('returns a stable color for a given index', () => {
    expect(categoryColor(0)).toBe(categoryColor(0));
  });

  it('wraps around once the palette is exhausted', () => {
    expect(categoryColor(0)).toBe(categoryColor(16));
  });
});
