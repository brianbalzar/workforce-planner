// Ports the BuildOps "Project Forecasting" CSV row-walk and aggregation math
// from the data pipeline repo (forecast-pipeline/parse_raw.py,
// update_project_from_buildops_export.py, labor_category_rules.py) so a
// single project's export can be parsed and previewed client-side, per
// BUILDOPS_HARD_BACKLOG_IMPORT_UI.md. Ported verbatim where the pipeline's
// docstrings call out an exact string/regex match against BuildOps' fixed
// export format — these are not estimates.
import type { LaborCategory } from '../domain/types';
import { ramp } from '../planning/engine';

export const UNMAPPED_CATEGORY = 'Unmapped (admin/overhead/other)';
export const SUBCONTRACTED_SCOPE =
  'Subcontracted scope (excluded from internal craft headcount)';

export const COST_TYPES = new Set([
  'labor',
  'material',
  'other',
  'overhead',
  'subcontractor',
  'equipment',
  'unspecified',
]);

// Same assumption layer as labor_category_rules.py's ASSUMED_HOURLY_RATE —
// a placeholder rate table (BuildOps Pricebook has real per-region rates
// that weren't pulled into this pass), used only to turn $ into an
// estimated FTE-months figure, not to price anything.
const ASSUMED_HOURLY_RATE: Record<string, number> = {
  'Project Manager': 65,
  'Project Engineer': 50,
  Superintendent: 55,
  Foreman: 45,
  Plumber: 38,
  Pipefitter: 40,
  'Sheet-Metal Worker': 38,
  Welder: 40,
  'HVAC Mechanic': 38,
  Electrician: 38,
  'Electrical Apprentice': 24,
  'Plumbing Apprentice': 24,
  'Controls Technician': 45,
  'BIM/VDC Specialist': 42,
  'Project Coordinator': 32,
  Painter: 32,
  [UNMAPPED_CATEGORY]: 35,
};

const STANDARD_WORKWEEK_HOURS = 40;
export const HOURS_PER_FTE_MONTH = (STANDARD_WORKWEEK_HOURS * 52) / 12; // ~173.33

const PLURAL: Record<string, string> = {
  Plumber: 'Plumbers',
  Pipefitter: 'Pipefitters',
  'Sheet-Metal Worker': 'Sheet-Metal Workers',
  'HVAC Mechanic': 'HVAC Mechanics',
  Electrician: 'Electricians',
  'Controls Technician': 'Controls Technicians',
  Painter: 'Painters',
  'Project Manager': 'Project Managers',
  'Project Engineer': 'Project Engineers',
  Superintendent: 'Superintendents',
  'BIM/VDC Specialist': 'BIM/VDC Specialists',
  'Project Coordinator': 'Project Coordinators',
  Foreman: 'Foremen',
  Welder: 'Welders',
  'Electrical Apprentice': 'Electrical Apprentices',
  'Plumbing Apprentice': 'Plumbing Apprentices',
  [SUBCONTRACTED_SCOPE]: 'Subcontracted crews',
};

// Some Greenwood-template projects carry a generic "Sub-Labor" /
// "Subcontractor" PHASE CODE alongside the craft-named ones. Dollars booked
// there are subcontracted scope by definition, regardless of which cost-type
// leaf row they sit under — route them to their own bucket rather than a
// craft category or the generic Unmapped bucket.
const SUBCONTRACT_PHASE_RE =
  /sub[\s-]*labor|\bsub[\s-]*contract(or|ed)?\b|general constructi/i;

