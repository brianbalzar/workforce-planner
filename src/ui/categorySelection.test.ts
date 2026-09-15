import { describe, expect, it } from 'vitest';
import {
  categoryColor,
  primaryOnly,
  promoteCategory,
  selectEveryConstrained,
  selectedCategories,
  toggleCategory,
  type CategorySelectionState,
} from './categorySelection';

describe('categoryColor', () => {
  it('is stable and cycles through the 7-color palette', () => {
    expect(categoryColor(0)).toBe(categoryColor(0));
    expect(categoryColor(0)).toBe(categoryColor(7));
    expect(categoryColor(0)).not.toBe(categoryColor(1));
  });
});

describe('selectedCategories', () => {
  it('puts the primary first, deduped against extra', () => {
    const s: CategorySelectionState = {
      category: 'Plumber',
      extra: ['Pipefitter', 'Plumber', 'Electrician'],
    };
    expect(selectedCategories(s)).toEqual([
      'Plumber',
      'Pipefitter',
      'Electrician',
    ]);
  });
});

describe('toggleCategory', () => {
  it('appends an unselected category to the comparison set', () => {
    const s: CategorySelectionState = { category: 'Plumber', extra: [] };
    expect(toggleCategory(s, 'Pipefitter')).toEqual({
      category: 'Plumber',
      extra: ['Pipefitter'],
    });
  });

  it('removes a selected non-primary category', () => {
    const s: CategorySelectionState = {
      category: 'Plumber',
      extra: ['Pipefitter', 'Electrician'],
    };
    expect(toggleCategory(s, 'Pipefitter')).toEqual({
      category: 'Plumber',
      extra: ['Electrician'],
    });
  });

  it('promotes the next selected category when the primary is toggled off', () => {
    const s: CategorySelectionState = {
      category: 'Plumber',
      extra: ['Pipefitter', 'Electrician'],
    };
    expect(toggleCategory(s, 'Plumber')).toEqual({
      category: 'Pipefitter',
      extra: ['Electrician'],
    });
  });

  it('never allows zero categories — toggling the sole primary is a no-op', () => {
    const s: CategorySelectionState = { category: 'Plumber', extra: [] };
    expect(toggleCategory(s, 'Plumber')).toEqual({
      category: 'Plumber',
      extra: [],
    });
  });
});

describe('promoteCategory', () => {
  it('makes the target primary, keeping the former primary in the comparison set', () => {
    const s: CategorySelectionState = {
      category: 'Plumber',
      extra: ['Pipefitter', 'Electrician'],
    };
    expect(promoteCategory(s, 'Electrician')).toEqual({
      category: 'Electrician',
      extra: ['Plumber', 'Pipefitter'],
    });
  });
});

describe('primaryOnly', () => {
  it('clears the comparison set', () => {
    expect(
      primaryOnly({
        category: 'Plumber',
        extra: ['Pipefitter', 'Electrician'],
      }),
    ).toEqual({ extra: [] });
  });
});

describe('selectEveryConstrained', () => {
  const peaks: Record<string, number> = {
    Plumber: 0.2,
    Pipefitter: 3,
    Electrician: 0,
    Welder: 5,
  };
  const peakFor = (c: string) => peaks[c] ?? 0;
  const all = Object.keys(peaks);

  it('keeps the current primary if it qualifies as constrained', () => {
    const s: CategorySelectionState = { category: 'Plumber', extra: [] };
    expect(selectEveryConstrained(s, all, peakFor)).toEqual({
      category: 'Plumber',
      extra: ['Pipefitter', 'Welder'],
    });
  });

  it("promotes the worst category when the current primary isn't constrained", () => {
    const s: CategorySelectionState = { category: 'Electrician', extra: [] };
    expect(selectEveryConstrained(s, all, peakFor)).toEqual({
      category: 'Welder',
      extra: ['Plumber', 'Pipefitter'],
    });
  });

  it('is a no-op when nothing is constrained', () => {
    const s: CategorySelectionState = { category: 'Electrician', extra: [] };
    const zeroPeaks = () => 0;
    expect(selectEveryConstrained(s, all, zeroPeaks)).toEqual({
      category: 'Electrician',
      extra: [],
    });
  });
});
