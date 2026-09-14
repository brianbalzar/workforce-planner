import { describe, expect, it } from 'vitest';
import { ATLAS, LABOR_CATEGORIES } from './sampleData';
import {
  createProposedProject,
  resizeProposedProjectSchedule,
} from './proposedProjectBuilder';

describe('proposed project builder', () => {
  it('seeds a project from an archetype and scales the template schedule', () => {
    const project = createProposedProject(
      {
        name: '  New Data Center  ',
        department: ATLAS.department,
        archetypeId: 'data-center',
        value: 14.126,
        startIndex: 3,
        endIndex: 9,
        probability: 45.4,
      },
      {
        id: 'data-center',
        name: 'Data center',
        projectType: ATLAS.projectType,
        defaultDurationMonths: 12,
        staffingCurve: ATLAS.staffingCurve,
        costMix: { ...ATLAS.costMix },
        laborAllocation: { ...ATLAS.laborAllocation },
      },
      ATLAS,
      LABOR_CATEGORIES,
      'new-data-center',
      18,
    );

    expect(project).toMatchObject({
      id: 'new-data-center',
      name: 'New Data Center',
      value: 14.13,
      startIndex: 3,
      durationMonths: 7,
      probability: 45,
    });
    expect(project.workPackages).toHaveLength(3);
    expect(
      Math.min(...project.workPackages.map((item) => item.startIndex)),
    ).toBe(3);
    expect(
      Object.values(project.laborAllocation).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBeCloseTo(100);

    const resized = resizeProposedProjectSchedule(project, 10, 18);
    expect(resized.durationMonths).toBe(10);
    expect(resized.workPackages[0].durationMonths).toBeGreaterThan(
      project.workPackages[0].durationMonths,
    );
  });

  it('creates one general work package when no comparable project exists', () => {
    const project = createProposedProject(
      {
        name: 'General Opportunity',
        department: ATLAS.department,
        archetypeId: 'general',
        value: 8,
        startIndex: 1,
        endIndex: 4,
        probability: 50,
      },
      {
        id: 'general',
        name: 'General',
        projectType: 'General',
        defaultDurationMonths: 4,
        staffingCurve: 'Standard ramp / peak / taper',
        costMix: { material: 50, internalLabor: 35, subcontract: 10, other: 5 },
        laborAllocation: { Plumber: 100 },
        laborHoursPerMillion: 1200,
      },
      undefined,
      LABOR_CATEGORIES,
      'general-opportunity',
      18,
    );

    expect(project.workPackages).toHaveLength(1);
    expect(project.workPackages[0].curve.some((value) => value > 0)).toBe(true);
  });
});
