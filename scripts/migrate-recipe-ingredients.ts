// scripts/migrate-recipe-ingredients.ts
/**
 * One-time migration: Extract ingredients embedded in the instructions array
 * into the proper ingredients array for community recipes.
 *
 * Affected recipes have `ingredients: []` and their ingredient list stored
 * inside `instructions`, bracketed by "Ingredients:" and "Instructions:" labels.
 *
 * Polarity: dry-run by DEFAULT — pass --commit (without --dry-run, which
 * vetoes it) to actually write changes.
 *
 * This script creates NO backup table and its write REPLACES both
 * `ingredients` and `instructions` on the matched row, so a bad split is
 * unrecoverable. `splitInstructionsArray` therefore refuses any row it cannot
 * split into a non-empty ingredients AND instructions pair; every refusal is
 * printed as an explicit `[SKIP] ... NOTHING WRITTEN` line.
 *
 * Usage:
 *   npx tsx scripts/migrate-recipe-ingredients.ts            # dry-run (default)
 *   npx tsx scripts/migrate-recipe-ingredients.ts --commit   # actually write changes
 *   (--dry-run vetoes --commit if both are passed)
 */
import "dotenv/config";
import { db } from "../server/db";
import { communityRecipes } from "../shared/schema";
import { sql, eq } from "drizzle-orm";
// Parsers live in the -utils leaf (DB-free) so the A-D pattern matrix is
// unit-tested against the exact functions this script executes.
import {
  splitInstructionsArray,
  parseCleanupFlags,
} from "./migrate-recipe-ingredients-utils";

/**
 * Best-effort, redacted description of the connection target, logged in the
 * banner so the operator can confirm which DB they are about to rewrite before
 * typing --commit. Never prints credentials (host/port/db name only).
 * Mirrors `server/scripts/backfill-email-verified.ts::describeTarget`.
 */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL unset)";
  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\//, "") || "(default)";
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname}${port}/${dbName}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Exported (rather than a module-private function) so a test can invoke it
// directly with a controlled argv and a mocked `db`, bypassing the auto-run
// below. The real write gate (`if (COMMIT)` further down) sits behind an
// unconditional DB read (the `communityRecipes` select just below), so no
// no-DB spawnSync test can ever reach it — an in-process test with a mocked
// db is the only route that reaches this gate at all.
export async function main(argv: readonly string[] = process.argv) {
  // Dry-run by DEFAULT — pass --commit (without --dry-run, which vetoes it)
  // to actually write changes.
  const { commit: COMMIT, vetoed: VETOED } = parseCleanupFlags(argv);
  console.log(
    COMMIT
      ? "=== LIVE RUN ==="
      : VETOED
        ? "=== DRY RUN ===  (--dry-run overrides --commit; drop --dry-run to write changes)"
        : "=== DRY RUN ===  (pass --commit to write changes)",
  );
  console.log(`Target DB: ${describeTarget()}`);
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
      // POSITIVE skip signal. `splitInstructionsArray` returns null for all
      // four unsplittable shapes — including an empty steps section, which
      // before the guard produced a [MIGRATE] line whose only tell was an
      // ABSENT "First instruction step:" preview. Never leave "nothing was
      // written" to be inferred from a missing line.
      console.log(
        `[SKIP] #${recipe.id} "${recipe.title}" — NOTHING WRITTEN: could not split into a non-empty ingredients AND instructions pair (missing Ingredients:/Instructions: markers, or a section that parsed empty). Row left untouched.`,
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

    // Both arrays are guaranteed non-empty here — `splitInstructionsArray`
    // returns null rather than a half-empty result, so these previews always
    // print for a [MIGRATE] row.
    console.log("  Sample ingredients:");
    result.ingredients.slice(0, 3).forEach((ing) => {
      const parts = [ing.quantity, ing.unit, ing.name].filter(Boolean);
      console.log(`    - ${parts.join(" ")}`);
    });
    if (result.ingredients.length > 3) {
      console.log(`    ... and ${result.ingredients.length - 3} more`);
    }

    console.log(`  First instruction step: "${result.instructions[0]}"`);
    console.log();

    if (COMMIT) {
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
  console.log(`${COMMIT ? "Migrated" : "Would migrate"}: ${migratedCount}`);
  console.log(`Skipped:  ${skippedCount}`);

  if (COMMIT) {
    console.log("\nMigration complete.");
  } else if (VETOED) {
    console.log(
      "\nDry run complete — no changes written. (--dry-run overrode --commit)",
    );
  } else {
    console.log(
      "\nDry run complete — no changes written. Pass --commit to write changes.",
    );
  }
}

// Guard the auto-run so importing `main` (e.g. from a test with a mocked db)
// doesn't also trigger the real CLI entrypoint.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]?.includes("migrate-recipe-ingredients"));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