// (regex, LaborCategory) — order matters, first match wins. Ported verbatim
// from labor_category_rules.py's _RULES.
const CLASSIFICATION_RULES: [RegExp, LaborCategory][] = [
  [/\bcontrols?\b|\bbas\b|thermostat|\bsensor\b/i, 'Controls Technician'],
  [
    /\bbim\b|\bvdc\b|shop drawing|spool drawing|\bdrawings?\b|detailing|coordination/i,
    'BIM/VDC Specialist',
  ],
  [/superintendent|sup'?t\b|non working sup/i, 'Superintendent'],
  [
    /project manager|project management|^pm$|\bpm\b - |purchasing|whse|warehouse/i,
    'Project Manager',
  ],
  [/engineering fee|\bengineer\b/i, 'Project Engineer'],
  [/clerical|project coordinator/i, 'Project Coordinator'],
  [/electric(al)? heater|\belectrical\b|\belectric\b/i, 'Electrician'],
  [
    /duct\w*|spiral|sheet\s*metal|sheetmetal|diffuser|louver|\bvav\b|fire\s*\/?\s*smoke damper|smoke damper|grille|grill\b|air distribution|curb|silencer|flex and diffuser|wall louvers/i,
    'Sheet-Metal Worker',
  ],
  [/\bpaint/i, 'Painter'],
  [
    /pipefit|process piping|hydronic|chilled\s*(&|and)?\s*heating water|\bchw\b|\bhhw\b|chilled water|condenser water|hot water|refrigerant pip|refrigeration pip|gas pip(e|ing)|gas flue|compressed air|medical gas|pumped condensate|condensate (pipe|drain)|test and flush|welded duct|insulat|firestop|fire\s*stop|fire protection|coring|core drill|\bsleeves?\b|pipe id|\bvalve tagging\b/i,
    'Pipefitter',
  ],
  [
    /\bhvac\b|air handler|\bahu\b|\brtu\b|furnace|heat pump|condensing unit|unit heater|chiller|plate exchanger|cooling tower|\bboiler\b|crac unit|roof top|rooftop|set equipment|ductless split|exhaust fan|supply fan|expansion tank|vibration isolation|fan coil|\bt\s*&\s*b\b|\bhoist(ing)?\b/i,
    'HVAC Mechanic',
  ],
  [
    /\bplumbing\b|sewer|\bdrain\b|drains?\/|plumbing fixture|water heater|domestic water|sanitary|storm|waste\b|below ground sewer|above ground sewer|excavat|bedding|backfill|compaction|mobilization|\bw\s*&\s*v\b|chlorination/i,
    'Plumber',
  ],
  [/test & balance|commissioning|start\s*up|startup/i, 'HVAC Mechanic'],
];

/** Assigns a BuildOps phase-code description to the LaborCategory that most
 * plausibly performs that scope of work. A phase code matching nothing falls
 * into UNMAPPED_CATEGORY rather than being forced into a craft category. */
export function classifyPhaseCode(phaseCode: string | null): string {
  if (!phaseCode) return UNMAPPED_CATEGORY;
  if (SUBCONTRACT_PHASE_RE.test(phaseCode)) return SUBCONTRACTED_SCOPE;
  for (const [rx, category] of CLASSIFICATION_RULES) {
    if (rx.test(phaseCode)) return category;
  }
  return UNMAPPED_CATEGORY;
}

const MONTH_ABBR: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function parseMoney(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '') return null;
  const cleaned = s.replace(/\$/g, '').replace(/,/g, '').replace(/%/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** "Aug '25 Actual" -> ["2025-08", "Actual"] */
function parseMonthHeader(
  header: string,
): [string, 'Actual' | 'Forecast'] | null {
  const match = /^([A-Za-z]{3}) '(\d{2}) (Actual|Forecast)$/.exec(
    header.trim(),
  );
  if (!match) return null;
  const [, mon, yy, kind] = match;
  const monthNum = MONTH_ABBR[mon];
  if (!monthNum) return null;
  const year = 2000 + Number(yy);
  return [`${year}-${monthNum}`, kind as 'Actual' | 'Forecast'];
}

const MONEY_COLS_FIXED_COUNT = 5; // Forecast Remaining, % Complete, Budget, Actual Cost, Estimate at Completion

/** Minimal RFC4180-ish CSV line splitter — quoted fields with embedded
 * commas/doubled quotes, which is as much as a plain .text() walk needs
 * here (no CSV package required per the handoff spec). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseCsvText(text: string): string[][] {
  // Strip a UTF-8 BOM if present (BuildOps exports carry one), and normalize
  // line endings before splitting.
  const stripped = text.replace(/^﻿/, '');
  return stripped
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0)
    .map(splitCsvLine);
}

export interface BuildOpsRecord {
  workPackage: string | null;
  phaseCode: string | null;
  costType: string;
  month: string;
  amountKind: 'Actual' | 'Forecast';
  amount: number;
}

/**
 * Walks a BuildOps "Project Forecasting" export's flat rows into one record
 * per (phase_code, cost_type, month, amount) — the same lookahead-based
 * hierarchy reconstruction as parse_raw.py's parse_file /
 * update_project_from_buildops_export.py's parse_csv_rows, decoupled from
 * their filename-based project lookup since the app already knows which
 * project it's refreshing.
 */
export function parseBuildOpsCsv(
  text: string,
  departments: string[],
): BuildOpsRecord[] {
  const rows = parseCsvText(text);
  if (!rows.length) return [];
  const header = rows[0];
  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''));

  const monthCols: [number, string, 'Actual' | 'Forecast'][] = [];
  header.forEach((h, idx) => {
    if (idx < MONEY_COLS_FIXED_COUNT + 1) return; // +1 for the Phase column
    const parsed = parseMonthHeader(h);
    if (parsed) monthCols.push([idx, parsed[0], parsed[1]]);
  });

  const departmentSet = new Set(departments);
  const records: BuildOpsRecord[] = [];
  let currentWorkPackage: string | null = null;
  let currentPhase: string | null = null;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const v = (row[0] ?? '').trim();
    if (v === '') continue; // Total footer row
    const next = (dataRows[i + 1]?.[0] ?? '').trim();

    if (departmentSet.has(v)) continue;

    if (COST_TYPES.has(v)) {
      // Exact-case match against the all-lowercase cost types is
      // deliberate — BuildOps also emits ALL-CAPS work-package group
      // headers like "LABOR"/"MATERIAL" that must NOT be treated as leaf
      // rows (see parse_raw.py's comment on this).
      const costType = v;
      for (const [colIdx, isoMonth, kind] of monthCols) {
        const amount = parseMoney(row[colIdx]);
        if (amount === null) continue;
        records.push({
          workPackage: currentWorkPackage,
          phaseCode: currentPhase,
          costType,
          month: isoMonth,
          amountKind: kind,
          amount,
        });
      }
      continue;
    }

    if (departmentSet.has(next)) {
      currentWorkPackage = v;
    } else {
      // Whether `next` is a cost-type leaf or something else with no
      // recognizable children, both cases treat `v` as a phase code — the
      // rarer "no recognizable children" case is the less common shape but
      // still more often a phase code than a work package.
      currentPhase = v;
    }
  }
  return records;
}

