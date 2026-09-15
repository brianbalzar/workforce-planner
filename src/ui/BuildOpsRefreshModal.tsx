import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import {
  computeBuildOpsProjectEntry,
  parseBuildOpsCsv,
  type BuildOpsProjectEntry,
} from '../data/buildOpsImport';
import { DEPARTMENTS, LABOR_CATEGORIES, MONTH_KEYS } from '../data/runtimeData';
import type { Project } from '../domain/types';
import { useDialogA11y } from './App';
import {
  buildRefreshCounts,
  buildRefreshDiffs,
  buildRefreshedProject,
} from './buildOpsRefresh';
import {
  CountTileStrip,
  ImportStepRail,
  TrustContractCards,
} from './ImportFlowShell';

// The BuildOps hard-backlog refresh gets its own component rather than a
// generic dual-kind modal shared with the soft-backlog estimate import
// (AddProjectModal/SoftBacklogModal): that flow already existed, has a much
// richer editable review form, and predates this design handoff. Reconciling
// it fully onto one shared component would mean rewriting ~500 lines of
// working, tested form UI to fit a shape built for this simpler,
// read-then-commit flow. Instead the two share the actual primitives that
// matter (ImportFlowShell's step rail / count-tile strip / trust-contract
// cards) — see AddProjectModal and SoftBacklogModal for the lighter-weight
// reuse there.
export function BuildOpsRefreshModal({
  project,
  close,
  commit,
}: {
  /** The Hard Backlog project being refreshed. */
  project: Project;
  close: () => void;
  commit: (project: Project) => void;
}) {
  const dialogRef = useDialogA11y<HTMLElement>(close);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<BuildOpsProjectEntry | null>(null);
  const [done, setDone] = useState(false);

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setError('');
  };

  const parseFile = async () => {
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      const text = await file.text();
      const records = parseBuildOpsCsv(text, DEPARTMENTS);
      const computed = computeBuildOpsProjectEntry(
        records,
        MONTH_KEYS,
        LABOR_CATEGORIES,
      );
      if (!computed) {
        setError(
          `This export has no positive forecast in the ${MONTH_KEYS[0]}–${MONTH_KEYS[MONTH_KEYS.length - 1]} window. ` +
            'Nothing to commit — the project would be removed under the pipeline’s own rules; do that from the data pipeline instead of here.',
        );
        return;
      }
      setEntry(computed);
      setStep(2);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The export could not be read.',
      );
    } finally {
      setParsing(false);
    }
  };

  const diffs = entry ? buildRefreshDiffs(project, entry) : [];
  const counts = entry ? buildRefreshCounts(diffs, entry, false) : [];

  const commitRefresh = () => {
    if (!entry) return;
    const refreshed = buildRefreshedProject(
      project,
      { id: project.id, name: project.name, department: project.department },
      entry,
    );
    commit(refreshed);
    setDone(true);
    setStep(3);
  };

  return (
    <div className="overlay">
      <section
        className="modal import-flow-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Refresh ${project.name} from BuildOps`}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>BUILDOPS HARD BACKLOG — UPLOAD, REVIEW, COMMIT</span>
            <h2>Refresh {project.name} from BuildOps</h2>
          </div>
          <button onClick={close}>
            <X /> Close
          </button>
        </header>
        <div className="import-step-rail-bar">
          <ImportStepRail step={step} />
          <span className="import-step-scope">{project.department}</span>
        </div>
        <div className="import-flow-body">
          {step === 1 && (
            <>
              {!file ? (
                <label className="import-dropzone">
                  <Upload />
                  <strong>Drop the file here, or choose it</strong>
                  <span>
                    BuildOps &ldquo;Project Forecasting&rdquo; export · exported
                    for {project.name} alone · .csv
                  </span>
                  <span className="import-choose-file">CHOOSE FILE</span>
                  <input type="file" accept=".csv" onChange={chooseFile} />
                </label>
              ) : (
                <div className="import-chosen-file">
                  <div>
                    <strong>{file.name}</strong>
                    <small>
                      {(file.size / 1024).toFixed(0)} KB · not yet parsed
                    </small>
                  </div>
                  <button onClick={() => setFile(null)}>
                    Choose a different file
                  </button>
                </div>
              )}
              <TrustContractCards
                canChange={[
                  'Contract value and cost mix for this project',
                  'Monthly labor hours, and the staffing curve derived from them',
                  'Labor allocation by category and primary labor for this project',
                ]}
                neverTouches={[
                  'Soft-backlog probabilities and any probability you have overridden',
                  'Capacity actions — hires, subcontracts, overtime',
                  'Proposed projects and saved plans',
                ]}
              />
              {error && (
                <div className="data-import-error" role="alert">
                  <strong>This export could not be parsed.</strong>
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
          {step === 2 && entry && (
            <>
              <CountTileStrip tiles={counts} />
              <h3 className="import-review-title">
                {diffs.filter((d) => d.changed).length} of {diffs.length || 6}{' '}
                fields changed
              </h3>
              <p className="info-note">
                Only fields whose value moved are highlighted. Unchanged fields
                stay listed in grey so the row set reads as complete.
              </p>
              <div className="import-diff-block">
                <strong>{project.name}</strong>
                <small>Hard backlog · awarded</small>
                {diffs.map((d) => (
                  <div
                    className={`import-diff-row${d.changed ? ' changed' : ''}`}
                    key={d.label}
                  >
                    <span>{d.label}</span>
                    <span className="from">{d.from}</span>
                    <span className="arrow">{d.changed ? '→' : '—'}</span>
                    <span className="to">{d.to}</span>
                  </div>
                ))}
              </div>
              {entry.unclassifiedPercent > 15 && (
                <div className="import-flag-box">
                  {entry.unclassifiedPercent.toFixed(1)}% of this project&apos;s
                  labor and subcontract $ could not be classified into a labor
                  category (permits, bonds, admin, or a scope this pass&apos;s
                  keyword rules don&apos;t recognize) and is excluded from labor
                  allocation above — review before relying on the labor-mix
                  figures.
                </div>
              )}
            </>
          )}
          {step === 3 && (
            <>
              {!done ? (
                <>
                  <h3 className="import-review-title">
                    What commit will write
                  </h3>
                  <p>
                    Commit replaces {project.name}&apos;s contract value,
                    staffing curve, cost mix, and labor allocation with the
                    figures above. Every current planning probability, capacity
                    action, and saved plan is left exactly as it is.
                  </p>
                  <p className="info-note">
                    This preview lives in the current browser session only —
                    reloading the page loses it, and it does not update the
                    published dataset. Download the updated data from the data
                    pipeline to make it durable.
                  </p>
                </>
              ) : (
                <>
                  <p className="import-receipt">
                    <span className="import-receipt-dot" />
                    Hard backlog refreshed from BuildOps
                  </p>
                  <p>
                    {file?.name} · committed to this session ·{' '}
                    {project.department}
                  </p>
                </>
              )}
            </>
          )}
        </div>
        <footer className="import-flow-footer">
          {step > 1 && !done && (
            <button onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
              BACK
            </button>
          )}
          {step === 1 && (
            <button
              className="primary"
              disabled={!file || parsing}
              onClick={parseFile}
            >
              {parsing ? 'PARSING…' : 'PARSE FILE'}
            </button>
          )}
          {step === 2 && (
            <button className="primary" onClick={() => setStep(3)}>
              REVIEW AND COMMIT
            </button>
          )}
          {step === 3 && !done && (
            <button className="primary" onClick={commitRefresh}>
              COMMIT UPDATE
            </button>
          )}
          {done && <button onClick={close}>DONE</button>}
        </footer>
      </section>
    </div>
  );
}
