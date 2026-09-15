# Spec: All-Categories Bottleneck Heatmap + Labor Category Picker

**Status:** Proposed — handoff spec for Codex to implement. Claude owns the
data pipeline (`workforce-planner-data`); Codex owns this app repo (UI,
`engine.ts`, deploy) per our 2026-09-14 team split. This document does not
change any code in this repo — it's the spec for that change.

**Revision 2 (2026-09-15, same day, follow-up conversation):** the original
heatmap-only design below is still the base — Brian confirmed "heatmap-first"
after seeing both options. This revision adds the piece his boss asked for:
a real multi-select widget (checkboxes, sparklines, red/yellow/green status)
replacing the plain LABOR CATEGORY dropdown, plus what checking multiple
categories actually does to the rest of the screen. Section 5 is new;
sections 1-4 are the original spec, lightly updated where the widget changes
the drill-down interaction.

**Requested by:** Brian, 2026-09-15, in his own words (first pass):

> While using the app, one thing that's difficult is finding where a
> bottleneck is. For example, you have to select each individual labor
> category. In the bottleneck plot, is there a way to maybe select all
> labor, that maybe gives a plot that would show all the labor and where
> the bottleneck might be? Then we can drill into that labor category?

And the follow-up, from a conversation with his boss:

> Putting check boxes next to the selections on the labor category... maybe
> there's a way we can visualize with sparkline or something in the dropdown
> so we know which one is limiting? Or maybe we can color code them red,
> yellow, green if they're in danger?
>
> I think we should build a widget. It would provide a lot of value and give
> us credence.

## 1. Problem today

`category` is a single piece of global state (`App.tsx` line 165,
`useState<LaborCategory>`), driven by one plain `<select>` in `ControlBar`
("LABOR CATEGORY" field, line 921). Every bottleneck-relevant view —
`Dashboard` (line 1018), `PortfolioOverlap`'s heat row (lines 2143-2165),
and `Capacity` — reads that one global category. To check whether, say,
Electricians are the constraint in November, Brian has to already suspect
Electricians, select them from the dropdown, and look. There's no way to
scan all 16 categories at once, and the dropdown itself carries zero signal
about which options are worth picking.

## 2. Where this lives

`PortfolioOverlap` (function starting `App.tsx` line 2008) is rendered
inside `Projects` (line 1995), which renders when `tab === 'projects'`
(line 604) — **not** inside the `tab === 'dashboard'` block (that block
closes at line 603, well before `PortfolioOverlap` is even invoked). The
new heatmap and the new picker widget both belong to this same
category-selection problem, but live in two different places: the widget
replaces the dropdown in `ControlBar` (visible everywhere, all tabs), and
the heatmap is a new scan section on the Projects tab, next to the existing
single-category heat row.

## 3. A shared per-category results memo

Both the widget (sparklines, status dots) and the heatmap (all 16 rows)
need every category's `analyze()` result, not just the one currently
selected. Compute this once, at the `App` level, and pass it down to both,
rather than each computing its own copy:

```tsx
// In App(), alongside the existing single-category `result`:
const allCategoryResults = useMemo(
  () =>
    new Map(
      LABOR_CATEGORIES.map((cat) => [cat, analyze(live, cat, department)]),
    ),
  [live, department],
);
```

This is 16 `analyze()` calls instead of 1, on every relevant render.
`analyze()` is already called in a loop elsewhere (the plan-comparison
modal, `CompareModal` ~line 5068), so the pattern isn't new, but doing it
this often is a bigger, more frequent cost than that modal's occasional
use — profile it against the real ~50-project, 18-month dataset before
shipping, and consider computing it lazily (only once the widget is opened
or the Projects tab is visible) if it's too slow to run on every keystroke
of a scenario edit.

The same status classification `PortfolioOverlap` already uses should be
reused everywhere (heatmap cells, widget dots, widget sparklines) rather
than reinvented per component:

