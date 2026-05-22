/**
 * Backward-compatible facade — re-exports all community-recipe storage
 * functions from domain-scoped sub-modules.
 *
 * Sub-modules:
 *   community-recipes.ts        — recipe CRUD, browse/featured columns, sharing
 *   community-generation-log.ts — daily generation-quota log + atomic limit check
 *   community-meal-types.ts     — meal-type backfill helpers
 *
 * All consumers (server/storage/index.ts, meal-plan-recipes.ts, tests) that
 * import from "./community" continue to work without modification.
 */
export * from "./community-recipes";
export * from "./community-generation-log";
export * from "./community-meal-types";
