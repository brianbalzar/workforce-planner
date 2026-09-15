import type {
  LaborCategory,
  ProposedProject,
  ProposedProjectArchetype,
  StaffingCurve,
  WorkPackage,
} from '../domain/types';

export interface ProposedProjectIntake {
  name: string;
  department: string;
  archetypeId: string;
  value: number;
  startIndex: number;
  endIndex: number;
  probability: number;
}

function resample(values: number[], length: number) {
  if (!values.length) return Array(length).fill(0) as number[];
  if (length === 1) return [Math.max(...values)];
  return Array.from({ length }, (_, index) => {
    const position = (index / (length - 1)) * (values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);
    const fraction = position - left;
    return values[left] * (1 - fraction) + values[right] * fraction;
  });
}

function genericShape(curve: StaffingCurve, duration: number) {
  if (curve === 'Even distribution' || curve === 'Manual monthly forecast')
    return Array(duration).fill(1) as number[];
  if (curve === 'Standard ramp / peak / taper')
    return Array.from({ length: duration }, (_, index) =>
      Math.sin((Math.PI * (index + 1)) / (duration + 1)),
    );
  return resample([0.2, 0.4, 0.6, 0.8, 1, 1, 0.8, 0.5, 0.2], duration);
}

export function normalizeAllocation(
  allocation: Partial<Record<LaborCategory, number>>,
  laborCategories: LaborCategory[],
) {
  const result = Object.fromEntries(
    laborCategories.map((category) => [
      category,
      Math.max(0, allocation[category] ?? 0),
    ]),
  ) as Record<LaborCategory, number>;
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (total <= 0 && laborCategories[0]) {
    result[laborCategories[0]] = 100;
    return result;
  }
  const active = laborCategories.filter((category) => result[category] > 0);
  active.forEach((category) => {
    result[category] = Math.round((result[category] / total) * 1000) / 10;
  });
  if (active[0]) {
    const roundedTotal = Object.values(result).reduce(
      (sum, value) => sum + value,
      0,
    );
    result[active[0]] += Math.round((100 - roundedTotal) * 10) / 10;
  }
  return result;
}

function placeCurve(shape: number[], startIndex: number, months: number) {
  const curve = Array(months).fill(0) as number[];
  shape.forEach((value, offset) => {
    const index = startIndex + offset;
    if (index >= 0 && index < curve.length)
      curve[index] = Math.round(value * 1000) / 1000;
  });
  return curve;
}

function scaledTemplatePackages(
  template: ProposedProject,
  projectId: string,
  startIndex: number,
  duration: number,
  months: number,
) {
  const scale = duration / Math.max(1, template.durationMonths);
  return template.workPackages.map((item, index) => {
    const relativeStart = Math.max(0, item.startIndex - template.startIndex);
    const nextStart = startIndex + Math.round(relativeStart * scale);
    const nextDuration = Math.max(1, Math.round(item.durationMonths * scale));
    const original = item.curve.slice(
      item.startIndex,
      item.startIndex + item.durationMonths,
    );
    const shape = resample(original, nextDuration);
    return {
      ...structuredClone(item),
      id: `${projectId}-w${index + 1}`,
      startIndex: nextStart,
      durationMonths: nextDuration,
      curve: placeCurve(shape, nextStart, months),
      baselineDurationMonths: nextDuration,
      manualMonthly: item.manualMonthly
        ? resample(item.manualMonthly, nextDuration)
        : undefined,
    };
  });
}

export function genericPackage(
  archetype: ProposedProjectArchetype,
  projectId: string,
  startIndex: number,
  duration: number,
  months: number,
): WorkPackage {
  const shape = genericShape(archetype.staffingCurve, duration);
  const baseFteMonths = ((archetype.laborHoursPerMillion ?? 1730) * 10) / 173;
  const shapeTotal = shape.reduce((sum, value) => sum + value, 0) || 1;
  const scaled = shape.map((value) => (value / shapeTotal) * baseFteMonths);
  return {
    id: `${projectId}-w1`,
    name: 'Overall project execution',
    valuePercent: 100,
    startIndex,
    durationMonths: duration,
    laborAllocation: { ...archetype.laborAllocation },
    curve: placeCurve(scaled, startIndex, months),
    staffingCurve: archetype.staffingCurve,
    execution: 'Self-perform',
    selfPerformPercent: 100,
    subcontractPercent: 0,
    included: true,
    confidence: 50,
    scenarioShift: 0,
    baselineSelfPerformPercent: 100,
    baselineStaffingCurve: archetype.staffingCurve,
    baselineDurationMonths: duration,
  };
}

