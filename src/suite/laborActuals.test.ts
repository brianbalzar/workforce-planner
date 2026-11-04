import { describe, expect, it } from 'vitest';
import { datasetId, sampleDataset, validateDataset } from './dataset';
import { clone, compute } from './engine';
import { laborHistory } from './laborActuals';
import type { ApprovedLaborRecord } from './types';

function fixture() {
  const d = sampleDataset();
  const row: ApprovedLaborRecord = {
    id: 'approved-row',
    weekStart: d.weeks[0].weekStart,
    dept: 'GW',
    job: d.projects.projects[0].id,
    sourceDepartment: 'Mechanical - Greenwood - Projects',
    laborType: null,
    trade: null,
    classification: 'unclassified',
    evidence: 'Approved source time entry; craft unknown',
    hours: { RT: 32, OT: 8, PR: 0, DT: 0, PTO: 4 },
    sourceRows: 2,
  };
  d.labor_actuals = {
    asOf: '2026-10-26',
    periodStart: d.weeks[0].weekStart,
    periodEnd: '2026-10-25',
    approvalStatus: 'APPROVED',
    source: 'Native timesheets',
    notes: [],
    records: [row],
  };
  return d;
}

describe('approved labor history with verified classifications only', () => {
  it('retains unresolved work hours and separates PTO without asserting zero work in missing weeks', () => {
    const d = validateDataset(fixture());
    const rows = laborHistory(d, ['GW'], ['PF']);
    expect(rows[0]).toMatchObject({
      total: 40,
      verified: 0,
      unclassified: 40,
      pto: 4,
      hasRecords: true,
    });
    expect(rows[1].hasRecords).toBe(false);
    expect(laborHistory(d, ['DFW'], ['PF']).every((r) => !r.hasRecords)).toBe(
      true,
    );
    expect(
      laborHistory(d, ['GW'], ['PF'], new Set(['another-job'])).every(
        (r) => !r.hasRecords,
      ),
    ).toBe(true);
  });

  it('filters verified categories while keeping unresolved hours visible', () => {
    const d = fixture();
    d.labor_actuals!.records.push({
      ...clone(d.labor_actuals!.records[0]),
      id: 'verified-row',
      trade: 'PL',
      laborType: 'Journeyman Plumber',
      classification: 'verified',
      hours: { RT: 10, OT: 0, PR: 0, DT: 0, PTO: 0 },
    });
    expect(laborHistory(d, ['GW'], ['PF'])[0].total).toBe(40);
    expect(laborHistory(d, ['GW'], ['PL'])[0]).toMatchObject({
      total: 50,
      verified: 10,
      unclassified: 40,
    });
  });

  it('never changes forecast demand, dispatch actuals or crew capacity', () => {
    const d = fixture(),
      withoutHistory = clone(d);
    delete withoutHistory.labor_actuals;
    expect(compute(d, d.scenarios[0].snap)).toEqual(
      compute(withoutHistory, withoutHistory.scenarios[0].snap),
    );
    expect(datasetId(d)).not.toBe(datasetId(withoutHistory));
  });

  it.each([
    'pending',
    'duplicate',
    'negative',
    'invented-category',
    'out-of-period',
    'invalid-date',
  ])('rejects %s source records', (problem) => {
    const d = fixture(),
      row = d.labor_actuals!.records[0];
    if (problem === 'pending')
      Object.assign(d.labor_actuals!, { approvalStatus: 'SUBMITTED' });
    if (problem === 'duplicate') d.labor_actuals!.records.push(clone(row));
    if (problem === 'negative') row.hours.OT = -1;
    if (problem === 'invented-category') row.trade = 'PF';
    if (problem === 'out-of-period')
      row.weekStart = d.reference.constants.WEEK0;
    if (problem === 'invalid-date') d.labor_actuals!.periodEnd = '2026-02-30';
    expect(() => validateDataset(d)).toThrow(/labor history/);
  });
});
