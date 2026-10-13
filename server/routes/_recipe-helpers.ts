/**
 * Helpers shared across the split recipe route modules
 * (`recipes.ts`, `recipe-search.ts`, `recipe-import.ts`).
 */

/** Strip authorId from public-facing community recipe responses. */
export function stripAuthorId<T extends { authorId?: unknown }>(
  recipes: T[],
): Omit<T, "authorId">[] {
  return recipes.map(({ authorId: _, ...rest }) => rest);
}

/** Single-recipe variant of `stripAuthorId` — prefer this over inline destructuring at call sites. */
export function stripAuthorIdOne<T extends { authorId?: unknown }>(
  recipe: T,
): Omit<T, "authorId"> {
  const { authorId: _, ...rest } = recipe;
  return rest;
}
