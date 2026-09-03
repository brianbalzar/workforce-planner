# Workforce Planner — Pass 3 completion report

This pass had two inputs: a Codex review (`REVIEW_RECOMMENDATIONS.md`, 16
items) and a set of recommendations you got from ChatGPT after showing it
your team's labor-tracker workbook and five screenshots of your boss's
prototype. Neither the workbook nor the screenshots reached this
conversation — only the derived text did — so everything below was built
from that text plus this repo, using entirely fabricated sample data. No
real project, customer, employee, PM, dollar amount, labor requirement,
location, file path, or workbook metadata was copied, referenced, or
committed. The "Prototype — Sample Data Only" banner is untouched and now
also appears on the new error-recovery screen.

## Codex review items — implemented

1. **Returning-user crash.** `planStore.ts` now normalizes every loaded
   plan against a known-good template instead of trusting parsed JSON —
   missing or malformed fields (the old `packageIncluded[w.id]` crash and
   any future schema growth) are defaulted rather than thrown. The two
   unguarded `config.packageIncluded[w.id]` accesses in the Project Drawer
   are also now optional-chained as a second line of defense. Added
   `src/ui/ErrorBoundary.tsx`, wrapping `<App/>` in `main.tsx`, with a
   "Reset prototype data & reload" recovery action. Three new regression
   tests cover a pre-Pass-1-shaped saved plan and fully malformed records.
2. **Plan Comparison metric bug.** "Peak shortage" was showing the same
   number as "Remaining unresolved gap" (`m.peak` in both rows). It now
   shows `m.peakVsExisting` — demand against existing headcount before any
   mitigating action — while "Remaining unresolved gap" keeps `m.peak`,
   the gap left after hires/subcontract/overtime are counted.
3. **Help-screen button contrast.** "Try a Proposed Project" on the black
   banner had no color/border of its own and relied on inherited text
   color. Gave it an explicit outlined-on-black treatment.
4. Skipped the manual "clean rehearsal" walkthrough — see Known
   limitations below; there's no way to keep a dev server alive across
   tool calls in this environment to drive an automated one either.
5. **Context-sensitive Saved Plans actions.** "Submit for Review,"
   "Mark as Approved," and "Supersede" now only render for the status
   they apply to; "Archive" is replaced by "Reopen as Draft" once a plan
   is archived.
6. **Projects table.** Added a Completion column (schedule/cost
   completion to date — see `percentComplete` below; shows "Not started"
   for soft/proposed work). Enlarged the probability slider, number
   input, and quick-pick buttons to real touch targets. Added
   `aria-label`s to the month-shift chevrons.
7. **Non-Metro department options.** The department selector's five other
   entries are now disabled with a "(reference only)" suffix and an
   explicit hint, since only Mechanical — Metro has real underlying
   calculations — selecting another used to silently show identical
   numbers.
8. **Planning window label.** Changed "rolling 18 months" to "18-month
   window" with a hint that this is a fixed demonstration window, not a
   live rolling forecast.
9. **Modal accessibility.** All four overlay/drawer components (Project
   Drawer, Proposed Project modal, Capacity Action modal, Plan
   Comparison) now get `role="dialog"`, `aria-modal`, an accessible name,
   autofocus on open, and Escape-to-close via a shared `useDialogA11y`
   hook. Tab navigation gets `aria-current="page"`. The bottleneck
   chart's month selection (previously a chart-click only) now has a
   keyboard-operable "Jump to month" `<select>` next to the legend.
10. **Unused Tailwind import.** Removed `@import 'tailwindcss'` from
    `styles.css` — grepped first to confirm zero Tailwind utility classes
    are used anywhere in the app. This also removed the `@theme`/
    `@tailwind` lightningcss build warnings.

Deferred (explicitly out of scope for this pass, noted below): 5, 8, 11,
13, 15, 16.

## ChatGPT/workbook-derived recommendations — implemented (Phase 1)

The workbook is a single-project weekly labor-forecast tool; this planner
consolidates forecasts _across_ projects to find department-level
bottlenecks. That separation of responsibility is preserved — this pass
adds the data model and calculations a real integration would need, plus
one new visualization, without turning this into a second labor tracker.

- **Weekly → monthly peak rollup**, exactly per your worked example:
  `peakCrewFromWeekly([10, 10, 25, 10])` returns `[25]`, not an average.
  Applied to a sample project (`p1`) with fabricated `weeklyCrew: [5, 5,
9, 5]`, whose true peak (9) now shows even though its existing
  FTE-curve peak was lower.
