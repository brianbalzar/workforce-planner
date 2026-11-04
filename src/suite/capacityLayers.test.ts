import { describe, expect, it } from 'vitest';
import { capacityLayers, type Cell } from './engine';

function cell(
  demand: number,
  roster: number,
  confirmed = 0,
  planned = 0,
): Cell {
  return {
    hard: demand,
    carry: 0,
    soft: 0,
    proposed: 0,
    actual: 0,
    historyPlan: demand,
    roster,
    confirmed,
    planned,
    capConf: roster + confirmed,
    cap: roster + confirmed + planned,
    gap: 0,
    spare: 0,
  };
}

describe('capacity chart department and category layers', () => {
  it('retains shortages alongside spare capacity in another crew', () => {
    const layers = capacityLayers([cell(100, 40), cell(20, 80)], false);
    expect(layers.uConf).toBe(60);
    expect(layers.shortConf).toBe(60);
    expect(layers.shortPlan).toBe(60);
    expect(layers.open).toBe(60);
    expect(layers.uConf + layers.uAssumed + layers.shortPlan).toBe(120);
  });

  it('separates secured and planned additions and conserves the component stack', () => {
    const layers = capacityLayers([cell(100, 40, 20, 20)], false);
    expect(layers.uConf).toBe(60);
    expect(layers.uAssumed).toBe(20);
    expect(layers.shortConf).toBe(40);
    expect(layers.shortPlan).toBe(20);
    expect(layers.uRoster + layers.uConfirmed + layers.uPlanned).toBe(80);
    expect(layers.uConf + layers.uAssumed + layers.shortPlan).toBe(100);
  });

  it('uses historical planned workload without manufacturing historical gaps', () => {
    const historical = { ...cell(999, 40), historyPlan: 80 };
    const layers = capacityLayers([historical], true);
    expect(layers.uConf).toBe(40);
    expect(layers.shortConf).toBe(0);
    expect(layers.shortPlan).toBe(0);
    expect(layers.open).toBe(0);
  });
});
