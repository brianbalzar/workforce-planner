import { StrictMode, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { loadPlannerData, validatePlannerData } from './data/plannerDataLoader';
import { activatePlannerData } from './data/runtimeData';
import { resetPlans } from './persistence/planStore';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

function renderUnavailable(message: string, detail: string) {
  root.render(
    <main className="startup-error" role="alert">
      <h1>{message}</h1>
      <p>{detail}</p>
      <p>
        The previously published file can be restored without redeploying the
        app.
      </p>
      <button onClick={() => window.location.reload()}>TRY AGAIN</button>
    </main>,
  );
}

function renderApp() {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

function DataImportGate() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const data = validatePlannerData(JSON.parse(await file.text()));
      const asOf = new Date(data.source.hardBacklogAsOf);
      const ageDays = Math.floor((Date.now() - asOf.getTime()) / 86_400_000);
      activatePlannerData(data, {
        mode: 'uploaded',
        publishedAt: data.publishedAt,
        sourceRevision: data.publishedAt,
        hardBacklogAsOf: data.source.hardBacklogAsOf,
        stale: ageDays > 45,
      });
      renderApp();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The selected file could not be read.',
      );
      setLoading(false);
      event.target.value = '';
    }
  };

  return (
    <main className="data-import-gate">
      <section aria-labelledby="import-title">
        <span className="data-import-eyebrow">WORKFORCE PLANNER</span>
        <h1 id="import-title">Open your workforce dataset</h1>
        <p>
          Select the <strong>workforce-planner.json</strong> file produced by
          the data pipeline. It is validated and opened only in this browser
          session.
        </p>
        <label className="data-import-button">
          {loading ? 'OPENING DATA…' : 'SELECT DATA FILE'}
          <input
            type="file"
            accept=".json,application/json"
            disabled={loading}
            onChange={importFile}
          />
        </label>
        {error && (
          <div className="data-import-error" role="alert">
            <strong>This file could not be opened.</strong>
            <span>{error}</span>
          </div>
        )}
        <div className="data-import-privacy">
          <strong>Session-only by design</strong>
          <span>
            The dataset is not uploaded to GitHub or saved by the app. Closing
            or refreshing this page clears it, and you will select the file
            again next time.
          </span>
        </div>
      </section>
    </main>
  );
}

async function bootstrap() {
  if (import.meta.env.VITE_DATA_MODE === 'upload') {
    // The public/dataless build must never revive a workforce plan from an
    // earlier visit. Only the non-sensitive guided-tour preference remains.
    try {
      resetPlans();
    } catch {
      // Storage may be disabled by browser policy. Uploaded mode does not
      // otherwise read or write workforce-plan storage.
    }
    root.render(
      <StrictMode>
        <DataImportGate />
      </StrictMode>,
    );
    return;
  }
  const loaded = await loadPlannerData();
  if (!loaded.ok) {
    renderUnavailable(loaded.message, loaded.detail);
    return;
  }
  activatePlannerData(loaded.data, loaded.info);
  renderApp();
}

void bootstrap();
