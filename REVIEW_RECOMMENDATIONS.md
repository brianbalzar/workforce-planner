# Workforce Planner MVP Review

## Overall assessment

The build is visually strong and close to demo-ready. The dashboard, scenario workflow, saved plans, comparison view, and Help screen form a convincing pilot.

## Before the demonstration

1. **Fix the returning-user crash.** Opening a project can blank the application when the browser contains data saved by an earlier build. The saved-data format remains at version 1 even though new required fields were introduced. The immediate failure is at `src/ui/App.tsx:1439`; version handling is in `src/persistence/planStore.ts:4`. Add a migration/defaulting layer, validate nested plan data, and add a regression test using an older saved plan. Add an error boundary so one bad record cannot blank the application.

   Temporary workaround: clear the site's stored prototype data before the presentation.

2. **Correct “Peak shortage” in Plan Comparison.** “Peak shortage” and “Remaining unresolved gap” currently display the same number. Peak shortage should represent demand above existing capacity before mitigation; unresolved gap should be the amount left after actions. The comparison currently uses `m.peak` for both at `src/ui/App.tsx:3210` and `src/ui/App.tsx:3240`.

3. **Fix the invisible Help-screen button.** “Try a Proposed Project” has insufficient contrast against the white button background in the black Help banner. Give it an explicit text color or secondary-button treatment.

4. **Run a clean demo rehearsal.** Reset prototype data, reload, and walk through the Dashboard chart, Project drawer, Proposed Project creation, all seven Scenario Builder steps, saving/comparing plans, and refreshing/reopening a saved plan.

## High-value pilot improvements

5. **Finish the proposed-project workflow.** Compared with the handoff specification, it is still missing Quick versus Detailed modes, independent labor allocation for each work package, project-level staffing-curve control, several preview metrics (including labor hours, peak people, recommended hires/temp labor, and sourcing deadlines), and clear month labels/legend on the preview chart.

6. **Make workflow actions context-sensitive.** Saved plans show actions that do not always make sense, such as “Mark as Approved” on an already approved plan. Hide or disable invalid actions and explain why when disabled.

7. **Improve the Projects table.** Add the specified Completion column. Enlarge the probability controls, which are currently small targets, and give the project-expansion arrows accessible labels.

8. **Improve tablet layouts.** At approximately 1024px wide, Dashboard controls wrap awkwardly, Scenario steps become horizontally scrollable, and the Workforce Capacity table hides important columns. A compact header, always-visible current-step indicator, and sticky first table column would help.

9. **Clarify the demonstration dataset.** The organization and department selectors imply multiple distinct datasets, but non-Metro selections reuse demonstration assumptions. Disable those choices for the pilot or label them clearly as illustrative.

10. **Label the fixed planning period accurately.** The interface describes an 18-month rolling window, but this pilot uses fixed demonstration dates. “Demonstration planning window: Sep 2026–Feb 2028” would avoid confusion.

## Quality and deployment recommendations

11. **Add interaction tests.** The existing 21 calculation and persistence tests pass, as do linting, formatting, and type checking. There are no browser-level tests, so the project-drawer crash escaped detection. Add a small smoke suite covering each tab, drawer, modal, and older saved-data fixture.

12. **Improve accessibility basics.** Modals need dialog semantics, accessible names, keyboard focus management, and Escape-to-close behavior. Navigation should identify the current tab, and chart selection should be keyboard accessible.

13. **Reduce the application bundle.** The production build succeeds, but JavaScript is approximately 630 KB and triggers a chunk-size warning. `src/ui/App.tsx` is more than 3,000 lines. Split major screens and lazy-load secondary areas.

14. **Remove the unused Tailwind import.** `src/ui/styles.css:1` imports Tailwind even though the app uses conventional CSS. This produces production-build warnings.

15. **Make the site fully self-contained.** `index.html:26` fetches Google Fonts externally. Bundle the fonts or use system fonts for a reliable, privacy-conscious demo. Set an absolute social-preview image URL once the GitHub Pages address is known.

16. **Complete GitHub Pages validation.** The deployment workflow is present and well structured, but the repository currently has no GitHub remote, so the real project-subpath deployment has not been exercised. Test the final Pages URL, especially asset and social-preview paths.

