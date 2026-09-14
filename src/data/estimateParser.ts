import type { WorkBook, WorkSheet } from 'xlsx';
import type { Project } from '../domain/types';
import { LABOR_CATEGORIES, MONTH_KEYS } from './runtimeData';

export interface SoftBacklogDraft {
  project: Project;
  sourceFileName?: string;
  extractedFields: string[];
  warnings: string[];
  forecastSetup: {
    totalLaborHours: number;
    startMonth: string;
    endMonth: string;
    method: 'straight-line' | 'bell-curve';
    productiveHoursPerFteMonth: number;
    generated: boolean;
  };
}

function inferredForecastSetup(project: Project) {
  const firstActive = project.curve.findIndex((value) => value > 0);
  const lastActive = project.curve.findLastIndex((value) => value > 0);
  const productiveHoursPerFteMonth = 173;
  return {
    totalLaborHours: Math.round(
      project.curve.reduce((sum, value) => sum + value, 0) *
        productiveHoursPerFteMonth,
    ),
    startMonth:
      MONTH_KEYS[firstActive >= 0 ? firstActive : project.startIndex] ??
      MONTH_KEYS[0],
    endMonth:
      MONTH_KEYS[lastActive >= 0 ? lastActive : project.startIndex] ??
      MONTH_KEYS[0],
    method: project.method.toLowerCase().includes('bell')
      ? ('bell-curve' as const)
      : ('straight-line' as const),
    productiveHoursPerFteMonth,
    generated: project.curve.some((value) => value > 0),
  };
}

export function editSoftBacklogDraft(project: Project): SoftBacklogDraft {
  return {
    project: structuredClone(project),
    sourceFileName: project.estimateFileName,
    extractedFields: [],
    warnings: project.softBacklogForecast
      ? []
      : [
          'Forecast setup was reconstructed from the saved monthly staffing curve. Review the labor hours and dates before regenerating it.',
        ],
    forecastSetup: structuredClone(
      project.softBacklogForecast ?? inferredForecastSetup(project),
    ),
  };
}

const blankAllocation = () =>
  Object.fromEntries(LABOR_CATEGORIES.map((category) => [category, 0]));

function text(sheet: WorkSheet, address: string) {
  const value = sheet[address]?.v;
  return value === undefined || value === null ? '' : String(value).trim();
}

function number(sheet: WorkSheet, address: string) {
  const value = sheet[address]?.v;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthKey(monthName: string, bidDate: string, afterKey?: string) {
  if (!monthName) return MONTH_KEYS[0];
  const parsedBid = new Date(bidDate);
  const baseYear = Number.isNaN(parsedBid.getTime())
    ? Number(MONTH_KEYS[0].slice(0, 4))
    : parsedBid.getFullYear();
  const month = new Date(`${monthName} 1, ${baseYear}`);
  if (Number.isNaN(month.getTime())) return MONTH_KEYS[0];
  const monthNumber = month.getMonth() + 1;
  let year = month.getFullYear();
  let key = `${year}-${String(monthNumber).padStart(2, '0')}`;
  if (afterKey && key < afterKey) {
    year += 1;
    key = `${year}-${String(monthNumber).padStart(2, '0')}`;
  }
  return key;
}

function monthIndex(key: string) {
  const [year, monthNumber] = key.split('-').map(Number);
  const [forecastYear, forecastMonth] = MONTH_KEYS[0].split('-').map(Number);
  return (year - forecastYear) * 12 + monthNumber - forecastMonth;
}

function inclusiveMonthCount(startKey: string, endKey: string) {
  const [startYear, startMonth] = startKey.split('-').map(Number);
  const [endYear, endMonth] = endKey.split('-').map(Number);
  return (endYear - startYear) * 12 + endMonth - startMonth + 1;
}

export function generateSoftBacklogForecast(
  draft: SoftBacklogDraft,
): SoftBacklogDraft {
  const setup = draft.forecastSetup;
  const duration = inclusiveMonthCount(setup.startMonth, setup.endMonth);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(setup.startMonth))
    throw new Error('Choose a valid forecast start month.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(setup.endMonth) || duration <= 0)
    throw new Error('Forecast end month must be on or after the start month.');
  if (setup.totalLaborHours <= 0)
    throw new Error('Total labor hours must be greater than zero.');
  if (setup.productiveHoursPerFteMonth <= 0)
    throw new Error(
      'Productive hours per FTE-month must be greater than zero.',
    );

  const weights = Array.from({ length: duration }, (_, index) =>
    setup.method === 'bell-curve'
      ? Math.sin((Math.PI * (index + 1)) / (duration + 1))
      : 1,
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const totalFteMonths =
    setup.totalLaborHours / setup.productiveHoursPerFteMonth;
  const startIndex = monthIndex(setup.startMonth);
  const curve = Array(MONTH_KEYS.length).fill(0) as number[];
  weights.forEach((weight, offset) => {
    const index = startIndex + offset;
    if (index >= 0 && index < curve.length)
      curve[index] =
        Math.round(((totalFteMonths * weight) / weightTotal) * 10) / 10;
  });
  const outsideMonths = weights.filter((_, offset) => {
    const index = startIndex + offset;
    return index < 0 || index >= curve.length;
  }).length;
  const warnings = draft.warnings.filter(
    (warning) =>
      !warning.startsWith('This estimate supplies total labor hours') &&
      !warning.startsWith('Productive labor hours were not found') &&
      !warning.startsWith('The forecast includes'),
  );
  if (outsideMonths)
    warnings.push(
      `The forecast includes ${outsideMonths} ${outsideMonths === 1 ? 'month' : 'months'} outside the current 18-month planning window. Those months are not shown or counted in this plan.`,
    );
  return {
    ...draft,
    warnings,
    forecastSetup: { ...setup, generated: true },
    project: {
      ...draft.project,
      startIndex: Math.max(0, startIndex),
      curve,
      curveBasis: 'total-internal-labor',
      softBacklogForecast: { ...setup, generated: true },
      method:
        setup.method === 'bell-curve'
          ? 'Estimate workbook — bell-curve labor hours'
          : 'Estimate workbook — straight-line labor hours',
    },
  };
}

function percentages(values: number[], warnings: string[]) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) {
    warnings.push('Cost mix was not found. Enter percentages totaling 100%.');
    return [0, 0, 0, 0];
  }
  const rounded = values.map(
    (value) => Math.round((Math.max(0, value) / total) * 1000) / 10,
  );
  rounded[rounded.length - 1] =
    Math.round((100 - rounded.slice(0, -1).reduce((a, b) => a + b, 0)) * 10) /
    10;
  return rounded;
}

