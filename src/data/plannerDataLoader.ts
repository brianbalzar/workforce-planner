import type {
  PlannerData,
  Project,
  ProposedProject,
  ProposedProjectArchetype,
  WorkforcePlan,
} from '../domain/types';
import { getDemoPlannerData, type RuntimeDataInfo } from './runtimeData';

export interface PlannerDataLoadSuccess {
  ok: true;
  data: PlannerData;
  info: RuntimeDataInfo;
}

export interface PlannerDataLoadFailure {
  ok: false;
  message: string;
  detail: string;
}

export type PlannerDataLoadResult =
  | PlannerDataLoadSuccess
  | PlannerDataLoadFailure;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function nextMonth(key: string) {
  const [year, month] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year, month, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validateAllocation(value: unknown, laborCategories: string[]) {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([category, amount]) =>
        laborCategories.includes(category) &&
        isFiniteNumber(amount) &&
        amount >= 0,
    )
  );
}

function validateSoftBacklogForecast(value: unknown) {
  if (value === undefined) return true;
  return (
    isObject(value) &&
    isFiniteNumber(value.totalLaborHours) &&
    value.totalLaborHours >= 0 &&
    typeof value.startMonth === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.startMonth) &&
    typeof value.endMonth === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.endMonth) &&
    (value.method === 'straight-line' || value.method === 'bell-curve') &&
    isFiniteNumber(value.productiveHoursPerFteMonth) &&
    value.productiveHoursPerFteMonth > 0 &&
    typeof value.generated === 'boolean'
  );
}

function validateProject(
  value: unknown,
  months: number,
  laborCategories: string[],
): value is Project {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.department === 'string' &&
    (value.type === 'Hard' || value.type === 'Soft') &&
    isFiniteNumber(value.value) &&
    isFiniteNumber(value.planningProbability) &&
    isFiniteNumber(value.sourceProbability) &&
    isFiniteNumber(value.startIndex) &&
    (value.curveBasis === undefined ||
      value.curveBasis === 'total-internal-labor' ||
      value.curveBasis === 'base-category') &&
    validateSoftBacklogForecast(value.softBacklogForecast) &&
    typeof value.method === 'string' &&
    typeof value.quality === 'string' &&
    typeof value.primaryLabor === 'string' &&
    Array.isArray(value.curve) &&
    value.curve.length === months &&
    value.curve.every((item) => isFiniteNumber(item) && item >= 0) &&
    value.curve.some((item) => item > 0) &&
    (value.type !== 'Hard' ||
      (value.planningProbability === 100 && value.sourceProbability === 100)) &&
    validateAllocation(value.laborAllocation, laborCategories) &&
    isObject(value.costMix)
  );
}

function validateProposedProject(
  value: unknown,
  laborCategories: string[],
): value is ProposedProject {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.department === 'string' &&
    typeof value.projectType === 'string' &&
    isFiniteNumber(value.value) &&
    isFiniteNumber(value.startIndex) &&
    isFiniteNumber(value.durationMonths) &&
    isFiniteNumber(value.probability) &&
    typeof value.staffingCurve === 'string' &&
    isObject(value.costMix) &&
    validateAllocation(value.laborAllocation, laborCategories) &&
    Array.isArray(value.workPackages)
  );
}

function validateProposedProjectArchetype(
  value: unknown,
  laborCategories: string[],
): value is ProposedProjectArchetype {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.projectType === 'string' &&
    isFiniteNumber(value.defaultDurationMonths) &&
    value.defaultDurationMonths > 0 &&
    typeof value.staffingCurve === 'string' &&
    isObject(value.costMix) &&
    validateAllocation(value.laborAllocation, laborCategories) &&
    (value.laborHoursPerMillion === undefined ||
      (isFiniteNumber(value.laborHoursPerMillion) &&
        value.laborHoursPerMillion > 0))
  );
}

function validatePlan(
  value: unknown,
  laborCategories: string[],
): value is WorkforcePlan {
  if (!isObject(value) || !isObject(value.config)) return false;
  const capacity = value.config.capacity;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.config.actions) &&
    isObject(capacity) &&
    laborCategories.every((category) => isObject(capacity[category])) &&
    isObject(value.config.included) &&
    isObject(value.config.probabilities) &&
    Array.isArray(value.config.proposedProjects) &&
    value.config.proposedProjects.every((project) =>
      validateProposedProject(project, laborCategories),
    ) &&
    isObject(value.config.proposedIncluded)
  );
}

