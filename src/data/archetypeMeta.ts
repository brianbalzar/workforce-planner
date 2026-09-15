import type { ProposedProjectArchetype } from '../domain/types';

/** Top two labor categories by %, same "sort by share, take the top ones"
 * pattern primaryLabor already uses elsewhere in this codebase — no new
 * data field needed. */
export function leadingTrades(
  archetype: ProposedProjectArchetype,
): [string, number][] {
  return Object.entries(archetype.laborAllocation)
    .filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
}

const COMPARABLE_COUNT_RE = /averaged from (\d+) real hard backlog projects/i;

/**
 * The published data doesn't have a clean comparableCount field yet — this
 * count only exists inside each archetype's free-text notes string. Parses
 * it out for display; returns null (meta line drops the count) if notes
 * don't match this exact pipeline-authored phrasing, rather than guessing.
 */
export function comparableProjectCount(
  archetype: ProposedProjectArchetype,
): number | null {
  const match = archetype.notes
    ? COMPARABLE_COUNT_RE.exec(archetype.notes)
    : null;
  return match ? Number(match[1]) : null;
}
