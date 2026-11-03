import { describe, expect, it } from 'vitest';
import {
  sampleDataset,
  datasetId,
  importScenario,
  validateDataset,
  validateSnapshot,
} from './dataset';
import {
  actionCost,
  aggregate,
  bucket,
  clone,
  compute,
  createProject,
  hireFactor,
  makeAction,
  negative,
  projectsFor,
  recommendations,
  reforecast,
  serviceLayers,
  serviceSettings,
  sum,
  timeline,
  total,
} from './engine';
import golden from './data/golden-reforecast.json';
import timelines from './data/golden-actionTimelines.json';
import type { TradeKey } from './types';

const data = sampleDataset();
const base = () => clone(data.scenarios[0].snap);

describe('weekly artifact calculation regressions', () => {
  it('matches every hard-job reforecast line in the supplied golden fixture', () => {
    for (const expected of golden) {
      const p = data.projects.projects.find((p) => p.id === expected.pid)!;
      const actual = reforecast(data, base(), p, expected.tk as TradeKey);
      expect(actual.status, actual.key).toBe(expected.status);
      expect(actual.applied, actual.key).toBe(expected.applied);
      // The exported job hours are rounded to .01; the golden engine summed unrounded input.
      for (const key of [
        'planned',
        'done',
        'delta',
        'remPlan',
        'remWeeks',
      ] as const) {
        const terms =
          key === 'remPlan'
            ? actual.remWeeks
            : key === 'remWeeks'
              ? 0
              : data.reference.constants.PAST;
        expect(
          Math.abs(actual[key] - expected[key]),
          `${actual.key}.${key}`,
        ).toBeLessThan(0.011 + terms * 0.005);
      }
      for (const [i, v] of expected.add.entries())
        expect(
          Math.abs(actual.add[data.reference.constants.PAST + i] - v),
          `${actual.key}.add[${i}]`,
        ).toBeLessThan(0.011 + data.reference.constants.PAST * 0.005);
    }
  });
  it('preserves source lead-time milestones when no actual date supersedes them', () => {
    for (const row of timelines) {
      const action = [
        ...data.capacity_actions.fromSystems,
        ...data.capacity_actions.addedInPlan,
      ].find((a) => a.id === row.id);
      if (!action || action.actualStart || action.actualOffer) continue;
      const t = timeline(action, data);
      expect(Math.abs(t.actBy - row.timeline.actBy)).toBeLessThan(0.011);
      for (const [i, p] of t.phases.entries()) {
        expect(p[0]).toBe(row.timeline.phases[i][0]);
        expect(Math.abs(p[1] - Number(row.timeline.phases[i][1]))).toBeLessThan(
          0.011,
        );
        expect(Math.abs(p[2] - Number(row.timeline.phases[i][2]))).toBeLessThan(
          0.011,
        );
      }
    }
  });
  it('does not apply a pending forecast until the PM accepts it', () => {
    const expected = golden.find((r) => r.status === 'pending' && r.delta > 0)!;
    const p = data.projects.projects.find((p) => p.id === expected.pid)!;
    const s = base(),
      tk = expected.tk as TradeKey;
    expect(sum(reforecast(data, s, p, tk).add)).toBe(0);
    s.review[`${p.id}|${tk}`] = 'accepted';
    const f = reforecast(data, s, p, tk);
    expect(sum(f.add)).toBeCloseTo(f.delta, 6);
    s.review[`${p.id}|${tk}`] = 'held';
    expect(sum(reforecast(data, s, p, tk).add)).toBe(0);
  });
  it('uses explicit manual future hours, including intentional zero', () => {
    const s = base(),
      p = data.projects.projects[0],
      tk = Object.keys(p.plan)[0] as TradeKey;
    s.manual[`${p.id}|${tk}`] = data.weeks.map(() => 0);
    const f = reforecast(data, s, p, tk);
    expect(f.status).toBe('manual');
    for (let i = data.reference.constants.PAST; i < data.weeks.length; i++)
      expect(p.plan[tk]![i] + f.add[i]).toBe(0);
  });
  it('never derives headcount from workload or invents attrition drift', () => {
    const s = base();
    s.actions = [];
    const d = clone(data);
    d.capacity_actions.fromSystems = [];
    const { cube } = compute(d, s);
    expect(cube.GW.PF[8].roster).toBe((data.crews.headcount.GW.PF ?? 0) * 36);
    expect(cube.GW.PF[50].roster / d.weeks[50].holidayFactor).toBe(
      cube.GW.PF[8].roster,
    );
  });
  it('routes controls scope from mechanical jobs into Building Automation', () => {
    const d = clone(data),
      s = base();
    const p = d.projects.projects.find(
      (p) => p.dept !== 'BAS' && p.plan.CT?.some((v) => v > 0),
    )!;
    d.projects.projects = [p];
    d.service.agreements = [];
    d.service.openJobs = [];
    const { cube } = compute(d, s);
    expect(sum(cube[p.dept].CT.map(total))).toBe(0);
    expect(sum(cube.BAS.CT.map(total))).toBeGreaterThan(0);
  });
  it('keeps confirmed and planned capacity distinct', () => {
    const s = base();
    const a = makeAction(data, {
      kind: 'subcontract',
      dk: 'HLS',
      tk: 'HS',
      qty: 2,
      from: 0,
      to: 5,
    });
    const before = compute(data, s).cube.HLS.HS[8];
    s.actions.push(a);
    const after = compute(data, s).cube.HLS.HS[8];
    expect(after.capConf).toBe(before.capConf);
    expect(after.cap - before.cap).toBe(72);
    a.status = 'Contracted';
    expect(compute(data, s).cube.HLS.HS[8].capConf - before.capConf).toBe(72);
  });
  it('sums department shortages without netting spare crew elsewhere', () => {
    const { cube } = compute(data, base());
    cube.GW.PF[8] = {
      ...cube.GW.PF[8],
      hard: 100,
      carry: 0,
      soft: 0,
      proposed: 0,
      capConf: 0,
      cap: 0,
      gap: 100,
      spare: 0,
    };
    cube.NAT.PF[8] = {
      ...cube.NAT.PF[8],
      hard: 0,
      carry: 0,
      soft: 0,
      proposed: 0,
      capConf: 1000,
      cap: 1000,
      gap: 0,
      spare: 1000,
    };
    const row = aggregate(data, cube, ['GW', 'NAT'], ['PF'])[8];
    expect(row.gap).toBe(100);
    expect(row.spare).toBe(1000);
  });
  it('capacity reductions never appear in the secured bucket', () => {
    const reductions = data.capacity_actions.fromSystems.filter(negative);
    expect(reductions.length).toBe(3);
    for (const a of reductions)
      expect(bucket(data, a)).toBe('Capacity reductions');
  });
  it('recruiting that already started is not reported as an overdue start', () => {
    const a = data.capacity_actions.fromSystems.find(
      (a) => a.status === 'Recruiting',
    )!;
    expect(timeline(a, data).actBy).toBeLessThan(0);
    expect(bucket(data, a)).toBe('In progress');
  });
  it('does not mark a mathematically current-week start overdue because of floating point drift', () => {
    const a = makeAction(data, {
      kind: 'hire',
      dk: 'GW',
      tk: 'PF',
      qty: 1,
      from: 16,
    });
    expect(bucket(data, a)).toBe('Start this week');
  });
  it('actual start dates drive productive dates and ramp boundaries', () => {
    const a = data.capacity_actions.fromSystems.find((a) => a.actualStart)!;
    const t = timeline(a, data);
    expect(
      new Date(data.reference.constants.WEEK0).getTime() + t.start * 604800000,
    ).toBe(Date.parse('2026-11-16'));
    expect(hireFactor(a, t.ramp - 0.001, data)).toBe(0);
    expect(hireFactor(a, t.ramp, data)).toBe(0.5);
    expect(hireFactor(a, (t.ramp + t.productive) / 2, data)).toBe(0.75);
    expect(hireFactor(a, t.productive, data)).toBe(1);
  });
  it('an actual offer date shifts the target start and productivity when no actual start is known', () => {
    const a = makeAction(data, {
      kind: 'hire',
      dk: 'GW',
      tk: 'PF',
      qty: 1,
      from: 16,
      actualOffer: '2026-12-14',
    });
    const t = timeline(a, data);
    expect((t.start - t.offer) * 7).toBeCloseTo(a.lead.offer!, 7);
    expect((t.productive - t.start) * 7).toBeCloseTo(
      a.lead.onboard! + a.lead.ramp!,
      7,
    );
  });
  it('includes paid onboarding and ramp time in the hire cost', () => {
    const a = makeAction(data, {
      kind: 'hire',
      dk: 'GW',
      tk: 'PF',
      qty: 1,
      from: 16,
    });
    const productiveOnly = 36 * 36 * a.rate;
    expect(actionCost(data, a)).toBeGreaterThan(productiveOnly);
  });
  it('generates collision-free user ids and preserves both saved and new projects', () => {
    const s = base();
    const a = makeAction(data, {
      kind: 'hire',
      dk: 'GW',
      tk: 'PF',
      qty: 1,
      from: 16,
    });
    const b = makeAction(data, {
      kind: 'hire',
      dk: 'GW',
      tk: 'PF',
      qty: 1,
      from: 16,
    });
    expect(a.id).not.toBe(b.id);
    const extra = {
      ...s.extra[0],
      id: crypto.randomUUID(),
      name: 'Another proposed job',
    };
    s.extra.push(extra);
    expect(projectsFor(data, s).filter((p) => p.user).length).toBe(
      s.extra.length,
    );
    expect(createProject(data, extra).name).toBe('Another proposed job');
  });
});

