export interface CategorySelectionState {
  /** The primary labor category. */
  category: string;
  /** Comparison categories, in the order added. Never contains `category`. */
  extra: string[];
}

const SERIES_COLORS = [
  '#161514',
  '#0068CC',
  '#B8740B',
  '#6E4B9E',
  '#007A3D',
  '#8E2DA8',
  '#B91D1D',
];

/** Assigned by position in the selection, cycling — the primary is always
 * the first color. */
export function categoryColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/** Primary first, then the comparison list (deduped against the primary).
 * Every consumer should read this rather than `extra` directly. */
export function selectedCategories(s: CategorySelectionState): string[] {
  return [s.category, ...s.extra.filter((c) => c !== s.category)];
}

/**
 * Toggling a category row. Toggling an unselected category appends it;
 * toggling a selected non-primary category removes it; toggling the primary
 * promotes the next selected category to primary (a no-op if it is the only
 * one selected — zero categories is never a valid state).
 */
export function toggleCategory(
  s: CategorySelectionState,
  category: string,
): Pick<CategorySelectionState, 'category' | 'extra'> {
  const current = selectedCategories(s);
  if (!current.includes(category))
    return { category: s.category, extra: [...s.extra, category] };
  if (category !== s.category)
    return {
      category: s.category,
      extra: s.extra.filter((c) => c !== category),
    };
  const rest = current.filter((c) => c !== category);
  if (!rest.length) return { category: s.category, extra: s.extra };
  const [nextPrimary, ...nextExtra] = rest;
  return { category: nextPrimary, extra: nextExtra };
}

/** The `SET` action — makes `category` the primary, keeping the rest of the
 * selection (the former primary stays in the comparison set). */
export function promoteCategory(
  s: CategorySelectionState,
  category: string,
): Pick<CategorySelectionState, 'category' | 'extra'> {
  const current = selectedCategories(s);
  return { category, extra: current.filter((c) => c !== category) };
}

/** `Primary only` — clears the comparison set. */
export function primaryOnly(
  _s: CategorySelectionState,
): Pick<CategorySelectionState, 'extra'> {
  return { extra: [] };
}

/**
 * `Select every constrained category` — selects every category whose peak
 * gap exceeds the epsilon, keeping the current primary if it qualifies,
 * otherwise promoting the worst one.
 */
export function selectEveryConstrained(
  s: CategorySelectionState,
  categories: string[],
  peakFor: (category: string) => number,
  epsilon = 0.05,
): Pick<CategorySelectionState, 'category' | 'extra'> {
  const constrained = categories.filter((c) => peakFor(c) > epsilon);
  if (!constrained.length) return { category: s.category, extra: s.extra };
  if (constrained.includes(s.category))
    return {
      category: s.category,
      extra: constrained.filter((c) => c !== s.category),
    };
  const worst = [...constrained].sort((a, b) => peakFor(b) - peakFor(a))[0];
  return { category: worst, extra: constrained.filter((c) => c !== worst) };
}