export interface BuildOpsProjectEntry {
  value: number;
  curve: number[];
  costMix: {
    material: number;
    internalLabor: number;
    subcontract: number;
    other: number;
  };
  laborAllocation: Partial<Record<LaborCategory, number>>;
  primaryLabor: string;
  /** Share of labor+subcontractor $ that fell into UNMAPPED or
   * SUBCONTRACTED_SCOPE rather than a craft category, 0-100. Surfaced in
   * the review step so a silent guess isn't trusted blindly. */
  unclassifiedPercent: number;
}

// Same forced-100%-sum convention as estimateParser.ts's percentages() —
// round each bucket to 0.1, then adjust the last one so they sum exactly.
function costMixPercentages(values: number[]): number[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0) return [0, 0, 0, 0];
  const rounded = values.map(
    (v) => Math.round((Math.max(0, v) / total) * 1000) / 10,
  );
  rounded[rounded.length - 1] =
    Math.round((100 - rounded.slice(0, -1).reduce((a, b) => a + b, 0)) * 10) /
    10;
  return rounded;
}

/**
 * Mirrors update_project_from_buildops_export.py's compute_project_entry:
 * aggregates one project's records into value/curve/costMix/laborAllocation,
 * reshaping the project's total window FTE across its own real active span
 * using this repo's own ramp() (the "Standard ramp / peak / taper" curve),
 * rather than re-deriving the shape. Returns null when the project has no
 * positive forecast in the window, matching the pipeline's own
 * omit-if-no-forecast rule.
 */
