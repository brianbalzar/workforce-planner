import type { AnalysisResult } from '../domain/types';

export type CategoryStatus = 'none' | 'good' | 'watch' | 'critical';

// Matches PortfolioOverlap's existing heat-row classification (App.tsx) —
// kept here so the heatmap, the picker widget, and PortfolioOverlap all
// agree on what "critical" means instead of drifting apart per component.
export const STATUS_EPSILON = 0.05;

export function monthStatus(result: AnalysisResult, i: number): CategoryStatus {
  const need = result.scenario[i];
  if (need <= STATUS_EPSILON) return 'none';
  if (need <= result.existing[i] + result.prefab[i] + STATUS_EPSILON)
    return 'good';
  if (need <= result.total[i] + STATUS_EPSILON) return 'watch';
  return 'critical';
}

const STATUS_ORDER: Record<CategoryStatus, number> = {
  none: 0,
  good: 1,
  watch: 2,
  critical: 3,
};

export function worstStatus(result: AnalysisResult): CategoryStatus {
  let worst: CategoryStatus = 'none';
  for (let i = 0; i < result.scenario.length; i++) {
    const status = monthStatus(result, i);
    if (STATUS_ORDER[status] > STATUS_ORDER[worst]) worst = status;
  }
  return worst;
}

export function criticalMonthCount(result: AnalysisResult): number {
  let count = 0;
  for (let i = 0; i < result.scenario.length; i++)
    if (monthStatus(result, i) === 'critical') count++;
  return count;
}

/** Sorts categories worst-first, breaking ties by count of critical months. */
export function sortCategoriesByBottleneck<T extends string>(
  categories: T[],
  resultFor: (category: T) => AnalysisResult,
): T[] {
  return [...categories].sort((a, b) => {
    const ra = resultFor(a),
      rb = resultFor(b);
    const order = STATUS_ORDER[worstStatus(rb)] - STATUS_ORDER[worstStatus(ra)];
    if (order !== 0) return order;
    return criticalMonthCount(rb) - criticalMonthCount(ra);
  });
}

// A fixed categorical palette, keyed by a category's index in LABOR_CATEGORIES
// (stable for the life of a loaded dataset). Reused by the picker's status
// dots/sparklines and the overlay chart's lines so a category's color stays
// consistent everywhere it appears.
const CATEGORY_PALETTE = [
  '#0068cc',
  '#8e2da8',
  '#009500',
  '#b8740b',
  '#b91d1d',
  '#1f8a70',
  '#6e4b9e',
  '#c2185b',
  '#5d4037',
  '#00838f',
  '#7c8b00',
  '#c9622a',
  '#3949ab',
  '#00695c',
  '#8d6e00',
  '#455a64',
];

export function categoryColor(index: number): string {
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}
