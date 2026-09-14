import { describe, expect, it } from 'vitest';
import { validatePlannerData } from './plannerDataLoader';
import { getDemoPlannerData } from './runtimeData';

describe('published planner data validation', () => {
  it('accepts the versioned 18-month demo contract', () => {
    const data = getDemoPlannerData();
    expect(validatePlannerData(data).months).toHaveLength(18);
  });

  it('rejects a broken or non-consecutive planning window', () => {
    const data = getDemoPlannerData();
    data.months[4] = '2030-01';
    expect(() => validatePlannerData(data)).toThrow(/consecutive/i);
  });

  it('rejects duplicate project identifiers', () => {
    const data = getDemoPlannerData();
    data.projects.push(structuredClone(data.projects[0]));
    expect(() => validatePlannerData(data)).toThrow(/unique/i);
  });

  it('rejects an active project with no demand in the rolling window', () => {
    const data = getDemoPlannerData();
    data.projects[0].curve = Array(18).fill(0);
    expect(() => validatePlannerData(data)).toThrow(/projects are invalid/i);
  });

  it('allows data-owned labor categories when their factors are supplied', () => {
    const data = getDemoPlannerData();
    data.laborCategories.push('Material Handler');
    data.categoryFactors['Material Handler'] = 0.2;
    data.initialPlans.forEach((plan) => {
      plan.config.capacity['Material Handler'] = {
        ...structuredClone(plan.config.capacity.Plumber),
        headcount: 0,
      };
    });
    expect(validatePlannerData(data).laborCategories).toContain(
      'Material Handler',
    );
  });

  it('accepts data-owned proposed-project archetypes', () => {
    const data = getDemoPlannerData();
    data.proposedProjectArchetypes[0].laborHoursPerMillion = 1250;

    expect(
      validatePlannerData(data).proposedProjectArchetypes[0],
    ).toMatchObject({
      id: 'data-center-plumbing-package',
      laborHoursPerMillion: 1250,
    });
  });

  it('accepts editable Soft Backlog forecast settings', () => {
    const data = getDemoPlannerData();
    data.projects[1].softBacklogForecast = {
      totalLaborHours: 5190,
      startMonth: data.months[0],
      endMonth: data.months[2],
      method: 'straight-line',
      productiveHoursPerFteMonth: 173,
      generated: true,
    };

    expect(
      validatePlannerData(data).projects[1].softBacklogForecast,
    ).toMatchObject({ totalLaborHours: 5190, generated: true });
  });

  it('rejects duplicate proposed-project archetype IDs', () => {
    const data = getDemoPlannerData();
    data.proposedProjectArchetypes.push({
      ...data.proposedProjectArchetypes[0],
    });

    expect(() => validatePlannerData(data)).toThrow(/archetype IDs.*unique/i);
  });
});
