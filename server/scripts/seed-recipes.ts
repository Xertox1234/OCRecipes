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
 * Usage: npm run seed:recipes
 */
import "dotenv/config";
import bcrypt from "bcrypt";
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
const RATE_LIMIT_DELAY_MS = 15_000;

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

async function ensureDemoUser(): Promise<string> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, "demo"));

  if (existing.length > 0) {
    console.log("Demo user already exists");
    return existing[0].id;
  }

  const hashedPassword = await bcrypt.hash("demo123", 12);
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

async function main() {
  console.log("=== Seed Recipes Script ===\n");
  console.log(
    `Quality gates: ≥${MIN_INGREDIENTS} ingredients, ≥${MIN_INSTRUCTIONS} instructions, image required\n`,
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

  let successCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < RECIPE_TARGETS.length; i++) {
    const target = RECIPE_TARGETS[i];
    const seedKey = `seed-${normalizeProductName(target.ingredient)}`;

    if (alreadySeeded.has(seedKey)) {
      console.log(
        `\n[${i + 1}/${RECIPE_TARGETS.length}] Skipping: ${target.ingredient} (already seeded)`,
      );
      successCount++;
      continue;
    }

    console.log(
      `\n[${i + 1}/${RECIPE_TARGETS.length}] Generating: ${target.ingredient} (${target.cuisine})...`,
    );

    try {
      // Generate recipe content
      const content = await generateRecipeContent({
        productName: target.ingredient,
        dietPreferences: [target.cuisine, ...target.dietTags],
        userProfile: null,
      });

      console.log(`  Title: ${content.title}`);

      // ── Quality gate: content checks ───────────────────────────────
      if (content.ingredients.length < MIN_INGREDIENTS) {
        console.log(
          `  SKIPPED: only ${content.ingredients.length} ingredients (need ≥${MIN_INGREDIENTS})`,
        );
        skippedCount++;
        continue;
      }
      if (content.instructions.length < MIN_INSTRUCTIONS) {
        console.log(
          `  SKIPPED: only ${content.instructions.length} instructions (need ≥${MIN_INSTRUCTIONS})`,
        );
        skippedCount++;
        continue;
      }
      if (!content.description || content.description.trim().length < 10) {
        console.log("  SKIPPED: description too short or missing");
        skippedCount++;
        continue;
      }

      console.log(
        `  ${content.ingredients.length} ingredients, ${content.instructions.length} steps`,
      );

      // ── Quality gate: image required ───────────────────────────────
      const imageUrl = await generateImageWithRetry(
        content.title,
        target.ingredient,
      );
      if (!imageUrl) {
        console.log("  SKIPPED: image generation failed after retries");
        skippedCount++;
        continue;
      }
      console.log(`  Image: ${imageUrl}`);

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

      successCount++;
      console.log("  ✓ Inserted");

      // Rate-limit delay between image generation calls
      if (i < RECIPE_TARGETS.length - 1) {
        console.log(
          `  Waiting ${RATE_LIMIT_DELAY_MS / 1000}s for rate limit...`,
        );
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }
    } catch (error) {
      console.error(`  FAILED for ${target.ingredient}:`, error);
      skippedCount++;
    }
  }

  console.log(
    `\n=== Done! ${successCount} seeded, ${skippedCount} skipped (quality gate). ===`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
