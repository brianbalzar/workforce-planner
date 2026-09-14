# Workforce Planner data contract

The deployed app is static. It loads one versioned JSON document from
`/data/workforce-planner.json` before rendering. The physical data directory
stays outside both this repository and the generated `dist/` directory.

Local development serves the same URL from:

`../workforce-planner-data/forecast-pipeline/output/workforce-planner.json`

Set `WFP_DATA_FILE` before starting Vite to use a different local file. The
physical path is used only by the development server and is never exposed to
the browser or compiled into the production app.

## Top-level fields

- `schemaVersion`: currently `1`.
- `publishedAt`: ISO date-time. This is also the source revision used to
  detect browser plans created from an older publication.
- `forecastStart`: first planning month as `YYYY-MM`.
- `months`: exactly 18 consecutive `YYYY-MM` values beginning at
  `forecastStart`.
- `source`: source dates for Hard and Soft Backlog.
- `departments`: selectable organizational units.
- `laborCategories`: configurable categories shown by the app.
- `categoryFactors`: numeric demand factor for every labor category.
- `proposedProjectArchetypes`: configurable rule-of-thumb templates used to
  seed the lightweight proposed-project workflow. Each template owns its
  project type, default duration, staffing curve, cost mix, labor-category
  allocation, and an optional `laborHoursPerMillion`. The last value can stay
  omitted until historical estimates support a defensible conversion.
- `projects`: active Hard and Soft Backlog projects. Project `curve` arrays
  must contain exactly 18 non-negative values. BuildOps project number is the
  stable ID for Hard Backlog. Soft projects may also carry `projectType`,
  `bidDate`, and `estimateFileName` for estimate traceability. Estimate imports
  use `curveBasis: "total-internal-labor"`; their total FTE curve is split into
  labor categories using `laborAllocation`. Soft Backlog projects created or
  edited in the app may also carry `softBacklogForecast`, which preserves the
  total labor hours, start/end months, curve method, productive-hours
  assumption, and generated status needed to reopen the editor. Existing
  pipeline curves without
  this flag retain the legacy category-factor behavior.
- `initialPlans`: the shared published plan(s), including capacity assumptions,
  actions, and any scenario-only proposed projects.

## Project lifecycle

- `Hard`: awarded in BuildOps and has positive forecast demand somewhere in
  the rolling window.
- `Soft`: supported by a detailed estimate but not yet awarded.
- Proposed projects are intentionally stored inside a scenario's
  `proposedProjects` collection. They are rule-of-thumb planning concepts,
  not shared source backlog.
- A project with no positive forecast in the rolling window is omitted from
  active `projects`. The private pipeline may retain its historical record.

## Publishing behavior

The server should upload to a temporary filename, validate it, and then rename
it to `workforce-planner.json`. Configure the `/data/` route with `no-cache`
or equivalent revalidation so monthly publications do not remain stale in
browsers. Keep the prior valid file for rollback.

Server-published builds never fall back to sample data. A missing or invalid
file produces a blocking data-unavailable screen. Local development uses a
clearly labeled sample fallback when the sibling output is not ready.

GitHub Pages is built with `VITE_DATA_MODE=upload` and contains no workforce
dataset. On every visit, the user selects a contract-valid JSON file. The app
validates and holds that data in memory for the current page session; it does
not upload the file or persist workforce plans in browser storage. Refreshing
or closing the page clears the session. This is distinct from importing raw
BuildOps CSV: the selected file is the pipeline's finished contract document.

## Local browser plans

Working scenarios remain browser-local. Saved data records the `publishedAt`
revision it was based on. When a newer file is published, the app warns the
user and offers to reload the published plan instead of merging unlike source
revisions silently.
