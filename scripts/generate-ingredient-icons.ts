/**
 * Batch-generate ingredient icons using Runware FLUX.
 *
 * Usage:
 *   npx tsx scripts/generate-ingredient-icons.ts             # generate missing icons
 *   npx tsx scripts/generate-ingredient-icons.ts --force      # regenerate ALL icons
 *   npx tsx scripts/generate-ingredient-icons.ts --test 3     # test with first 3 icons
 *   npx tsx scripts/generate-ingredient-icons.ts --force --test 3  # test overwrite
 *
 * Features:
 *   - Resumable: skips icons whose .png already exists on disk
 *   - Parallel: processes CONCURRENCY icons at a time
 *   - Generates at 512×512 via Runware with clean white background
 *   - Removes background via Runware AI segmentation → transparent PNG
 *   - Resizes to 256×256 final output
 *   - Produces codegen map file at client/data/ingredient-icon-map.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  ALL_ICONS,
  CATEGORY_ICONS,
  INGREDIENT_ICONS,
} from "./ingredient-icon-list";

// ── Dynamic imports (ESM/CJS compat for sharp + dotenv) ─────────────────────

async function loadDotenv(): Promise<void> {
  try {
    const dotenv = await import("dotenv");
    dotenv.config();
  } catch {
    // dotenv not installed — rely on env being set externally
  }
}

async function loadSharp(): Promise<typeof import("sharp")> {
  const mod = await import("sharp");
  return mod.default ?? mod;
}

async function loadRunware(): Promise<typeof import("../server/lib/runware")> {
  return import("../server/lib/runware");
}

// ── Config ──────────────────────────────────────────────────────────────────

const CONCURRENCY = 4;
const OUTPUT_DIR = path.resolve(__dirname, "../assets/images/ingredients");
const CODEGEN_PATH = path.resolve(
  __dirname,
  "../client/data/ingredient-icon-map.ts",
);

const ICON_PROMPT_TEMPLATE = (name: string) =>
  `3D clay render icon of a ${name}, centered, soft lighting, rounded smooth shapes, matte clay finish, subtle pastel tones, minimal detail, solid clean white background, no shadow, Pixar style, single object, app icon`;

const CATEGORY_PROMPT_TEMPLATE = (name: string) =>
  `3D clay render icon representing ${name}, centered, soft lighting, rounded smooth shapes, matte clay finish, subtle pastel tones, minimal detail, solid clean white background, no shadow, Pixar style, app icon`;

const NEGATIVE_PROMPT =
  "text, watermark, logo, label, letters, realistic photo, sharp edges, dark shadows, complex background, multiple objects, busy scene";

// ── Helpers ─────────────────────────────────────────────────────────────────

function iconPath(slug: string): string {
  return path.join(OUTPUT_DIR, `${slug}.png`);
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── CLI flags ──────────────────────────────────────────────────────────────

/** --force: regenerate all icons, overwriting existing files */
const forceRegenerate = process.argv.includes("--force");

/** --test N: only generate first N icons (for testing prompt/chroma-key) */
const testCount = (() => {
  const idx = process.argv.indexOf("--test");
  if (idx === -1) return 0;
  return parseInt(process.argv[idx + 1], 10) || 3;
})();

