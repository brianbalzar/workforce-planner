import { contiguousWindows } from '../planning/engine';
import type { AnalysisResult, LaborCategory } from '../domain/types';
import { peakGap, sortByPeakGapDesc } from './categoryStatus';
import {
  categoryColor,
  selectedCategories,
  type CategorySelectionState,
} from './categorySelection';

const EPSILON = 0.05;

/**
 * "Unresolved gap by labor category" — replaces a per-category line chart,
 * which was unreadable once more than two categories were selected. Shown
 * only when 2+ categories are selected; metric tiles, recommendations and
 * the workflow timeline still follow the primary category, stated in the
 * note below.
 */
export function GapMatrixCard({
  months,
  allResults,
  selection,
  promote,
  display,
}: {
  months: string[];
  allResults: Map<LaborCategory, AnalysisResult>;
  selection: CategorySelectionState;
  promote: (category: LaborCategory) => void;
  display: (v: number) => string;
}) {
  const selected = selectedCategories(selection).filter((c) =>
    allResults.has(c),
  );
  const resultFor = (c: LaborCategory) => allResults.get(c)!;
  const sharedMax = Math.max(
    1,
    ...selected.map((c) => peakGap(resultFor(c)).peak),
  );
  const rows = sortByPeakGapDesc(selected, resultFor).map((category) => {
    const result = resultFor(category);
    const { peak, index: peakIndex } = peakGap(result);
    const windows = contiguousWindows(result.gap, EPSILON);
    const constrainedMonths = windows.reduce(
      (sum, w) => sum + (w.end - w.start + 1),
      0,
    );
    return { category, result, peak, peakIndex, windows, constrainedMonths };
  });
  const worst = rows[0];

  return (
    <section className="chart-card gap-matrix-card">
      <div className="card-heading">
        <div>
          <span>UNRESOLVED GAP BY LABOR CATEGORY</span>
          <h2>
            {worst && worst.peak > EPSILON
              ? `${worst.category} is the binding constraint, peaking ${months[worst.peakIndex]}`
              : 'No unresolved gap in any selected category'}
          </h2>
        </div>
      </div>
      <p className="gap-matrix-note">
        One shared vertical scale, so bar heights compare directly across
        categories. The solid bar marks each peak month. Tiles and the workflow
        timeline above follow the primary category — click a category name to
        make it primary.
      </p>
      <div className="gap-matrix-scroll">
        <div className="gap-matrix-row gap-matrix-header">
          <span>CATEGORY</span>
          <span />
          <span>PEAK GAP</span>
          <span>CONSTRAINED</span>
        </div>
        {rows.map(
          ({
            category,
            result,
            peak,
            peakIndex,
            windows,
            constrainedMonths,
          }) => {
            const isPrimary = category === selection.category;
            const index = selectedCategories(selection).indexOf(category);
            const color = categoryColor(index);
            return (
              <div
                className={`gap-matrix-row${isPrimary ? ' is-primary' : ''}`}
                key={category}
              >
                <div className="gap-matrix-label">
                  <span
                    className="gap-matrix-accent"
                    style={{ background: color }}
                  />
                  <div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => promote(category)}
                    >
                      {category}
                    </button>
                    <small>{isPrimary ? 'PRIMARY' : 'COMPARISON'}</small>
                  </div>
                </div>
                <div className="gap-matrix-bars">
                  {result.gap.map((g, i) => {
                    const height =
                      g > EPSILON
                        ? Math.max(4, Math.min(100, (g / sharedMax) * 100))
                        : 0;
                    const opacity =
                      g <= EPSILON ? 0 : i === peakIndex ? 1 : 0.55;
                    return (
                      <div
                        className="gap-matrix-cell"
                        key={months[i]}
                        title={`${months[i]} — ${category} · ${g.toFixed(1)} FTE unresolved`}
                      >
                        <div
                          className="gap-matrix-bar"
                          style={{
                            height: `${height}%`,
                            opacity,
                            background: color,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="gap-matrix-peak">
                  <b className={peak > EPSILON ? 'danger' : 'success'}>
                    {peak > EPSILON ? display(peak) : 'None'}
                  </b>
                  <small>
                    {peak > EPSILON ? months[peakIndex] : 'fully covered'}
                  </small>
                </div>
                <div className="gap-matrix-constrained">
                  <b>
                    {constrainedMonths > 0
                      ? `${constrainedMonths} ${constrainedMonths === 1 ? 'month' : 'months'}`
                      : '—'}
                  </b>
                  <small>
                    {windows.length
                      ? windows
                          .map((w) =>
                            w.start === w.end
                              ? months[w.start].slice(0, 3).toUpperCase()
                              : `${months[w.start].slice(0, 3).toUpperCase()}–${months[w.end].slice(0, 3).toUpperCase()}`,
                          )
                          .join(', ')
                      : 'no constrained months'}
                  </small>
                </div>
              </div>
            );
          },
        )}
      </div>
    </section>
  );
}
