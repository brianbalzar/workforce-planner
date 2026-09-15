# Spec: All-Categories Bottleneck Heatmap

**Status:** Proposed — handoff spec for Codex to implement. Claude owns the
data pipeline (`workforce-planner-data`); Codex owns this app repo (UI,
`engine.ts`, deploy) per our 2026-09-14 team split. This document does not
change any code in this repo — it's the spec for that change.

**Requested by:** Brian, 2026-09-15, in his own words:

> While using the app, one thing that's difficult is finding where a
> bottleneck is. For example, you have to select each individual labor
> category. In the bottleneck plot, is there a way to maybe select all
> labor, that maybe gives a plot that would show all the labor and where
> the bottleneck might be? Then we can drill into that labor category?

**Approved approach** (Brian picked this over alternatives when asked):
an **all-categories heatmap** — one row per labor category, one column per
month, colored by bottleneck severity — that you can scan at a glance, then
click a row to drill into that category's existing single-category
Dashboard view.

## Problem today

`category` is a single piece of global state (`App.tsx` line 165,
`useState<LaborCategory>`), driven by one `<select>` in `ControlBar`
("LABOR CATEGORY" field, line 921). Every bottleneck-relevant view —
`Dashboard` (the main chart, line 1018), `PortfolioOverlap`'s heat row
(line 2143-2165), and `Capacity` — reads that one global category. To
check whether, say, Electricians are the constraint in November, Brian has
to already suspect Electricians, select them from the dropdown, and look.
There's no view that shows all 16 categories at once so a bottleneck can be
spotted before you know which category to look for.

## Where this lives

`PortfolioOverlap` (`App.tsx`, function starting line 2008) is rendered
inside `Projects` (line 1995), which renders when `tab === 'projects'`
(line 604) — **not** inside the `tab === 'dashboard'` block (that block
closes at line 603, well before `PortfolioOverlap` is even invoked). So
today's single-category heat row already lives on the Projects tab, next
to the per-project overlap bars, not on the Dashboard tab. The new
all-categories heatmap should be added as a sibling section in that same
place, not on the Dashboard tab — keep the Dashboard tab as the focused
single-category drill-down view it already is.

## Proposed change

### 1. New component: `BottleneckHeatmap`

