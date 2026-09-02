import { describe, expect, it } from 'vitest';
import { INITIAL_PLANS } from '../data/sampleData';
import { loadPlans, PLAN_STORAGE_KEY, savePlans } from './planStore';

describe('versioned plan persistence', () => {
  it('serializes and restores plans', () => {
    let value:string|null=null;
    savePlans(INITIAL_PLANS,{setItem:(key,next)=>{expect(key).toBe(PLAN_STORAGE_KEY);value=next}});
    const restored=loadPlans({getItem:()=>value});
    expect(restored.map(p=>p.name)).toEqual(INITIAL_PLANS.map(p=>p.name));
  });

  it('recovers from invalid or obsolete localStorage data', () => {
    expect(loadPlans({getItem:()=>'{bad json'})).toHaveLength(INITIAL_PLANS.length);
    expect(loadPlans({getItem:()=>JSON.stringify({version:0,plans:[]})})).toHaveLength(INITIAL_PLANS.length);
  });
});
