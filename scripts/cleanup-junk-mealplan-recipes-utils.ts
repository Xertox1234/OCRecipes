/**
 * Pure helpers for `cleanup-junk-mealplan-recipes.ts` — the DB-free leaf
 * (policy: docs/solutions/design-patterns/db-free-policy-leaf-module-for-
 * operator-tooling-2026-07-24.md). The script runs `main()` at module load and
 * cannot be imported in a test; the deletion predicate lives here so the suite
 * asserts on the exact SQL the script executes.
 */
import { sql } from "drizzle-orm";
import { mealPlanRecipes } from "../shared/schema";

/**
 * Titles deleted by EXACT match, across ALL users (no author scoping).
 * Several are titles a real user could plausibly type — which is why the
 * script previews by default and only deletes on --commit.
 */
export const JUNK_TITLES = [
  "Full Recipe",
  "Ordered",
  "Shared Recipe",
  "Other Recipe",
  "With Ingredients",
  "Test Recipe",
  "Chicken Rice",
  "Meal 1",
  "Meal 2",
  "Simple Meal",
];

/** The deletion perimeter: meal_plan_recipes.title IN (exact junk titles). */
export function buildJunkMealplanTitleWhere() {
  return sql`${mealPlanRecipes.title} IN (${sql.join(
    JUNK_TITLES.map((t) => sql`${t}`),
    sql`, `,
  )})`;
}

/**
 * CLI contract: preview by default; deletion only on an explicit --commit.
 * (`--dry-run` is accepted as a no-op alias so stale invocations from the old
 * live-by-default contract keep previewing — the safe failure direction.)
 */
export function parseCleanupFlags(argv: readonly string[]): {
  commit: boolean;
} {
  return { commit: argv.includes("--commit") };
}
