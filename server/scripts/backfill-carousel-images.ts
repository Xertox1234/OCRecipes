/* eslint-disable no-console */
/**
 * Backfill script: generates images for cached carousel cards that have no image.
 * Updates the JSON in carouselSuggestionCache with the new image URLs.
 *
 * Usage: npx tsx server/scripts/backfill-carousel-images.ts
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, pool } from "../db";
import { carouselSuggestionCache } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateImage as runwareGenerateImage } from "../lib/runware";

const IMAGES_DIR = path.resolve(process.cwd(), "uploads/recipe-images");
const DELAY_MS = 2_000;

async function main() {
  console.log("=== Backfill Carousel Cache Images ===\n");

  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const rows = await db
    .select({
      id: carouselSuggestionCache.id,
      mealType: carouselSuggestionCache.mealType,
      suggestions: carouselSuggestionCache.suggestions,
    })
    .from(carouselSuggestionCache);

  let generated = 0;
  let failed = 0;

  for (const row of rows) {
    const cards = row.suggestions as any[];
    if (!Array.isArray(cards)) continue;

    const needsImage = cards.some((c) => !c.imageUrl);
    if (!needsImage) continue;

    console.log(`Cache [${row.id}] (${row.mealType}):`);
    let updated = false;

    for (const card of cards) {
      if (card.imageUrl) continue;

      console.log(`  Generating: "${card.title}"...`);

      try {
        const prompt = `Appetizing food photography of "${card.title}". Professional lighting, top-down view, styled on rustic wooden table. No text or labels. Photorealistic style.`;

        const buffer = await runwareGenerateImage(prompt);
        if (!buffer) {
          console.log("    Skipped: generation returned null");
          failed++;
          continue;
        }

        const filename = `recipe-${crypto.randomUUID()}.png`;
        const filepath = path.join(IMAGES_DIR, filename);
        fs.writeFileSync(filepath, buffer);

        card.imageUrl = `/api/recipe-images/${filename}`;
        updated = true;
        generated++;
        console.log(`    -> ${card.imageUrl} (${buffer.length} bytes)`);

        await new Promise((r) => setTimeout(r, DELAY_MS));
      } catch (err) {
        failed++;
        console.error(`    FAILED:`, err);
      }
    }

    if (updated) {
      await db
        .update(carouselSuggestionCache)
        .set({ suggestions: cards })
        .where(eq(carouselSuggestionCache.id, row.id));
      console.log(`  Cache [${row.id}] updated in DB.`);
    }
  }

  console.log(`\n=== Done! Generated: ${generated}, Failed: ${failed} ===`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