Add a new component, rendered directly above (or below — Codex's call)
the existing `category.toUpperCase() + ' — MONTHLY LABOR NEEDED'` single-row
heat block inside `PortfolioOverlap` (lines 2143-2165), or as its own
sibling section in `Projects` right before `<PortfolioOverlap ... />`
(line 1995). Either placement keeps it on the Projects tab, next to the
existing overlap heat row it generalizes.

```tsx
function BottleneckHeatmap({
  config,
  department,
  setCategory,
  setTab,
  setSelectedMonth,
}: {
  config: ScenarioConfig;
  department: string;
  setCategory: (v: LaborCategory) => void;
  setTab: (t: Tab) => void;
  setSelectedMonth: (v: number | null) => void;
}) {
  // One analyze() call per labor category instead of one for the globally
  // selected category. LABOR_CATEGORIES has 16 entries; analyze() is
  // already cheap enough to call in a loop elsewhere in this file (see the
  // plan-comparison modal, ~line 5075), but 16x here runs on every
  // Projects-tab render, so memoize it — see Performance note below.
  const rows = useMemo(
    () =>
      LABOR_CATEGORIES.map((cat) => ({
        category: cat,
        result: analyze(config, cat, department),
      })),
    [config, department],
  );

  const EPSILON = 0.05;
  const statusFor = (result: ReturnType<typeof analyze>, i: number) => {
    const need = result.scenario[i];
    if (need <= EPSILON) return 'none' as const;
    if (need <= result.existing[i] + result.prefab[i] + EPSILON)
      return 'good' as const;
    if (need <= result.total[i] + EPSILON) return 'watch' as const;
    return 'critical' as const;
  };

  // Sort worst-first so the categories most worth looking at are on top:
  // by count of 'critical' months, then 'watch' months, as a tiebreak.
  const withSeverity = rows
    .map((r) => {
      const statuses = MONTHS.map((_, i) => statusFor(r.result, i));
      return {
        ...r,
        statuses,
        criticalCount: statuses.filter((s) => s === 'critical').length,
        watchCount: statuses.filter((s) => s === 'watch').length,
      };
    })
    .sort(
      (a, b) =>
        b.criticalCount - a.criticalCount || b.watchCount - a.watchCount,
    );

  return (
    <section className="chart-card overlap-card" data-tour="all-category-heatmap">
      <div className="card-heading">
        <div>
          <span>ALL LABOR — BOTTLENECK SCAN</span>
          <h2>Every category, one screen</h2>
        </div>
      </div>
      <div className="overlap-scroll">
        <div className="overlap-row overlap-months">
          <div />
          {MONTHS.map((m, i) => (
            <div key={m} className="overlap-month">
              {m.slice(0, 3)}
            </div>
          ))}
        </div>
        {withSeverity.map(({ category: cat, statuses, result }) => (
          <div className="overlap-row overlap-heat-row" key={cat}>
            <div className="overlap-row-label">
              <button
                className="text-link"
                onClick={() => {
                  setCategory(cat);
                  setTab('dashboard');
                }}
              >
                {cat}
              </button>
            </div>
            {statuses.map((status, i) => (
              <div
                key={MONTHS[i]}
                className={`overlap-heat-cell status-${status}`}
                style={{ gridColumnStart: i + 2, gridColumnEnd: i + 3 }}
                title={`${cat} · ${MONTHS[i]}: ${result.scenario[i].toFixed(1)} needed`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setCategory(cat);
                  setSelectedMonth(i);
                  setTab('dashboard');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setCategory(cat);
                    setSelectedMonth(i);
                    setTab('dashboard');
                  }
                }}
              >
                {result.scenario[i] > 0.05 ? result.scenario[i].toFixed(1) : ''}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="info-note heat-legend">
        Same coloring as the category heat row below: total demand each
        month, colored by how it&apos;s covered.
        <span className="heat-legend-swatch status-good" />
        Existing staff and/or the pre-fab shop
        <span className="heat-legend-swatch status-watch" />
        Needs planned hires, subcontract, or overtime
        <span className="heat-legend-swatch status-critical" />
        Unresolved gap
      </p>
      <p className="info-note">
        Rows are sorted worst-first. Click a category name or a cell to
        switch LABOR CATEGORY and open it on the Bottleneck Dashboard —
        clicking a cell also jumps to that month.
      </p>
    </section>
  );
}
```

### 2. Wiring

- `Projects` already receives `setTab` and `setSelectedMonth` (lines
  1724-1725) — it just needs to also receive `setCategory` (not currently
  passed to `Projects`, only used at the `App` level and inside
  `ControlBar`) and pass all three down to the new component.
- Reuses the existing `Tab`, `LaborCategory`, `ScenarioConfig`, `analyze`,
  `MONTHS`, `LABOR_CATEGORIES` types/values already imported in `App.tsx`
  — no new dependencies.
- Reuses the existing `overlap-row`, `overlap-heat-row`, `overlap-heat-cell`,
  `overlap-month`, `status-{none,good,watch,critical}` CSS classes verbatim
  — no new CSS should be needed beyond maybe a hover/focus state for the
  now-clickable cells (`overlap-heat-cell` isn't currently a button/clickable
  element in the single-category row, so check that a focus outline looks
  right before shipping).

### 3. Drill-down behavior

Two click targets, both switch the global `category` state (the same one
`ControlBar`'s dropdown drives) and jump to the Dashboard tab, which then
shows that category's existing single-category chart exactly as it does
today:

- **Row label click** (category name): sets `category`, switches to the
  Dashboard tab. Mirrors the existing `Capacity` table's
  `onClick={() => setCategory(cat)}` row pattern (line ~2864 area).
- **Cell click** (a specific category+month): sets `category`, sets
  `selectedMonth`, switches to the Dashboard tab. Mirrors the existing
  month-header click already in `PortfolioOverlap` (lines 2098-2101,
  `setSelectedMonth(i); setTab('dashboard');`).

No new state is needed — this reuses `category`/`setCategory`,
`selectedMonth`/`setSelectedMonth`, and `tab`/`setTab`, all of which
already exist at the `App` level (lines 164-170) and already flow down to
`Dashboard` and `Projects`.

### Performance note

`analyze()` today runs once per render off the single global `category`
(`App.tsx` line 201-204, already `useMemo`'d on `[live, category,
department]`). This component calls it 16x (once per `LaborCategory`)
instead of once. `analyze()` is already called in a loop elsewhere (the
plan-comparison modal), so the pattern isn't new, but doing it on every
render of the Projects tab is a bigger, more frequent cost than that
modal's occasional use. Recommend memoizing on `[config, department]`
exactly as sketched above, and consider only mounting
`BottleneckHeatmap` when the Projects tab is actually visible/scrolled
into view rather than always-rendered, if a perf pass shows it's needed —
Codex's call once it's profiled against the real 16-category, 18-month,
~50-project dataset.

### Out of scope / left to Codex's judgment

- Exact placement relative to the existing single-category heat row inside
  `PortfolioOverlap` (above, below, or replacing it — Brian didn't ask to
  remove the single-category view, just to add an all-categories one).
- Whether "worst-first" sort is the right default, or whether it should be
  toggleable/alphabetical — flagged as a reasonable default, not a hard
  requirement.
- Mobile/narrow-viewport handling of a 16-row x 18-column grid (the
  existing `overlap-scroll` container already handles horizontal scroll
  for the single-row case; confirm it's still usable with 16 rows).
