import type { WorkforcePlan } from '../domain/types';
import { INITIAL_PLANS } from '../data/sampleData';

const KEY = 'wfp.plans.v1';
interface Payload {
  version: 1;
  plans: WorkforcePlan[];
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
    return data.plans;
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
