import { describe, expect, it } from 'vitest';
import {
  classifyPhaseCode,
  computeBuildOpsProjectEntry,
  parseBuildOpsCsv,
  SUBCONTRACTED_SCOPE,
  UNMAPPED_CATEGORY,
  type BuildOpsRecord,
} from './buildOpsImport';

const DEPARTMENTS = [
  'Mechanical - DFW - Projects',
  'Mechanical - Florida - Special Projects',
];
const MONTHS = ['2026-09', '2026-10'];
const CATEGORIES = [
  'Plumber',
  'Pipefitter',
  'Superintendent',
  'Sheet-Metal Worker',
];

describe('classifyPhaseCode', () => {
  it('matches craft keywords case-insensitively', () => {
    expect(classifyPhaseCode('3514 - Plumbing')).toBe('Plumber');
    expect(classifyPhaseCode('2000 - HVAC All Cost')).toBe('HVAC Mechanic');
    expect(classifyPhaseCode('Duct Fabrication')).toBe('Sheet-Metal Worker');
    expect(classifyPhaseCode('PIPEFITTING')).toBe('Pipefitter');
  });

  it('routes generic subcontract phase codes to SUBCONTRACTED_SCOPE ahead of craft rules', () => {
    expect(classifyPhaseCode('15018 - Sub-Labor')).toBe(SUBCONTRACTED_SCOPE);
    expect(classifyPhaseCode('Sub-Contractor')).toBe(SUBCONTRACTED_SCOPE);
    // Truncated BuildOps export field, not a typo.
    expect(classifyPhaseCode('3511 - General Constructi')).toBe(
      SUBCONTRACTED_SCOPE,
    );
  });

  it('falls back to UNMAPPED for phase codes matching nothing, and for empty input', () => {
    expect(classifyPhaseCode('9999 - Permits and Bonds')).toBe(
      UNMAPPED_CATEGORY,
    );
    expect(classifyPhaseCode(null)).toBe(UNMAPPED_CATEGORY);
  });

  it('evaluates rules in order — first match wins', () => {
    // "engineering fee" would also loosely relate to project management, but
    // the Project Engineer rule is checked before anything more permissive.
    expect(classifyPhaseCode('Engineering Fee')).toBe('Project Engineer');
  });
});

function csvLine(...cells: string[]): string {
  return cells.join(',');
}

const SAMPLE_CSV = [
  csvLine(
    'Phase',
    'Forecast Remaining',
    '% Complete',
    'Budget',
    'Actual Cost',
    'Estimate at Completion',
    "Sep '26 Actual",
    "Oct '26 Forecast",
  ),
  csvLine('Plumbing Fixtures'),
  csvLine('Mechanical - DFW - Projects'),
  csvLine('3514 - Plumbing'),
  csvLine('labor', '', '', '', '', '', '1000', '2000'),
  csvLine('subcontractor', '', '', '', '', '', '500', '0'),
  csvLine('3511 - General Constructi'),
  csvLine('subcontractor', '', '', '', '', '', '300', '300'),
  csvLine(''),
].join('\n');

