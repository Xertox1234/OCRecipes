/* eslint-disable no-console */
/**
 * Run-once backfill: re-generate our OWN AI recipe images in place with the new
 * art direction. Overwrites the existing R2 object at its current key (DB URL
 * unchanged). Skips external source photos and (by default) null images.
 *
 * Idempotent resume via a local JSON checkpoint (recipe keys already done).
 *
 * Usage:
 *   npx tsx server/scripts/backfill-recipe-images.ts --dry-run     # classify + sample, no spend
 *   npx tsx server/scripts/backfill-recipe-images.ts --limit 5     # smoke test
 *   npx tsx server/scripts/backfill-recipe-images.ts               # full run (hero images)
 *   npx tsx server/scripts/backfill-recipe-images.ts --include-canonical  # also canonicalImages[]
 *   npx tsx server/scripts/backfill-recipe-images.ts --fill-missing       # also generate for null-image rows
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
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
} from "../lib/recipe-image-keys";

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_CANONICAL = process.argv.includes("--include-canonical");
const FILL_MISSING = process.argv.includes("--fill-missing");
void FILL_MISSING;
const limitFlag = process.argv.indexOf("--limit");
const LIMIT = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : Infinity;
const R2_BASE = process.env.R2_PUBLIC_BASE_URL ?? null;
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
  console.log(`=== Backfill recipe images ${DRY_RUN ? "(dry-run)" : ""} ===`);
  if (!DRY_RUN && !isRunwareConfigured) {
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
    if (cls === "ours" && !done.has(key)) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] community ${r.id} hero -> ${r.imageUrl}`);
      } else {
        try {
          const ok = await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            counts.refreshed++;
            done.add(key);
            saveCheckpoint(done);
            console.log(`community ${r.id} hero refreshed`);
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
      for (let i = 0; i < r.canonicalImages.length && processed < LIMIT; i++) {
        const url = r.canonicalImages[i];
        const ckey = `community:${r.id}:canonical:${i}`;
        if (classifyRecipeImageUrl(url, R2_BASE) !== "ours" || done.has(ckey))
          continue;
        processed++;
        if (DRY_RUN) {
          console.log(`[dry] community ${r.id} canonical[${i}] -> ${url}`);
          continue;
        }
        try {
          const ok = await refreshInPlace(url, ctx, variants[i] ?? "plated");
          if (ok) {
            counts.refreshed++;
            done.add(ckey);
            saveCheckpoint(done);
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
    if (cls === "ours" && !done.has(key)) {
      processed++;
      if (DRY_RUN) {
        console.log(`[dry] mealplan ${r.id} -> ${r.imageUrl}`);
      } else {
        try {
          const ok = await refreshInPlace(r.imageUrl!, ctx, "hero");
          if (ok) {
            counts.refreshed++;
            done.add(key);
            saveCheckpoint(done);
            console.log(`mealplan ${r.id} refreshed`);
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
      "Next: purge the Cloudflare cache for recipe-images/* so the CDN serves the new bytes.",
    );
  await pool.end();
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  void pool.end().then(() => process.exit(1));
});
