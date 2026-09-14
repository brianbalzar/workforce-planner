import { describe, expect, it } from 'vitest';
import { utils } from 'xlsx';
import {
  editSoftBacklogDraft,
  generateSoftBacklogForecast,
  parseEstimateWorkbook,
} from './estimateParser';

function estimateWorkbook() {
  const summary = utils.aoa_to_sheet([]);
  const set = (address: string, value: string | number) => {
    summary[address] = { t: typeof value === 'number' ? 'n' : 's', v: value };
  };
  set('A3', '26 SPG 051');
  set('C3', 'MDD 150');
  set('C4', 'Data Center Piping');
  set('C5', 'July 31, 2026');
  set('G5', 'Fort Stockton, TX');
  set('J1', 'September');
  set('J3', 3);
  set('C8', 5190.4);
  set('F82', 10_000_000);
  set('N14', 4_000_000);
  set('N16', 3_500_000);
  set('N19', 1_500_000);
  set('N22', 10_000_000);
  set('C20', 4000);
  set('C24', 500);
  set('C43', 1);
  set('D43', 3);
  summary['!ref'] = 'A1:N82';
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, summary, 'SUMMARY');
  return workbook;
}

describe('detailed estimate parser', () => {
  it('extracts reviewable Soft Backlog values from the Upchurch summary', () => {
    const draft = parseEstimateWorkbook(
      estimateWorkbook(),
      'estimate.xlsx',
      'Mechanical — Metro',
    );

    expect(draft.project).toMatchObject({
      id: '26 SPG 051',
      name: 'MDD 150',
      type: 'Soft',
      value: 10,
      location: 'Fort Stockton, TX',
      projectType: 'Data Center Piping',
      bidDate: 'July 31, 2026',
      planningProbability: 50,
    });
    expect(draft.project.costMix).toEqual({
      material: 40,
      internalLabor: 35,
      subcontract: 15,
      other: 10,
    });
    expect(draft.project.curve).toEqual(Array(18).fill(0));
    expect(draft.forecastSetup).toMatchObject({
      totalLaborHours: 5190,
      startMonth: '2026-09',
      endMonth: '2026-11',
      method: 'straight-line',
      generated: false,
    });
    expect(
      Object.values(draft.project.laborAllocation).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      ),
    ).toBeCloseTo(100);
    expect(draft.warnings.join(' ')).toMatch(/generate the monthly forecast/i);

    const generated = generateSoftBacklogForecast(draft);
    expect(generated.project.curve.slice(0, 3)).toEqual([10, 10, 10]);
    expect(generated.forecastSetup.generated).toBe(true);
  });

  it('generates a bell curve while preserving total FTE-months', () => {
    const draft = parseEstimateWorkbook(
      estimateWorkbook(),
      'estimate.xlsx',
      'Mechanical — Metro',
    );
    draft.forecastSetup = {
      ...draft.forecastSetup,
      totalLaborHours: 8650,
      endMonth: '2027-01',
      method: 'bell-curve',
    };

    const generated = generateSoftBacklogForecast(draft);
    const values = generated.project.curve.slice(0, 5);
    expect(values[2]).toBeGreaterThan(values[0]);
    expect(values[2]).toBeGreaterThan(values[4]);
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(50, 1);
  });

  it('reopens a saved Soft Backlog project with its forecast inputs', () => {
    const imported = parseEstimateWorkbook(
      estimateWorkbook(),
      'estimate.xlsx',
      'Mechanical — Metro',
    );
    const generated = generateSoftBacklogForecast(imported);
    const reopened = editSoftBacklogDraft(generated.project);

    expect(reopened.project.id).toBe('26 SPG 051');
    expect(reopened.forecastSetup).toEqual({
      totalLaborHours: 5190,
      startMonth: '2026-09',
      endMonth: '2026-11',
      method: 'straight-line',
      productiveHoursPerFteMonth: 173,
      generated: true,
    });
    expect(reopened.project.curve.slice(0, 3)).toEqual([10, 10, 10]);
  });

  it('preserves an older Soft Backlog curve basis until it is regenerated', () => {
    const imported = parseEstimateWorkbook(
      estimateWorkbook(),
      'estimate.xlsx',
      'Mechanical — Metro',
    );
    const legacyProject = {
      ...imported.project,
      curveBasis: undefined,
      softBacklogForecast: undefined,
      curve: [1, 2, 1, ...Array(15).fill(0)],
    };

    const reopened = editSoftBacklogDraft(legacyProject);
    expect(reopened.project.curveBasis).toBeUndefined();
    expect(reopened.warnings.join(' ')).toMatch(/reconstructed/i);

    const regenerated = generateSoftBacklogForecast(reopened);
    expect(regenerated.project.curveBasis).toBe('total-internal-labor');
  });

  it('rejects an unrelated workbook instead of guessing', () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Other']]), 'Data');

    expect(() =>
      parseEstimateWorkbook(workbook, 'other.xlsx', 'Mechanical — Metro'),
    ).toThrow(/SUMMARY sheet/i);
  });
});
