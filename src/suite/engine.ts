import type {
  Agreement,
  CapacityAction,
  DeptKey,
  Project,
  ScenarioSnapshot,
  TradeKey,
  UserProjectArgs,
  WorkforceSample,
} from './types';

export type Basis = 'confirmed' | 'plan';
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const clone = <T>(x: T): T => structuredClone(x);
export const uid = () => crypto.randomUUID();
export const serviceSettings = (s: ScenarioSnapshot) =>
  s.service ?? {
    demand: 'expected' as const,
    renewals: true,
    leveling: false,
    overrides: {},
  };
export const negative = (a: CapacityAction) =>
  a.kind === 'leave' || a.kind === 'attrition';
export const secured = (d: WorkforceSample, a: CapacityAction) =>
  a.status !== 'Cancelled' && d.reference.confirmedStatuses.includes(a.status);
export const dateAt = (d: WorkforceSample, offset: number) =>
  new Date(
    Date.parse(d.reference.constants.WEEK0.slice(0, 10)) +
      Math.round(offset * 7) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
export const weekOffset = (d: WorkforceSample, date: string) =>
  (Date.parse(date) - Date.parse(d.reference.constants.WEEK0.slice(0, 10))) /
  604800000;
export const displayDate = (date: string) =>
  new Date(date).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function timeline(a: CapacityAction, d?: WorkforceSample) {
  const l = a.lead;
  let phases: [string, number, number][] = [];
  let offer = a.from,
    start = a.from,
    ramp = a.from;
  if (a.kind === 'hire') {
    ramp = a.from - (l.ramp ?? 0) / 7;
    start = ramp - (l.onboard ?? 0) / 7;
    offer = start - (l.offer ?? 0) / 7;
    // Actual dates replace predictions; the productive date follows actual start.
    if (d && a.actualStart) {
      start = weekOffset(d, a.actualStart);
      ramp = start + (l.onboard ?? 0) / 7;
    }
    if (d && a.actualOffer) {
      offer = weekOffset(d, a.actualOffer);
      if (!a.actualStart) {
        start = offer + (l.offer ?? 0) / 7;
        ramp = start + (l.onboard ?? 0) / 7;
      }
    }
    const selection = offer - (l.interview ?? 0) / 7;
    const recruiting = selection - (l.recruit ?? 0) / 7;
    const productive = ramp + (l.ramp ?? 0) / 7;
    phases = [
      ['Recruiting', recruiting, selection],
      ['Selection', selection, offer],
      ['Offer / notice', offer, start],
      ['Onboarding', start, ramp],
      ['Ramp-up', ramp, productive],
    ];
    return { actBy: recruiting, offer, start, ramp, productive, phases };
  }
  if (a.kind === 'subcontract') {
    const vet = a.from - (l.mobilize ?? 0) / 7;
    const source = vet - (l.vet ?? 0) / 7;
    phases = [
      ['Sourcing', source - (l.source ?? 0) / 7, source],
      ['Vetting and contracting', source, vet],
      ['Mobilization', vet, a.from],
    ];
  } else if (a.kind === 'overtime')
    phases = [
      ['Approval and crew notice', a.from - (l.notice ?? 0) / 7, a.from],
    ];
  return {
    actBy: phases[0]?.[1] ?? a.from,
    offer,
    start,
    ramp,
    productive: a.from,
    phases,
  };
}

export function hireFactor(a: CapacityAction, w: number, d?: WorkforceSample) {
  const t = timeline(a, d);
  if (w >= t.productive) return 1;
  if (w < t.ramp || t.productive <= t.ramp) return 0;
  return w >= (t.ramp + t.productive) / 2 ? 0.75 : 0.5;
}

export function makeAction(
  d: WorkforceSample,
  args: Partial<CapacityAction> &
    Pick<CapacityAction, 'kind' | 'dk' | 'tk' | 'qty' | 'from'>,
): CapacityAction {
  const kind = args.kind;
  const lead =
    kind === 'hire'
      ? d.reference.leadTimeDefaultsDays.hire[args.tk]
      : kind === 'subcontract'
        ? d.reference.leadTimeDefaultsDays.subcontract[args.tk]
        : kind === 'overtime'
          ? d.reference.leadTimeDefaultsDays.overtime[args.tk]
          : {};
  return {
    id: uid(),
    src: 'plan',
    status: 'Proposed',
    confirmed: false,
    notes: '',
    to:
      kind === 'hire' || kind === 'attrition'
        ? d.reference.constants.FUT - 1
        : args.from + 7,
    rate: d.reference.loadedRates[args.tk],
    cost: Math.round(d.reference.loadedRates[args.tk] * 1.55),
    owner:
      kind === 'hire'
        ? 'Talent Acquisition'
        : d.reference.deptManagers[args.dk],
    sourceType: 'External',
    costBasis: 'per hour',
    ...args,
    lead: clone(args.lead ?? lead),
  };
}

export function actionCost(d: WorkforceSample, a: CapacityAction) {
  if (negative(a)) return 0;
  const start = a.kind === 'hire' ? timeline(a, d).start : a.from;
  const end =
    a.kind === 'hire'
      ? d.reference.constants.FUT - 1
      : Math.min(a.to, d.reference.constants.FUT - 1);
  const weeks = Math.max(0, end + 1 - Math.max(0, start));
  if (a.kind === 'subcontract')
    return (
      a.qty *
      weeks *
      a.cost *
      (a.costBasis === 'per month' ? 1 / 4.33 : d.reference.constants.HPF)
    );
  return (
    a.qty *
    weeks *
    (a.kind === 'hire'
      ? d.reference.constants.SV_PAID
      : d.reference.constants.HPF) *
    a.rate *
    (a.kind === 'overtime' ? 1.5 : 1)
  );
}

export function createProject(d: WorkforceSample, a: UserProjectArgs): Project {
  const ar = d.reference.archetypes[a.arch];
  const duration = Math.max(
    1,
    a.end !== undefined
      ? a.end - a.start + 1
      : Math.min(56, Math.round(14 + 2.3 * a.value)),
  );
  const hours =
    a.hours ??
    (a.value * 1e6 * ar.share * 0.72) / d.reference.constants.RATE_BLENDED;
  const raw = Array.from({ length: duration }, (_, k) =>
    a.shape === 'flat' ? 1 : Math.sin((Math.PI * (k + 0.5)) / duration),
  );
  const mix = a.mix ?? ar.mix;
  const plan: Project['plan'] = {};
  for (const t of d.reference.trades)
    if (mix[t.k])
      plan[t.k] = d.weeks.map((w) => {
        const k = w.offset - a.start;
        return k >= 0 && k < duration
          ? ((hours * raw[k]) / sum(raw)) * (mix[t.k] ?? 0)
          : 0;
      });
  return {
    ...a,
    type: a.kind,
    dur: duration,
    hours,
    mix: clone(mix),
    plan,
    src:
      a.source === 'estimate'
        ? (a.file ?? 'Imported estimate')
        : `${ar.name} archetype · editable assumptions`,
    on: true,
    user: true,
  };
}

export function projectsFor(d: WorkforceSample, s: ScenarioSnapshot) {
  const extras = new Set(s.extra.map((p) => p.id));
  return [
    ...d.projects.projects.filter((p) => !extras.has(p.id) && !p.user),
    ...s.extra.map((p) => createProject(d, p)),
  ];
}
export function weight(s: ScenarioSnapshot, p: Project) {
  if (s.on[p.id] === false || (s.on[p.id] === undefined && p.on === false))
    return 0;
  if (p.type === 'hard') return 1;
  if (p.type === 'soft' && s.softMode === 'off') return 0;
  if (p.type === 'proposed' && !s.includeProposed) return 0;
  return s.softMode === 'all' ? 1 : (s.prob[p.id] ?? p.prob);
}
export const route = (p: Project, tk: TradeKey): DeptKey =>
  tk === 'CT' || tk === 'PG' ? 'BAS' : p.dept;

export function reforecast(
  d: WorkforceSample,
  s: ScenarioSnapshot,
  p: Project,
  tk: TradeKey,
) {
  const { PAST, NW, REVIEW_THRESHOLD } = d.reference.constants;
  const plan = p.plan[tk] ?? Array(NW).fill(0);
  const actual = d.dispatch_actuals[p.id]?.[tk];
  const planned = sum(plan.slice(0, PAST)),
    done = sum(actual ?? []);
  const end = Math.min(p.start + p.dur + PAST, NW);
  const remPlan = sum(plan.slice(PAST, end));
  const delta = actual ? planned - done : 0;
  const key = `${p.id}|${tk}`;
  const status = s.manual[key]
    ? 'manual'
    : !actual || planned < 1
      ? 'none'
      : (s.review[key] ??
        (delta < -0.5 || Math.abs(delta) / planned >= REVIEW_THRESHOLD
          ? 'pending'
          : 'auto'));
  const applied = ['manual', 'accepted', 'auto'].includes(status);
  const add = Array<number>(NW).fill(0);
  if (status === 'manual')
    for (let i = PAST; i < NW; i++) add[i] = (s.manual[key][i] ?? 0) - plan[i];
  else if (applied && remPlan > 0)
    for (let i = PAST; i < end; i++)
      add[i] = Math.max(-plan[i], (delta * plan[i]) / remPlan);
  else if (applied && delta > 0) add[PAST] = delta;
  return {
    key,
    add,
    delta,
    planned,
    done,
    remPlan,
    remWeeks: Math.max(0, end - PAST),
    status,
    applied,
    end,
  };
}

export function burn(d: WorkforceSample, s: ScenarioSnapshot, a: Agreement) {
  const day0 = Date.parse(d.reference.constants.WEEK0.slice(0, 10));
  const contractStart = new Date(day0 + a.start * 86400000);
  let yearStart = new Date(contractStart);
  while (
    new Date(
      Date.UTC(
        yearStart.getUTCFullYear() + 1,
        yearStart.getUTCMonth(),
        yearStart.getUTCDate(),
      ),
    ).getTime() <= day0
  )
    yearStart = new Date(
      Date.UTC(
        yearStart.getUTCFullYear() + 1,
        yearStart.getUTCMonth(),
        yearStart.getUTCDate(),
      ),
    );
  const start = Math.round((yearStart.getTime() - day0) / 86400000);
  const next = new Date(
    Date.UTC(
      yearStart.getUTCFullYear() + 1,
      yearStart.getUTCMonth(),
      yearStart.getUTCDate(),
    ),
  );
  const end = Math.min(
    a.end + 1,
    Math.round((next.getTime() - day0) / 86400000),
  );
  const visits = a.visits.filter(
    (v) => !v.ren && v.due >= start && v.due < end,
  );
  const done = visits.filter((v) => v.status === 'done');
  const actual = sum(done.map((v) => v.act ?? 0));
  const budgetDone = sum(done.map((v) => v.bud));
  const ratio = budgetDone ? actual / budgetDone : 1;
  const ov = serviceSettings(s).overrides[a.id];
  const factor =
    ov?.basis === 'budget'
      ? 1
      : ov?.basis === 'custom'
        ? (ov.factor ?? 1)
        : done.length >= 2
          ? Math.max(0.8, Math.min(1.5, ratio))
          : 1;
  const missing = visits.filter((v) => v.status === 'missing');
  const remaining = sum(
    visits
      .filter((v) => !['done', 'missing'].includes(v.status))
      .map((v) => v.bud * factor),
  );
  const missingHours = sum(missing.map((v) => v.bud));
  const budget = sum(visits.map((v) => v.bud));
  return {
    factor,
    ratio,
    actual,
    budgetDone,
    remaining,
    missingHours,
    missing: missing.length,
    budget,
    projected: actual + missingHours + remaining,
    visits,
  };
}

export type ServiceLayer =
  | 'maint'
  | 'carry'
  | 'renS'
  | 'renE'
  | 'jobs'
  | 'allow'
  | 'high'
  | 'pastM'
  | 'pastMiss';
export interface ServiceContribution {
  id: string;
  name: string;
  source: string;
  layer: ServiceLayer;
  hours: number;
  agreement?: string;
}
export function serviceLayers(
  d: WorkforceSample,
  s: ScenarioSnapshot,
  tk: 'HS' | 'PS',
  capacity?: number[],
) {
  const { PAST, NW } = d.reference.constants;
  const settings = serviceSettings(s);
  const layers = Object.fromEntries(
    [
      'maint',
      'carry',
      'renS',
      'renE',
      'jobs',
      'allow',
      'high',
      'pastM',
      'pastMiss',
    ].map((k) => [k, Array<number>(NW).fill(0)]),
  ) as Record<ServiceLayer, number[]>;
  const detail: ServiceContribution[][] = Array.from({ length: NW }, () => []);
  const moves: {
    id: string;
    agreement: string;
    name: string;
    from: number;
    to: number;
    hours: number;
  }[] = [];
  const candidates: {
    id: string;
    agreement: string;
    name: string;
    i: number;
    hours: number;
    window: number;
  }[] = [];
  const put = (
    i: number,
    layer: ServiceLayer,
    hours: number,
    r: Omit<ServiceContribution, 'layer' | 'hours'>,
  ) => {
    if (i >= 0 && i < NW) {
      layers[layer][i] += hours;
      detail[i].push({ ...r, layer, hours });
    }
  };
  for (const a of d.service.agreements.filter((a) => a.tk === tk)) {
    const b = burn(d, s, a),
      ov = settings.overrides[a.id];
    for (const v of a.visits) {
      const i0 =
        PAST +
        Math.floor((v.status === 'resched' ? (v.to ?? v.due) : v.due) / 7);
      const row = {
        id: v.id,
        name: a.name,
        source: `${a.id} · ${v.id}`,
        agreement: a.id,
      };
      if (v.status === 'done' || v.status === 'missing') {
        if (i0 < PAST)
          put(
            i0,
            v.status === 'done' ? 'pastM' : 'pastMiss',
            v.status === 'done' ? (v.act ?? 0) : v.bud,
            row,
          );
        continue;
      }
      const renewal =
        ov?.renewal && ov.renewal !== 'source' ? ov.renewal : a.ren?.status;
      if (
        v.ren &&
        (renewal === 'none' ||
          !renewal ||
          (renewal !== 'signed' &&
            (!settings.renewals || s.softMode === 'off')))
      )
        continue;
      const probability =
        renewal === 'signed' || s.softMode === 'all'
          ? 1
          : (ov?.probability ?? a.ren?.p ?? 0);
      const hours = v.bud * (v.ren ? probability : b.factor);
      const layer = v.ren
        ? renewal === 'signed'
          ? 'renS'
          : 'renE'
        : v.status === 'overdue'
          ? 'carry'
          : 'maint';
      const manual = ov?.moves?.[v.id];
      if (v.status === 'overdue' && manual === undefined) {
        put(PAST, 'carry', hours * 0.6, row);
        put(PAST + 1, 'carry', hours * 0.4, row);
        continue;
      }
      const i = manual ?? i0;
      if (i < PAST) continue;
      put(i, layer, hours, row);
      if (
        v.status === 'sched' &&
        v.flex &&
        !v.ren &&
        manual === undefined &&
        i > PAST &&
        i < NW
      )
        candidates.push({
          id: v.id,
          agreement: a.id,
          name: a.name,
          i,
          hours,
          window: v.win,
        });
    }
  }
  for (const j of d.service.openJobs.filter((j) => j.tk === tk))
    put(PAST + j.wk, 'jobs', j.hrs, {
      id: j.id,
      name: `${j.desc} · ${j.site}`,
      source: j.bill,
    });
  for (let i = PAST; i < NW; i++) {
    const base =
      d.service.callHistoryBaseHoursPerWeekByMonth[tk][
        new Date(d.weeks[i].weekStart).getUTCMonth()
      ] * d.weeks[i].holidayFactor;
    layers.allow[i] = Math.max(0, base - layers.jobs[i]);
    layers.high[i] =
      settings.demand === 'high'
        ? Math.max(0, base * d.service.highDemandMultiplier - layers.jobs[i]) -
          layers.allow[i]
        : 0;
    if (layers.allow[i] + layers.high[i] > 0)
      detail[i].push({
        id: `calls-${i}`,
        name: 'Expected additional calls',
        source: 'Call history less known jobs',
        layer: 'allow',
        hours: layers.allow[i] + layers.high[i],
      });
  }
  if (settings.leveling && capacity) {
    const demand = d.weeks.map((_, i) =>
      sum(
        ['maint', 'carry', 'renS', 'renE', 'jobs', 'allow', 'high'].map(
          (k) => layers[k as ServiceLayer][i],
        ),
      ),
    );
    for (const c of candidates.sort((a, b) => b.hours - a.hours)) {
      if (demand[c.i] <= capacity[c.i]) continue;
      let best = -1,
        spare = 0;
      for (
        let k = Math.max(PAST + 1, c.i - c.window);
        k <= Math.min(NW - 1, c.i + c.window);
        k++
      ) {
        const room = capacity[k] - demand[k];
        if (k !== c.i && room >= c.hours && room > spare) {
          best = k;
          spare = room;
        }
      }
      if (best < 0) continue;
      layers.maint[c.i] -= c.hours;
      layers.maint[best] += c.hours;
      demand[c.i] -= c.hours;
      demand[best] += c.hours;
      const r = detail[c.i].find((r) => r.id === c.id);
      detail[c.i] = detail[c.i].filter((r) => r.id !== c.id);
      if (r) detail[best].push(r);
      moves.push({ ...c, from: c.i, to: best });
    }
  }
  return { layers, detail, moves };
}

export interface Cell {
  hard: number;
  carry: number;
  soft: number;
  proposed: number;
  actual: number;
  historyPlan: number;
  roster: number;
  confirmed: number;
  planned: number;
  cap: number;
  capConf: number;
  gap: number;
  spare: number;
}
export type Cube = Record<DeptKey, Record<TradeKey, Cell[]>>;
export const total = (c: Cell) => c.hard + c.carry + c.soft + c.proposed;
export const capFor = (c: Cell, basis: Basis) =>
  basis === 'confirmed' ? c.capConf : c.cap;
export const actionsFor = (d: WorkforceSample, s: ScenarioSnapshot) =>
  [...d.capacity_actions.fromSystems, ...s.actions].filter(
    (a) => a.status !== 'Cancelled' && !a.draft,
  );

export function compute(
  d: WorkforceSample,
  s: ScenarioSnapshot,
  basis: Basis = 'confirmed',
) {
  const { NW, PAST, HPF } = d.reference.constants;
  const cube = {} as Cube;
  for (const dept of d.reference.departments) {
    cube[dept.k] = {} as Cube[DeptKey];
    for (const trade of d.reference.trades)
      cube[dept.k][trade.k] = d.weeks.map((w) => {
        const roster =
          (d.crews.headcount[dept.k]?.[trade.k] ?? 0) * HPF * w.holidayFactor;
        return {
          hard: 0,
          carry: 0,
          soft: 0,
          proposed: 0,
          actual: 0,
          historyPlan: 0,
          roster,
          confirmed: 0,
          planned: 0,
          cap: roster,
          capConf: roster,
          gap: 0,
          spare: 0,
        };
      });
  }
  for (const p of projectsFor(d, s)) {
    const w = weight(s, p);
    if (!w) continue;
    for (const tk of Object.keys(p.plan) as TradeKey[]) {
      const col = cube[route(p, tk)]?.[tk];
      if (!col) continue;
      const f = reforecast(d, s, p, tk);
      for (let i = 0; i < NW; i++) {
        const c = col[i],
          value =
            (p.type !== 'hard' && s.manual[`${p.id}|${tk}`]
              ? (s.manual[`${p.id}|${tk}`][i] ?? 0)
              : (p.plan[tk]?.[i] ?? 0)) * w;
        if (i < PAST) {
          if (p.type === 'hard') {
            c.actual += d.dispatch_actuals[p.id]?.[tk]?.[i] ?? 0;
            c.historyPlan += value;
          }
        } else if (p.type === 'hard') {
          c.hard += value;
          c.carry += f.add[i];
        } else if (p.type === 'soft') c.soft += value;
        else c.proposed += value;
      }
    }
  }
  for (const a of actionsFor(d, s))
    for (let i = 0; i < NW; i++) {
      const c = cube[a.dk]?.[a.tk]?.[i];
      if (!c) continue;
      const w = d.weeks[i].offset;
      const f =
        a.kind === 'hire'
          ? hireFactor(a, w, d)
          : a.kind === 'attrition'
            ? Number(w >= a.from)
            : Number(w >= a.from && w <= a.to);
      const v =
        a.qty *
        f *
        HPF *
        (a.kind === 'overtime' ? 1 : d.weeks[i].holidayFactor);
      if (negative(a)) {
        c.roster = Math.max(0, c.roster - v);
      } else if (secured(d, a)) c.confirmed += v;
      else c.planned += v;
    }
  for (const dept of d.reference.departments)
    for (const trade of d.reference.trades)
      for (const c of cube[dept.k][trade.k]) {
        c.capConf = c.roster + c.confirmed;
        c.cap = c.capConf + c.planned;
      }
  const services = {} as Record<'HS' | 'PS', ReturnType<typeof serviceLayers>>;
  for (const tk of ['HS', 'PS'] as const) {
    const col = cube.HLS?.[tk];
    services[tk] = serviceLayers(
      d,
      s,
      tk,
      col?.map((c) => c.cap),
    );
    if (!col) continue;
    const L = services[tk].layers;
    for (let i = 0; i < NW; i++) {
      if (i < PAST) {
        col[i].actual += L.pastM[i];
        continue;
      }
      col[i].hard +=
        L.maint[i] +
        L.carry[i] +
        L.renS[i] +
        L.jobs[i] +
        L.allow[i] +
        L.high[i];
      col[i].soft += L.renE[i];
    }
  }
  for (const dept of d.reference.departments)
    for (const trade of d.reference.trades)
      for (const c of cube[dept.k][trade.k]) {
        c.gap = Math.max(0, total(c) - capFor(c, basis));
        c.spare = Math.max(0, capFor(c, basis) - total(c));
      }
  return { cube, services };
}

export interface Recommendation {
  key: string;
  action: CapacityAction;
  reason: string;
  uncovered: number;
  covered: number;
  cost: number;
}
export function recommendations(
  d: WorkforceSample,
  s: ScenarioSnapshot,
  cube: Cube,
  basis: Basis,
  depts: DeptKey[],
  trades: TradeKey[],
) {
  const { PAST, FUT, HPF, OT_LIMIT, SHORT_TE, ACT_TE } = d.reference.constants;
  const out: Recommendation[] = [];
  for (const dk of depts)
    for (const tk of trades) {
      const col = cube[dk]?.[tk];
      if (!col || d.metadata?.capacityKnown === false) continue;
      // Existing unfilled actions reserve their contribution so recommendations do not duplicate a requisition.
      const gap = col
        .slice(PAST)
        .map(
          (c) =>
            Math.max(0, total(c) - Math.max(capFor(c, basis), c.cap)) / HPF,
        );
      const add = (
        kind: CapacityAction['kind'],
        from: number,
        to: number,
        qty: number,
        reason: string,
      ) => {
        if (qty <= 0 || from >= FUT) return;
        const key = `${dk}:${tk}:${kind}:${from}:${to}`;
        const action = makeAction(d, {
          id: `rec:${key}`,
          src: 'rec',
          kind,
          dk,
          tk,
          qty,
          from,
          to,
          notes: reason,
        });
        let uncovered = 0,
          covered = 0;
        for (let w = from; w <= Math.min(to, FUT - 1); w++) {
          const room =
            qty *
            HPF *
            (kind === 'overtime' ? 1 : d.weeks[w + PAST].holidayFactor);
          covered += Math.min(gap[w] * HPF, room);
          uncovered += Math.max(0, gap[w] * HPF - room);
        }
        out.push({
          key,
          action,
          reason,
          uncovered,
          covered,
          cost: actionCost(d, action),
        });
      };
      const ot = (from: number, to: number, reason: string) => {
        const crew = Math.min(
          ...col
            .slice(PAST + from, PAST + to + 1)
            .map((c, n) =>
              Math.max(
                0,
                Math.floor(
                  c.roster / HPF / d.weeks[PAST + from + n].holidayFactor +
                    0.01,
                ),
              ),
            ),
        );
        const hours = Math.min(
          crew * OT_LIMIT,
          Math.ceil((Math.max(...gap.slice(from, to + 1)) * HPF) / 5) * 5,
        );
        add(
          'overtime',
          from,
          to,
          hours / HPF,
          `${reason} Up to ${hours} extra hours/week across ${crew} available workers; maximum ${OT_LIMIT} hours each.`,
        );
      };
      for (let w = 0; w < gap.length;) {
        if (gap[w] <= SHORT_TE) {
          w++;
          continue;
        }
        let end = w;
        while (
          end + 1 < gap.length &&
          (gap[end + 1] > SHORT_TE ||
            (end + 2 < gap.length && gap[end + 2] > SHORT_TE))
        )
          end++;
        const vals = gap.slice(w, end + 1),
          peak = Math.max(...vals),
          length = end - w + 1;
        if (peak < ACT_TE) {
          w = end + 1;
          continue;
        }
        const kind =
          length >= 26
            ? 'hire'
            : (length >= 3 && peak >= 0.75) ||
                peak * HPF > Math.max(0, col[PAST].roster / HPF) * OT_LIMIT
              ? 'subcontract'
              : 'overtime';
        if (kind === 'overtime') ot(w, end, 'Short, limited-duration gap.');
        else {
          const proto = makeAction(d, { kind, dk, tk, qty: 1, from: 0 });
          const lead = Math.ceil(-timeline(proto).actBy);
          if (w < lead)
            ot(
              w,
              Math.min(end, lead - 1),
              `Too late for ${kind === 'hire' ? 'a hire' : 'temporary labor'} before ${displayDate(dateAt(d, lead))}.`,
            );
          if (end >= lead) {
            const from = Math.max(w, lead),
              rest = gap.slice(from, end + 1).filter((n) => n > SHORT_TE);
            const typical =
              kind === 'hire'
                ? [...rest].sort((a, b) => a - b)[Math.floor(rest.length / 2)]
                : sum(rest) / Math.max(1, rest.length);
            add(
              kind,
              from,
              kind === 'hire' ? FUT - 1 : end,
              Math.max(1, Math.round(typical ?? 1)),
              `${length} weeks of shortage; sized to typical demand. ${kind === 'hire' ? 'Sustained need supports a permanent hire.' : 'Use flexible labor for a temporary peak.'}`,
            );
          }
        }
        w = end + 1;
      }
      if (dk === 'HLS') {
        const departures = actionsFor(d, s).filter(
          (a) => a.dk === dk && a.tk === tk && a.kind === 'attrition',
        );
        const hiring = actionsFor(d, s).some(
          (a) => a.dk === dk && a.tk === tk && a.kind === 'hire',
        );
        if (departures.length && !hiring) {
          for (let n = out.length - 1; n >= 0; n--)
            if (
              out[n].action.dk === dk &&
              out[n].action.tk === tk &&
              out[n].action.kind === 'hire'
            )
              out.splice(n, 1);
          const lv = departures[0],
            lead = Math.ceil(
              -timeline(
                makeAction(d, { kind: 'hire', dk, tk, qty: lv.qty, from: 0 }),
              ).actBy,
            );
          add(
            'hire',
            Math.max(lv.from, lead),
            FUT - 1,
            lv.qty,
            `Replace a known departure. ${Math.max(0, lead - lv.from)} weeks require interim cover. ${lv.notes}`,
          );
        }
        const mine = out.filter(
          (r) => r.action.dk === dk && r.action.tk === tk,
        );
        const short = gap.filter((v) => v > SHORT_TE);
        if (
          !hiring &&
          !mine.some((r) => r.action.kind === 'hire') &&
          mine.length > 1 &&
          short.length >= 20
        ) {
          for (let n = out.length - 1; n >= 0; n--)
            if (out[n].action.dk === dk && out[n].action.tk === tk)
              out.splice(n, 1);
          const first = gap.findIndex((v) => v > SHORT_TE);
          const lead = Math.ceil(
            -timeline(makeAction(d, { kind: 'hire', dk, tk, qty: 1, from: 0 }))
              .actBy,
          );
          if (first < lead)
            ot(
              first,
              lead - 1,
              'Recurring seasonal demand; recruiting lead time requires interim cover.',
            );
          const typical = [...short].sort((a, b) => a - b)[
            Math.floor(short.length / 2)
          ];
          add(
            'hire',
            Math.max(first, lead),
            FUT - 1,
            Math.max(1, Math.round(typical)),
            `Short in ${short.length} of the next ${FUT} weeks. Repeated seasonal peaks are treated as structural hiring need.`,
          );
        }
      }
    }
  return out.sort(
    (a, b) => timeline(a.action, d).actBy - timeline(b.action, d).actBy,
  );
}

export function bucket(d: WorkforceSample, a: CapacityAction) {
  if (negative(a)) return 'Capacity reductions';
  if (secured(d, a)) return 'Secured';
  if (
    a.status === 'Recruiting' ||
    a.status === 'Sourcing' ||
    a.status === 'Vetting'
  )
    return 'In progress';
  // Calendar-day normalization avoids a computed -1e-15 being treated as overdue.
  const due = Math.round((a.due ?? timeline(a, d).actBy) * 7) / 7;
  return due < 0
    ? 'Overdue'
    : due < 1
      ? 'Start this week'
      : due < 5
        ? 'Next 4 weeks'
        : 'Later';
}

export function aggregate(
  d: WorkforceSample,
  cube: Cube,
  depts: DeptKey[],
  trades: TradeKey[],
) {
  const historyAvailable =
    Object.keys(d.dispatch_actuals).length > 0 ||
    (depts.includes('HLS') &&
      d.service.agreements.some((a) =>
        a.visits.some((v) => v.status === 'done'),
      ));
  return d.weeks.map((week, i) => {
    const cells = depts.flatMap((dk) =>
      trades.map((tk) => cube[dk]?.[tk]?.[i]).filter((c): c is Cell => !!c),
    );
    return {
      ...week,
      label: displayDate(week.weekStart),
      hard: sum(cells.map((c) => c.hard + c.carry)),
      soft: sum(cells.map((c) => c.soft)),
      proposed: sum(cells.map((c) => c.proposed)),
      demand: sum(cells.map(total)),
      actual:
        i < d.reference.constants.PAST && historyAvailable
          ? sum(cells.map((c) => c.actual))
          : undefined,
      roster: sum(cells.map((c) => c.roster)),
      secured: sum(cells.map((c) => c.capConf)),
      planned: sum(cells.map((c) => c.planned)),
      capacity: sum(cells.map((c) => c.cap)),
      gap: sum(cells.map((c) => c.gap)),
      spare: sum(cells.map((c) => c.spare)),
    };
  });
}
