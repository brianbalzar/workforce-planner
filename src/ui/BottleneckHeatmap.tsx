import type { AnalysisResult } from '../domain/types';
import type { LaborCategory } from '../domain/types';
import type { Tab } from './App';
import { monthStatus, sortCategoriesByBottleneck } from './categoryStatus';

export function BottleneckHeatmap({
  categories,
  months,
  allResults,
  selected,
  setSelected,
  setTab,
  setSelectedMonth,
}: {
  categories: LaborCategory[];
  months: string[];
  allResults: Map<LaborCategory, AnalysisResult>;
  selected: Set<LaborCategory>;
  setSelected: (next: Set<LaborCategory>) => void;
  setTab: (t: Tab) => void;
  setSelectedMonth: (v: number | null) => void;
}) {
  const resultFor = (category: LaborCategory) => allResults.get(category)!;
  const sorted = sortCategoriesByBottleneck(
    categories.filter((c) => allResults.has(c)),
    resultFor,
  );
  const toggle = (category: LaborCategory) => {
    const next = new Set(selected);
    if (next.has(category)) {
      if (next.size === 1) return;
      next.delete(category);
    } else {
      next.add(category);
    }
    setSelected(next);
  };
  const jumpTo = (category: LaborCategory, monthIndex: number) => {
    setSelected(new Set([category]));
    setSelectedMonth(monthIndex);
    setTab('dashboard');
  };
  const jumpToMonth = (monthIndex: number) => {
    setSelectedMonth(monthIndex);
    setTab('dashboard');
  };
  return (
    <section className="chart-card overlap-card" data-tour="bottleneck-heatmap">
      <div className="card-heading">
        <div>
          <span>ALL-CATEGORIES BOTTLENECK SCAN</span>
          <h2>Every labor category, worst first</h2>
        </div>
      </div>
      <div className="overlap-scroll">
        <div className="overlap-row overlap-months">
          <div />
          {months.map((m, i) => (
            <button
              key={m}
              className="overlap-month"
              aria-label={`Inspect ${m} on the bottleneck dashboard`}
              onClick={() => jumpToMonth(i)}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
        {sorted.map((category) => {
          const result = resultFor(category);
          return (
            <div className="overlap-row overlap-heat-row" key={category}>
              <div className="overlap-row-label">
                <label className="heat-row-checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(category)}
                    disabled={selected.size === 1 && selected.has(category)}
                    onChange={() => toggle(category)}
                  />
                  <strong>{category}</strong>
                </label>
              </div>
              {months.map((m, i) => {
                const status = monthStatus(result, i);
                const need = result.scenario[i];
                return (
                  <button
                    key={m}
                    className={`overlap-heat-cell status-${status}`}
                    style={{ gridColumnStart: i + 2, gridColumnEnd: i + 3 }}
                    title={`${category} · ${m}: ${need.toFixed(1)} needed`}
                    onClick={() => jumpTo(category, i)}
                  >
                    {need > 0.05 ? need.toFixed(1) : '—'}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="info-note heat-legend">
        Checking a row here selects it in the LABOR CATEGORY picker above. Click
        a cell to jump to that category and month on the Dashboard.
        <span className="heat-legend-swatch status-good" />
        Existing staff and/or the pre-fab shop
        <span className="heat-legend-swatch status-watch" />
        Needs planned hires, subcontract, or overtime
        <span className="heat-legend-swatch status-critical" />
        Unresolved gap
      </p>
    </section>
  );
}
