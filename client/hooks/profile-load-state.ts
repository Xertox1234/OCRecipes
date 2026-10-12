/**
 * Pure load-state logic for the Profile hub (QA sweep #61), extracted so
 * Vitest can cover it without rendering the screen.
 */

interface QueryLike {
  isError: boolean;
  error: unknown;
  data: unknown;
}

/** apiRequest errors keep the `${status}: ${text}` message shape. */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /^429:/.test(error.message);
}

export interface ProfileLoadState {
  /** Show the full-screen error — only when a failed query has nothing to show. */
  isError: boolean;
  /** At least one blocking failure was a 429 (rate limit), not connectivity. */
  isRateLimited: boolean;
}

export function getProfileLoadState(queries: QueryLike[]): ProfileLoadState {
  // A failed background refetch with data already on screen (keepPreviousData)
  // must not replace the whole profile with the error screen.
  const blocking = queries.filter((q) => q.isError && q.data === undefined);
  return {
    isError: blocking.length > 0,
    isRateLimited: blocking.some((q) => isRateLimitError(q.error)),
  };
}
