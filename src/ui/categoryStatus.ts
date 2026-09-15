import type { AnalysisResult } from '../domain/types';

/** Peak unresolved gap across the window, and the month index it peaks in. */
export function peakGap(result: AnalysisResult): {
  peak: number;
  index: number;
} {
  let peak = 0,
    index = -1;
  result.gap.forEach((g, i) => {
    if (g > peak) {
      peak = g;
      index = i;
    }
  });
  return { peak, index };
}

/** Sorts categories by peak unresolved gap, worst first. */
export function sortByPeakGapDesc<T>(
  items: T[],
  resultFor: (item: T) => AnalysisResult,
): T[] {
  return [...items].sort(
    (a, b) => peakGap(resultFor(b)).peak - peakGap(resultFor(a)).peak,
  );
}

export type RampBucket = -1 | 0 | 1 | 2 | 3 | 4;

/** The five-step solid ramp the scan/heat-strip/gap-matrix cells share:
 * `t = gap / globalMax`. -1 means covered (no color, blank cell). */
export function rampBucket(t: number): RampBucket {
  if (t <= 0) return -1;
  if (t < 0.2) return 0;
  if (t < 0.4) return 1;
  if (t < 0.62) return 2;
  if (t < 0.82) return 3;
  return 4;
}

export const RAMP_BACKGROUND = [
  '#FCEDED',
  '#F7D2D2',
  '#F0B0B0',
  '#C82F32',
  '#8F1416',
];
export const RAMP_TEXT = ['#7A1414', '#7A1414', '#7A1414', '#fff', '#fff'];

export function rampColors(
  t: number,
): { background: string; color: string } | null {
  const bucket = rampBucket(t);
  if (bucket < 0) return null;
  return { background: RAMP_BACKGROUND[bucket], color: RAMP_TEXT[bucket] };
}
