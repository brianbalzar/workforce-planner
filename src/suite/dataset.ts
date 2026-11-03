import raw from './data/sample.json';
import type {
  CapacityAction,
  ScenarioSnapshot,
  WorkforceSample,
} from './types';
import { clone } from './engine';

export function sampleDataset(): WorkforceSample {
  const d = clone(raw) as unknown as WorkforceSample;
  d.metadata = {
    id: 'artifact-sample-2026-11-03-v2',
    label: 'Demonstration dataset',
    sample: true,
    capacityKnown: true,
    notes: [
      'All customers, people, jobs and hours are fabricated.',
      'Roster-based capacity; no invented attrition drift or automatic temporary labor.',
      'Rates and hiring lead times are illustrative. No external feeds or AI service are connected.',
    ],
  };
  // Notes are not a second date source. Preserve narrative details, remove conflicting dates.
  for (const a of d.capacity_actions.fromSystems) {
    if (a.notes.startsWith('Req 26-117')) {
      a.actualStart = '2026-11-16';
      a.notes = 'Req 26-117';
    }
    if (a.notes.startsWith('Req 26-114')) {
      a.actualOffer = '2026-09-28';
      a.notes = 'Req 26-114';
    }
  }
  for (const s of d.scenarios)
    s.snap.service = {
      demand: 'expected',
      renewals: true,
      leveling: false,
      overrides: {},
    };
  return d;
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const safe = (v: unknown, depth = 0): boolean => {
  if (depth > 30) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (v === null || ['string', 'boolean', 'undefined'].includes(typeof v))
    return true;
  if (Array.isArray(v))
    return v.length < 50000 && v.every((x) => safe(x, depth + 1));
  return (
    object(v) &&
    Object.entries(v).every(
      ([k, x]) =>
        !['__proto__', 'constructor', 'prototype'].includes(k) &&
        safe(x, depth + 1),
    )
  );
};

export function validateSnapshot(
  value: unknown,
  d: WorkforceSample,
): ScenarioSnapshot {
  if (
    !object(value) ||
    !safe(value) ||
    !object(value.on) ||
    !object(value.prob) ||
    !object(value.manual) ||
    !object(value.review) ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.extra) ||
    !['off', 'weighted', 'all'].includes(String(value.softMode)) ||
    typeof value.includeProposed !== 'boolean'
  )
    throw new Error('This file does not contain a valid scenario.');
  if (
    !Object.values(value.on).every((v) => typeof v === 'boolean') ||
    !Object.values(value.prob).every(
      (v) => number(v) && Number(v) >= 0 && Number(v) <= 1,
    ) ||
    !Object.values(value.review).every((v) =>
      ['held', 'accepted'].includes(String(v)),
    ) ||
    !Object.values(value.manual).every(
      (v) =>
        Array.isArray(v) &&
        v.length === d.weeks.length &&
        v.every((n) => number(n) && n >= 0),
    )
  )
    throw new Error('Scenario inputs or weekly hours are invalid.');
  const dept = new Set(d.reference.departments.map((x) => x.k)),
    trade = new Set(d.reference.trades.map((x) => x.k));
  const ids = new Set(d.capacity_actions.fromSystems.map((a) => a.id));
  for (const a of value.actions as CapacityAction[]) {
    if (
      !object(a) ||
      typeof a.id !== 'string' ||
      ids.has(a.id) ||
      !dept.has(a.dk) ||
      !trade.has(a.tk) ||
      !['hire', 'subcontract', 'overtime', 'leave', 'attrition'].includes(
        a.kind,
      ) ||
      !d.reference.statuses.includes(a.status) ||
      ![a.qty, a.from, a.to, a.rate, a.cost].every(number) ||
      a.qty < 0 ||
      a.rate < 0 ||
      a.cost < 0 ||
      a.to < a.from ||
      a.from < -520 ||
      a.to > 1040 ||
      !object(a.lead) ||
      !Object.values(a.lead).every((n) => number(n) && n >= 0) ||
      typeof a.owner !== 'string' ||
      typeof a.notes !== 'string' ||
      [a.actualOffer, a.actualStart].some(
        (date) =>
          date !== undefined &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))),
      )
    )
      throw new Error(
        'Scenario contains an invalid or duplicate capacity action.',
      );
    ids.add(a.id);
  }
  const jobIds = new Set(
    d.projects.projects.filter((p) => !p.user).map((p) => p.id),
  );
  for (const p of value.extra) {
    if (
      !object(p) ||
      typeof p.id !== 'string' ||
      jobIds.has(p.id) ||
      !dept.has(p.dept as never) ||
      !object(
        d.reference.archetypes[p.arch as keyof typeof d.reference.archetypes],
      ) ||
      !['soft', 'proposed'].includes(String(p.kind)) ||
      typeof p.name !== 'string' ||
      ![p.value, p.start, p.prob].every(number) ||
      Number(p.value) < 0 ||
      Number(p.prob) < 0 ||
      Number(p.prob) > 1 ||
      (p.end !== undefined &&
        (!number(p.end) || Number(p.end) < Number(p.start))) ||
      (p.hours !== undefined && (!number(p.hours) || Number(p.hours) < 0)) ||
      (p.mix !== undefined &&
        (!object(p.mix) ||
          !Object.entries(p.mix).every(
            ([k, n]) => trade.has(k as never) && number(n) && Number(n) >= 0,
          ) ||
          Math.abs(
            Object.values(p.mix).reduce<number>((a, b) => a + Number(b), 0) - 1,
          ) > 0.01))
    )
      throw new Error('Scenario contains an invalid or duplicate project.');
    jobIds.add(p.id);
  }
  if (value.service !== undefined) {
    const sv = value.service;
    if (
      !object(sv) ||
      !['expected', 'high'].includes(String(sv.demand)) ||
      typeof sv.renewals !== 'boolean' ||
      typeof sv.leveling !== 'boolean' ||
      !object(sv.overrides)
    )
      throw new Error('Service settings are invalid.');
    for (const ov of Object.values(sv.overrides)) {
      if (
        !object(ov) ||
        (ov.basis !== undefined &&
          !['burn', 'budget', 'custom'].includes(
            typeof ov.basis === 'string' ? ov.basis : '',
          )) ||
        (ov.factor !== undefined &&
          (!number(ov.factor) ||
            Number(ov.factor) < 0 ||
            Number(ov.factor) > 5)) ||
        (ov.renewal !== undefined &&
          !['source', 'signed', 'expected', 'none'].includes(
            typeof ov.renewal === 'string' ? ov.renewal : '',
          )) ||
        (ov.probability !== undefined &&
          (!number(ov.probability) ||
            Number(ov.probability) < 0 ||
            Number(ov.probability) > 1)) ||
        (ov.moves !== undefined &&
          (!object(ov.moves) ||
            !Object.values(ov.moves).every(
              (n) =>
                Number.isInteger(n) &&
                Number(n) >= d.reference.constants.PAST &&
                Number(n) < d.weeks.length,
            )))
      )
        throw new Error('Service overrides are invalid.');
    }
  }
  return clone(value) as unknown as ScenarioSnapshot;
}

