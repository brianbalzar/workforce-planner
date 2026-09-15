import type { AnalysisResult } from '../domain/types';
import type { LaborCategory } from '../domain/types';
import {
  categoryColor,
  sortCategoriesByBottleneck,
  worstStatus,
} from './categoryStatus';

/** A small inline gap-over-time sparkline — no axes/labels, ~60x20px. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const width = 60,
    height = 20;
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="category-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function CategoryPickerRow({
  category,
  index,
  result,
  checked,
  disabled,
  onToggle,
}: {
  category: LaborCategory;
  index: number;
  result: AnalysisResult;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const status = worstStatus(result);
  return (
    <label className="category-picker-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className={`status-dot status-${status}`} aria-hidden="true" />
      <span className="category-picker-name">{category}</span>
      <Sparkline values={result.gap} color={categoryColor(index)} />
    </label>
  );
}

export function categoryPickerLabel(
  categories: LaborCategory[],
  selected: Set<LaborCategory>,
  resultFor: (category: LaborCategory) => AnalysisResult,
): string {
  const ordered = sortCategoriesByBottleneck(
    categories.filter((c) => selected.has(c)),
    resultFor,
  );
  if (ordered.length <= 2) return ordered.join(', ');
  return `${ordered.slice(0, 2).join(', ')} +${ordered.length - 2}`;
}

export function LaborCategoryPicker({
  categories,
  allResults,
  selected,
  setSelected,
}: {
  categories: LaborCategory[];
  allResults: Map<LaborCategory, AnalysisResult>;
  selected: Set<LaborCategory>;
  setSelected: (next: Set<LaborCategory>) => void;
}) {
  const emptyResult = (): AnalysisResult => ({
    hard: [],
    expected: [],
    scenario: [],
    proposed: [],
    drivers: [],
    prefab: [],
    existing: [],
    confirmedHires: [],
    plannedHires: [],
    subcontract: [],
    overtime: [],
    total: [],
    gap: [],
    unconfirmed: [],
  });
  const resultFor = (category: LaborCategory) =>
    allResults.get(category) ?? emptyResult();
  const sorted = sortCategoriesByBottleneck(categories, resultFor);
  const toggle = (category: LaborCategory) => {
    const next = new Set(selected);
    if (next.has(category)) {
      if (next.size === 1) return; // zero-checked is not a valid state
      next.delete(category);
    } else {
      next.add(category);
    }
    setSelected(next);
  };
  return (
    <div className="field category-picker-field">
      <span className="field-label">LABOR CATEGORY</span>
      <details className="category-picker">
        <summary>
          {categoryPickerLabel(categories, selected, resultFor) || 'Select…'}
        </summary>
        <div className="category-picker-panel" role="group">
          {sorted.map((category) => (
            <CategoryPickerRow
              key={category}
              category={category}
              index={categories.indexOf(category)}
              result={resultFor(category)}
              checked={selected.has(category)}
              disabled={selected.size === 1 && selected.has(category)}
              onToggle={() => toggle(category)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