function normalizeAllocation(raw: Record<string, number>, warnings: string[]) {
  const allocation = blankAllocation();
  let includedHours = 0;
  let excludedHours = 0;
  Object.entries(raw).forEach(([category, hours]) => {
    if (hours <= 0) return;
    if (LABOR_CATEGORIES.includes(category)) {
      allocation[category] = (allocation[category] ?? 0) + hours;
      includedHours += hours;
    } else if (LABOR_CATEGORIES.includes('Unmapped')) {
      allocation.Unmapped = (allocation.Unmapped ?? 0) + hours;
      includedHours += hours;
    } else {
      excludedHours += hours;
    }
  });
  if (excludedHours > 0)
    warnings.push(
      `${Math.round(excludedHours).toLocaleString()} estimate hours use labor categories that are not in this dataset and were excluded from the allocation.`,
    );
  if (includedHours <= 0) {
    warnings.push(
      'Labor-category hours were not found. Enter an allocation totaling 100%.',
    );
    return allocation;
  }
  const active = Object.entries(allocation).filter(([, hours]) => hours > 0);
  active.forEach(([category, hours]) => {
    allocation[category] = Math.round((hours / includedHours) * 1000) / 10;
  });
  const current = Object.values(allocation).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (active.length)
    allocation[active[0][0]] += Math.round((100 - current) * 10) / 10;
  return allocation;
}

export function blankSoftBacklogDraft(department: string): SoftBacklogDraft {
  return {
    project: {
      id: '',
      name: '',
      department,
      type: 'Soft',
      value: 0,
      planningProbability: 50,
      sourceProbability: 50,
      startIndex: 0,
      curve: Array(MONTH_KEYS.length).fill(0),
      curveBasis: 'total-internal-labor',
      method: 'Manual monthly forecast',
      quality: 'Review — manually entered',
      primaryLabor: '',
      costMix: { material: 0, internalLabor: 0, subcontract: 0, other: 0 },
      laborAllocation: blankAllocation(),
      softBacklogForecast: {
        totalLaborHours: 0,
        startMonth: MONTH_KEYS[0],
        endMonth: MONTH_KEYS[0],
        method: 'straight-line',
        productiveHoursPerFteMonth: 173,
        generated: false,
      },
    },
    extractedFields: [],
    warnings: [],
    forecastSetup: {
      totalLaborHours: 0,
      startMonth: MONTH_KEYS[0],
      endMonth: MONTH_KEYS[0],
      method: 'straight-line',
      productiveHoursPerFteMonth: 173,
      generated: false,
    },
  };
}

