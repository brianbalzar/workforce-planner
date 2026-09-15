import { useState } from 'react';
import type { AnalysisResult, LaborCategory } from '../domain/types';
import { peakGap, rampColors, sortByPeakGapDesc } from './categoryStatus';
import {
  categoryColor,
  selectedCategories,
  type CategorySelectionState,
} from './categorySelection';

const EPSILON = 0.05;

export function BottleneckHeatmap({
  categories,
  months,
  allResults,
  selection,
  clickThrough,
  display,
}: {
  categories: LaborCategory[];
  months: string[];
  allResults: Map<LaborCategory, AnalysisResult>;
  selection: CategorySelectionState;
  /** Clicking a category name: sets it as primary, moves the previous
   * primary into the comparison set (capped), clears the month selection
   * (or jumps straight to a specific month, for a cell click), and switches
   * to the Dashboard tab. */
  clickThrough: (category: LaborCategory, monthIndex?: number) => void;
  display: (v: number) => string;
}) {
  const [scanAll, setScanAll] = useState(false);
  const selected = selectedCategories(selection);
  const resultFor = (c: LaborCategory) => allResults.get(c)!;
  const withPeak = categories
    .filter((c) => allResults.has(c))
    .map((c) => ({ category: c, ...peakGap(resultFor(c)) }));
  const constrained = sortByPeakGapDesc(
    withPeak.filter((p) => p.peak > EPSILON),
    (p) => resultFor(p.category),
  );
  const clear = withPeak.filter((p) => p.peak <= EPSILON);
  const rows = scanAll ? [...constrained, ...clear] : constrained;
  const globalMax = Math.max(1, ...withPeak.map((p) => p.peak));
  const globalPeak = Math.max(0, ...withPeak.map((p) => p.peak));

  return (
    <section className="chart-card scan-card" data-tour="bottleneck-heatmap">
      <div className="card-heading">
        <div>
          <span>ALL-CATEGORIES BOTTLENECK SCAN</span>
          <h2>
            {constrained.length
              ? `${constrained.length} of ${categories.length} labor categories are constrained in this window`
              : 'No labor category is constrained in this window'}
          </h2>
        </div>
      </div>
      <p className="scan-sub-line">
        Unresolved gap after every planned hire, subcontract and overtime hour,
        for each category in this plan. Click a category to open it on the
        dashboard. Blank months are covered.
      </p>
      <div className="scan-legend">
        <span>0</span>
        {[0, 1, 2, 3, 4].map((bucket) => (
          <span
            key={bucket}
            className="scan-legend-swatch"
            style={{ background: rampColors((bucket + 0.5) / 5)!.background }}
          />
        ))}
        <span className="scan-legend-label">
          {display(globalPeak)} UNRESOLVED
        </span>
        <button
          type="button"
          className="scan-toggle"
          onClick={() => setScanAll((v) => !v)}
        >
          {scanAll
            ? 'SHOW CONSTRAINED ONLY'
            : `SHOW ALL ${categories.length} CATEGORIES`}
        </button>
      </div>
      <div className="scan-scroll">
        <div className="scan-grid scan-grid-header">
          <div />
          {months.map((m, i) => (
            <div key={m} className="scan-month-header">
              <span className="scan-year">
                {(i === 0 || m.startsWith('Jan')) && m.split(' ')[1]}
              </span>
              <span>{m.slice(0, 3)}</span>
            </div>
          ))}
          <div className="scan-peak-header">PEAK</div>
        </div>
        {rows.map(({ category, peak, index: peakIndex }) => {
          const result = resultFor(category);
          const isPrimary = category === selection.category;
          const isCompared = !isPrimary && selected.includes(category);
          const accent = isPrimary
            ? '#161514'
            : isCompared
              ? categoryColor(selected.indexOf(category))
              : 'transparent';
          const tag = isPrimary
            ? { label: 'PRIMARY', color: '#0082FF' }
            : isCompared
              ? { label: 'COMPARED', color: '#6E6C68' }
              : peak > EPSILON
                ? {
                    label: `${result.gap.filter((g) => g > EPSILON).length} MONTHS`,
                    color: '#B91D1D',
                  }
                : { label: 'CLEAR', color: '#009500' };
          return (
            <div
              className={`scan-grid scan-row${isPrimary ? ' is-primary' : ''}`}
              key={category}
            >
              <div className="scan-row-label">
                <span className="scan-accent" style={{ background: accent }} />
                <button
                  type="button"
                  className={`text-link${isPrimary ? ' bold' : ''}`}
                  onClick={() => clickThrough(category)}
                >
                  {category}
                </button>
                <small style={{ color: tag.color }}>{tag.label}</small>
              </div>
              {result.gap.map((g, i) => {
                const t = g / globalMax;
                const colors = rampColors(t);
                const isPeak = i === peakIndex && g > EPSILON;
                return (
                  <button
                    type="button"
                    key={months[i]}
                    className={`scan-cell${isPeak ? ' peak' : ''}`}
                    style={
                      colors
                        ? { background: colors.background, color: colors.color }
                        : undefined
                    }
                    title={
                      g > EPSILON
                        ? `${months[i]} — ${category} · ${g.toFixed(1)} FTE unresolved`
                        : `${months[i]} — ${category} · covered by planned capacity`
                    }
                    onClick={() => clickThrough(category, i)}
                  >
                    {g > EPSILON ? g.toFixed(1) : ''}
                  </button>
                );
              })}
              <div className="scan-peak-cell">
                <b>{peak > EPSILON ? display(peak) : '—'}</b>
                <small>{peak > EPSILON ? months[peakIndex] : ''}</small>
              </div>
            </div>
          );
        })}
        {!scanAll && clear.length > 0 && (
          <div className="scan-clear-footer">
            <span>NO UNRESOLVED GAP</span>
            <span>{clear.map((p) => p.category).join(' · ')}</span>
          </div>
        )}
      </div>
    </section>
  );
}
