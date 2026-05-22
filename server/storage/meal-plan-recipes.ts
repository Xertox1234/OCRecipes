/**
 * Backward-compatible facade — re-exports all meal-plan-recipe storage
 * functions from domain-scoped sub-modules.
 *
 * Sub-modules:
 *   meal-plan-recipes-crud.ts   — recipe CRUD + suggestion batch insert
 *   meal-plan-recipes-browse.ts — unified browse, search-index loaders,
 *                                 meal-type backfill
 *
 * All consumers (server/storage/meal-plans.ts, routes, services, tests) that
 * import from "./meal-plan-recipes" continue to work without modification.
 */
export * from "./meal-plan-recipes-crud";
export * from "./meal-plan-recipes-browse";