export function parseEstimateWorkbook(
  workbook: WorkBook,
  fileName: string,
  department: string,
): SoftBacklogDraft {
  const summaryName = workbook.SheetNames.find(
    (name) => name.trim().toUpperCase() === 'SUMMARY',
  );
  if (!summaryName)
    throw new Error(
      'No SUMMARY sheet was found. This importer currently supports the Upchurch Accubid/Trimble estimate workbook.',
    );
  const sheet = workbook.Sheets[summaryName];
  const warnings: string[] = [];
  const extractedFields: string[] = [];
  const readText = (address: string, label: string) => {
    const value = text(sheet, address);
    if (value) extractedFields.push(label);
    return value;
  };
  const readNumber = (address: string, label: string) => {
    const value = number(sheet, address);
    if (value) extractedFields.push(label);
    return value;
  };

  const id = readText('A3', 'Bid number');
  const name = readText('C3', 'Project name');
  const projectType = readText('C4', 'Project type');
  const bidDate = readText('C5', 'Bid date');
  const location = readText('G5', 'Location');
  const statedDurationMonths = Math.max(
    1,
    Math.round(readNumber('J3', 'Duration') || 1),
  );
  const startMonth = monthKey(readText('J1', 'Start month'), bidDate);
  const finishName = readText('J2', 'Finish month');
  let endMonth = finishName
    ? monthKey(finishName, bidDate, startMonth)
    : startMonth;
  if (!finishName && statedDurationMonths > 1) {
    const [year, month] = startMonth.split('-').map(Number);
    const end = new Date(year, month - 1 + statedDurationMonths - 1, 1);
    endMonth = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`;
  }
  const startIndex = monthIndex(startMonth);
  const totalHours = readNumber('C8', 'Productive labor hours');
  const value =
    readNumber('F82', 'Bid amount') || readNumber('N22', 'Bid amount');
  const curve = Array(MONTH_KEYS.length).fill(0) as number[];
  if (totalHours > 0)
    warnings.push(
      'This estimate supplies total labor hours but not monthly staffing. Confirm the end month and method, then generate the monthly forecast.',
    );
  else
    warnings.push(
      'Productive labor hours were not found. Enter the monthly staffing forecast before adding this project.',
    );

  const material = number(sheet, 'N14');
  const internalLabor = number(sheet, 'N16');
  const subcontract = number(sheet, 'N19');
  const pricingTotal = number(sheet, 'N22');
  const other = Math.max(
    0,
    pricingTotal - material - internalLabor - subcontract,
  );
  const [materialPct, internalLaborPct, subcontractPct, otherPct] = percentages(
    [material, internalLabor, subcontract, other],
    warnings,
  );
  if (pricingTotal > 0) extractedFields.push('Cost mix');

  const managementHours = (countCell: string, durationCell: string) =>
    number(sheet, countCell) * number(sheet, durationCell) * 173;
  const allocation = normalizeAllocation(
    {
      Plumber: number(sheet, 'C19'),
      Pipefitter: number(sheet, 'C20'),
      'Sheet-Metal Worker': number(sheet, 'C21'),
      'Material Handler': number(sheet, 'C24'),
      'Project Manager': managementHours('C43', 'D43'),
      Superintendent: managementHours('C44', 'D44'),
      'Project Coordinator': managementHours('C45', 'D45'),
      'Project Engineer': managementHours('C47', 'D47'),
      Foreman: managementHours('C48', 'D48'),
      Unmapped: managementHours('C49', 'D49') + number(sheet, 'C26'),
    },
    warnings,
  );
  if (Object.values(allocation).some((amount) => amount > 0))
    extractedFields.push('Labor allocation');
  const primaryLabor =
    Object.entries(allocation).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  if (!id) warnings.push('Bid or project number was not found.');
  if (!name) warnings.push('Project name was not found.');
  if (!value) warnings.push('Bid amount was not found.');

  return {
    sourceFileName: fileName,
    extractedFields: [...new Set(extractedFields)],
    warnings,
    forecastSetup: {
      totalLaborHours: Math.round(totalHours),
      startMonth,
      endMonth,
      method: 'straight-line',
      productiveHoursPerFteMonth: 173,
      generated: false,
    },
    project: {
      id,
      name,
      department,
      projectType,
      bidDate,
      estimateFileName: fileName,
      type: 'Soft',
      value: Math.round((value / 1_000_000) * 100) / 100,
      planningProbability: 50,
      sourceProbability: 50,
      startIndex: Math.max(0, startIndex),
      curve,
      curveBasis: 'total-internal-labor',
      method: 'Estimate workbook — forecast not generated',
      quality: 'Review — imported estimate',
      primaryLabor,
      costMix: {
        material: materialPct,
        internalLabor: internalLaborPct,
        subcontract: subcontractPct,
        other: otherPct,
      },
      laborAllocation: allocation,
      softBacklogForecast: {
        totalLaborHours: Math.round(totalHours),
        startMonth,
        endMonth,
        method: 'straight-line',
        productiveHoursPerFteMonth: 173,
        generated: false,
      },
      location,
    },
  };
}

export async function parseEstimateFile(file: File, department: string) {
  if (file.size > 50 * 1024 * 1024)
    throw new Error('The estimate is larger than the 50 MB import limit.');
  const { read } = await import('xlsx');
  const workbook = read(await file.arrayBuffer(), {
    type: 'array',
    cellDates: true,
    cellFormula: true,
  });
  const draft = parseEstimateWorkbook(workbook, file.name, department);
  if (file.lastModified)
    draft.project.lastRevisionDate = new Date(file.lastModified)
      .toISOString()
      .slice(0, 10);
  return draft;
}