describe('parseBuildOpsCsv', () => {
  it('walks the work-package/department/phase-code/cost-type hierarchy by lookahead', () => {
    const records = parseBuildOpsCsv(SAMPLE_CSV, DEPARTMENTS);
    // 2 leaf rows × 2 non-blank month cells = 4 records for the plumbing
    // phase (the Oct "0" subcontractor cell still parses to a real record —
    // parseMoney("0") is 0, not null), plus 2 for the sub-scope phase.
    expect(records).toHaveLength(6);
    expect(records[0]).toEqual({
      workPackage: 'Plumbing Fixtures',
      phaseCode: '3514 - Plumbing',
      costType: 'labor',
      month: '2026-09',
      amountKind: 'Actual',
      amount: 1000,
    });
    expect(records[1]).toMatchObject({ month: '2026-10', amount: 2000 });
    expect(
      records.filter((r) => r.phaseCode === '3511 - General Constructi'),
    ).toHaveLength(2);
  });

  it('skips department rows and the blank Total footer row', () => {
    const records = parseBuildOpsCsv(SAMPLE_CSV, DEPARTMENTS);
    expect(records.every((r) => !DEPARTMENTS.includes(r.phaseCode ?? ''))).toBe(
      true,
    );
  });

  it('treats an ALL-CAPS group header as a phase code, not a cost-type leaf', () => {
    const csv = [
      csvLine(
        'Phase',
        'Forecast Remaining',
        '% Complete',
        'Budget',
        'Actual Cost',
        'Estimate at Completion',
        "Sep '26 Actual",
      ),
      csvLine('Work Package'),
      csvLine('Mechanical - DFW - Projects'),
      csvLine('LABOR'), // group header, not a leaf row — exact-case matters
      csvLine('labor', '', '', '', '', '', '1000'),
    ].join('\n');
    const records = parseBuildOpsCsv(csv, DEPARTMENTS);
    expect(records).toHaveLength(1);
    expect(records[0].phaseCode).toBe('LABOR');
  });
});

describe('computeBuildOpsProjectEntry', () => {
  it('returns null when there is no positive forecast in the window', () => {
    expect(computeBuildOpsProjectEntry([], MONTHS, CATEGORIES)).toBeNull();
  });

  it('forces cost-mix percentages to sum to exactly 100', () => {
    const records = parseBuildOpsCsv(SAMPLE_CSV, DEPARTMENTS);
    const entry = computeBuildOpsProjectEntry(records, MONTHS, CATEGORIES)!;
    const sum =
      entry.costMix.material +
      entry.costMix.internalLabor +
      entry.costMix.subcontract +
      entry.costMix.other;
    expect(sum).toBeCloseTo(100, 5);
  });

  it('excludes subcontracted-scope $ from craft laborAllocation but counts it as unclassified', () => {
    const records = parseBuildOpsCsv(SAMPLE_CSV, DEPARTMENTS);
    const entry = computeBuildOpsProjectEntry(records, MONTHS, CATEGORIES)!;
    expect(Object.keys(entry.laborAllocation)).toEqual(['Plumber']);
    expect(entry.laborAllocation.Plumber).toBeCloseTo(100, 5);
    // 600 of the 1500 classifiable (labor+subcontractor) $ is subcontracted
    // scope: 600 / (1000 + 2000 + 500 + 0 + 300 + 300) = 600 / 4100.
    expect(entry.unclassifiedPercent).toBeCloseTo((600 / 4100) * 100, 1);
  });

  it('names primaryLabor from the top two categories, pluralized and joined', () => {
    const records: BuildOpsRecord[] = [
      {
        workPackage: null,
        phaseCode: '3514 - Plumbing',
        costType: 'labor',
        month: '2026-09',
        amountKind: 'Actual',
        amount: 3000,
      },
      {
        workPackage: null,
        phaseCode: 'Pipefitting',
        costType: 'labor',
        month: '2026-09',
        amountKind: 'Actual',
        amount: 2000,
      },
      {
        workPackage: null,
        phaseCode: 'Superintendent',
        costType: 'labor',
        month: '2026-09',
        amountKind: 'Actual',
        amount: 500,
      },
    ];
    const entry = computeBuildOpsProjectEntry(records, MONTHS, CATEGORIES)!;
    expect(entry.primaryLabor).toBe('Plumbers and Pipefitters');
  });

  it('reshapes the total window FTE across the ramp curve, preserving the total', () => {
    const records: BuildOpsRecord[] = [
      {
        workPackage: null,
        phaseCode: '3514 - Plumbing',
        costType: 'labor',
        month: '2026-09',
        amountKind: 'Actual',
        amount: 38 * 173.33, // ~1 FTE-month at the assumed Plumber rate
      },
    ];
    const entry = computeBuildOpsProjectEntry(
      records,
      ['2026-09', '2026-10', '2026-11'],
      CATEGORIES,
    )!;
    const total = entry.curve.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(entry.curve).toHaveLength(3);
  });
});
