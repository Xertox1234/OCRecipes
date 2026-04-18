/* eslint-disable no-console */
/**
 * Cleanup script: removes seed-generated AND leaked test community recipes,
 * along with their associated image files, generation logs, cookbook refs,
 * and favourites.
 *
 * Identifies junk by `normalizedProductName` prefix:
 *   - `seed-*` → seed script output (`server/scripts/seed-recipes.ts`)
 *   - `test-*` → Vitest test data (test factories + storage `__tests__`
 *     insert helpers). New tests MUST use a `test-` prefix so cleanup
 *     catches the row automatically — see
 *     `cleanup-seed-recipes-utils.ts` for the convention.
 *
 * `LEGACY_TEST_PRODUCT_NAMES` is a one-off back-compat allowlist for dev
 * databases that still contain pre-prefix-convention leaks. Safe to drop
 * after a few release cycles. (L-4, audit 2026-04-17.)
 *
 * Safety:
 *   - Defaults to DRY-RUN. Pass `--commit` to actually delete.
 *   - Scoped to orphan (authorId IS NULL) or the demo user only — never
 *     touches real user recipes. See
 *     `docs/patterns/security.md` → "Seed / Cleanup Scripts Must Scope by
 *     `authorId`, Not Just Name" for rationale.
 *
 * Usage:
 *   npm run cleanup:seeds              # dry-run (default)
 *   npm run cleanup:seeds -- --commit  # actually delete
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import {
  communityRecipes,
  recipeGenerationLog,
  cookbookRecipes,
  favouriteRecipes,
  recipeDismissals,
  users,
} from "@shared/schema";
import { eq, and, ilike, inArray, or, sql, isNull } from "drizzle-orm";
import {
  LEGACY_TEST_PRODUCT_NAMES,
  SEED_PREFIX,
  TEST_PREFIX,
} from "./cleanup-seed-recipes-utils";

const RECIPE_IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");

// Accept only filenames with safe chars and an image extension. This blocks
// path-traversal (`../`) and absolute paths that could be injected via a
// malicious `imageUrl` in the DB. Keep in sync with allowed extensions used
// by `server/services/recipe-generation.ts::saveImageBuffer` (currently
// `.png`).
const IMAGE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/;

function parseArgs(argv: string[]): { commit: boolean } {
  const commit = argv.includes("--commit");
  return { commit };
}

async function main() {
  const { commit } = parseArgs(process.argv.slice(2));
  const mode = commit ? "COMMIT" : "DRY-RUN";

  console.log("=== Cleanup Junk Recipes ===");
  console.log(`Mode: ${mode}${commit ? "" : "  (pass --commit to delete)"}\n`);

  // Resolve demo user ID so we can restrict deletion to orphan/demo-authored
  // rows and NEVER touch real user recipes that happen to share a test name.
  const demoUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "demo"));
  const demoUserId = demoUserRows[0]?.id ?? null;

  const authorIdCondition = demoUserId
    ? or(
        isNull(communityRecipes.authorId),
        eq(communityRecipes.authorId, demoUserId),
      )
    : isNull(communityRecipes.authorId);

  // Find all junk recipes: seeds + leaked test data — scoped to orphan or demo author
  const junkRecipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      authorId: communityRecipes.authorId,
      normalizedProductName: communityRecipes.normalizedProductName,
      imageUrl: communityRecipes.imageUrl,
    })
    .from(communityRecipes)
    .where(
      and(
        authorIdCondition,
        or(
          // `seed-*` → seed script output
          ilike(communityRecipes.normalizedProductName, `${SEED_PREFIX}%`),
          // `test-*` → Vitest test factories / insert helpers
          ilike(communityRecipes.normalizedProductName, `${TEST_PREFIX}%`),
          // Back-compat for pre-convention dev DBs
          inArray(
            communityRecipes.normalizedProductName,
            LEGACY_TEST_PRODUCT_NAMES,
          ),
        ),
      ),
    );

  if (junkRecipes.length === 0) {
    console.log("No junk recipes found. Database is clean.");
    await pool.end();
    return;
  }

  // Bucket counts so the operator can see at a glance whether they're
  // wiping fresh test leaks vs. legacy pre-convention rows.
  const seedCount = junkRecipes.filter((r) =>
    r.normalizedProductName.toLowerCase().startsWith(SEED_PREFIX),
  ).length;
  const testPrefixCount = junkRecipes.filter((r) =>
    r.normalizedProductName.toLowerCase().startsWith(TEST_PREFIX),
  ).length;
  const legacyCount = junkRecipes.length - seedCount - testPrefixCount;

  console.log(
    `Found ${junkRecipes.length} junk recipes (${seedCount} seeds, ${testPrefixCount} test-prefix, ${legacyCount} legacy)\n`,
  );

  // List each target so reviewers can audit before committing.
  for (const r of junkRecipes) {
    console.log(
      `  - id=${r.id}  authorId=${r.authorId ?? "NULL"}  title=${JSON.stringify(r.title)}  normalized=${r.normalizedProductName}`,
    );
  }
  console.log("");

  const junkIds = junkRecipes.map((r) => r.id);

  // Pre-count cascaded rows so the dry-run output is informative even though
  // nothing is deleted.
  // NOTE: `recipeGenerationLog.recipeId` has `onDelete: "set null"` in the
  // schema — explicit deletion is required, otherwise orphaned log rows
  // continue to count toward the user's daily recipe generation limit. The
  // batch delete below is therefore load-bearing, not redundant.
  const dismissalIdentifiersAll = junkIds.map(String);
  const cascadeCounts = {
    recipeGenerationLog: (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(recipeGenerationLog)
        .where(inArray(recipeGenerationLog.recipeId, junkIds))
    )[0]?.count,
    cookbookRecipes: (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, junkIds),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        )
    )[0]?.count,
    favouriteRecipes: (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(favouriteRecipes)
        .where(
          and(
            inArray(favouriteRecipes.recipeId, junkIds),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        )
    )[0]?.count,
    recipeDismissals: (
      await db
        .select({ count: sql<number>`count(*)` })
        .from(recipeDismissals)
        .where(
          and(
            inArray(recipeDismissals.recipeIdentifier, dismissalIdentifiersAll),
            eq(recipeDismissals.source, "community"),
          ),
        )
    )[0]?.count,
  };

  console.log("Cascaded rows that would be deleted:");
  console.log(
    `  recipe_generation_log: ${cascadeCounts.recipeGenerationLog ?? 0}`,
  );
  console.log(`  cookbook_recipes:      ${cascadeCounts.cookbookRecipes ?? 0}`);
  console.log(
    `  favourite_recipes:     ${cascadeCounts.favouriteRecipes ?? 0}`,
  );
  console.log(
    `  recipe_dismissals:     ${cascadeCounts.recipeDismissals ?? 0}`,
  );
  console.log("");

  if (!commit) {
    console.log(
      "DRY-RUN: no changes committed. Re-run with --commit to delete.",
    );
    await pool.end();
    return;
  }

  // Delete in batches of 500 to avoid parameter limit issues
  const BATCH = 500;
  let totalDeleted = 0;

  for (let i = 0; i < junkIds.length; i += BATCH) {
    const batch = junkIds.slice(i, i + BATCH);

    await db.transaction(async (tx) => {
      // Explicit delete — `recipeGenerationLog.recipeId` is `onDelete: set null`,
      // so without this the daily-limit counter would be skewed by orphaned rows.
      await tx
        .delete(recipeGenerationLog)
        .where(inArray(recipeGenerationLog.recipeId, batch));

      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, batch),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );

      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            inArray(favouriteRecipes.recipeId, batch),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );

      // Scope by `source = "community"` — otherwise we'd delete dismissals for
      // `mealPlan:N` rows whose numeric identifier happens to collide with a
      // community recipe id being cleaned up.
      const dismissalIdentifiers = batch.map(String);
      await tx
        .delete(recipeDismissals)
        .where(
          and(
            inArray(recipeDismissals.recipeIdentifier, dismissalIdentifiers),
            eq(recipeDismissals.source, "community"),
          ),
        );

      const result = await tx
        .delete(communityRecipes)
        .where(inArray(communityRecipes.id, batch))
        .returning({ id: communityRecipes.id });

      totalDeleted += result.length;
    });
  }

  console.log(`Deleted ${totalDeleted} community recipes`);

  // Clean up image files on disk
  let imagesDeleted = 0;
  let imagesRejected = 0;
  for (const r of junkRecipes) {
    if (!r.imageUrl) continue;
    const filename = r.imageUrl.replace("/api/recipe-images/", "");

    // Defense-in-depth against path traversal: validate the filename against
    // a strict allowlist before concatenating onto the images directory. If
    // a malicious `imageUrl` contained `../../etc/passwd`, this rejects it.
    if (!IMAGE_FILENAME_PATTERN.test(filename)) {
      console.warn(
        `  Warning: skipping unsafe image filename for recipe ${r.id}: ${JSON.stringify(filename)}`,
      );
      imagesRejected++;
      continue;
    }

    const filepath = path.join(RECIPE_IMAGES_DIR, filename);

    // Belt-and-braces check: the resolved filepath must still live inside
    // RECIPE_IMAGES_DIR. Rejects any residual traversal that somehow passed
    // the regex (e.g. symlink shenanigans on some filesystems).
    const resolvedFilepath = path.resolve(filepath);
    if (
      resolvedFilepath !== path.join(RECIPE_IMAGES_DIR, filename) ||
      !resolvedFilepath.startsWith(RECIPE_IMAGES_DIR + path.sep)
    ) {
      console.warn(
        `  Warning: resolved path escapes images dir for recipe ${r.id}: ${resolvedFilepath}`,
      );
      imagesRejected++;
      continue;
    }

    try {
      if (fs.existsSync(resolvedFilepath)) {
        fs.unlinkSync(resolvedFilepath);
        imagesDeleted++;
      }
    } catch (err) {
      console.warn(`  Warning: could not delete ${resolvedFilepath}:`, err);
    }
  }
  if (imagesDeleted > 0) {
    console.log(`Deleted ${imagesDeleted} image files from disk`);
  }
  if (imagesRejected > 0) {
    console.log(`Rejected ${imagesRejected} image paths as unsafe`);
  }

  // Report remaining recipe count
  const remaining = await db
    .select({ count: sql<number>`count(*)` })
    .from(communityRecipes);
  console.log(`\nRemaining community recipes: ${remaining[0]?.count}`);

  console.log("\n=== Cleanup complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
