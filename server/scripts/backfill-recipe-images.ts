/* eslint-disable no-console */
/**
 * Run-once backfill: re-generate our OWN AI recipe images in place with the new
 * art direction. Overwrites the existing R2 object at its current key, then
 * bumps a cache-busting `?v=` token on the stored DB URL so URL-keyed client
 * caches (e.g. expo-image) re-fetch. Skips external source photos and (by
 * default) null images.
 *
 * Idempotent resume via a local JSON checkpoint (recipe keys already done).
 *
 * Usage:
 *   npx tsx server/scripts/backfill-recipe-images.ts --dry-run     # classify + sample, no spend
 *   npx tsx server/scripts/backfill-recipe-images.ts --limit 5     # smoke test
 *   npx tsx server/scripts/backfill-recipe-images.ts               # full run (hero images)
 *   npx tsx server/scripts/backfill-recipe-images.ts --include-canonical  # also canonicalImages[]
 *   npx tsx server/scripts/backfill-recipe-images.ts --bump-version-only  # bust caches WITHOUT regenerating (no Runware spend)
 *   npx tsx server/scripts/backfill-recipe-images.ts --fill-missing       # also generate for null-image rows
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import { generateImage, isRunwareConfigured } from "../lib/runware";
import { saveRecipeImage } from "../lib/image-store";
import {
  buildImagePrompt,
  type RecipeImageContext,
} from "../services/image-art-direction";
import {
  classifyRecipeImageUrl,
  deriveRecipeImageFilename,
  bustImageUrl,
} from "../lib/recipe-image-keys";

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_CANONICAL = process.argv.includes("--include-canonical");
const BUMP_ONLY = process.argv.includes("--bump-version-only");
const FILL_MISSING = process.argv.includes("--fill-missing");
void FILL_MISSING;
const limitFlag = process.argv.indexOf("--limit");
const LIMIT = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : Infinity;
const R2_BASE = process.env.R2_PUBLIC_BASE_URL ?? null;
// One cache-busting token per run; every refreshed/bumped URL adopts it so
// clients re-fetch. New value each run (ignores the checkpoint in bump-only).
const RUN_VERSION = Date.now();
const CHECKPOINT = path.resolve(
  process.cwd(),
  "scratch",
  "backfill-recipe-images.checkpoint.json",
);

function loadCheckpoint(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(CHECKPOINT, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveCheckpoint(done: Set<string>): void {
  fs.mkdirSync(path.dirname(CHECKPOINT), { recursive: true });
  fs.writeFileSync(CHECKPOINT, JSON.stringify([...done]));
}

/** Re-generate one image and overwrite the existing R2 key in place. */
async function refreshInPlace(
  existingUrl: string,
  ctx: RecipeImageContext,
  variant: "hero" | "plated" | "ingredients",
): Promise<boolean> {
  const filename = deriveRecipeImageFilename(existingUrl);
  if (!filename) return false;
  const prompt = await buildImagePrompt(ctx, variant);
  const buffer = await generateImage({ prompt });
  if (!buffer) return false;
  const ext = (filename.split(".").pop() ?? "png").toLowerCase();
  await saveRecipeImage(
    buffer,
    ext === "jpg" || ext === "jpeg" || ext === "webp"
      ? (ext as "jpg" | "jpeg" | "webp")
      : "png",
    filename,
  );
  return true;
}

