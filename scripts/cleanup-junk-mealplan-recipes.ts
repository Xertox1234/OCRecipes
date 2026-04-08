import "dotenv/config";
import { db } from "../server/db";
import {
  mealPlanRecipes,
  mealPlanItems,
  recipeIngredients,
  cookbookRecipes,
} from "../shared/schema";
import { sql, eq, and, inArray } from "drizzle-orm";

const JUNK_TITLES = [
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

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");

  const junk = await db
    .select({ id: mealPlanRecipes.id, title: mealPlanRecipes.title })
    .from(mealPlanRecipes)
    .where(
      sql`${mealPlanRecipes.title} IN (${sql.join(
        JUNK_TITLES.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    );

  console.log(`Found ${junk.length} junk meal plan recipes.`);

  if (DRY_RUN || junk.length === 0) {
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
