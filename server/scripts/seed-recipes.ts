/* eslint-disable no-console */
/**
 * Seed script: generates 25 AI recipes with images and inserts them
 * into the communityRecipes table as public featured content.
 *
 * Quality gates enforced before insertion:
 *   - Image must be generated (no image → skip)
 *   - At least 4 ingredients
 *   - At least 4 instruction steps
 *   - Description must be non-empty
 *
 * Usage:
 *   npm run seed:recipes                  # dev / test only
 *   npm run seed:recipes -- --allow-prod-seed   # required in production
 *
 * Performance:
 *   Up to CONTENT_CONCURRENCY (3) recipes run their full pipeline
 *   (content + image + insert) in parallel. Image generation retries stay
 *   serial-per-recipe (5s sleep inside generateImageWithRetry) to respect
 *   Runware/DALL-E rate limits while still allowing 3 recipes to be in
 *   flight at once. Expected wall-clock: ~1.5 min for 25 recipes vs. the
 *   original ~6+ min serial path.
 *
 * Safety:
 *   ensureDemoUser() refuses to run in NODE_ENV=production unless
 *   --allow-prod-seed is passed. The demo user's password is a
 *   cryptographically-random 24-char string (or $SEED_DEMO_PASSWORD if set)
 *   and is printed to stdout once on first creation.
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import pLimit from "p-limit";
import { db, pool } from "../db";
import { users, userProfiles, communityRecipes } from "@shared/schema";
import { eq, ilike } from "drizzle-orm";
import {
  generateRecipeContent,
  generateRecipeImage,
  normalizeProductName,
} from "../services/recipe-generation";
import { inferMealTypes } from "../lib/meal-type-inference";

const MIN_INGREDIENTS = 4;
const MIN_INSTRUCTIONS = 4;
const IMAGE_RETRIES = 2;

/**
 * Concurrency for the full per-recipe pipeline (content + image + insert).
 * OpenAI tier-1 chat RPM is 500 and image RPM is 50+, so 3 concurrent
 * recipes stays well under both. Tune via SEED_CONCURRENCY env var for
 * bigger accounts. DO NOT raise without checking current OpenAI quota.
 * Clamped to [1, 10] to guard against negative/absurd inputs — p-limit
 * throws on non-positive concurrency.
 */
const CONTENT_CONCURRENCY = Math.max(
  1,
  Math.min(10, Number(process.env.SEED_CONCURRENCY) || 3),
);

const RECIPE_TARGETS = [
  // ── American (4) ─────────────────────────────────────────────────────
  {
    ingredient: "Chicken Breast",
    cuisine: "American",
    dietTags: ["high-protein", "gluten-free", "american"],
  },
  {
    ingredient: "Avocado",
    cuisine: "American",
    dietTags: ["vegetarian", "keto", "american"],
  },
  {
    ingredient: "Ground Beef",
    cuisine: "American",
    dietTags: ["high-protein", "american"],
  },
  {
    ingredient: "Turkey Breast",
    cuisine: "American",
    dietTags: ["high-protein", "low-fat", "american"],
  },

  // ── Italian (4) ──────────────────────────────────────────────────────
  {
    ingredient: "Pasta",
    cuisine: "Italian",
    dietTags: ["vegetarian", "italian"],
  },
  {
    ingredient: "Chicken Thigh",
    cuisine: "Italian",
    dietTags: ["high-protein", "italian"],
  },
  {
    ingredient: "Eggplant",
    cuisine: "Italian",
    dietTags: ["vegan", "italian", "mediterranean"],
  },
  {
    ingredient: "Shrimp",
    cuisine: "Italian",
    dietTags: ["pescatarian", "low-carb", "italian"],
  },

  // ── Mexican (4) ──────────────────────────────────────────────────────
  {
    ingredient: "Ground Turkey",
    cuisine: "Mexican",
    dietTags: ["high-protein", "low-fat", "mexican"],
  },
  {
    ingredient: "Black Beans",
    cuisine: "Mexican",
    dietTags: ["vegan", "high-fiber", "mexican"],
  },
  {
    ingredient: "Corn Tortillas",
    cuisine: "Mexican",
    dietTags: ["vegetarian", "gluten-free", "mexican"],
  },
  {
    ingredient: "Pork Shoulder",
    cuisine: "Mexican",
    dietTags: ["high-protein", "mexican"],
  },

  // ── Asian (4) ────────────────────────────────────────────────────────
  {
    ingredient: "Salmon Fillet",
    cuisine: "Japanese",
    dietTags: ["pescatarian", "omega-3", "asian"],
  },
  {
    ingredient: "Tofu",
    cuisine: "Thai",
    dietTags: ["vegan", "asian"],
  },
  {
    ingredient: "Sweet Potato",
    cuisine: "Korean",
    dietTags: ["vegan", "paleo", "asian"],
  },
  {
    ingredient: "Rice Noodles",
    cuisine: "Vietnamese",
    dietTags: ["gluten-free", "asian"],
  },
  {
    ingredient: "Bok Choy",
    cuisine: "Chinese",
    dietTags: ["vegan", "low-carb", "asian"],
  },

  // ── Mediterranean (4) ────────────────────────────────────────────────
  {
    ingredient: "Chickpeas",
    cuisine: "Mediterranean",
    dietTags: ["vegan", "mediterranean"],
  },
  {
    ingredient: "Lamb",
    cuisine: "Mediterranean",
    dietTags: ["high-protein", "mediterranean"],
  },
  {
    ingredient: "Feta Cheese",
    cuisine: "Mediterranean",
    dietTags: ["vegetarian", "mediterranean"],
  },
  {
    ingredient: "Falafel",
    cuisine: "Mediterranean",
    dietTags: ["vegan", "high-fiber", "mediterranean"],
  },

  // ── Other (4) ────────────────────────────────────────────────────────
  {
    ingredient: "Quinoa",
    cuisine: "Indian",
    dietTags: ["vegan", "gluten-free"],
  },
  {
    ingredient: "Eggs",
    cuisine: "French",
    dietTags: ["vegetarian", "keto"],
  },
  {
    ingredient: "Lentils",
    cuisine: "Indian",
    dietTags: ["vegan", "high-fiber"],
  },
  {
    ingredient: "Greek Yogurt",
    cuisine: "Greek",
    dietTags: ["vegetarian", "high-protein", "mediterranean"],
  },
] as const;

