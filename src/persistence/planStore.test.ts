import { describe, expect, it } from 'vitest';
import { INITIAL_PLANS } from '../data/sampleData';
import { loadPlans, PLAN_STORAGE_KEY, savePlans } from './planStore';

describe('versioned plan persistence', () => {
  it('serializes and restores plans', () => {
    let value: string | null = null;
    savePlans(INITIAL_PLANS, {
      setItem: (key, next) => {
        expect(key).toBe(PLAN_STORAGE_KEY);
        value = next;
      },
    });
    const restored = loadPlans({ getItem: () => value });
    expect(restored.map((p) => p.name)).toEqual(
      INITIAL_PLANS.map((p) => p.name),
    );
  });

  it('recovers from invalid or obsolete localStorage data', () => {
    expect(loadPlans({ getItem: () => '{bad json' })).toHaveLength(
      INITIAL_PLANS.length,
    );
    expect(
      loadPlans({ getItem: () => JSON.stringify({ version: 0, plans: [] }) }),
    ).toHaveLength(INITIAL_PLANS.length);
  });

  it('defaults a plan saved by an older build that is missing newer config fields', () => {
    // Mimics a pre-Pass-1 saved plan: no packageIncluded, proposedIncluded,
    // proposed, actions, or capacity on config, and no department/owner on
    // the plan itself. Loading this must not throw (see REVIEW_RECOMMENDATIONS
    // item 1 — this previously crashed the Project Drawer at the unguarded
    // config.packageIncluded[w.id] access).
    const legacyPlan = {
      id: 'legacy-1',
      name: 'Legacy plan',
      config: {
        probabilities: {},
        included: {},
        shifts: {},
        // packageIncluded, proposedIncluded, proposed, actions, capacity
        // deliberately omitted.
      },
    };
    const raw = JSON.stringify({ version: 1, plans: [legacyPlan] });
    const restored = loadPlans({ getItem: () => raw });
    expect(restored).toHaveLength(1);
    const [plan] = restored;
    expect(plan.department).toBeTruthy();
    expect(plan.owner).toBeTruthy();
    expect(plan.config.packageIncluded).toEqual(
      INITIAL_PLANS[0].config.packageIncluded,
    );
    expect(plan.config.proposedIncluded).toBe(
      INITIAL_PLANS[0].config.proposedIncluded,
    );
    expect(Array.isArray(plan.config.actions)).toBe(true);
    expect(plan.config.capacity).toEqual(INITIAL_PLANS[0].config.capacity);
  });

  it('drops malformed plan records instead of corrupting the whole list', () => {
    const raw = JSON.stringify({
      version: 1,
      plans: [{ notAPlan: true }, null, 42],
    });
    // Every record is unusable, so loadPlans falls back to the sample data
    // rather than returning an empty or partially-broken list.
    expect(loadPlans({ getItem: () => raw })).toHaveLength(
      INITIAL_PLANS.length,
    );
  });
});