// Process items in batches of `size`
async function batchProcess<T>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    await Promise.all(batch.map((item, batchIdx) => fn(item, i + batchIdx)));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadDotenv();

  const { generateImage, removeBackground, isRunwareConfigured } =
    await loadRunware();
  const sharp = await loadSharp();

  if (!isRunwareConfigured) {
    console.error("❌ RUNWARE_API_KEY is not set. Cannot generate icons.");
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Filter to icons that need generation
  const pending = forceRegenerate
    ? ALL_ICONS
    : ALL_ICONS.filter((icon) => !exists(iconPath(icon.slug)));
  const skipped = ALL_ICONS.length - pending.length;

  // If --test, limit to first N icons
  const toProcess = testCount > 0 ? pending.slice(0, testCount) : pending;

  console.log(
    `\n🎨 Ingredient Icon Generator\n` +
      `   Total: ${ALL_ICONS.length} icons\n` +
      `   Already exist: ${skipped}\n` +
      `   To generate: ${toProcess.length}${testCount > 0 ? ` (--test ${testCount})` : ""}${forceRegenerate ? " (--force)" : ""}\n` +
      `   Concurrency: ${CONCURRENCY}\n` +
      `   Background: AI removal → transparent PNG\n`,
  );

  if (toProcess.length === 0) {
    console.log("✅ All icons already exist. Skipping generation.\n");
    await generateCodegenMap();
    return;
  }

  const failures: { slug: string; error: string }[] = [];
  let completed = 0;

  await batchProcess(toProcess, CONCURRENCY, async (icon, _index) => {
    const prompt = icon.isCategory
      ? CATEGORY_PROMPT_TEMPLATE(icon.name)
      : ICON_PROMPT_TEMPLATE(icon.name);

    const num = completed + 1;
    console.log(
      `[${num}/${toProcess.length}] Generating: ${icon.name} (${icon.slug})...`,
    );

    try {
      const buffer = await generateImage({
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        width: 512,
        height: 512,
      });

      if (!buffer) {
        failures.push({ slug: icon.slug, error: "Runware returned null" });
        completed++;
        return;
      }

      // Step 1: AI background removal via Runware
      const transparent = await removeBackground(buffer);
      if (!transparent) {
        failures.push({
          slug: icon.slug,
          error: "Background removal returned null",
        });
        completed++;
        return;
      }

      // Step 2: Resize 512→256
      const resized = await sharp(transparent)
        .resize(256, 256, { fit: "cover" })
        .png({ compressionLevel: 9 })
        .toBuffer();

      fs.writeFileSync(iconPath(icon.slug), resized);
      completed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ slug: icon.slug, error: msg });
      completed++;
    }

    // Small delay between batches to avoid rate limiting
    await sleep(200);
  });

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n📊 Generation Summary`);
  console.log(`   Succeeded: ${completed - failures.length}`);
  console.log(`   Failed: ${failures.length}`);
  console.log(`   Skipped (existing): ${skipped}`);

  if (failures.length > 0) {
    console.log(`\n❌ Failed icons:`);
    for (const f of failures) {
      console.log(`   - ${f.slug}: ${f.error}`);
    }
  }

  // ── Codegen ─────────────────────────────────────────────────────────────
  await generateCodegenMap();

  if (failures.length > 0) {
    console.log(`\n⚠️  Re-run the script to retry failed icons (resumable).`);
    if (testCount > 0) {
      console.log(
        `   (Test mode was active — only ${testCount} icons attempted)\n`,
      );
    }
    process.exit(1);
  }

  console.log(`\n✅ Done!\n`);
}

// ── Codegen: generate client/data/ingredient-icon-map.ts ────────────────────

async function generateCodegenMap(): Promise<void> {
  console.log(
    `\n📝 Generating icon map: ${path.relative(process.cwd(), CODEGEN_PATH)}`,
  );

  // Only include icons that actually exist on disk
  const existingIngredients = INGREDIENT_ICONS.filter((i) =>
    exists(iconPath(i.slug)),
  );
  const existingCategories = CATEGORY_ICONS.filter((i) =>
    exists(iconPath(i.slug)),
  );

  const lines: string[] = [
    `/**`,
    ` * AUTO-GENERATED by scripts/generate-ingredient-icons.ts`,
    ` * Do not edit manually. Re-run: npm run generate:icons`,
    ` *`,
    ` * Generated: ${new Date().toISOString()}`,
    ` * Icons: ${existingIngredients.length} ingredients + ${existingCategories.length} categories`,
    ` */`,
    ``,
    `import { ImageSourcePropType } from "react-native";`,
    ``,
    `/** Ingredient slug → static image source */`,
    `export const ingredientIconMap: Record<string, ImageSourcePropType> = {`,
  ];

  for (const icon of existingIngredients) {
    lines.push(
      `  "${icon.slug}": require("../../assets/images/ingredients/${icon.slug}.png"),`,
    );
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`/** Category slug → static image source */`);
  lines.push(
    `export const categoryIconMap: Record<string, ImageSourcePropType> = {`,
  );

  for (const icon of existingCategories) {
    lines.push(
      `  "${icon.slug}": require("../../assets/images/ingredients/${icon.slug}.png"),`,
    );
  }

  lines.push(`};`);
  lines.push(``);

  // Also export a name→slug lookup for the fuzzy matcher
  lines.push(`/** Ingredient name → slug (for fuzzy matching) */`);
  lines.push(`export const ingredientNameToSlug: Record<string, string> = {`);
  for (const icon of existingIngredients) {
    lines.push(`  "${icon.name}": "${icon.slug}",`);
  }
  lines.push(`};`);
  lines.push(``);

  fs.mkdirSync(path.dirname(CODEGEN_PATH), { recursive: true });
  fs.writeFileSync(CODEGEN_PATH, lines.join("\n") + "\n");

  console.log(
    `   ✅ ${existingIngredients.length} ingredient + ${existingCategories.length} category entries written.`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
