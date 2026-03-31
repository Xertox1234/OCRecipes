/* eslint-disable no-console */
/**
 * Backfill script: generates images for recipes that have no image.
 * Covers both communityRecipes and mealPlanRecipes tables.
 * Uses Runware (primary) with DALL-E fallback, same as production generation.
 *
 * Usage: npx tsx server/scripts/backfill-recipe-images.ts
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes, users } from "@shared/schema";
import { eq, isNull, and, notLike } from "drizzle-orm";
import { generateImage as runwareGenerateImage } from "../lib/runware";

const IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");
const DELAY_MS = 2_000; // 2s between requests to respect rate limits

interface RecipeRow {
  id: number;
  title: string;
  table: "community" | "mealPlan";
}

async function main() {
  console.log("=== Backfill Recipe Images ===\n");

  // Ensure output directory exists
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    console.log(`Created directory: ${IMAGES_DIR}`);
  }

  const rows: RecipeRow[] = [];

  // Community recipes without images
  const communityRows = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
    })
    .from(communityRecipes)
    .where(isNull(communityRecipes.imageUrl));

  for (const r of communityRows) {
    rows.push({ id: r.id, title: r.title, table: "community" });
  }

  // Meal plan recipes without images (exclude test users)
  const mealPlanRows = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
    })
    .from(mealPlanRecipes)
    .innerJoin(users, eq(mealPlanRecipes.userId, users.id))
    .where(
      and(
        isNull(mealPlanRecipes.imageUrl),
        notLike(users.username, "testuser_%"),
      ),
    );

  for (const r of mealPlanRows) {
    rows.push({ id: r.id, title: r.title, table: "mealPlan" });
  }

  console.log(
    `Found ${communityRows.length} community + ${mealPlanRows.length} meal plan recipe(s) without images.\n`,
  );

  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    await pool.end();
    return;
  }

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`[${i + 1}/${rows.length}] [${row.table}] "${row.title}"...`);

    try {
      const prompt = `Appetizing food photography of "${row.title}". Professional lighting, top-down view, styled on rustic wooden table. No text or labels. Photorealistic style.`;

      const buffer = await runwareGenerateImage(prompt);
      if (!buffer) {
        console.log("  Skipped: image generation returned null");
        failed++;
        continue;
      }

      const filename = `recipe-${crypto.randomUUID()}.png`;
      const filepath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(filepath, buffer);

      const imageUrl = `/api/recipe-images/${filename}`;

      if (row.table === "community") {
        await db
          .update(communityRecipes)
          .set({ imageUrl })
          .where(eq(communityRecipes.id, row.id));
      } else {
        await db
          .update(mealPlanRecipes)
          .set({ imageUrl })
          .where(eq(mealPlanRecipes.id, row.id));
      }

      generated++;
      console.log(`  -> ${imageUrl} (${buffer.length} bytes)`);

      // Delay between requests
      if (i < rows.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED:`, err);
    }
  }

  console.log(`\n=== Done! Generated: ${generated}, Failed: ${failed} ===`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
