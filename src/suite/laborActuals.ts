import type {
  ApprovedLaborFile,
  DeptKey,
  TradeKey,
  WorkforceSample,
} from './types';

const hourTypes = ['RT', 'OT', 'PR', 'DT', 'PTO'] as const;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;

export function validateLaborActuals(value: unknown, d: WorkforceSample) {
  if (value === undefined) return;
  if (!object(value))
    throw new Error('Approved labor history must be a source feed.');
  const f = value as unknown as ApprovedLaborFile;
  if (
    !date(f.asOf) ||
    !date(f.periodStart) ||
    !date(f.periodEnd) ||
    f.periodEnd < f.periodStart ||
    f.asOf < f.periodEnd ||
    f.approvalStatus !== 'APPROVED' ||
    typeof f.source !== 'string' ||
    !f.source.trim() ||
    !Array.isArray(f.notes) ||
    !f.notes.every((n) => typeof n === 'string') ||
    !Array.isArray(f.records)
  )
    throw new Error(
      'Approved labor history has invalid source dates or approval status.',
    );
  const weeks = new Set(
    d.weeks.slice(0, d.reference.constants.PAST).map((w) => w.weekStart),
  );
  const depts = new Set(d.reference.departments.map((v) => v.k));
  const trades = new Set(d.reference.trades.map((v) => v.k));
  const ids = new Set<string>();
  for (const r of f.records) {
    if (
      !object(r) ||
      typeof r.id !== 'string' ||
      !r.id ||
      ids.has(r.id) ||
      !date(r.weekStart) ||
      !weeks.has(r.weekStart) ||
      r.weekStart < f.periodStart ||
      r.weekStart > f.periodEnd ||
      new Date(Date.parse(r.weekStart) + 6 * 86400000)
        .toISOString()
        .slice(0, 10) > f.periodEnd ||
      !depts.has(r.dept) ||
      typeof r.job !== 'string' ||
      typeof r.sourceDepartment !== 'string' ||
      typeof r.evidence !== 'string' ||
      !r.evidence.trim() ||
      !Number.isInteger(r.sourceRows) ||
      r.sourceRows < 1 ||
      !object(r.hours) ||
      !hourTypes.every(
        (k) =>
          typeof r.hours[k] === 'number' &&
          Number.isFinite(r.hours[k]) &&
          r.hours[k] >= 0,
      ) ||
      (r.classification === 'verified'
        ? !trades.has(r.trade as TradeKey) ||
          typeof r.laborType !== 'string' ||
          !r.laborType.trim()
        : r.classification !== 'unclassified' ||
          r.trade !== null ||
          r.laborType !== null)
    )
      throw new Error(
        'Approved labor history contains duplicate records, invalid hours or unsupported craft classifications.',
      );
    ids.add(r.id);
  }
}

export function laborHistory(
  d: WorkforceSample,
  depts: DeptKey[],
  trades: TradeKey[],
  jobs?: Set<string>,
) {
  const records = (d.labor_actuals?.records ?? []).filter(
    (r) =>
      depts.includes(r.dept) &&
      (!jobs || jobs.has(r.job)) &&
      (r.trade === null || trades.includes(r.trade)),
  );
  return d.weeks.slice(0, d.reference.constants.PAST).map((w) => {
    const selected = records.filter((r) => r.weekStart === w.weekStart);
    const work = (r: (typeof selected)[number]) =>
      r.hours.RT + r.hours.OT + r.hours.PR + r.hours.DT;
    const verified = selected
      .filter((r) => r.classification === 'verified')
      .reduce((n, r) => n + work(r), 0);
    const unclassified = selected
      .filter((r) => r.classification === 'unclassified')
      .reduce((n, r) => n + work(r), 0);
    return {
      weekStart: w.weekStart,
      hasRecords: selected.length > 0,
      verified,
      unclassified,
      total: verified + unclassified,
      pto: selected.reduce((n, r) => n + r.hours.PTO, 0),
      sourceRows: selected.reduce((n, r) => n + r.sourceRows, 0),
    };
  });
}