- **Three distinct people metrics** (`peopleMetricsForProject`): Peak
  Crew, Average/Implied People, and Monthly Planned People, each tagged
  with a `basis` (`weekly-peak` / `monthly-planned` / `even-spread-
estimate`) so the UI never presents an estimate as a confirmed peak.
  Surfaced in the Project Drawer's new "People view" section, with the
  even-spread case explicitly labeled as an assumption.
- **Workweek assumption.** Added `workweekHours` (40/50/60) to `Project`.
  `impliedPeopleFromHours` demonstrates that the same total hours imply
  _fewer_ people as the workweek lengthens — shown with a fabricated
  `totalForecastHours` figure back-computed at a 40-hour baseline so the
  effect is visible without inventing a whole parallel hours dataset.
  **Scoped down from the full ask**: this affects only the project-level
  Average/Implied People figure, not department-wide overtime cost or
  bottleneck recalculation — see Known limitations.
- **Labor category mapping.** `LABOR_SOURCE_MAP` maps 18 fabricated
  source-forecast labels (generic MEP trade/role names — Plumbing,
  Mechanical Piping, Fitters/Welders, Miscellaneous Labor, etc., not
  drawn from any specific workbook) to this planner's standardized
  `LaborCategory` list, with 6 intentionally left unmapped (`null`) to
  demonstrate the "never silently dump into Other" requirement. Sample
  projects carry `sourceLaborLabels`, and the Project Drawer shows each
  one's mapped category or an "UNMAPPED — needs review" flag.
- **Forecast freshness.** `forecastFreshness()` classifies a project's
  `lastRevisionDate` as Current/Approaching stale/Stale/Missing against a
  configurable threshold (30/60 days by default). Sample data covers all
  four states across the five hard-backlog projects. Shown as a badge in
  the Project Drawer.
- **Data-quality/assumption flags.** `assumptionFlagsForProject()`
  generates a representative subset of the requested taxonomy — even-
  spread-estimate, stale, missing revision date, and review-flagged
  method/quality — each with severity, explanation, effect on the
  analysis, and a recommended action, shown as expandable rows instead of
  one aggregate confidence score. **Not the full ~15-flag catalog** from
  the requirements — see Known limitations.
- **Monthly Composition chart.** New stacked-bar section on the
  Dashboard, directly under the bottleneck chart, breaking each month's
  demand into its largest contributing projects plus "Other." Clicking a
  bar opens the same month-detail drawer as the main chart. The existing
  month-detail drawer got a "Who is on site in [Month]?" eyebrow label
  per your framing, without otherwise redesigning it.
- **Percent complete.** Added a `percentComplete` field to `Project`
  (fabricated values, Hard/awarded projects only) and a Completion column
  with a small progress bar — this was also Codex's item 7 and the
  workbook's own "% complete" field, so it served both requests.

## Deferred to a future pass

From the ChatGPT/workbook recommendations — explicitly **not** built this
pass, because each is a substantial standalone feature and the brief
asked me not to broadly redesign what's working:

- The full **Portfolio Overlap** Gantt-style, project-by-project timeline
  view (grouping by project/category/location, include/exclude toggles
  from that view, confidence/status indicators on each bar).
- A full **Project Detail** drawer redesign with an expandable phase/work-
  package hierarchy exposing per-phase dates, value, staffing curve, and
  execution method independently.
- A fully **generalized toggle system** across projects, phases, work
  packages, alternates, and subcontracted portions with hiring/
  subcontract/recruiting-deadline recalculation — the existing per-
  project and per-work-package include/exclude toggles already do this at
  today's level; extending it to phases/alternates uniformly is a bigger
  change to the scenario config shape.
- The **complete ~15-item flag taxonomy** (conflicting dates, duration/
  hours mismatches, multiple competing estimates, prorated phase values,
  reconciliation failures, overridden soft-project probability, etc.) —
  only 4 representative flag types are implemented.
- **Forecast basis** as its own explicit data dimension (original budget
  vs. current forecast vs. remaining vs. forecast-at-completion vs.
  actual vs. trend vs. scenario override). The MVP scope note in your
  brief said not to build a full actuals/productivity module, and
  distinguishing all six bases cleanly touches most of the demand engine.
- The remainder of the 15-item test checklist beyond what's covered by
  the 8 new engine tests below (grouping-by-location/status reconciliation
  specifically, and a dedicated parent/phase double-counting test beyond
  what `rollupProjectCurve` already guarantees).

From the Codex review — also deferred, unchanged from what a full redesign
or infrastructure change would require:

- **Item 5**: Quick/Detailed proposed-project modes, independent
  per-work-package labor allocation, project-level staffing-curve control
  in that flow.
- **Item 8**: tablet-width (~1024px) layout fixes for the Dashboard
  controls, Scenario steps, and Workforce Capacity table.
