import { describe, expect, it } from 'vitest';
import type { ProposedProjectArchetype } from '../domain/types';
import { comparableProjectCount, leadingTrades } from './archetypeMeta';

const BASE: ProposedProjectArchetype = {
  id: 'data-center',
  name: 'Data Center — Mechanical Package',
  projectType: 'Data Center',
  defaultDurationMonths: 10,
  staffingCurve: 'Standard ramp / peak / taper',
  costMix: { material: 44, internalLabor: 0.7, subcontract: 19.1, other: 36.1 },
  laborAllocation: {
    Pipefitter: 63.1,
    'BIM/VDC Specialist': 1.2,
    Superintendent: 3.0,
    'HVAC Mechanic': 3.2,
    'Sheet-Metal Worker': 3.4,
    Plumber: 18.6,
    'Project Coordinator': 1.9,
    'Project Manager': 5.6,
  },
  notes:
    'Averaged from 11 real Hard Backlog projects with current $ activity out of 23 historically classified as this type.',
};

describe('leadingTrades', () => {
  it('returns the top two categories by share, descending', () => {
    expect(leadingTrades(BASE)).toEqual([
      ['Pipefitter', 63.1],
      ['Plumber', 18.6],
    ]);
  });

  it('excludes zero-share categories and handles fewer than two present', () => {
    const single: ProposedProjectArchetype = {
      ...BASE,
      laborAllocation: { Plumber: 100, Pipefitter: 0 },
    };
    expect(leadingTrades(single)).toEqual([['Plumber', 100]]);
  });

  it('returns an empty list when nothing has a positive share', () => {
    expect(leadingTrades({ ...BASE, laborAllocation: {} })).toEqual([]);
  });
});

describe('comparableProjectCount', () => {
  it('parses the count out of the pipeline-authored notes phrasing', () => {
    expect(comparableProjectCount(BASE)).toBe(11);
  });

  it('is case-insensitive', () => {
    expect(
      comparableProjectCount({
        ...BASE,
        notes: 'AVERAGED FROM 7 REAL HARD BACKLOG PROJECTS out of 9.',
      }),
    ).toBe(7);
  });

  it('returns null rather than guessing when notes are missing or unrecognized', () => {
    expect(comparableProjectCount({ ...BASE, notes: undefined })).toBeNull();
    expect(
      comparableProjectCount({
        ...BASE,
        notes: 'A hand-authored placeholder.',
      }),
    ).toBeNull();
  });
});
