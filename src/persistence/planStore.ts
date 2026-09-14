import type { ScenarioConfig, WorkforcePlan } from '../domain/types';
import { INITIAL_PLANS, getRuntimeDataInfo } from '../data/runtimeData';

const KEY = 'wfp.plans.v1';
interface Payload {
  version: 1 | 2;
  plans: WorkforcePlan[];
  sourceRevision?: string;
}
export interface PlanLoadState {
  plans: WorkforcePlan[];
  sourceChanged: boolean;
}

// Older saved data (or data missing fields introduced by a later build) is
// defaulted against a known-good template rather than trusted as-is, so one
// incomplete record can never blank the application. See REVIEW_RECOMMENDATIONS
// item 1: this is the migration/defaulting layer plus nested-data validation.
const TEMPLATE = INITIAL_PLANS[0].config;

function normalizeConfig(config: unknown): ScenarioConfig {
  const c = (
    config && typeof config === 'object' ? config : {}
  ) as Partial<ScenarioConfig> & {
    proposedIncluded?: Record<string, boolean> | boolean;
    proposed?: ScenarioConfig['proposedProjects'][number];
  };
  const proposedProjects = Array.isArray(c.proposedProjects)
    ? c.proposedProjects
    : c.proposed
      ? [c.proposed]
      : structuredClone(TEMPLATE.proposedProjects);
  const proposedIncluded =
    c.proposedIncluded && typeof c.proposedIncluded === 'object'
      ? { ...TEMPLATE.proposedIncluded, ...c.proposedIncluded }
      : typeof c.proposedIncluded === 'boolean' && proposedProjects[0]
        ? { [proposedProjects[0].id]: c.proposedIncluded }
        : { ...TEMPLATE.proposedIncluded };
  const savedCapacity =
    c.capacity && typeof c.capacity === 'object' ? c.capacity : {};
  const capacity = Object.fromEntries(
    Object.entries(TEMPLATE.capacity).map(([category, defaults]) => [
      category,
      {
        ...defaults,
        ...(savedCapacity[category] &&
        typeof savedCapacity[category] === 'object'
          ? savedCapacity[category]
          : {}),
      },
    ]),
  );
  return {
    probabilities: { ...TEMPLATE.probabilities, ...c.probabilities },
    included: { ...TEMPLATE.included, ...c.included },
    shifts: { ...TEMPLATE.shifts, ...c.shifts },
    packageIncluded: { ...TEMPLATE.packageIncluded, ...c.packageIncluded },
    proposedIncluded,
    proposedProjects: structuredClone(proposedProjects),
    actions: Array.isArray(c.actions)
      ? c.actions
      : structuredClone(TEMPLATE.actions),
    capacity,
  };
}

function normalizePlan(plan: unknown): WorkforcePlan | null {
  if (!plan || typeof plan !== 'object') return null;
  const p = plan as Partial<WorkforcePlan>;
  if (!p.id || !p.name) return null;
  return {
    id: p.id,
    name: p.name,
    status: p.status ?? 'Draft',
    department: p.department ?? 'Mechanical — Metro',
    owner: p.owner ?? 'Unassigned',
    description: p.description ?? '',
    sourceDate: p.sourceDate ?? '',
    updatedDate: p.updatedDate ?? '',
    ...(p.stale !== undefined ? { stale: p.stale } : {}),
    config: normalizeConfig(p.config),
  };
}

export function loadPlans(
  storage: Pick<Storage, 'getItem'> = localStorage,
): WorkforcePlan[] {
  return loadPlanState(getRuntimeDataInfo().sourceRevision, storage).plans;
}

export function loadPlanState(
  currentSourceRevision: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): PlanLoadState {
  try {
    const raw = storage.getItem(KEY);
    if (!raw)
      return { plans: structuredClone(INITIAL_PLANS), sourceChanged: false };
    const data = JSON.parse(raw) as Payload;
    if (
      ![1, 2].includes(data.version) ||
      !Array.isArray(data.plans) ||
      !data.plans.length
    )
      throw new Error('Invalid plan store');
    const normalized = data.plans
      .map(normalizePlan)
      .filter((p): p is WorkforcePlan => p !== null);
    return {
      plans: normalized.length ? normalized : structuredClone(INITIAL_PLANS),
      sourceChanged:
        !!normalized.length && data.sourceRevision !== currentSourceRevision,
    };
  } catch {
    return { plans: structuredClone(INITIAL_PLANS), sourceChanged: false };
  }
}
export function savePlans(
  plans: WorkforcePlan[],
  storage: Pick<Storage, 'setItem'> = localStorage,
  sourceRevision = getRuntimeDataInfo().sourceRevision,
) {
  storage.setItem(
    KEY,
    JSON.stringify({ version: 2, sourceRevision, plans } satisfies Payload),
  );
}
export function resetPlans(
  storage: Pick<Storage, 'removeItem'> = localStorage,
) {
  storage.removeItem(KEY);
  return structuredClone(INITIAL_PLANS);
}
export { KEY as PLAN_STORAGE_KEY };