- **Item 11**: browser-level interaction/smoke tests. This environment
  can't keep a dev server alive across tool calls (each shell call to
  your machine is a fresh process, so a background `vite preview` server
  is killed the moment the command that started it returns) — I confirmed
  this by starting one, then having its own next health-check fail. A
  real Playwright test suite run in CI (where the server and test runner
  share one process) would not have this problem; running it by hand as
  a rehearsal is something you're better positioned to do than I am from
  here.
- **Item 13**: bundle size / code-splitting (the build is ~643 KB JS,
  above Vite's 500 KB warning threshold — unchanged in kind from before
  this pass, slightly larger from this pass's additions).
- **Item 15**: bundling Google Fonts / system-font fallback, and setting
  an absolute social-preview image URL (blocked on knowing the eventual
  Pages URL).
- **Item 16**: real GitHub Pages subpath deployment validation — this
  repo still has no git remote configured, so the base-path logic in
  `vite.config.ts` has only ever been exercised locally.

## Deliberate modeling decisions worth validating with operations leadership

- **Workweek assumption changes Average/Implied People but not Peak
  Crew.** Reasoning: peak crew counts distinct people on site in a given
  week, which doesn't change based on how many hours each of them works —
  only the hours-derived average should move. The ChatGPT-derived brief's
  wording was ambiguous on whether workweek should also move peak/implied
  headcount together; I picked the interpretation that avoids overtime-
  hours silently inflating a "concurrent people" number. Worth confirming
  against how your ops team actually reasons about this.
- **Basis inference from existing fields.** `peopleMetricsForProject`
  infers `even-spread-estimate` from `method === 'Comparable-project
curve'` rather than a new explicit field, to avoid adding yet another
  parallel classification. If a project could have a monthly-planned
  forecast built via a "comparable-project" method, this heuristic would
  mislabel it.
- **`jsx-a11y/prefer-tag-over-role` disabled in `.oxlintrc.json`.** Oxlint
  wants native `<dialog>` elements instead of `role="dialog"`. Adopting
  native `<dialog>` would need its own pass (backdrop styling, `.showModal()`
  wiring, and rechecking the existing click-outside-to-close pattern) —
  I turned this one rule off with a comment rather than risk changing
  modal behavior in a pass that also touches accessibility semantics.

## Verification performed

- `npm run format` / `format:check` — clean.
- `npx oxlint` (187 rules) — 0 warnings, 0 errors (one rule intentionally
  disabled, noted above and in the config file).
- `npm run typecheck` (`tsc -b`) — clean.
- `npx vitest run` — **31 tests passing** (23 before this pass + 8 new:
  weekly→monthly peak rollup with your exact 10/10/25/10 example,
  implied-people-vs-workweek, peak-vs-average/implied distinction across
  three bases, hours/implied-people formula reconciliation, freshness
  classification across all four states, flag generation for stale/
  missing/review-quality/even-spread projects, unmapped-label detection,
  and monthly-composition-to-total reconciliation) plus 3 new persistence
  regression tests (old-shaped saved plan, fully malformed records).
- `npm run build` — succeeds; only the pre-existing chunk-size warning
  (bundle now ~643 KB JS, up from ~630 KB).
- Manually reviewed every new markup/CSS change for the tablet-adjacent
  areas I touched (probability controls, completion bar, chart month-jump
  selector) since I could not get a live browser preview working in this
  environment — see the item 11 note above for why. **I was not able to
  visually confirm rendering with a screenshot this pass**; the changes
  are additive and reuse existing CSS conventions, but a quick look on
  your end before a demo is warranted, especially for the disabled-option
  styling on the department dropdown and the new Monthly Composition
  chart's legend wrapping at narrower widths.
- Grepped the full diff for workbook-identifying strings (SharePoint,
  the workbook's filename, "Projection Master") — no matches.

## Known MVP limitations

- No workbook upload or ingestion — as instructed, this pass only adds
  the data model and sample data an eventual integration would populate.
- The labor-category mapping is reference/traceability only; it does not
  feed the demand-calculation engine, which still operates on the
  existing standardized `LaborCategory` list via `CATEGORY_FACTORS`.
- The Monthly Composition chart's series are the overall top 4 projects
  across the whole 18-month window (not recomputed per month), so a
  project that's huge in one month but small elsewhere still gets its own
  series rather than being folded into "Other" for its quiet months —
  this keeps the stacked chart's colors stable but means "Other" isn't
  always the 5th-biggest thing in every single month.
- Assumption flags and freshness are computed per-project on render, not
  cached or exposed at the portfolio level (e.g., no "3 projects have
  stale forecasts" department-wide rollup yet).