export function validateDataset(value: unknown): WorkforceSample {
  if (
    !object(value) ||
    !safe(value) ||
    !object(value.reference) ||
    !object(value.reference.constants) ||
    !Array.isArray(value.weeks) ||
    !object(value.projects) ||
    !Array.isArray(value.projects.projects) ||
    !Array.isArray(value.scenarios) ||
    !value.scenarios.length ||
    !object(value.crews) ||
    !object(value.crews.headcount) ||
    !object(value.capacity_actions) ||
    !Array.isArray(value.capacity_actions.fromSystems) ||
    !object(value.dispatch_actuals) ||
    !object(value.service) ||
    !Array.isArray(value.service.agreements) ||
    !Array.isArray(value.service.openJobs)
  )
    throw new Error(
      'Select the combined weekly workforce dataset. Monthly workforce-planner.json files open in the Monthly planner.',
    );
  const d = value as unknown as WorkforceSample,
    c = d.reference.constants;
  if (
    !Number.isInteger(c.PAST) ||
    c.PAST < 1 ||
    !Number.isInteger(c.FUT) ||
    c.FUT < 1 ||
    c.NW !== c.PAST + c.FUT ||
    c.NW !== d.weeks.length ||
    c.NW > 200 ||
    !(c.HPF > 0) ||
    !/^\d{4}-\d{2}-\d{2}/.test(c.WEEK0) ||
    Number.isNaN(Date.parse(c.WEEK0)) ||
    !Array.isArray(d.reference.departments) ||
    !Array.isArray(d.reference.trades) ||
    !d.reference.departments.length ||
    !d.reference.trades.length
  )
    throw new Error(
      'The dataset has an invalid weekly calendar or reference data.',
    );
  for (const [i, w] of d.weeks.entries())
    if (
      w.i !== i ||
      w.offset !== i - c.PAST ||
      !number(w.holidayFactor) ||
      w.holidayFactor <= 0 ||
      w.holidayFactor > 1 ||
      Date.parse(w.weekStart) !==
        Date.parse(c.WEEK0.slice(0, 10)) + w.offset * 604800000
    )
      throw new Error('Weekly dates must form a continuous Monday calendar.');
  const dept = new Set(d.reference.departments.map((x) => x.k)),
    trades = new Set(d.reference.trades.map((x) => x.k));
  if (
    dept.size !== d.reference.departments.length ||
    trades.size !== d.reference.trades.length
  )
    throw new Error('Duplicate department or trade identifiers.');
  for (const dk of dept)
    if (
      !d.crews.headcount[dk] ||
      !Object.values(d.crews.headcount[dk]).every((n) => number(n) && n >= 0)
    )
      throw new Error('Roster headcounts are invalid.');
  if (
    !dept.has('BAS') ||
    !dept.has('HLS') ||
    !trades.has('HS') ||
    !trades.has('PS') ||
    !object(d.reference.loadedRates) ||
    !object(d.reference.leadTimeDefaultsDays) ||
    !Array.isArray(d.reference.statuses) ||
    !Array.isArray(d.reference.confirmedStatuses) ||
    !Array.isArray(d.reference.actionKinds) ||
    !object(d.reference.archetypes)
  )
    throw new Error(
      'The shared reference tables or routing targets are missing.',
    );
  for (const tk of trades) {
    if (
      !number(d.reference.loadedRates[tk]) ||
      d.reference.loadedRates[tk] < 0 ||
      !object(d.reference.leadTimeDefaultsDays.hire?.[tk]) ||
      !object(d.reference.leadTimeDefaultsDays.subcontract?.[tk]) ||
      !object(d.reference.leadTimeDefaultsDays.overtime?.[tk])
    )
      throw new Error('A trade is missing its rate or hiring lead times.');
    for (const lead of [
      d.reference.leadTimeDefaultsDays.hire[tk],
      d.reference.leadTimeDefaultsDays.subcontract[tk],
      d.reference.leadTimeDefaultsDays.overtime[tk],
    ])
      if (!Object.values(lead).every((n) => number(n) && n >= 0))
        throw new Error('Lead times must be nonnegative calendar days.');
  }
  validateSnapshot(
    {
      on: {},
      prob: {},
      manual: {},
      review: {},
      extra: [],
      actions: d.capacity_actions.fromSystems,
      softMode: 'off',
      includeProposed: false,
    },
    { ...d, capacity_actions: { fromSystems: [], addedInPlan: [] } },
  );
  for (const [pid, actuals] of Object.entries(d.dispatch_actuals)) {
    if (
      !d.projects.projects.some((p) => p.id === pid) ||
      !object(actuals) ||
      !Object.entries(actuals).every(
        ([tk, ns]) =>
          trades.has(tk as never) &&
          Array.isArray(ns) &&
          ns.length === c.PAST &&
          ns.every((n) => number(n) && n >= 0),
      )
    )
      throw new Error(
        'Dispatch history must contain valid trade hours for every history week.',
      );
  }
  const ids = new Set<string>();
  for (const p of d.projects.projects) {
    if (
      !p ||
      ids.has(p.id) ||
      typeof p.id !== 'string' ||
      typeof p.name !== 'string' ||
      ![p.start, p.dur, p.value, p.prob, p.hours].every(number) ||
      p.dur <= 0 ||
      p.value < 0 ||
      p.prob < 0 ||
      p.prob > 1 ||
      p.hours < 0 ||
      !dept.has(p.dept) ||
      !['hard', 'soft', 'proposed'].includes(p.type) ||
      !object(p.plan) ||
      !Object.entries(p.plan).every(
        ([tk, ns]) =>
          trades.has(tk as never) &&
          Array.isArray(ns) &&
          ns.length === c.NW &&
          ns.every((n) => number(n) && n >= 0),
      )
    )
      throw new Error('A project has invalid or duplicate weekly hours.');
    ids.add(p.id);
  }
  for (const s of d.scenarios) validateSnapshot(s.snap, d);
  // Exercise nested feed records before accepting an upload; no raw HTML is rendered.
  for (const a of d.service.agreements)
    if (
      !a ||
      !['HS', 'PS'].includes(a.tk) ||
      !Array.isArray(a.visits) ||
      !a.visits.every(
        (v) =>
          number(v.bud) &&
          v.bud >= 0 &&
          number(v.due) &&
          (v.act === undefined || (number(v.act) && v.act >= 0)),
      )
    )
      throw new Error('A service agreement contains invalid visits.');
  const serviceIds = new Set<string>(),
    visitIds = new Set<string>();
  for (const a of d.service.agreements) {
    if (
      typeof a.id !== 'string' ||
      serviceIds.has(a.id) ||
      typeof a.name !== 'string' ||
      ![a.start, a.end].every(number) ||
      a.end < a.start ||
      !['complete', 'priority', 'standard'].includes(a.tier)
    )
      throw new Error(
        'A service agreement has invalid identity or term dates.',
      );
    serviceIds.add(a.id);
    if (
      a.ren &&
      (!number(a.ren.p) ||
        a.ren.p < 0 ||
        a.ren.p > 1 ||
        !number(a.ren.deadline))
    )
      throw new Error('A renewal has invalid confidence or action dates.');
    for (const v of a.visits) {
      if (
        typeof v.id !== 'string' ||
        visitIds.has(v.id) ||
        !['done', 'missing', 'sched', 'overdue', 'resched'].includes(
          v.status,
        ) ||
        !number(v.win) ||
        v.win < 0 ||
        (v.to !== undefined && !number(v.to))
      )
        throw new Error(
          'Service visits contain duplicate identities or invalid scheduling values.',
        );
      visitIds.add(v.id);
    }
  }
  if (
    !number(d.service.highDemandMultiplier) ||
    d.service.highDemandMultiplier < 1
  )
    throw new Error('The high-demand multiplier must be at least 1.');
  const openIds = new Set<string>();
  for (const j of d.service.openJobs) {
    if (
      typeof j.id !== 'string' ||
      openIds.has(j.id) ||
      !['HS', 'PS'].includes(j.tk) ||
      !Number.isInteger(j.wk) ||
      j.wk < 0 ||
      j.wk >= c.FUT ||
      !number(j.hrs) ||
      j.hrs < 0 ||
      typeof j.desc !== 'string'
    )
      throw new Error('An open service job has invalid hours or scheduling.');
    openIds.add(j.id);
  }
  for (const tk of ['HS', 'PS'] as const)
    if (
      !Array.isArray(d.service.callHistoryBaseHoursPerWeekByMonth?.[tk]) ||
      d.service.callHistoryBaseHoursPerWeekByMonth[tk].length !== 12 ||
      !d.service.callHistoryBaseHoursPerWeekByMonth[tk].every(
        (n) => number(n) && n >= 0,
      )
    )
      throw new Error('Service call history requires twelve monthly values.');
  return clone(d);
}

