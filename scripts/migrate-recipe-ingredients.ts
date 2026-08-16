// scripts/migrate-recipe-ingredients.ts
/**
 * One-time migration: Extract ingredients embedded in the instructions array
 * into the proper ingredients array for community recipes.
 *
 * Affected recipes have `ingredients: []` and their ingredient list stored
 * inside `instructions`, bracketed by "Ingredients:" and "Instructions:" labels.
 *
 * Usage:
 *   npx tsx scripts/migrate-recipe-ingredients.ts           # live run
 *   npx tsx scripts/migrate-recipe-ingredients.ts --dry-run # preview only
 */
import "dotenv/config";
import { db } from "../server/db";
import { communityRecipes } from "../shared/schema";
import { sql, eq } from "drizzle-orm";
// Parsers live in the -utils leaf (DB-free) so the A-D pattern matrix is
// unit-tested against the exact functions this script executes.
import { splitInstructionsArray } from "./migrate-recipe-ingredients-utils";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== LIVE RUN ===");
  console.log();

  // Query all community recipes where ingredients array is empty
  const recipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      instructions: communityRecipes.instructions,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes)
    .where(
      sql`COALESCE(jsonb_array_length(${communityRecipes.ingredients}), 0) = 0`,
    );

  console.log(`Found ${recipes.length} recipe(s) with empty ingredients.\n`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const recipe of recipes) {
    const instructions = recipe.instructions as string[];

    if (!Array.isArray(instructions) || instructions.length === 0) {
      console.log(
        `[SKIP] #${recipe.id} "${recipe.title}" — instructions is empty or not an array`,
      );
      skippedCount++;
      continue;
    }

    const result = splitInstructionsArray(instructions);

    if (!result) {
      console.log(
        `[SKIP] #${recipe.id} "${recipe.title}" — no Ingredients:/Instructions: markers found`,
      );
      skippedCount++;
      continue;
    }

    console.log(`[MIGRATE] #${recipe.id} "${recipe.title}"`);
    console.log(
      `  Before: ${instructions.length} instruction lines, 0 ingredients`,
    );
    console.log(
      `  After:  ${result.instructions.length} instruction steps, ${result.ingredients.length} ingredients`,
    );

    if (result.ingredients.length > 0) {
      console.log("  Sample ingredients:");
      result.ingredients.slice(0, 3).forEach((ing) => {
        const parts = [ing.quantity, ing.unit, ing.name].filter(Boolean);
        console.log(`    - ${parts.join(" ")}`);
      });
      if (result.ingredients.length > 3) {
        console.log(`    ... and ${result.ingredients.length - 3} more`);
      }
    }

    if (result.instructions.length > 0) {
      console.log(`  First instruction step: "${result.instructions[0]}"`);
    }
    console.log();

    if (!DRY_RUN) {
      await db
        .update(communityRecipes)
        .set({
          ingredients: result.ingredients,
          instructions: result.instructions,
        })
        .where(eq(communityRecipes.id, recipe.id));
    }

    migratedCount++;
  }

  console.log("---");
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Skipped:  ${skippedCount}`);

  if (DRY_RUN) {
    console.log("\nDry run complete — no changes written.");
  } else {
    console.log("\nMigration complete.");
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
