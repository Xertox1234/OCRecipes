import "dotenv/config";
import { db } from "../server/db";
import {
  mealPlanRecipes,
  mealPlanItems,
  recipeIngredients,
  cookbookRecipes,
} from "../shared/schema";
import { sql, eq, and, inArray } from "drizzle-orm";
import {
  buildJunkMealplanTitleWhere,
  parseCleanupFlags,
} from "./cleanup-junk-mealplan-recipes-utils";

// Predicate + flags live in the -utils leaf so the deletion perimeter is
// unit-tested. Dry-run by DEFAULT — pass --commit to actually delete.
const { commit: COMMIT } = parseCleanupFlags(process.argv);

async function main() {
  console.log(
    COMMIT ? "=== LIVE RUN ===" : "=== DRY RUN ===  (pass --commit to delete)",
  );

  const junk = await db
    .select({ id: mealPlanRecipes.id, title: mealPlanRecipes.title })
    .from(mealPlanRecipes)
    .where(buildJunkMealplanTitleWhere());

  console.log(`Found ${junk.length} junk meal plan recipes.`);

  if (!COMMIT || junk.length === 0) {
    const counts: Record<string, number> = {};
    for (const r of junk) {
      counts[r.title] = (counts[r.title] ?? 0) + 1;
    }
    for (const [title, count] of Object.entries(counts)) {
      console.log(`  "${title}" x${count}`);
    }
    console.log("No changes made.");
    process.exit(0);
  }

  const ids = junk.map((r) => r.id);
  const BATCH = 100;

  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      await tx
        .delete(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, batch));
      await tx
        .delete(mealPlanItems)
        .where(inArray(mealPlanItems.recipeId, batch));
      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, batch),
            eq(cookbookRecipes.recipeType, "meal_plan"),
          ),
        );
      await tx
        .delete(mealPlanRecipes)
        .where(inArray(mealPlanRecipes.id, batch));
      console.log(
        `  Deleted batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(ids.length / BATCH)} (${batch.length} recipes)`,
      );
    }
  });

  const remaining = await db
    .select({ count: sql<number>`count(*)` })
    .from(mealPlanRecipes);
  console.log(
    `Done. ${junk.length} junk recipes deleted. ${Number(remaining[0]?.count ?? 0)} recipes remain.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
