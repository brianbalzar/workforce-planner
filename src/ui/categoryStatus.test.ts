import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../domain/types';
import {
  peakGap,
  rampBucket,
  rampColors,
  sortByPeakGapDesc,
} from './categoryStatus';

function fakeResult(gap: number[]): AnalysisResult {
  const zeros = Array(gap.length).fill(0);
  return {
    hard: zeros,
    expected: zeros,
    scenario: zeros,
    proposed: zeros,
    drivers: gap.map(() => []),
    prefab: zeros,
    existing: zeros,
    confirmedHires: zeros,
    plannedHires: zeros,
    subcontract: zeros,
    overtime: zeros,
    total: zeros,
    gap,
    unconfirmed: zeros,
  };
}

describe('peakGap', () => {
  it('finds the peak value and its month index', () => {
    expect(peakGap(fakeResult([0, 2, 5, 1]))).toEqual({ peak: 5, index: 2 });
  });

  it('is zero with index -1 when nothing is unresolved', () => {
    expect(peakGap(fakeResult([0, 0, 0]))).toEqual({ peak: 0, index: -1 });
  });
});

describe('sortByPeakGapDesc', () => {
  it('sorts worst-first without mutating the input', () => {
    const items = ['a', 'b', 'c'];
    const results: Record<string, AnalysisResult> = {
      a: fakeResult([1]),
      b: fakeResult([5]),
      c: fakeResult([3]),
    };
    const sorted = sortByPeakGapDesc(items, (i) => results[i]);
    expect(sorted).toEqual(['b', 'c', 'a']);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('rampBucket / rampColors', () => {
  it('is covered (-1) at or below zero', () => {
    expect(rampBucket(0)).toBe(-1);
    expect(rampColors(0)).toBeNull();
  });

  it('buckets the five steps at the documented thresholds', () => {
    expect(rampBucket(0.01)).toBe(0);
    expect(rampBucket(0.19)).toBe(0);
    expect(rampBucket(0.2)).toBe(1);
    expect(rampBucket(0.39)).toBe(1);
    expect(rampBucket(0.4)).toBe(2);
    expect(rampBucket(0.61)).toBe(2);
    expect(rampBucket(0.62)).toBe(3);
    expect(rampBucket(0.81)).toBe(3);
    expect(rampBucket(0.82)).toBe(4);
    expect(rampBucket(1)).toBe(4);
  });

  it('switches to white text at the darker end of the ramp', () => {
    expect(rampColors(0.1)!.color).toBe('#7A1414');
    expect(rampColors(0.9)!.color).toBe('#fff');
  });
});
