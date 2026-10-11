import type { RecipeCommunityStats } from "@shared/types/recipe-community";

export function formatPeopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

export function triedBarCaption(n: number): string {
  return n === 0
    ? "Be the first to try it"
    : `${formatPeopleCount(n)} tried this`;
}

export function triedButtonLabel(triedByMe: boolean): string {
  return triedByMe ? "Tried" : "I tried it";
}

export function triedButtonA11yLabel(n: number): string {
  return n === 0
    ? "I tried it, no one has tried this yet"
    : `I tried it, ${formatPeopleCount(n)} tried this`;
}

export function triedRowValue(n: number): string {
  return n === 0 ? "Be the first" : formatPeopleCount(n);
}

export function favouritedRowValue(n: number): string {
  return n === 0 ? "Not yet" : formatPeopleCount(n);
}

export function variantsRowValue(n: number): string {
  return n === 0 ? "Remix it" : String(n);
}

/** Optimistic cache update for the tried toggle; a no-op when already there. */
export function applyTriedOptimistic(
  stats: RecipeCommunityStats,
  tried: boolean,
): RecipeCommunityStats {
  if (stats.triedByMe === tried) return stats;
  return {
    ...stats,
    triedByMe: tried,
    triedCount: Math.max(0, stats.triedCount + (tried ? 1 : -1)),
  };
}