export function createProposedProject(
  intake: ProposedProjectIntake,
  archetype: ProposedProjectArchetype,
  template: ProposedProject | undefined,
  laborCategories: LaborCategory[],
  projectId: string,
  months: number,
): ProposedProject {
  const duration = Math.max(1, intake.endIndex - intake.startIndex + 1);
  const workPackages = template?.workPackages.length
    ? scaledTemplatePackages(
        template,
        projectId,
        intake.startIndex,
        duration,
        months,
      )
    : [
        genericPackage(
          archetype,
          projectId,
          intake.startIndex,
          duration,
          months,
        ),
      ];
  return {
    id: projectId,
    name: intake.name.trim(),
    department: intake.department,
    projectType: archetype.projectType,
    archetypeId: archetype.id,
    value: Math.round(Math.max(0, intake.value) * 100) / 100,
    startIndex: intake.startIndex,
    durationMonths: duration,
    probability: Math.round(Math.max(0, Math.min(100, intake.probability))),
    staffingCurve: archetype.staffingCurve,
    costMix: structuredClone(archetype.costMix),
    laborAllocation: normalizeAllocation(
      archetype.laborAllocation,
      laborCategories,
    ),
    workPackages,
  };
}

/**
 * Drift is computed by comparing duration, curve, every cost-mix key and
 * every labor-allocation key against the archetype's own values — not a
 * dirty flag — so editing a value back to the archetype's number clears the
 * ADJUSTED badge. Values are compared exactly: costMix is stored as a
 * verbatim clone of the archetype's own object at creation, and
 * laborAllocation is normalized through the same pure normalizeAllocation()
 * both at creation and here, so an untouched project always compares equal.
 */
export function hasDriftedFromArchetype(
  project: Pick<
    ProposedProject,
    'durationMonths' | 'staffingCurve' | 'costMix' | 'laborAllocation'
  >,
  archetype: ProposedProjectArchetype,
  laborCategories: LaborCategory[],
): boolean {
  if (project.durationMonths !== archetype.defaultDurationMonths) return true;
  if (project.staffingCurve !== archetype.staffingCurve) return true;
  const costKeys = [
    'material',
    'internalLabor',
    'subcontract',
    'other',
  ] as const;
  if (costKeys.some((key) => project.costMix[key] !== archetype.costMix[key]))
    return true;
  const archetypeAllocation = normalizeAllocation(
    archetype.laborAllocation,
    laborCategories,
  );
  return laborCategories.some(
    (category) =>
      (project.laborAllocation[category] ?? 0) !==
      (archetypeAllocation[category] ?? 0),
  );
}

/** "Reset to archetype" — rebuilds the project's duration, curve, cost mix
 * and labor allocation back to the archetype's own averages, discarding any
 * edits to those fields (name, department, value, start, probability are
 * left untouched). */
export function resetProposedProjectToArchetype(
  project: ProposedProject,
  archetype: ProposedProjectArchetype,
  laborCategories: LaborCategory[],
  months: number,
): ProposedProject {
  const duration = archetype.defaultDurationMonths;
  return {
    ...project,
    durationMonths: duration,
    staffingCurve: archetype.staffingCurve,
    costMix: structuredClone(archetype.costMix),
    laborAllocation: normalizeAllocation(
      archetype.laborAllocation,
      laborCategories,
    ),
    workPackages: [
      genericPackage(
        archetype,
        project.id,
        project.startIndex,
        duration,
        months,
      ),
    ],
  };
}

export function resizeProposedProjectSchedule(
  project: ProposedProject,
  durationMonths: number,
  months: number,
): ProposedProject {
  const duration = Math.max(1, Math.round(durationMonths));
  return {
    ...project,
    durationMonths: duration,
    workPackages: scaledTemplatePackages(
      project,
      project.id,
      project.startIndex,
      duration,
      months,
    ),
  };
}
