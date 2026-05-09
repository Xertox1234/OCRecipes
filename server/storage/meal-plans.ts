/**
 * Backward-compatible facade — re-exports all meal-plan storage functions
 * from domain-scoped sub-modules.
 *
 * Sub-modules:
 *   meal-plan-recipes.ts   — recipe CRUD, search-index management, meal-type backfill
 *   meal-plan-items.ts     — scheduling, confirmation helpers
 *   meal-plan-analytics.ts — nutrition aggregation, frequent recipes, popular picks
 *
 * All consumers (server/storage/index.ts, routes, services, tests) that import
 * from "./meal-plans" continue to work without modification.
 */
export * from "./meal-plan-recipes";
export * from "./meal-plan-items";
export * from "./meal-plan-analytics";
