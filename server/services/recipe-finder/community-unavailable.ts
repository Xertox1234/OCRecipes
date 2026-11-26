// server/services/recipe-finder/community-unavailable.ts

/**
 * The community search could not run (the index is still building, or the
 * search threw). Distinct from 0 matches: callers must not act on it as an
 * empty result (coach chat audit 2026-11-24, L50).
 */
export class CommunitySearchUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Community recipe search is unavailable", options);
    this.name = "CommunitySearchUnavailableError";
  }
}
