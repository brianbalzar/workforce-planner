import type { ScenarioConfig, WorkforcePlan } from '../domain/types';
import { INITIAL_PLANS } from '../data/sampleData';

const KEY = 'wfp.plans.v1';
interface Payload {
  version: 1;
  plans: WorkforcePlan[];
}

// Older saved data (or data missing fields introduced by a later build) is
// defaulted against a known-good template rather than trusted as-is, so one
// incomplete record can never blank the application. See REVIEW_RECOMMENDATIONS
// item 1: this is the migration/defaulting layer plus nested-data validation.
const TEMPLATE = INITIAL_PLANS[0].config;

function normalizeConfig(config: unknown): ScenarioConfig {
  const c = (
    config && typeof config === 'object' ? config : {}
  ) as Partial<ScenarioConfig>;
  return {
    probabilities: { ...TEMPLATE.probabilities, ...c.probabilities },
    included: { ...TEMPLATE.included, ...c.included },
    shifts: { ...TEMPLATE.shifts, ...c.shifts },
    packageIncluded: { ...TEMPLATE.packageIncluded, ...c.packageIncluded },
    proposedIncluded: c.proposedIncluded ?? TEMPLATE.proposedIncluded,
    proposed: c.proposed ?? structuredClone(TEMPLATE.proposed),
    actions: Array.isArray(c.actions)
      ? c.actions
      : structuredClone(TEMPLATE.actions),
    capacity: { ...TEMPLATE.capacity, ...c.capacity },
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
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(INITIAL_PLANS);
    const data = JSON.parse(raw) as Payload;
    if (data.version !== 1 || !Array.isArray(data.plans) || !data.plans.length)
      throw new Error('Invalid plan store');
    const normalized = data.plans
      .map(normalizePlan)
      .filter((p): p is WorkforcePlan => p !== null);
    return normalized.length ? normalized : structuredClone(INITIAL_PLANS);
  } catch {
    return structuredClone(INITIAL_PLANS);
  }
}
export function savePlans(
  plans: WorkforcePlan[],
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  storage.setItem(KEY, JSON.stringify({ version: 1, plans } satisfies Payload));
}
export function resetPlans(
  storage: Pick<Storage, 'removeItem'> = localStorage,
) {
  storage.removeItem(KEY);
  return structuredClone(INITIAL_PLANS);
}
export { KEY as PLAN_STORAGE_KEY };
