// Shared primitives for the "upload -> review -> commit" pattern (design
// handoff §8) — used by BuildOpsRefreshModal in full, and reused in lighter
// form by AddProjectModal/SoftBacklogModal for the soft-backlog estimate
// import, which predates this shell and keeps its own richer edit form (see
// BuildOpsRefreshModal.tsx's file comment for why these weren't merged into
// one component).

export function ImportStepRail({
  step,
  labels = ['Source', 'Review', 'Commit'],
}: {
  step: 1 | 2 | 3;
  labels?: [string, string, string];
}) {
  return (
    <div className="import-step-rail">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n === step ? 'current' : n < step ? 'done' : 'future';
        return (
          <div className={`import-step import-step-${state}`} key={label}>
            <span className="import-step-num">{n}</span>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface CountTile {
  label: string;
  value: string | number;
  tone?: 'warning' | 'danger' | 'success' | 'info' | '';
}

export function CountTileStrip({ tiles }: { tiles: CountTile[] }) {
  return (
    <section className="metric-grid import-count-tiles">
      {tiles.map((tile) => (
        <article className="metric" key={tile.label}>
          <span>{tile.label}</span>
          <strong className={tile.tone ?? ''}>{tile.value}</strong>
        </article>
      ))}
    </section>
  );
}

export function TrustContractCards({
  canChange,
  neverTouches,
}: {
  canChange: string[];
  neverTouches: string[];
}) {
  return (
    <div className="trust-contract">
      <div className="trust-contract-card trust-can-change">
        <span>THIS FILE CAN CHANGE</span>
        <ul>
          {canChange.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="trust-contract-card trust-never-touches">
        <span>IT NEVER TOUCHES</span>
        <ul>
          {neverTouches.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
