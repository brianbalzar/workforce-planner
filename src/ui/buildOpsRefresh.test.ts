import { describe, expect, it } from 'vitest';
import type { BuildOpsProjectEntry } from '../data/buildOpsImport';
import type { Project } from '../domain/types';
import {
  buildRefreshCounts,
  buildRefreshDiffs,
  buildRefreshedProject,
} from './buildOpsRefresh';

const ENTRY: BuildOpsProjectEntry = {
  value: 2.5,
  curve: [1, 2, 3, 0, 0],
  costMix: { material: 50, internalLabor: 30, subcontract: 15, other: 5 },
  laborAllocation: { Plumber: 60, Pipefitter: 40 },
  primaryLabor: 'Plumbers and Pipefitters',
  unclassifiedPercent: 4,
};

const EXISTING: Project = {
  id: '25-1207',
  name: 'Coca Cola SW Bev Fossil Creek',
  department: 'Mechanical - DFW - Projects',
  type: 'Hard',
  value: 2.32,
  planningProbability: 100,
  sourceProbability: 100,
  startIndex: 0,
  curve: [1, 1, 1, 0, 0],
  method: 'BuildOps Project Forecasting export (Actual + Forecast)',
  quality: 'Current',
  primaryLabor: 'Pipefitters and Plumbers',
  costMix: {
    material: 59.3,
    internalLabor: 0.7,
    subcontract: 14.7,
    other: 25.3,
  },
  laborAllocation: { Plumber: 4.1, Pipefitter: 95.3, Superintendent: 0.5 },
};

describe('buildRefreshedProject', () => {
  it('matches the pipeline single-project refresh shape — no curveBasis, 100% probabilities', () => {
    const project = buildRefreshedProject(
      EXISTING,
      { id: EXISTING.id, name: EXISTING.name, department: EXISTING.department },
      ENTRY,
    );
    expect(project.curveBasis).toBeUndefined();
    expect(project.planningProbability).toBe(100);
    expect(project.sourceProbability).toBe(100);
    expect(project.type).toBe('Hard');
    expect(project.value).toBe(ENTRY.value);
    expect(project.curve).toBe(ENTRY.curve);
    expect(project.laborAllocation).toBe(ENTRY.laborAllocation);
  });

  it('carries over location and startIndex from the existing project when present', () => {
    const withLocation = { ...EXISTING, location: 'Dallas, TX', startIndex: 3 };
    const project = buildRefreshedProject(
      withLocation,
      {
        id: withLocation.id,
        name: withLocation.name,
        department: withLocation.department,
      },
      ENTRY,
    );
    expect(project.location).toBe('Dallas, TX');
    expect(project.startIndex).toBe(3);
  });

  it('defaults startIndex to 0 for a brand-new project', () => {
    const project = buildRefreshedProject(
      null,
      {
        id: 'new-1',
        name: 'New Project',
        department: 'Mechanical - DFW - Projects',
      },
      ENTRY,
    );
    expect(project.startIndex).toBe(0);
    expect(project.location).toBeUndefined();
  });
});

describe('buildRefreshDiffs', () => {
  it('returns no diffs for a brand-new project (nothing to compare against)', () => {
    expect(buildRefreshDiffs(null, ENTRY)).toEqual([]);
  });

  it('flags exactly the fields that actually moved', () => {
    const diffs = buildRefreshDiffs(EXISTING, ENTRY);
    const changedLabels = diffs.filter((d) => d.changed).map((d) => d.label);
    expect(changedLabels).toEqual([
      'Contract value',
      'Peak labor',
      'Primary labor',
      'Material share of cost',
      'Internal labor share of cost',
      'Subcontract share of cost',
    ]);
  });

  it('marks a field unchanged when the new value matches within tolerance', () => {
    const sameEntry: BuildOpsProjectEntry = {
      ...ENTRY,
      value: EXISTING.value,
      curve: EXISTING.curve,
      primaryLabor: EXISTING.primaryLabor,
      costMix: EXISTING.costMix,
    };
    const diffs = buildRefreshDiffs(EXISTING, sameEntry);
    expect(diffs.every((d) => !d.changed)).toBe(true);
  });
});

describe('buildRefreshCounts', () => {
  it('derives every tile from the diff list and entry — CHANGED + UNCHANGED always equal the diff count', () => {
    const diffs = buildRefreshDiffs(EXISTING, ENTRY);
    const tiles = buildRefreshCounts(diffs, ENTRY, false);
    const changed = Number(tiles.find((t) => t.label === 'CHANGED')!.value);
    const unchanged = Number(tiles.find((t) => t.label === 'UNCHANGED')!.value);
    expect(changed + unchanged).toBe(diffs.length);
    expect(changed).toBe(diffs.filter((d) => d.changed).length);
  });

  it('flags for review when unclassified $ exceeds 15%, and reflects new-vs-updated status', () => {
    const highUnmapped: BuildOpsProjectEntry = {
      ...ENTRY,
      unclassifiedPercent: 22,
    };
    const tiles = buildRefreshCounts([], highUnmapped, true);
    expect(tiles.find((t) => t.label === 'STATUS')!.value).toBe('New');
    expect(tiles.find((t) => t.label === 'FLAGGED FOR REVIEW')!.value).toBe(1);
  });

  it('does not flag for review when unclassified $ is low', () => {
    const tiles = buildRefreshCounts([], ENTRY, false);
    expect(tiles.find((t) => t.label === 'FLAGGED FOR REVIEW')!.value).toBe(0);
    expect(tiles.find((t) => t.label === 'STATUS')!.value).toBe('Updated');
  });
});
