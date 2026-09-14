import type { PlannerData, Project } from '../domain/types';
import {
  CATEGORY_FACTORS as SAMPLE_CATEGORY_FACTORS,
  DEPARTMENTS as SAMPLE_DEPARTMENTS,
  INITIAL_PLANS as SAMPLE_INITIAL_PLANS,
  LABOR_CATEGORIES as SAMPLE_LABOR_CATEGORIES,
  MONTH_KEYS as SAMPLE_MONTH_KEYS,
  MONTHS as SAMPLE_MONTHS,
  ATLAS,
  PROJECTS as SAMPLE_PROJECTS,
} from './sampleData';

export type RuntimeDataMode =
  | 'published'
  | 'uploaded'
  | 'demo'
  | 'development-fallback';

export interface RuntimeDataInfo {
  mode: RuntimeDataMode;
  publishedAt: string;
  sourceRevision: string;
  hardBacklogAsOf: string;
  stale: boolean;
  warning?: string;
}

const demoData: PlannerData = {
  schemaVersion: 1,
  publishedAt: '2026-09-02T00:00:00.000Z',
  forecastStart: SAMPLE_MONTH_KEYS[0],
  months: [...SAMPLE_MONTH_KEYS],
  source: {
    hardBacklogAsOf: '2026-08-30',
    softBacklogAsOf: '2026-09-01',
    notes: 'Sanitized demonstration dataset.',
  },
  departments: [...SAMPLE_DEPARTMENTS],
  laborCategories: [...SAMPLE_LABOR_CATEGORIES],
  categoryFactors: { ...SAMPLE_CATEGORY_FACTORS },
  proposedProjectArchetypes: [
    {
      id: 'data-center-plumbing-package',
      name: 'Data center — plumbing package',
      projectType: ATLAS.projectType,
      defaultDurationMonths: ATLAS.durationMonths,
      staffingCurve: ATLAS.staffingCurve,
      costMix: { ...ATLAS.costMix },
      laborAllocation: { ...ATLAS.laborAllocation },
      notes:
        'Demonstration assumptions only. Replace with reviewed historical estimate and forecast benchmarks.',
    },
  ],
  projects: structuredClone(SAMPLE_PROJECTS),
  initialPlans: structuredClone(SAMPLE_INITIAL_PLANS),
};

export let MONTH_KEYS = [...demoData.months];
export let MONTHS = [...SAMPLE_MONTHS];
export let DEPARTMENTS = [...demoData.departments];
export let LABOR_CATEGORIES = [...demoData.laborCategories];
export let CATEGORY_FACTORS = { ...demoData.categoryFactors };
export let PROPOSED_PROJECT_ARCHETYPES = structuredClone(
  demoData.proposedProjectArchetypes,
);
export let PROJECTS = structuredClone(demoData.projects);
export let INITIAL_PLANS = structuredClone(demoData.initialPlans);

let activeData = structuredClone(demoData);
let runtimeInfo: RuntimeDataInfo = {
  mode: 'demo',
  publishedAt: demoData.publishedAt,
  sourceRevision: demoData.publishedAt,
  hardBacklogAsOf: demoData.source.hardBacklogAsOf,
  stale: false,
};

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    year: 'numeric',
  });
}

export function activatePlannerData(data: PlannerData, info: RuntimeDataInfo) {
  activeData = structuredClone(data);
  runtimeInfo = { ...info };
  MONTH_KEYS = [...data.months];
  MONTHS = data.months.map(monthLabel);
  DEPARTMENTS = [...data.departments];
  LABOR_CATEGORIES = [...data.laborCategories];
  CATEGORY_FACTORS = { ...data.categoryFactors };
  PROPOSED_PROJECT_ARCHETYPES = structuredClone(data.proposedProjectArchetypes);
  PROJECTS = structuredClone(data.projects);
  INITIAL_PLANS = structuredClone(data.initialPlans);
}

export const getActivePlannerData = () => structuredClone(activeData);
export const getRuntimeDataInfo = () => ({ ...runtimeInfo });
export const getDemoPlannerData = () => structuredClone(demoData);

export function addRuntimeProject(project: Project) {
  if (activeData.projects.some((item) => item.id === project.id))
    throw new Error(`Project number ${project.id} already exists.`);
  activeData.projects.push(structuredClone(project));
  PROJECTS = structuredClone(activeData.projects);
}

export function updateRuntimeProject(projectId: string, project: Project) {
  const index = activeData.projects.findIndex((item) => item.id === projectId);
  if (index < 0) throw new Error(`Project number ${projectId} was not found.`);
  if (
    project.id !== projectId &&
    activeData.projects.some((item) => item.id === project.id)
  )
    throw new Error(`Project number ${project.id} already exists.`);
  activeData.projects[index] = structuredClone(project);
  PROJECTS = structuredClone(activeData.projects);
}