```tsx
const EPSILON = 0.05;
function monthStatus(result: ReturnType<typeof analyze>, i: number) {
  const need = result.scenario[i];
  if (need <= EPSILON) return 'none' as const;
  if (need <= result.existing[i] + result.prefab[i] + EPSILON)
    return 'good' as const;
  if (need <= result.total[i] + EPSILON) return 'watch' as const;
  return 'critical' as const;
}
// worst status across the window, for a single-dot summary (widget row, sort order):
function worstStatus(result: ReturnType<typeof analyze>) {
  const order = { none: 0, good: 1, watch: 2, critical: 3 } as const;
  return MONTHS.reduce(
    (worst, _, i) =>
      order[monthStatus(result, i)] > order[worst]
        ? monthStatus(result, i)
        : worst,
    'none' as const,
  );
}
```

## 4. The heatmap (`BottleneckHeatmap`)

Rendered as a sibling section in `Projects`, right before
`<PortfolioOverlap ... />` (line 1995) — or inside `PortfolioOverlap`,
above its existing single-category heat row. Either placement keeps it on
the Projects tab.

- One row per `LaborCategory`, sourced from `allCategoryResults` (section 3) instead of computing its own — no duplicate `analyze()` calls.
- Same `overlap-row`, `overlap-heat-row`, `overlap-heat-cell`,
  `overlap-month`, `status-{none,good,watch,critical}` CSS classes as
  `PortfolioOverlap` already uses — no new CSS needed beyond a focus state
  for clickable cells.
- Sorted worst-first (`worstStatus`, then count of `'critical'` months as a
  tiebreak) so the categories most worth looking at are on top.
- **Row selection is now a checkbox, not a plain click** (this is the
  change from Revision 1): each row has a checkbox bound to the _same_
  `selectedCategories: Set<LaborCategory>` state the widget (section 5)
  uses. Checking a row here is equivalent to checking it in the widget —
  one shared selection, two places to change it. A cell click still jumps
  straight to the Dashboard for that category+month
  (`setSelectedCategories(new Set([cat])); setSelectedMonth(i); setTab('dashboard')`),
  same as the original month-header click pattern already in
  `PortfolioOverlap` (lines 2098-2101).

## 5. The `LaborCategoryPicker` widget (new — Revision 2)

### Why this can't be the existing `<select>`

A native HTML `<select>` cannot render a checkbox, a sparkline, or a colored
dot per option — browsers don't allow rich content inside `<option>`. So
"add checkboxes to the dropdown" is a new custom component, not a prop
change: a button that looks like today's field, opening a popover/listbox
with 16 rows, each row richer than plain text. Worth being upfront about
this with Brian's boss — it's the right call for the value it adds, but
it's a real small component, not a one-line tweak.

### What each row shows

```tsx
function CategoryPickerRow({
  category,
  result,
  checked,
  onToggle,
}: {
  category: LaborCategory;
  result: ReturnType<typeof analyze>;
  checked: boolean;
  onToggle: () => void;
}) {
  const status = worstStatus(result);
  // Sparkline: the 18-month gap curve (result.gap), not raw demand —
  // gap is literally "how much of this category's need is unresolved,"
  // the thing Brian is hunting for. A flat-zero sparkline is a fine,
  // legible signal for "not a bottleneck."
  const points = result.gap;
  return (
    <label className="category-picker-row">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={`status-dot status-${status}`} aria-hidden="true" />
      <span className="category-picker-name">{category}</span>
      <Sparkline values={points} className={`status-${status}`} />
    </label>
  );
}
```

`Sparkline` is a small new presentational component — an inline `<svg>`
polyline over the 18 values, no axes/labels, sized to fit inline (roughly
60×20px). No charting library needed for something this small; Recharts
(already a dependency) also has a minimal `<LineChart>` mode if Codex
prefers reusing one library everywhere for consistency — either is fine.

### Behavior

