/**
 * Helpers shared across the split recipe route modules
 * (`recipes.ts`, `recipe-search.ts`, `recipe-catalog.ts`, `recipe-import.ts`).
 */

/** Strip authorId from public-facing community recipe responses. */
export function stripAuthorId<T extends { authorId?: unknown }>(
  recipes: T[],
): Omit<T, "authorId">[] {
  return recipes.map(({ authorId: _, ...rest }) => rest);
}
