import type { BuildOpsProjectEntry } from '../data/buildOpsImport';
import type { Project } from '../domain/types';
import type { CountTile } from './ImportFlowShell';

/** Builds the Project object a BuildOps refresh would write — matching the
 * data pipeline's own update_project_from_buildops_export.py new_project
 * shape exactly (no curveBasis: like every other published Hard Backlog
 * project, its curve is scaled by the portfolio's own categoryFactors, not
 * this project's own laborAllocation — laborAllocation/primaryLabor/costMix
 * here are informational, matching how every other Hard Backlog project
 * already works). */
export function buildRefreshedProject(
  existing: Project | null,
  meta: { id: string; name: string; department: string },
  entry: BuildOpsProjectEntry,
): Project {
  return {
    id: meta.id,
    name: meta.name,
    department: meta.department,
    type: 'Hard',
    value: entry.value,
    planningProbability: 100,
    sourceProbability: 100,
    startIndex: existing?.startIndex ?? 0,
    curve: entry.curve,
    method:
      'BuildOps Project Forecasting export (Actual + Forecast) — single-project refresh',
    quality: 'Current',
    primaryLabor: entry.primaryLabor,
    costMix: entry.costMix,
    laborAllocation: entry.laborAllocation,
    location: existing?.location,
    workweekHours: existing?.workweekHours,
  };
}

export interface FieldDiff {
  label: string;
  from: string;
  to: string;
  changed: boolean;
}

/** Only the fields a BuildOps refresh can ever touch (value/curve/cost
 * mix/labor allocation), per the refresh trust contract — never
 * probabilities, capacity actions, or saved plans. */
export function buildRefreshDiffs(
  existing: Project | null,
  entry: BuildOpsProjectEntry,
): FieldDiff[] {
  if (!existing) return [];
  const peakFrom = Math.max(0, ...existing.curve);
  const peakTo = Math.max(0, ...entry.curve);
  const diffs: FieldDiff[] = [
    {
      label: 'Contract value',
      from: `$${existing.value.toFixed(2)}M`,
      to: `$${entry.value.toFixed(2)}M`,
      changed: Math.abs(existing.value - entry.value) > 0.005,
    },
    {
      label: 'Peak labor',
      from: `${peakFrom.toFixed(1)} FTE`,
      to: `${peakTo.toFixed(1)} FTE`,
      changed: Math.abs(peakFrom - peakTo) > 0.05,
    },
    {
      label: 'Primary labor',
      from: existing.primaryLabor,
      to: entry.primaryLabor,
      changed: existing.primaryLabor !== entry.primaryLabor,
    },
    {
      label: 'Material share of cost',
      from: `${existing.costMix.material}%`,
      to: `${entry.costMix.material}%`,
      changed: existing.costMix.material !== entry.costMix.material,
    },
    {
      label: 'Internal labor share of cost',
      from: `${existing.costMix.internalLabor}%`,
      to: `${entry.costMix.internalLabor}%`,
      changed: existing.costMix.internalLabor !== entry.costMix.internalLabor,
    },
    {
      label: 'Subcontract share of cost',
      from: `${existing.costMix.subcontract}%`,
      to: `${entry.costMix.subcontract}%`,
      changed: existing.costMix.subcontract !== entry.costMix.subcontract,
    },
  ];
  return diffs;
}

/**
 * Every tile is derived from a list actually rendered on screen — never
 * hardcoded — per §8's explicit warning that a tile which can drift from its
 * own list is the one defect that discredits the whole review screen.
 */
export function buildRefreshCounts(
  diffs: FieldDiff[],
  entry: BuildOpsProjectEntry,
  isNew: boolean,
): CountTile[] {
  const changed = diffs.filter((d) => d.changed).length;
  const unchanged = diffs.filter((d) => !d.changed).length;
  const flagged = entry.unclassifiedPercent > 15 ? 1 : 0;
  return [
    {
      label: 'STATUS',
      value: isNew ? 'New' : 'Updated',
      tone: isNew ? 'info' : '',
    },
    { label: 'CHANGED', value: changed, tone: changed ? 'warning' : '' },
    { label: 'UNCHANGED', value: unchanged },
    {
      label: 'UNCLASSIFIED $',
      value: `${entry.unclassifiedPercent.toFixed(1)}%`,
      tone: flagged ? 'warning' : 'success',
    },
    {
      label: 'FLAGGED FOR REVIEW',
      value: flagged,
      tone: flagged ? 'warning' : 'success',
    },
  ];
}