describe('Service demand and shared hiring needs', () => {
  it('known jobs consume the expected-call allowance rather than adding twice', () => {
    const { layers } = serviceLayers(data, base(), 'HS');
    for (let i = 8; i < data.weeks.length; i++) {
      const expected =
        data.service.callHistoryBaseHoursPerWeekByMonth.HS[
          new Date(data.weeks[i].weekStart).getUTCMonth()
        ] * data.weeks[i].holidayFactor;
      expect(layers.jobs[i] + layers.allow[i]).toBeCloseTo(
        Math.max(expected, layers.jobs[i]),
        7,
      );
    }
  });
  it('uses full expected renewal hours at 100%, and excludes them when off', () => {
    const s = base();
    const weighted = sum(serviceLayers(data, s, 'HS').layers.renE);
    s.softMode = 'all';
    const full = sum(serviceLayers(data, s, 'HS').layers.renE);
    expect(full).toBeGreaterThan(weighted);
    s.softMode = 'off';
    expect(sum(serviceLayers(data, s, 'HS').layers.renE)).toBe(0);
  });
  it('conserves every service layer and total hours when leveling', () => {
    const s = base();
    const before = compute(data, s);
    s.service!.leveling = true;
    const after = compute(data, s);
    for (const tk of ['HS', 'PS'] as const) {
      expect(sum(after.cube.HLS[tk].map(total))).toBeCloseTo(
        sum(before.cube.HLS[tk].map(total)),
        6,
      );
      for (const m of after.services[tk].moves) {
        const v = data.service.agreements
          .flatMap((a) => a.visits)
          .find((v) => v.id === m.id)!;
        expect(Math.abs(m.to - m.from)).toBeLessThanOrEqual(v.win);
        expect(m.to).toBeGreaterThan(8);
      }
    }
  });
  it('keeps service overrides and settings in exported/imported scenarios', () => {
    const s = base();
    s.service = {
      demand: 'high',
      renewals: false,
      leveling: true,
      overrides: {
        SA3100: { basis: 'custom', factor: 1.2, renewal: 'none', moves: {} },
      },
    };
    const imported = importScenario(
      JSON.parse(
        JSON.stringify({
          schemaVersion: 2,
          datasetId: datasetId(data),
          name: 'Stress case',
          snapshot: s,
        }),
      ),
      data,
    );
    expect(serviceSettings(imported.snapshot)).toEqual(s.service);
  });
  it('a capacity-basis view switch does not change service workload or leveling moves', () => {
    const s = base();
    s.service!.leveling = true;
    const a = compute(data, s, 'confirmed'),
      b = compute(data, s, 'plan');
    expect(a.services).toEqual(b.services);
  });
  it('removes the backfill recommendation once that hire is in the shared plan', () => {
    const s = base(),
      cube = compute(data, s).cube;
    const list = recommendations(data, s, cube, 'confirmed', ['HLS'], ['HS']);
    const hire = list.find((r) => r.action.kind === 'hire')!;
    expect(hire).toBeDefined();
    s.actions.push({ ...hire.action, id: crypto.randomUUID(), src: 'plan' });
    const next = recommendations(
      data,
      s,
      compute(data, s).cube,
      'confirmed',
      ['HLS'],
      ['HS'],
    );
    expect(next.filter((r) => r.action.kind === 'hire')).toHaveLength(0);
  });
  it('does not recommend impossible overtime for a trade with no available roster', () => {
    const d = clone(data),
      s = base();
    d.crews.headcount.HLS.HS = 0;
    const rs = recommendations(
      d,
      s,
      compute(d, s).cube,
      'confirmed',
      ['HLS'],
      ['HS'],
    );
    expect(rs.filter((r) => r.action.kind === 'overtime')).toHaveLength(0);
  });
});