/**
 * Create or return the demo user. In production, creation requires the
 * --allow-prod-seed flag (enforced by the caller in main()). The default
 * password is a cryptographically-random 24-char hex string unless the
 * SEED_DEMO_PASSWORD env var is set, and is logged to stdout exactly once
 * on first creation so the operator can record it.
 *
 * M3 (audit 2026-04-17): removed hardcoded "demo123" password; prod guard
 * lives in main() so the script exits before touching any state.
 */
async function ensureDemoUser(): Promise<string> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, "demo"));

  if (existing.length > 0) {
    console.log("Demo user already exists");
    return existing[0].id;
  }

  const plaintextPassword =
    process.env.SEED_DEMO_PASSWORD ?? crypto.randomBytes(12).toString("hex"); // 24 hex chars
  const hashedPassword = await bcrypt.hash(plaintextPassword, 12);
  const [user] = await db
    .insert(users)
    .values({
      username: "demo",
      password: hashedPassword,
      displayName: "Demo Chef",
      onboardingCompleted: true,
    })
    .returning();

  await db.insert(userProfiles).values({
    userId: user.id,
    dietType: "omnivore",
    cuisinePreferences: ["italian", "japanese", "mexican", "mediterranean"],
    cookingSkillLevel: "intermediate",
    cookingTimeAvailable: "30-60 min",
    primaryGoal: "maintain",
    activityLevel: "moderate",
  });

  console.log(`Created demo user: ${user.id}`);
  console.log(
    `  Demo user password (shown ONCE, save it now): ${plaintextPassword}`,
  );
  if (!process.env.SEED_DEMO_PASSWORD) {
    console.log(
      "  Tip: set SEED_DEMO_PASSWORD in your shell/.env for reproducible logins.",
    );
  }
  return user.id;
}

async function getSeededIngredients(): Promise<Set<string>> {
  const existing = await db
    .select({ name: communityRecipes.normalizedProductName })
    .from(communityRecipes)
    .where(ilike(communityRecipes.normalizedProductName, "seed-%"));

  return new Set(existing.map((r) => r.name));
}

