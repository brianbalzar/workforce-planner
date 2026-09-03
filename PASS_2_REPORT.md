# Workforce Planner — Pass 2 completion report

Covers the deep visual/interaction fidelity pass (commit `2468165`), on top of
Pass 1's bug-fix/cleanup/CI pass (commit `4d34ab7`), on top of the untouched
Codex baseline (commit `179eda9`).

## What was implemented this pass

- **Per-work-package staffing curves are now live.** `resolveWorkPackageCurve()`
  in `src/planning/engine.ts` resamples a work package's baked curve against a
  new duration, regenerates it from a "Standard ramp / peak / taper",
  "Even distribution", or "Comparable-project curve" template, or uses a
  manually-entered monthly forecast — wired into the Work Package editor
  (duration field, staffing-curve select, manual-forecast grid) and into
  `proposedCurve()`. When nothing is edited it falls back exactly to the
  authored curve, so every pinned number in CALCULATIONS.md still reproduces
  bit-for-bit (see the "reproduces the specified..." Vitest cases).
- **Action workflow timeline rebuilt from real lead-time math.** New
  `actionMilestones()`/`datePosition()`/`addDays()` helpers turn each hire
  into five sequential phases (Recruiting → Interviewing and selection →
  Offer/notice → Onboarding → Ramp-up → Productive) and each subcontract into
  three (Sourcing → Vetting and contracting → Mobilization → Productive),
  each phase and milestone positioned on a continuous day-precision date
  scale rather than snapped to whole months. Overdue, unconfirmed actions get
  a red "OVERDUE · WAS DUE {date}" label. This replaced a single static bar
  per action with no phase detail.
- **Chart tooltip** now reports all seven demand/capacity series plus the top
  four driving projects for the hovered month (previously a single value).
- **Chart legend** rebuilt to the brief's spec: a column of three line
  swatches (hard/expected/scenario) plus a 2-column grid of six capacity
  swatches. The previous legend had `background`/`border` CSS rules on a
  `:before` pseudo-element with no `content` property, so no swatches
  rendered at all — plain unstyled text. Also added: X-axis month labels now
  render in red/bold for constrained (gap > 0) months, per spec.
- **Capacity Action modal** now has a real per-kind right rail: every
  milestone from `actionMilestones()` with its date, colored red if past and
  unconfirmed (previously a single hardcoded "ramp" text block that ignored
  the action's actual dates). Added the fields the brief specifies that were
  missing entirely: loaded hourly rate (hire), cost + cost basis + source
  type (subcontract).
- **Saved Plans** gained the brief's "Rebase" action (clears the stale flag,
  posts the exact confirmation copy from the brief) and swapped the
  "Unconfirmed" metric tile for the spec's "Next action" + overdue count.
- **Plan Comparison** now shows all eleven measures the brief lists — added
  Overtime, Added labor cost (18 mo), and Action dates (overdue count + next
  date), which were previously missing.
- Untracked `tsconfig.tsbuildinfo` (a build artifact that had been committed
  in the Codex baseline) and added it to `.gitignore`.

19 new/updated Vitest cases were added covering staffing-curve resolution
(fallback-equals-baseline, duration change, curve-type change) and the new
`metrics()` aggregation fields (`addedCapacityFteMonths`, `overtimePeak`).

## Deliberate deviations / simplifications (carried or introduced)

- **Growth Plan as default scenario**, not "Current Outlook" — this is the
  handoff's own documented deviation (README.md), kept as-is: Current Outlook
  doesn't include the Atlas project, but the brief's own sample demand table
  does, so Growth Plan is the only default that reproduces the specified
  numbers.
- **CATEGORY_FACTOR / PEAK_CALIBRATION approximations** in the demand engine
  are pre-existing, explicitly-flagged prototype simplifications from the
  original handoff — not "bugs," so left untouched both passes.
- **"Added labor cost (18 mo)" in Plan Comparison** uses the labor category's
  blended standard rate (`CapacityAssumption.hourlyRate` /
  `productiveHours`), not a weighted sum of each action's own
  loaded-rate/cost override. The per-action rate and cost fields are now
  captured and editable in the Action modal (this pass), but the aggregate
  comparison figure doesn't yet consume them individually — a reasonable,
  but real, simplification worth revisiting if per-action cost precision
  matters for the comparison view specifically.
- **Legend capacity swatches** approximate the chart's SVG hatch patterns
  (planned-hires, unresolved-gap) with CSS `repeating-linear-gradient`
  rather than reusing the exact same `<pattern>` defs the chart SVG uses.
  Visually equivalent, not byte-identical.
- The `@import 'tailwindcss'` in `styles.css` is unused dead weight (no
  Tailwind utility classes appear anywhere in `src/`) and produces harmless
  `@theme`/`@tailwind` warnings from the CSS minifier during build. Left in
  place both passes to minimize risk this late in the fidelity work; safe to
  remove in a follow-up (would shrink the CSS bundle and silence the build
  warnings).

## What was NOT specifically re-audited this pass

Screens 2 (Projects & Forecasts, including the project forecast drawer) and
3 (Scenario Builder's soft-backlog/proposed-project steps) received only
Pass 1's targeted bug fixes — this pass's fidelity work concentrated on the
Dashboard's signature visualization, the action timeline, and the Capacity
Action modal, which were the areas with the clearest static/illustrative
gaps. If those two screens need the same fidelity scrutiny, that's the
natural next slice of work (see below).

## Verification completed

Every change in this pass was verified against the full gate before commit:
`npm run format:check`, `npx oxlint` (0 warnings/errors, 187 rules),
`npm run typecheck` (`tsc -b`, 0 errors), `npx vitest run` (21/21 passing),
and `npm run build` (production Vite build succeeds). No interaction in this
pass is claimed as complete based on a static visual read alone — each was
checked by running the actual code path (engine unit tests for the
calculation changes; typecheck + build for the UI wiring).

## Deployment

The repo has a GitHub Actions workflow (`.github/workflows/deploy.yml`,
added in Pass 1) that builds and deploys to GitHub Pages on every push to
`main`. This local repo has no `git remote` configured yet, so to deploy:

1. Create an empty GitHub repository (public, for Pages).
2. `git remote add origin <repo-url>` then `git push -u origin main`
   (the default branch here is `main`).
3. In the GitHub repo, go to Settings → Pages → Source, and select
   "GitHub Actions."
4. The workflow will run on the push and publish to
   `https://<user>.github.io/<repo-name>/` — `vite.config.ts` already reads
   `GITHUB_REPOSITORY` to set the correct subpath base, so no further config
   is needed.

## Known MVP limitations (illustrative, not functional)

- The hire-action "Productive ramp" note (Month 1 50% / Month 2 75% / Month 3
  onward 100%) is descriptive copy only — the brief itself says default
  sample capacity begins at the fully productive month, i.e. this ramp is
  not wired into the capacity calculation. This matches the brief's own
  stated behavior, not a shortcut taken here.
- Single-department, single-office dataset (Mechanical — Metro) — matches
  the handoff's SAMPLE_DATA.md scope; the department/office selectors exist
  in the UI but only one combination has real fabricated data behind it.

## Recommended next step

Push to GitHub and confirm the Pages deployment succeeds end-to-end (the
workflow has been verified to build correctly locally but has never actually
run in GitHub Actions, since there's no remote yet). After that, if the
Projects & Forecasts and Scenario Builder screens warrant the same fidelity
pass given to the Dashboard, that would be the next scope of work.