async function main() {
  const mode = DRY_RUN ? "(dry-run)" : BUMP_ONLY ? "(bump-version-only)" : "";
  console.log(`=== Backfill recipe images ${mode} ===`);
  if (!DRY_RUN && !BUMP_ONLY && !isRunwareConfigured) {
    throw new Error("RUNWARE_API_KEY not set — image generation unavailable.");
  }
  const done = loadCheckpoint();
  const counts = {
    ours: 0,
    external: 0,
    none: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
  };

  // Community recipes carry both the hero imageUrl and canonicalImages[].
  const community = await db
    .select({
      id: communityRecipes.id,
      imageUrl: communityRecipes.imageUrl,
      canonicalImages: communityRecipes.canonicalImages,
      cuisineOrigin: communityRecipes.cuisineOrigin,
      mealTypes: communityRecipes.mealTypes,
      title: communityRecipes.title,
    })
    .from(communityRecipes);
  const mealPlan = await db
    .select({
      id: mealPlanRecipes.id,
      imageUrl: mealPlanRecipes.imageUrl,
      cuisine: mealPlanRecipes.cuisine,
      mealTypes: mealPlanRecipes.mealTypes,
      title: mealPlanRecipes.title,
    })
    .from(mealPlanRecipes);

  let processed = 0;
  for (const r of community) {
    if (processed >= LIMIT) break;
    const ctx: RecipeImageContext = {
      title: r.title,
      cuisine: r.cuisineOrigin,
      mealTypes: r.mealTypes,
    };
    const key = `community:${r.id}:hero`;
    const cls = classifyRecipeImageUrl(r.imageUrl, R2_BASE);
    counts[cls]++;
    if (cls === "ours" && (BUMP_ONLY || !done.has(key))) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] community ${r.id} hero -> ${r.imageUrl}`);
      } else {
        try {
          const ok = BUMP_ONLY
            ? true
            : await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            await db
              .update(communityRecipes)
              .set({
                imageUrl: bustImageUrl(r.imageUrl!, RUN_VERSION),
                updatedAt: new Date(),
              })
              .where(eq(communityRecipes.id, r.id));
            counts.refreshed++;
            if (!BUMP_ONLY) {
              done.add(key);
              saveCheckpoint(done);
            }
            console.log(
              `community ${r.id} hero ${BUMP_ONLY ? "bumped" : "refreshed"}`,
            );
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`community ${r.id} hero FAILED:`, e);
        }
      }
    } else if (cls === "ours") counts.skipped++;

    if (INCLUDE_CANONICAL && Array.isArray(r.canonicalImages)) {
      const variants: ("hero" | "plated" | "ingredients")[] = [
        "hero",
        "plated",
        "ingredients",
      ];
      // Working copy: bumps accumulate so each write carries prior indices' bumps.
      const canonical = [...r.canonicalImages] as string[];
      for (let i = 0; i < canonical.length && processed < LIMIT; i++) {
        const url = canonical[i];
        const ckey = `community:${r.id}:canonical:${i}`;
        if (
          classifyRecipeImageUrl(url, R2_BASE) !== "ours" ||
          (!BUMP_ONLY && done.has(ckey))
        )
          continue;
        processed++;
        if (DRY_RUN) {
          console.log(`[dry] community ${r.id} canonical[${i}] -> ${url}`);
          continue;
        }
        try {
          const ok = BUMP_ONLY
            ? true
            : await refreshInPlace(url, ctx, variants[i] ?? "plated");
          if (ok) {
            canonical[i] = bustImageUrl(url, RUN_VERSION);
            await db
              .update(communityRecipes)
              .set({ canonicalImages: canonical, updatedAt: new Date() })
              .where(eq(communityRecipes.id, r.id));
            counts.refreshed++;
            if (!BUMP_ONLY) {
              done.add(ckey);
              saveCheckpoint(done);
            }
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`community ${r.id} canonical[${i}] FAILED:`, e);
        }
      }
    }
  }

  for (const r of mealPlan) {
    if (processed >= LIMIT) break;
    const ctx: RecipeImageContext = {
      title: r.title,
      cuisine: r.cuisine,
      mealTypes: r.mealTypes,
    };
    const key = `mealplan:${r.id}:hero`;
    const cls = classifyRecipeImageUrl(r.imageUrl, R2_BASE);
    counts[cls]++;
    if (cls === "ours" && (BUMP_ONLY || !done.has(key))) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] mealplan ${r.id} -> ${r.imageUrl}`);
      } else {
        try {
          const ok = BUMP_ONLY
            ? true
            : await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            await db
              .update(mealPlanRecipes)
              .set({
                imageUrl: bustImageUrl(r.imageUrl!, RUN_VERSION),
                updatedAt: new Date(),
              })
              .where(eq(mealPlanRecipes.id, r.id));
            counts.refreshed++;
            if (!BUMP_ONLY) {
              done.add(key);
              saveCheckpoint(done);
            }
            console.log(
              `mealplan ${r.id} hero ${BUMP_ONLY ? "bumped" : "refreshed"}`,
            );
          } else counts.failed++;
        } catch (e) {
          counts.failed++;
          console.error(`mealplan ${r.id} FAILED:`, e);
        }
      }
    } else if (cls === "ours") counts.skipped++;
    // FILL_MISSING (cls === "none") intentionally not implemented in this minimal
    // pass — flag reserved; the ~25-row catalogue has no null AI images to fill.
  }

  console.log(
    `\n=== Done. classified ours=${counts.ours} external=${counts.external} none=${counts.none}; refreshed=${counts.refreshed} skipped(checkpoint)=${counts.skipped} failed=${counts.failed} ===`,
  );
  if (!DRY_RUN)
    console.log(
      `Stored URLs bumped to ?v=${RUN_VERSION} — URL-keyed client caches (e.g. expo-image) will re-fetch. The R2 CDN is uncached (DYNAMIC), so no purge is needed.`,
    );
  await pool.end();
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
