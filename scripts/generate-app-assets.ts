/**
 * Generates OCRecipes app icon and splash screen using the Runware API.
 *
 * Usage:
 *   npx tsx scripts/generate-app-assets.ts
 *
 * Outputs:
 *   assets/images/icon.png             (1024×1024, iOS app icon)
 *   assets/images/android-icon-foreground.png  (copy of icon)
 *   assets/images/favicon.png          (copy of icon)
 *   assets/images/splash-icon.png      (512×512, centered splash symbol)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "assets/images");

// PNG magic bytes (89 50 4E 47) — validate before writing to disk to prevent
// a corrupted API response from silently overwriting app assets.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
// 1 KB floor — rejects near-empty or truncated API responses
const MIN_PNG_SIZE_BYTES = 1_024;

async function loadEnv(): Promise<void> {
  try {
    const { default: dotenv } = await import("dotenv");
    dotenv.config({ path: path.join(ROOT, ".env") });
  } catch {
    // dotenv unavailable — rely on env being pre-set
  }
}

async function loadRunware(): Promise<typeof import("../server/lib/runware")> {
  return import("../server/lib/runware");
}

async function main(): Promise<void> {
  await loadEnv();
  const { generateImage, isRunwareConfigured } = await loadRunware();

  if (!isRunwareConfigured) {
    throw new Error("RUNWARE_API_KEY is not set in .env");
  }

  async function generate(opts: {
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    outputPath: string;
  }): Promise<Buffer> {
    console.log(`\n→ Generating: ${path.basename(opts.outputPath)}`);
    console.log(`  ${opts.prompt.slice(0, 120)}...`);

    const buf = await generateImage({
      prompt: opts.prompt,
      negativePrompt: opts.negativePrompt,
      width: opts.width,
      height: opts.height,
    });
    if (!buf)
      throw new Error(
        `Runware returned no image for ${path.basename(opts.outputPath)}`,
      );

    // Validate PNG magic bytes and minimum size before writing to disk.
    // A corrupted or malformed API response would otherwise silently overwrite app assets.
    if (buf.length < 4 || !buf.slice(0, 4).equals(PNG_MAGIC)) {
      throw new Error(
        `Runware response for ${path.basename(opts.outputPath)} is not a valid PNG (bad magic bytes)`,
      );
    }
    if (buf.length < MIN_PNG_SIZE_BYTES) {
      throw new Error(
        `Runware response for ${path.basename(opts.outputPath)} is too small (${buf.length} bytes) — likely corrupted`,
      );
    }

    fs.writeFileSync(opts.outputPath, buf);
    console.log(`  ✓ Saved (${(buf.length / 1024).toFixed(0)} KB)`);
    return buf;
  }

  // Main app icon: food photography + scan element
  const iconBuf = await generate({
    prompt:
      "Professional mobile app icon, top-down overhead shot of a beautiful terracotta ceramic bowl overflowing with vibrant fresh ingredients — cherry tomatoes, fresh basil leaves, lemon wedge, golden grains — arranged on warm parchment linen, thin burnt-orange circular scan-frame lines overlaid suggesting a camera viewfinder, clean editorial food photography, sharp focus, warm natural light, no text, perfectly centered, square composition",
    negativePrompt:
      "text, watermark, logo, labels, letters, words, blurry, cartoon, illustration, purple, pink, cold blue, dark background, multiple bowls, cutlery, human hands, border, frame box",
    width: 1024,
    height: 1024,
    outputPath: path.join(ASSETS, "icon.png"),
  });

  // Android foreground and favicon are same image
  fs.writeFileSync(path.join(ASSETS, "android-icon-foreground.png"), iconBuf);
  console.log("  ✓ Copied → android-icon-foreground.png");
  fs.writeFileSync(path.join(ASSETS, "favicon.png"), iconBuf);
  console.log("  ✓ Copied → favicon.png");

  // Splash screen icon: minimal centered symbol, works on both light and dark splash BG
  await generate({
    prompt:
      "Minimal flat icon on pure white background, a clean elegant symbol combining a camera aperture with fork tines arranged in a starburst, warm terracotta burnt-orange color, flat vector-style illustration, perfectly centered, bold graphic mark, no gradients, no shadows, no text, isolated symbol, lots of white space around it",
    negativePrompt:
      "text, watermark, letters, words, multiple objects, photograph, realistic photo, purple, blue, green, complex background, gradient, shadow, dark background",
    width: 512,
    height: 512,
    outputPath: path.join(ASSETS, "splash-icon.png"),
  });

  console.log(
    "\n✓ All assets generated. Rebuild with `npx expo run:ios` to see splash changes.",
  );
}

main().catch((err: unknown) => {
  console.error("Generation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