export function validatePlannerData(value: unknown): PlannerData {
  if (!isObject(value)) throw new Error('The published data is not an object.');
  if (value.schemaVersion !== 1)
    throw new Error(
      `Unsupported schema version: ${String(value.schemaVersion)}.`,
    );
  if (
    typeof value.publishedAt !== 'string' ||
    Number.isNaN(Date.parse(value.publishedAt))
  )
    throw new Error('publishedAt must be a valid date and time.');
  if (
    typeof value.forecastStart !== 'string' ||
    !MONTH_KEY.test(value.forecastStart)
  )
    throw new Error('forecastStart must use YYYY-MM format.');
  if (!Array.isArray(value.months) || value.months.length !== 18)
    throw new Error('The planning window must contain exactly 18 months.');
  const months = value.months;
  if (
    !months.every((month) => typeof month === 'string' && MONTH_KEY.test(month))
  )
    throw new Error('Every planning month must use YYYY-MM format.');
  if (months[0] !== value.forecastStart)
    throw new Error('forecastStart must match the first planning month.');
  for (let index = 1; index < months.length; index += 1) {
    if (months[index] !== nextMonth(months[index - 1]))
      throw new Error('Planning months must be consecutive.');
  }
  if (
    !isObject(value.source) ||
    typeof value.source.hardBacklogAsOf !== 'string' ||
    Number.isNaN(Date.parse(value.source.hardBacklogAsOf))
  )
    throw new Error('A Hard Backlog source date is required.');
  if (
    !Array.isArray(value.departments) ||
    !value.departments.length ||
    !value.departments.every((department) => typeof department === 'string')
  )
    throw new Error('At least one department is required.');
  if (
    !Array.isArray(value.laborCategories) ||
    !value.laborCategories.length ||
    !value.laborCategories.every((category) => typeof category === 'string')
  )
    throw new Error('At least one labor category is required.');
  if (!isObject(value.categoryFactors))
    throw new Error('Labor-category factors are required.');
  const categoryFactors = value.categoryFactors;
  const missingFactors = value.laborCategories.filter(
    (category) =>
      typeof category !== 'string' ||
      !isFiniteNumber(categoryFactors[category]),
  );
  if (missingFactors.length)
    throw new Error('Every labor category must have a numeric factor.');
  if (
    !Array.isArray(value.proposedProjectArchetypes) ||
    !value.proposedProjectArchetypes.every((archetype) =>
      validateProposedProjectArchetype(
        archetype,
        value.laborCategories as string[],
      ),
    )
  )
    throw new Error('One or more proposed-project archetypes are invalid.');
  const archetypeIds = value.proposedProjectArchetypes.map(
    (archetype) => archetype.id,
  );
  if (new Set(archetypeIds).size !== archetypeIds.length)
    throw new Error('Proposed-project archetype IDs must be unique.');
  if (
    !Array.isArray(value.projects) ||
    !value.projects.every((p) =>
      validateProject(p, 18, value.laborCategories as string[]),
    )
  )
    throw new Error('One or more projects are invalid.');
  const projectIds = value.projects.map((project) => project.id);
  if (new Set(projectIds).size !== projectIds.length)
    throw new Error('Project IDs must be unique.');
  if (
    !Array.isArray(value.initialPlans) ||
    !value.initialPlans.length ||
    !value.initialPlans.every((plan) =>
      validatePlan(plan, value.laborCategories as string[]),
    )
  )
    throw new Error('At least one valid published workforce plan is required.');
  return value as unknown as PlannerData;
}

export async function loadPlannerData(): Promise<PlannerDataLoadResult> {
  const requestedMode = import.meta.env.VITE_DATA_MODE;
  if (requestedMode === 'demo') {
    const data = getDemoPlannerData();
    return {
      ok: true,
      data,
      info: {
        mode: 'demo',
        publishedAt: data.publishedAt,
        sourceRevision: data.publishedAt,
        hardBacklogAsOf: data.source.hardBacklogAsOf,
        stale: false,
      },
    };
  }

  const url = new URL('data/workforce-planner.json', document.baseURI);
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`.trim());
    const data = validatePlannerData(await response.json());
    const asOf = new Date(data.source.hardBacklogAsOf);
    const ageDays = Math.floor((Date.now() - asOf.getTime()) / 86_400_000);
    return {
      ok: true,
      data,
      info: {
        mode: 'published',
        publishedAt: data.publishedAt,
        sourceRevision: data.publishedAt,
        hardBacklogAsOf: data.source.hardBacklogAsOf,
        stale: ageDays > 45,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (import.meta.env.DEV) {
      const data = getDemoPlannerData();
      return {
        ok: true,
        data,
        info: {
          mode: 'development-fallback',
          publishedAt: data.publishedAt,
          sourceRevision: data.publishedAt,
          hardBacklogAsOf: data.source.hardBacklogAsOf,
          stale: false,
          warning: `External data could not be loaded (${detail}).`,
        },
      };
    }
    return {
      ok: false,
      message: 'Published workforce data is unavailable.',
      detail: `The app could not load or validate ${url.pathname}: ${detail}`,
    };
  }
}