- Rows sorted worst-first, same as the heatmap (reuse `worstStatus`).
- Checking a row adds it to `selectedCategories`; the widget's closed-state
  label reads e.g. "Pipefitter, Electrician +1" when multiple are checked,
  or the single name when exactly one is (matching today's dropdown
  wording when there's no ambiguity).
- **Exactly one checked** (the common case, and the default on load — seed
  `selectedCategories` with the same single default `category` state uses
  today, e.g. Plumber): behaves exactly like today. `Dashboard` shows its
  existing single-category composition chart
  (`MonthlyCompositionChart`, line 1380) and metric tiles.
- **Two or more checked**: per Brian's answer, this drives an **overlay
  chart** — see section 5a. `Dashboard`'s current composition chart doesn't
  make sense for more than one category (you can't stack two categories'
  existing/prefab/hire/subcontract breakdown in one readable chart), so it
  swaps to the overlay view instead. The per-category metric tiles at the
  top of `Dashboard` (line 1085 area) also need a decision here — see Open
  question below.
- **Zero checked**: not a valid state — keep at least one checked (disable
  unchecking the last box, or fall back to the previous single selection).

### 5a. Overlay chart (new component, `CategoryOverlayGapChart` or similar)

When 2+ categories are selected, replace `Dashboard`'s composition chart
with a simple multi-series line chart: one line per selected category,
plotting `result.gap[i]` (unresolved shortfall) across the 18 months, using
`allCategoryResults` so nothing is recomputed. This directly answers "which
of these is the worse bottleneck, and when" — the actual ask from Brian's
first message. Each category needs a stable color (reuse whatever
categorical palette the app already has, if any; otherwise a small fixed
16-color list keyed by `LaborCategory`, reused for the status dots too so a
category's color is consistent across the widget, the legend, and the
chart).

### Open question for Codex / Brian to settle before building

`Dashboard`'s metric tiles (`FIRST CONSTRAINED MONTH`, `PEAK UNRESOLVED
GAP`, etc., `App.tsx` ~line 1085) are currently single-category numbers.
With multiple categories selected, these could become: (a) one tile set
per category, stacked or in a small-multiples row; (b) a single tile set
computed across the _union_ of selected categories (e.g. "peak gap" = the
worst single-category peak among those selected, or a summed peak); or (c)
hidden entirely in overlay mode, letting the chart and heatmap carry the
detail. Not resolved here — flagging so Codex doesn't have to guess and
Brian doesn't get surprised by whichever default ships.

## 6. Wiring summary

- `App`'s `category: LaborCategory` state becomes
  `selectedCategories: Set<LaborCategory>`, with a derived
  `category = selectedCategories.size === 1 ? [...selectedCategories][0] : <first selected, for `assumptions`/`display` which still need one>`
  — check every current single-category read site (`assumptions =
live.capacity[category]` at line 211, `Capacity` component, etc.) for
  whether it needs a "pick one" fallback or a small multiples treatment
  too. This is the widest-reaching part of the change — worth an explicit
  pass over every `category` read in `App.tsx`, not just `Dashboard`.
- `ControlBar`'s LABOR CATEGORY `<Field>` (line 921) is replaced by
  `<LaborCategoryPicker>`, fed `allCategoryResults` and
  `selectedCategories`/`setSelectedCategories`.
- `Projects`/`PortfolioOverlap`/`BottleneckHeatmap` all read the same
  `selectedCategories` state, so checking a box in the widget and checking
  a box in the heatmap are the same action.

## 7. Out of scope / left to Codex's judgment

- Exact popover mechanics (a `<details>`/`<summary>`, a small headless
  listbox, or a custom positioned panel) — whatever matches the rest of
  this app's existing component style.
- The metric-tiles question in section 5a.
- Whether `BottleneckHeatmap` sits above or below `PortfolioOverlap`'s
  existing single-category row, or replaces it now that the picker
  provides an at-a-glance signal on its own.
- Mobile/narrow-viewport handling of a 16-row popover and a 16-row heatmap
  grid.
