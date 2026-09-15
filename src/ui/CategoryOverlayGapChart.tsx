import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalysisResult } from '../domain/types';
import type { LaborCategory } from '../domain/types';
import { categoryColor, sortCategoriesByBottleneck } from './categoryStatus';

/**
 * Shown instead of MonthlyCompositionChart once 2+ labor categories are
 * selected — a composition (stacked breakdown) chart doesn't make sense for
 * more than one category at once, but "which of these is the worse
 * bottleneck, and when" (the original ask) is exactly a multi-line gap chart.
 */
export function CategoryOverlayGapChart({
  categories,
  selected,
  months,
  allResults,
}: {
  /** Every known category, in stable order — used only to keep each
   * category's color consistent with the picker widget and heatmap. */
  categories: LaborCategory[];
  selected: Set<LaborCategory>;
  months: string[];
  allResults: Map<LaborCategory, AnalysisResult>;
}) {
  const ordered = sortCategoriesByBottleneck(
    categories.filter((c) => selected.has(c) && allResults.has(c)),
    (c) => allResults.get(c)!,
  );
  const data = months.map((month, i) => {
    const row: Record<string, string | number> = { month };
    ordered.forEach((category) => {
      row[category] = allResults.get(category)!.gap[i];
    });
    return row;
  });
  return (
    <section
      className="chart-card composition-card"
      data-tour="composition-chart"
    >
      <div className="card-heading">
        <div>
          <span>UNRESOLVED GAP BY LABOR CATEGORY</span>
          <h2>Which selected category is the worse bottleneck, and when</h2>
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 24, left: 10, bottom: 48 }}
          >
            <CartesianGrid stroke="#efeeec" vertical={false} />
            <XAxis
              dataKey="month"
              interval={0}
              angle={-45}
              textAnchor="end"
              tick={{ fontSize: 9 }}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => Number(value).toFixed(1)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {ordered.map((category) => (
              <Line
                key={category}
                dataKey={category}
                stroke={categoryColor(categories.indexOf(category))}
                dot={false}
                strokeWidth={2.2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="info-note">
        Each line is that category&apos;s unresolved shortfall (demand beyond
        every planned capacity source) across the window. The metric tiles above
        still reflect the primary selected category only — use this chart and
        the bottleneck heatmap on the Projects tab to compare across categories.
      </p>
    </section>
  );
}