/** Retry image generation up to IMAGE_RETRIES times. */
async function generateImageWithRetry(
  title: string,
  ingredient: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= IMAGE_RETRIES; attempt++) {
    const imageUrl = await generateRecipeImage(title, ingredient);
    if (imageUrl) return imageUrl;
    if (attempt < IMAGE_RETRIES) {
      console.log(`    Image attempt ${attempt} failed, retrying...`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  return null;
}

/**
 * Result discriminator for a single recipe pipeline run.
 *
 * `inserted`       - content generated, image generated, row written
 * `alreadyExisted` - seed-key already present in DB; no work done
 * `skipped`        - quality gate rejected (content too short, no image, …)
 */
type RecipeResult = "inserted" | "alreadyExisted" | "skipped";

/**
 * Runs the full pipeline for a single recipe target: content generation,
 * quality gates, image generation (serial retry inside), and insert.
 * Designed to be launched CONTENT_CONCURRENCY-at-a-time via p-limit —
 * OpenAI content + image retries each have their own internal pacing so
 * the outer orchestration only needs to cap concurrency.
 */
async function seedOneRecipe(
  target: (typeof RECIPE_TARGETS)[number],
  index: number,
  alreadySeeded: Set<string>,
  demoUserId: string,
): Promise<RecipeResult> {
  const prefix = `[${index + 1}/${RECIPE_TARGETS.length}] ${target.ingredient}`;
  const seedKey = `seed-${normalizeProductName(target.ingredient)}`;

  if (alreadySeeded.has(seedKey)) {
    console.log(`${prefix}: already seeded, skipping`);
    return "alreadyExisted";
  }

  console.log(`${prefix}: generating (${target.cuisine})...`);

  try {
    const content = await generateRecipeContent({
      productName: target.ingredient,
      dietPreferences: [target.cuisine, ...target.dietTags],
      userProfile: null,
    });
    console.log(`${prefix}: title = ${content.title}`);

    // ── Quality gate: content checks ───────────────────────────────
    if (content.ingredients.length < MIN_INGREDIENTS) {
      console.log(
        `${prefix}: SKIPPED — only ${content.ingredients.length} ingredients (need ≥${MIN_INGREDIENTS})`,
      );
      return "skipped";
    }
    if (content.instructions.length < MIN_INSTRUCTIONS) {
      console.log(
        `${prefix}: SKIPPED — only ${content.instructions.length} instructions (need ≥${MIN_INSTRUCTIONS})`,
      );
      return "skipped";
    }
    if (!content.description || content.description.trim().length < 10) {
      console.log(`${prefix}: SKIPPED — description too short or missing`);
      return "skipped";
    }

    // ── Quality gate: image required (serial-per-recipe retry) ─────
    const imageUrl = await generateImageWithRetry(
      content.title,
      target.ingredient,
    );
    if (!imageUrl) {
      console.log(`${prefix}: SKIPPED — image generation failed after retries`);
      return "skipped";
    }

    // ── Insert ─────────────────────────────────────────────────────
    await db.insert(communityRecipes).values({
      authorId: demoUserId,
      barcode: null,
      normalizedProductName: seedKey,
      title: content.title,
      description: content.description,
      difficulty: content.difficulty,
      timeEstimate: content.timeEstimate,
      servings: 2,
      dietTags: [...new Set([...content.dietTags, ...target.dietTags])],
      mealTypes: inferMealTypes(
        content.title,
        content.ingredients.map((i) => i.name),
      ),
      instructions: content.instructions,
      ingredients: content.ingredients,
      imageUrl,
      isPublic: true,
      likeCount: 0,
    });
    console.log(`${prefix}: ✓ inserted`);
    return "inserted";
  } catch (error) {
    console.error(`${prefix}: FAILED —`, error);
    return "skipped";
  }
}

async function main() {
  console.log("=== Seed Recipes Script ===\n");

  // ── M3: production guard ───────────────────────────────────────────
  // ensureDemoUser() writes a privileged "demo" user with a scripted
  // password. Refuse to run in prod unless the caller explicitly opts in.
  const allowProdSeed = process.argv.includes("--allow-prod-seed");
  if (process.env.NODE_ENV === "production" && !allowProdSeed) {
    console.error(
      "Refusing to seed in NODE_ENV=production without --allow-prod-seed.",
    );
    console.error(
      "Re-run as: npm run seed:recipes -- --allow-prod-seed   (you will be held to this)",
    );
    await pool.end();
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && allowProdSeed) {
    console.warn(
      "⚠  NODE_ENV=production with --allow-prod-seed: creating demo user in a live DB.",
    );
  }

  console.log(
    `Quality gates: ≥${MIN_INGREDIENTS} ingredients, ≥${MIN_INSTRUCTIONS} instructions, image required`,
  );
  console.log(
    `Concurrency: ${CONTENT_CONCURRENCY} recipes in-flight at once (tune via SEED_CONCURRENCY)\n`,
  );

  const alreadySeeded = await getSeededIngredients();
  if (alreadySeeded.size >= RECIPE_TARGETS.length) {
    console.log(
      `All ${RECIPE_TARGETS.length} seed recipes already exist. Run npm run cleanup:seeds first to re-seed.`,
    );
    await pool.end();
    return;
  }
  if (alreadySeeded.size > 0) {
    console.log(
      `Found ${alreadySeeded.size} existing seed recipes, will skip those.\n`,
    );
  }

  const demoUserId = await ensureDemoUser();

  // ── M26: parallel pipeline ─────────────────────────────────────────
  // Each recipe's content+image+insert pipeline runs concurrently up to
  // CONTENT_CONCURRENCY at a time. The previous serial-with-15s-sleep
  // implementation took ~6 min for 25 recipes; at concurrency 3 the
  // wall-clock drops to ~1.5 min while still honoring per-recipe image
  // retry pacing (5s sleep inside generateImageWithRetry).
  const limit = pLimit(CONTENT_CONCURRENCY);
  const results = await Promise.all(
    RECIPE_TARGETS.map((target, i) =>
      limit(() => seedOneRecipe(target, i, alreadySeeded, demoUserId)),
    ),
  );

  // Counters are split so re-runs don't mask partial failures: a
  // previously-seeded recipe is `alreadyExisted`, a newly-written one is
  // `inserted`, and quality-gate / error rows are `skippedCount`.
  // Conflating "already present" with "successfully inserted" would hide
  // the case where every new attempt silently fails.
  const insertedCount = results.filter((r) => r === "inserted").length;
  const alreadyExistedCount = results.filter(
    (r) => r === "alreadyExisted",
  ).length;
  const skippedCount = results.filter((r) => r === "skipped").length;

  console.log(
    `\n=== Done! ${insertedCount} inserted, ${alreadyExistedCount} already existed, ${skippedCount} skipped (quality gate). ===`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