export function computeBuildOpsProjectEntry(
  records: BuildOpsRecord[],
  months: string[],
  categories: LaborCategory[],
): BuildOpsProjectEntry | null {
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const nMonths = months.length;

  const costTypeAllTime = new Map<string, number>();
  const laborByCategoryAllTime = new Map<string, number>();
  const fteByCategoryMonth = new Map<string, Map<string, number>>();
  const otherFteByMonth = new Map<string, number>();
  let unmappedOrSubDollars = 0;
  let classifiableDollars = 0;

  for (const r of records) {
    costTypeAllTime.set(
      r.costType,
      (costTypeAllTime.get(r.costType) ?? 0) + r.amount,
    );
    if (r.costType === 'labor' || r.costType === 'subcontractor') {
      classifiableDollars += r.amount;
      const category = classifyPhaseCode(r.phaseCode);
      if (category !== UNMAPPED_CATEGORY && category !== SUBCONTRACTED_SCOPE) {
        laborByCategoryAllTime.set(
          category,
          (laborByCategoryAllTime.get(category) ?? 0) + r.amount,
        );
        const rate = ASSUMED_HOURLY_RATE[category] ?? 35;
        const fte = r.amount ? r.amount / rate / HOURS_PER_FTE_MONTH : 0;
        if (!fteByCategoryMonth.has(category))
          fteByCategoryMonth.set(category, new Map());
        const byMonth = fteByCategoryMonth.get(category)!;
        byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + fte);
      } else {
        unmappedOrSubDollars += r.amount;
        const blended = ASSUMED_HOURLY_RATE[UNMAPPED_CATEGORY];
        const fte = r.amount ? r.amount / blended / HOURS_PER_FTE_MONTH : 0;
        otherFteByMonth.set(r.month, (otherFteByMonth.get(r.month) ?? 0) + fte);
      }
    }
  }

  const rawCurve = Array(nMonths).fill(0);
  fteByCategoryMonth.forEach((byMonth) => {
    byMonth.forEach((fte, month) => {
      const idx = monthIndex.get(month);
      if (idx !== undefined) rawCurve[idx] += fte;
    });
  });
  otherFteByMonth.forEach((fte, month) => {
    const idx = monthIndex.get(month);
    if (idx !== undefined) rawCurve[idx] += fte;
  });
  const totalWindowFte = rawCurve.reduce((s, v) => s + v, 0);
  if (totalWindowFte <= 0) return null;

  const activeMonths = new Set<string>();
  fteByCategoryMonth.forEach((byMonth) =>
    byMonth.forEach((fte, month) => {
      if (fte > 0) activeMonths.add(month);
    }),
  );
  otherFteByMonth.forEach((fte, month) => {
    if (fte > 0) activeMonths.add(month);
  });
  const forecastStart = months[0];
  const futureActive = [...activeMonths]
    .filter((m) => m >= forecastStart)
    .sort();
  const lastActive = futureActive[futureActive.length - 1];
  const span = lastActive
    ? Math.min(
        nMonths,
        Math.max(1, (monthIndex.get(lastActive) ?? nMonths - 1) + 1),
      )
    : 6;

  const shape = ramp(span);
  const shapeTotal = shape.reduce((s, v) => s + v, 0) || 1;
  const curve = shape.map(
    (s) => Math.round(totalWindowFte * (s / shapeTotal) * 1000) / 1000,
  );
  while (curve.length < nMonths) curve.push(0);
  if (!curve.some((v) => v > 0)) {
    let peakIndex = 0;
    shape.forEach((v, i) => {
      if (v > shape[peakIndex]) peakIndex = i;
    });
    curve[peakIndex] = Math.max(
      0.001,
      Math.round(totalWindowFte * 1000) / 1000,
    );
  }

  const totalValue = [...costTypeAllTime.values()].reduce((s, v) => s + v, 0);
  const material = costTypeAllTime.get('material') ?? 0;
  const labor = costTypeAllTime.get('labor') ?? 0;
  const subcontract = costTypeAllTime.get('subcontractor') ?? 0;
  const other =
    (costTypeAllTime.get('equipment') ?? 0) +
    (costTypeAllTime.get('overhead') ?? 0) +
    (costTypeAllTime.get('other') ?? 0) +
    (costTypeAllTime.get('unspecified') ?? 0);
  const [materialPct, laborPct, subPct, otherPct] = costMixPercentages([
    material,
    labor,
    subcontract,
    other,
  ]);

  const laborCats = [...laborByCategoryAllTime.entries()].filter(
    ([, v]) => v > 0,
  );
  const laborTotal = laborCats.reduce((s, [, v]) => s + v, 0);
  const laborAllocation: Partial<Record<LaborCategory, number>> = {};
  laborCats.forEach(([cat, v]) => {
    if (categories.includes(cat) && laborTotal > 0)
      laborAllocation[cat] = Math.round((v / laborTotal) * 1000) / 10;
  });
  const top = [...laborCats]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => cat);
  const primaryLabor = top.length
    ? top.map((cat) => PLURAL[cat] ?? cat).join(' and ')
    : 'Unclassified';

  return {
    value: Math.round((totalValue / 1_000_000) * 100) / 100,
    curve,
    costMix: {
      material: materialPct,
      internalLabor: laborPct,
      subcontract: subPct,
      other: otherPct,
    },
    laborAllocation,
    primaryLabor,
    unclassifiedPercent:
      classifiableDollars > 0
        ? Math.round((unmappedOrSubDollars / classifiableDollars) * 1000) / 10
        : 0,
  };
}