describe('import boundaries', () => {
  it('accepts the combined weekly handoff dataset', () => {
    expect(validateDataset(data).weeks).toHaveLength(60);
  });
  it('rejects nonfinite hours and broken calendars', () => {
    const d = clone(data);
    d.projects.projects[0].plan.PF![9] = Infinity;
    expect(() => validateDataset(d)).toThrow();
    const badCalendar = clone(data);
    badCalendar.weeks[9].weekStart = '2026-11-09';
    expect(() => validateDataset(badCalendar)).toThrow();
  });
  it('rejects mismatched datasets when importing a scenario', () => {
    expect(() =>
      importScenario(
        {
          schemaVersion: 2,
          datasetId: 'other',
          name: 'Plan',
          snapshot: base(),
        },
        data,
      ),
    ).toThrow(/different dataset/);
  });
  it('gives changed source hours a distinct dataset identity even when the source name is unchanged', () => {
    const other = clone(data);
    other.projects.projects[0].plan.PF![9] += 1;
    expect(datasetId(other)).not.toBe(datasetId(data));
  });
  it('rejects duplicate action and user project identifiers', () => {
    const s = base();
    s.actions.push(clone(s.actions[0]));
    expect(() => validateSnapshot(s, data)).toThrow(/duplicate/);
    const p = base();
    p.extra.push(clone(p.extra[0]));
    expect(() => validateSnapshot(p, data)).toThrow(/duplicate/);
  });
  it('rejects negative manual hours and out-of-calendar service moves', () => {
    const s = base();
    s.manual['h0|PF'] = Array(60).fill(-1);
    expect(() => validateSnapshot(s, data)).toThrow();
    const sv = base();
    sv.service!.overrides.SA3100 = { moves: { bad: 2000 } };
    expect(() => validateSnapshot(sv, data)).toThrow();
  });
});