export interface SavedScenario {
  schemaVersion: 2;
  datasetId: string;
  id: string;
  name: string;
  savedAt: string;
  snapshot: ScenarioSnapshot;
}
const identities = new WeakMap<WorkforceSample, string>();
export function datasetId(d: WorkforceSample) {
  const cached = identities.get(d);
  if (cached) return cached;
  // A same-named source export with changed hours must not inherit another dataset's scenario.
  const text = JSON.stringify([
    d.reference,
    d.weeks,
    d.crews,
    d.projects,
    d.dispatch_actuals,
    d.capacity_actions,
    d.service,
  ]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  const id = `${d.schemaVersion}:${d.reference.constants.WEEK0}:${(hash >>> 0).toString(16)}`;
  identities.set(d, id);
  return id;
}
export const storageKey = (d: WorkforceSample) =>
  `wfp:suite:scenarios:v2:${datasetId(d)}`;
export function readScenarios(d: WorkforceSample): SavedScenario[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(storageKey(d)) ?? '[]',
    );
    if (!Array.isArray(saved)) return [];
    return saved.filter((s) => {
      try {
        return (
          s.schemaVersion === 2 &&
          s.datasetId === datasetId(d) &&
          typeof s.name === 'string' &&
          !!validateSnapshot(s.snapshot, d)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
export function importScenario(
  value: unknown,
  d: WorkforceSample,
): SavedScenario {
  if (
    !object(value) ||
    value.schemaVersion !== 2 ||
    value.datasetId !== datasetId(d) ||
    typeof value.name !== 'string' ||
    !value.name.trim()
  )
    throw new Error(
      'This scenario belongs to a different dataset or version. Open the matching dataset first.',
    );
  return {
    schemaVersion: 2,
    datasetId: datasetId(d),
    id: crypto.randomUUID(),
    name: value.name,
    savedAt: new Date().toISOString(),
    snapshot: validateSnapshot(value.snapshot, d),
  };
}
