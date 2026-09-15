import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '../domain/types';
import type { LaborCategory } from '../domain/types';
import { peakGap, sortByPeakGapDesc } from './categoryStatus';
import {
  categoryColor,
  selectedCategories,
  type CategorySelectionState,
} from './categorySelection';

const EPSILON = 0.05;

function Sparkline({
  gap,
  globalMax,
  color,
}: {
  gap: number[];
  globalMax: number;
  color: string;
}) {
  const hasGap = gap.some((v) => v > EPSILON);
  const points = gap
    .map((v, i) => {
      const x = (i / Math.max(1, gap.length - 1)) * 74;
      const y = 17 - Math.min(15, (v / globalMax) * 15);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={74} height={18} viewBox="0 0 74 18" aria-hidden="true">
      <line x1={0} y1={17} x2={74} y2={17} stroke="#E2E1DE" strokeWidth={1} />
      <polyline
        points={points}
        fill="none"
        stroke={hasGap ? color : '#E2E1DE'}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function DrawnCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`drawn-checkbox${checked ? ' checked' : ''}`}
      aria-hidden="true"
    >
      {checked && (
        <svg width={10} height={8} viewBox="0 0 10 8">
          <polyline
            points="1,4 4,7 9,1"
            fill="none"
            stroke="#fff"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

export function categoryPickerLabel(s: CategorySelectionState): string {
  return s.category;
}

export function categoryPickerSubline(s: CategorySelectionState): string {
  const n = selectedCategories(s).length;
  return n > 1
    ? `${n - 1} compared · combined view available`
    : 'Primary only — add categories to compare';
}

export function LaborCategoryPicker({
  categories,
  allResults,
  selection,
  toggle,
  promote,
  selectEveryConstrained,
  primaryOnly,
  display,
}: {
  categories: LaborCategory[];
  allResults: Map<LaborCategory, AnalysisResult>;
  selection: CategorySelectionState;
  toggle: (category: LaborCategory) => void;
  promote: (category: LaborCategory) => void;
  selectEveryConstrained: () => void;
  primaryOnly: () => void;
  display: (v: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [rowOrder, setRowOrder] = useState<LaborCategory[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = selectedCategories(selection);
  const emptyResult: AnalysisResult = {
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
  };
  const resultFor = (c: LaborCategory) => allResults.get(c) ?? emptyResult;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPanel = () => {
    // Row order is sorted once per open, not per keystroke — selected
    // categories first (primary always first, in selection order), then
    // everything else worst-first.
    const rest = sortByPeakGapDesc(
      categories.filter((c) => !selected.includes(c)),
      resultFor,
    );
    setRowOrder([...selected, ...rest]);
    setOpen(true);
  };

  const globalMax = Math.max(
    1,
    ...categories.map((c) => peakGap(resultFor(c)).peak),
  );

  return (
    <div className="field category-picker-field" ref={rootRef}>
      <span className="field-label">LABOR CATEGORY</span>
      <button
        type="button"
        className="category-picker-trigger"
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        <span
          className="category-picker-swatch"
          style={{ background: categoryColor(0) }}
          aria-hidden="true"
        />
        <span className="category-picker-trigger-text">
          <strong>{categoryPickerLabel(selection)}</strong>
          <small>{categoryPickerSubline(selection)}</small>
        </span>
        <span className="category-picker-caret" aria-hidden="true">
          ▼
        </span>
      </button>
      {open && (
        <div className="category-picker-panel" role="group">
          <div className="category-picker-panel-header">
            <span>CATEGORY</span>
            <span>GAP SHAPE</span>
            <span>PEAK</span>
            <span />
          </div>
          <div className="category-picker-scroll">
            {rowOrder.map((category) => {
              const result = resultFor(category);
              const isSelected = selected.includes(category);
              const isPrimary = category === selection.category;
              const { peak } = peakGap(result);
              const index = selected.indexOf(category);
              const color = isSelected ? categoryColor(index) : '#C9C7C2';
              return (
                <div
                  key={category}
                  className={`category-picker-row${isPrimary ? ' is-primary' : ''}`}
                >
                  <div
                    className="category-picker-row-toggle"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={category}
                    tabIndex={0}
                    onClick={() => toggle(category)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(category);
                      }
                    }}
                  >
                    <DrawnCheckbox checked={isSelected} />
                    <span
                      className="category-picker-swatch"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    <span
                      className={
                        isSelected
                          ? 'category-picker-name selected'
                          : 'category-picker-name'
                      }
                    >
                      {category}
                    </span>
                  </div>
                  <Sparkline
                    gap={result.gap}
                    globalMax={globalMax}
                    color={color}
                  />
                  <span
                    className={`category-picker-peak${peak > EPSILON ? ' has-gap' : ''}`}
                  >
                    {peak > EPSILON ? display(peak) : '—'}
                  </span>
                  <span className="category-picker-action">
                    {isPrimary ? (
                      <span className="primary-badge">PRIMARY</span>
                    ) : isSelected ? (
                      <button
                        type="button"
                        className="set-button"
                        onClick={() => promote(category)}
                      >
                        SET
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="category-picker-footer">
            <div>
              <button
                type="button"
                className="text-link"
                onClick={selectEveryConstrained}
              >
                Select every constrained category
              </button>
              <button
                type="button"
                className="text-link muted"
                onClick={primaryOnly}
              >
                Primary only
              </button>
            </div>
            <span>{selected.length} categories selected</span>
          </div>
        </div>
      )}
    </div>
  );
}