## Recommended order

Fix items 1–3, perform the clean rehearsal, and then use the current build for the demonstration. The remaining items fit naturally into a post-demo refinement pass.

## Second-pass review — September 2, 2026

The follow-up build addressed most of the original high-priority findings:

- Legacy saved plans are normalized and no longer blank the app when opening a project.
- An error-recovery screen and error boundary were added.
- Plan Comparison now distinguishes peak shortage from remaining unresolved gap.
- The Help-screen proposed-project action now has an outlined, readable treatment.
- Saved-plan actions are contextual by status.
- The Projects table now includes Completion, larger probability controls, and labelled shift buttons.
- Non-Metro department choices are clearly marked reference-only and disabled.
- Modals have dialog semantics, Escape handling, autofocus, and accessible names.
- The Dashboard includes a keyboard-operable month selector.
- Portfolio Overlap, People view, forecast freshness, assumption flags, and monthly composition were added.
- The updated test suite has 34 passing tests; lint, type checking, formatting, and production build all pass.

Remaining recommendations from this second pass:

1. **Deepen the saved-data migration.** The current normalizer fills missing top-level config fields, but nested objects such as individual capacity assumptions and partial proposed projects are merged shallowly. A legacy record containing an incomplete category object could still produce missing values (for example, an hourly rate of zero). Deep-merge nested defaults or validate and replace incomplete nested records, and consider a future storage-key/version bump.

2. **Complete the proposed-project specification.** Quick/Detailed modes and visible per-work-package labor-category allocation are still absent. The builder has project-level allocation plus package execution percentages, but not a separate category mix for each package.

3. **Finish tablet and narrow-screen QA.** The 1024px Dashboard, Scenario step rail, and Workforce Capacity table still need a deliberate responsive pass. Test at 1024px and a small laptop width before the demo.

4. **Add browser smoke tests.** Unit coverage is now good, but automated browser tests should cover loading an older local plan, opening a project drawer, opening the proposed-project modal, switching tabs, and refreshing after save.

5. **Reduce the production bundle.** The build succeeds, but the main JavaScript bundle is approximately 646 KB and still triggers Vite's 500 KB warning. Split the large App module and lazy-load secondary views when practical.

6. **Decide on the self-contained deployment approach.** Google Fonts are still loaded from external URLs, and the repository has no configured GitHub remote, so the final GitHub Pages subpath has not yet been verified. Bundle fonts or use system fallbacks, then test the deployed path and social-preview metadata.

7. **Validate the new data-model assumptions with operations leadership.** The new People metrics, weekly-to-monthly peak rollup, forecast freshness labels, and assumption flags are useful additions, but the workweek interpretation and the distinction between peak crew and implied people should be confirmed with the intended audience.

## Deployed GitHub Pages review — September 3, 2026

The production URL was reviewed directly at `https://brianbalzar.github.io/workforce-planner/`.

- The GitHub Pages base path works and the Upchurch logo asset loads from the expected `/workforce-planner/assets/` path.
- The first-run tour appears on a fresh visit and explains the workflow clearly. It contains 14 steps; consider making it shorter for a live demonstration, with a “Restart tour” option available from Help.
- Dashboard, Projects & Forecasts, Scenario Builder, Workforce Capacity, Saved Plans, Help, Plan Comparison, and Portfolio Overlap were all reachable in production.
- Portfolio Overlap grouping and month-inspection controls responded correctly.
- The deployed version displayed no new blank-screen or navigation failure during the walkthrough.
- At 1024px and 390px, the semantic content remains reachable, but a visual pass is still recommended for header wrapping, horizontal tables, the Scenario Builder step rail, and modal height.

Production-specific cautions:

1. The live site is publicly readable while the repository/pages configuration is public; there is no application-level password gate. Keep all data fabricated and use repository/access visibility controls for the boss demonstration rather than placing sensitive information in the static app.
2. The production bundle still carries the large-main-chunk warning (approximately 646 KB JavaScript). This is not a demo blocker, but it is the clearest performance/maintainability follow-up.
3. The remaining proposed-project gaps (Quick/Detailed modes and per-work-package labor-category allocation) are still visible in the deployed flow.
