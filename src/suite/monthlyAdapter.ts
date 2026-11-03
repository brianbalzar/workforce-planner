import type {
  PlannerData,
  Project as MonthlyProject,
  WorkforcePlan,
} from '../domain/types';
import type { ByTrade, DeptKey, TradeKey, WorkforceSample } from './types';
import { clone, makeAction, sum } from './engine';
import { sampleDataset } from './dataset';

const categoryKeys: Record<string, TradeKey> = {
  Pipefitter: 'PF',
  Pipefitters: 'PF',
  Plumber: 'PL',
  Plumbers: 'PL',
  'Sheet-Metal Worker': 'SM',
  'Sheet Metal': 'SM',
  Electrician: 'EL',
  Electricians: 'EL',
  'Controls Technician': 'CT',
  'Controls Techs': 'CT',
  'BAS Programmer': 'PG',
  Welder: 'WE',
  Welders: 'WE',
  Foreman: 'FM',
  Foremen: 'FM',
  'HVAC Service Tech': 'HS',
  'Plumbing Service Tech': 'PS',
};
const monday = (date: string) => {
  const x = new Date(date.slice(0, 10));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const day = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const monthDays = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Monthly source totals are apportioned by calendar overlap, never presented as observed weekly peaks. */
export function spreadMonthHours(
  months: string[],
  hours: number[],
  weekStart: string,
) {
  let value = 0;
  for (let n = 0; n < 7; n++) {
    const key = day(weekStart, n).slice(0, 7),
      i = months.indexOf(key);
    if (i >= 0) value += (hours[i] ?? 0) / monthDays(key);
  }
  return value;
}

export function adaptMonthly(source: PlannerData): WorkforceSample {
  const d = sampleDataset(),
    week0 = monday(source.source.hardBacklogAsOf);
  const constants = d.reference.constants;
  constants.WEEK0 = week0;
  d.weeks = Array.from({ length: constants.NW }, (_, i) => ({
    i,
    offset: i - constants.PAST,
    weekStart: day(week0, (i - constants.PAST) * 7),
    holidayFactor: 1,
    holiday: null,
  }));
  const deptMap = new Map<string, DeptKey>();
  const used = new Set<string>();
  for (const [i, name] of source.departments.entries()) {
    const match = /greenwood/i.test(name)
      ? 'GW'
      : /national/i.test(name)
        ? 'NAT'
        : /dfw|dallas/i.test(name)
          ? 'DFW'
          : /florida/i.test(name)
            ? 'FL'
            : /automation|building systems/i.test(name)
              ? 'BAS'
              : /horn lake.*service/i.test(name)
                ? 'HLS'
                : `DEPT${i}`;
    const key = (used.has(match) ? `DEPT${i}` : match) as DeptKey;
    used.add(key);
    deptMap.set(name, key);
  }
  const categories = new Map<string, TradeKey>();
  source.laborCategories.forEach((name, i) => {
    const key = categoryKeys[name] ?? (`TRADE${i}` as TradeKey);
    categories.set(name, key);
    if (!d.reference.trades.some((t) => t.k === key)) {
      d.reference.trades.push({ k: key, name, one: name });
      d.reference.loadedRates[key] = 50;
      d.reference.leadTimeDefaultsDays.hire[key] = clone(
        d.reference.leadTimeDefaultsDays.hire.PF,
      );
      d.reference.leadTimeDefaultsDays.subcontract[key] = clone(
        d.reference.leadTimeDefaultsDays.subcontract.PF,
      );
      d.reference.leadTimeDefaultsDays.overtime[key] = { notice: 7 };
    }
  });
  d.reference.departments = source.departments.map((name) => ({
    k: deptMap.get(name)!,
    name,
    group: /service/i.test(name)
      ? ('Service' as const)
      : /automation|building systems/i.test(name)
        ? ('Performance Assurance' as const)
        : ('Mechanical' as const),
  }));
  // Keep empty routing targets so imported mechanical controls never become lost hours.
  for (const [key, name, group] of [
    ['BAS', 'Building Automation', 'Performance Assurance'],
    ['HLS', 'Service — no feed provided', 'Service'],
  ] as const)
    if (!used.has(key)) d.reference.departments.push({ k: key, name, group });
  d.reference.linesOfBusiness = (
    ['Mechanical', 'Performance Assurance', 'Service'] as const
  ).map((name) => ({
    name,
    depts: d.reference.departments
      .filter((v) => v.group === name)
      .map((v) => v.k),
  }));
  d.crews.headcount = {} as WorkforceSample['crews']['headcount'];
  d.crews.capacityBase = {} as WorkforceSample['crews']['capacityBase'];
  d.capacity_actions = { fromSystems: [], addedInPlan: [] };
  d.dispatch_actuals = {};
  d.service.agreements = [];
  d.service.openJobs = [];
  d.service.techs = { HS: [], PS: [] };
  d.service.callHistoryBaseHoursPerWeekByMonth = {
    HS: Array(12).fill(0),
    PS: Array(12).fill(0),
  };
  d.service.callbacksLast90Days = { visits: 0, hrs: 0, rate: 0 };
  const planFor = (name: string) =>
    source.initialPlans.find((p) => p.department === name);
  let known = false;
  for (const dept of d.reference.departments) {
    d.crews.headcount[dept.k] = {};
    d.crews.capacityBase[dept.k] = {};
    d.reference.deptManagers[dept.k] = 'Department manager';
    const plan = planFor(dept.name);
    for (const [name, tk] of categories) {
      const cap = plan?.config.capacity[name];
      if (cap) {
        d.crews.headcount[dept.k][tk] =
          (d.crews.headcount[dept.k][tk] ?? 0) + cap.headcount;
        d.reference.loadedRates[tk] = cap.hourlyRate;
        known = true;
      }
    }
  }
  const projectFor = (p: MonthlyProject) => {
    const plan: ByTrade<number[]> = {},
      monthlyByTrade: ByTrade<number[]> = {};
    const cfg = planFor(p.department)?.config;
    for (const [name, tk] of categories) {
      const productive = cfg?.capacity[name]?.productiveHours ?? 156;
      const factor =
        p.curveBasis === 'total-internal-labor'
          ? (p.laborAllocation[name] ?? 0) / 100
          : (source.categoryFactors[name] ?? 1);
      const curve = p.workPackages?.length
        ? source.months.map((_, i) =>
            sum(
              p
                .workPackages!.filter(
                  (w) => cfg?.packageIncluded[w.id] ?? w.included,
                )
                .map((w) => w.curve[i] ?? 0),
            ),
          )
        : p.curve;
      const monthHours = curve.map((v) => v * factor * productive);
      if (sum(monthHours) <= 0) continue;
      monthlyByTrade[tk] = (
        monthlyByTrade[tk] ?? source.months.map(() => 0)
      ).map((v, i) => v + (monthHours[i] ?? 0));
    }
    for (const tk of Object.keys(monthlyByTrade) as TradeKey[])
      plan[tk] = d.weeks.map((w) =>
        spreadMonthHours(source.months, monthlyByTrade[tk]!, w.weekStart),
      );
    const all = d.weeks.map((w) =>
      sum(Object.values(plan).map((ns) => ns?.[w.i] ?? 0)),
    );
    const first = Math.max(
        0,
        all.findIndex((v) => v > 0),
      ),
      last = all.findLastIndex((v) => v > 0);
    const totalHours = sum(
      Object.values(monthlyByTrade).flatMap((v) => v ?? []),
    );
    const mix: ByTrade<number> = {};
    for (const tk of Object.keys(monthlyByTrade) as TradeKey[])
      mix[tk] = totalHours ? sum(monthlyByTrade[tk]!) / totalHours : 0;
    return {
      id: p.id,
      type: p.type === 'Hard' ? ('hard' as const) : ('soft' as const),
      name: p.name,
      arch: 'IND' as const,
      value: p.value / 1e6,
      start: first - constants.PAST,
      dur: Math.max(1, last - first + 1),
      dept: deptMap.get(p.department)!,
      prob: p.planningProbability / 100,
      src: 'Monthly import · estimated weekly spread; not observed crew peaks',
      hours: totalHours,
      mix,
      plan,
      on: true,
      job: p.type === 'Hard' ? p.id : undefined,
    };
  };
  d.projects = {
    generatorInputs: { hard: [], soft: [], userProjectArgs: [] },
    projects: source.projects.map(projectFor),
  };
  const offsetAtMonth = (i: number) =>
    Math.round(
      (Date.parse(
        `${source.months[Math.min(source.months.length - 1, Math.max(0, i))]}-01`,
      ) -
        Date.parse(week0)) /
        604800000,
    );
  const snapshotFor = (p?: WorkforcePlan) => {
    const s = {
      on: Object.fromEntries(d.projects.projects.map((p) => [p.id, true])),
      prob: Object.fromEntries(
        d.projects.projects
          .filter((p) => p.type === 'soft')
          .map((p) => [p.id, p.prob]),
      ),
      extra: [],
      actions: [],
      manual: {},
      review: {},
      softMode: 'weighted' as const,
      includeProposed: true,
      service: {
        demand: 'expected' as const,
        renewals: true,
        leveling: false,
        overrides: {},
      },
    } satisfies WorkforceSample['scenarios'][number]['snap'];
    if (p) {
      Object.assign(s.on, p.config.included);
      for (const [id, probability] of Object.entries(p.config.probabilities))
        s.prob[id] = probability / 100;
    }
    return s as WorkforceSample['scenarios'][number]['snap'];
  };
  const snap = snapshotFor();
  for (const p of source.initialPlans.filter(
    (p) => planFor(p.department)?.id === p.id,
  ))
    for (const a of p.config.actions) {
      const tk = categories.get(a.category),
        dk = deptMap.get(p.department);
      if (!tk || !dk) continue;
      const status = d.reference.statuses.includes(a.status as never)
        ? (a.status as (typeof d.reference.statuses)[number])
        : a.confirmed
          ? 'Executed'
          : 'Proposed';
      const lead = a.leadDays;
      const action = makeAction(d, {
        id: `${p.id}:${a.id}`,
        kind: a.kind,
        dk,
        tk,
        qty: a.quantity,
        from: offsetAtMonth(a.fromIndex),
        to:
          a.kind === 'hire' || a.kind === 'attrition'
            ? constants.FUT - 1
            : offsetAtMonth(a.toIndex + 1) - 1,
        status,
        notes: a.notes,
        rate: a.hourlyRate ?? d.reference.loadedRates[tk],
        ...(lead
          ? {
              lead:
                a.kind === 'hire'
                  ? {
                      recruit: lead.recruit,
                      interview: lead.interview,
                      offer: lead.offer,
                      onboard: lead.onboard,
                      ramp: lead.ramp,
                    }
                  : a.kind === 'subcontract'
                    ? {
                        source: lead.source,
                        vet: lead.vet,
                        mobilize: lead.mobilize,
                      }
                    : { notice: 7 },
            }
          : {}),
      });
      if (
        action.from < constants.FUT &&
        action.to >= action.from &&
        !snap.actions.some((v) => v.id === action.id)
      )
        snap.actions.push(action);
    }
  // The first opening scenario is a neutral imported view. Source plans stay in Monthly planner.
  d.scenarios = [
    { id: 'imported', name: 'Imported workforce plan', seed: true, snap },
  ];
  d.generatedFrom = source.publishedAt;
  d.schemaVersion = '2-monthly-adapter';
  d.metadata = {
    id: `monthly:${source.publishedAt}`,
    label: 'Imported monthly workforce dataset',
    sample: false,
    capacityKnown: known,
    notes: [
      'Monthly forecast hours are spread by calendar overlap. Weekly shapes and peak crews are estimates, not observed staffing.',
      'Source monthly plans and detailed imports remain available in Monthly planner. This view opens their dataset as a shared weekly outlook.',
      'Capacity uses supplied department plan headcounts. Missing roster, service, requisition and trade-level timesheet feeds are left empty.',
      'This dataset stays in the current browser session. Export your scenario before closing.',
      ...(source.source.notes ? [source.source.notes] : []),
    ],
  };
  return d;
}
