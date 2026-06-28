/* eslint-disable no-console */
/**
 * Generate a sample batch of art-directed recipe images for visual review.
 * Writes PNGs to scratch/art-direction-preview/ so you can eyeball variety
 * BEFORE running the catalogue backfill.
 *
 * Usage:
 *   npx tsx server/scripts/preview-art-direction.ts            # LLM on (if configured)
 *   npx tsx server/scripts/preview-art-direction.ts --no-llm   # deterministic only
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  buildImagePrompt,
  type RecipeImageContext,
} from "../services/image-art-direction";
import { generateImage, isRunwareConfigured } from "../lib/runware";

const SKIP_LLM = process.argv.includes("--no-llm");
const OUT_DIR = path.resolve(process.cwd(), "scratch", "art-direction-preview");

const SAMPLES: RecipeImageContext[] = [
  { title: "Spaghetti Carbonara", cuisine: "Italian", mealTypes: ["dinner"] },
  { title: "Avocado Toast", cuisine: "American", mealTypes: ["breakfast"] },
  { title: "Chicken Tikka Masala", cuisine: "Indian", mealTypes: ["dinner"] },
  { title: "Pad Thai", cuisine: "Thai", mealTypes: ["lunch"] },
  { title: "Miso Salmon", cuisine: "Japanese", mealTypes: ["dinner"] },
  { title: "Street Tacos", cuisine: "Mexican", mealTypes: ["lunch"] },
  { title: "Tiramisu", cuisine: "Italian", mealTypes: ["dessert"] },
  { title: "Shakshuka", cuisine: "Middle Eastern", mealTypes: ["breakfast"] },
];

async function main() {
  if (!isRunwareConfigured) {
    console.error("RUNWARE_API_KEY not set — cannot generate preview images.");
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Generating ${SAMPLES.length} preview images (LLM ${SKIP_LLM ? "OFF" : "ON"}) → ${OUT_DIR}`,
  );
  for (const [i, ctx] of SAMPLES.entries()) {
    const prompt = await buildImagePrompt(ctx, "hero", { skipLLM: SKIP_LLM });
    console.log(`\n[${i + 1}] ${ctx.title}\n    ${prompt}`);
    const buffer = await generateImage({ prompt });
    if (!buffer) {
      console.warn(`    (no image returned)`);
      continue;
    }
    const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const file = path.join(
      OUT_DIR,
      `${String(i + 1).padStart(2, "0")}-${slug}.png`,
    );
    fs.writeFileSync(file, buffer);
    console.log(`    → ${file}`);
  }
  console.log("\nDone. Open the folder and eyeball the variety.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
