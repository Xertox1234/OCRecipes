/* eslint-disable no-console */
/**
 * Seed script: generates 12 AI recipes with DALL-E images and inserts them
 * into the communityRecipes table as public featured content.
 *
 * Usage: npm run seed:recipes
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcrypt";
import { db, pool } from "../db";
import { users, userProfiles, communityRecipes } from "@shared/schema";
import { eq, ilike } from "drizzle-orm";
import {
  generateRecipeContent,
  normalizeProductName,
} from "../services/recipe-generation";
import OpenAI from "openai";

// DALL-E client (direct OpenAI, not custom endpoint)
const dalleClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const RECIPE_TARGETS = [
  {
    ingredient: "Chicken Breast",
    cuisine: "American",
    dietTags: ["high-protein", "gluten-free"],
  },
  {
    ingredient: "Salmon Fillet",
    cuisine: "Japanese",
    dietTags: ["pescatarian", "omega-3"],
  },
  {
    ingredient: "Chickpeas",
    cuisine: "Mediterranean",
    dietTags: ["vegan", "mediterranean"],
  },
  {
    ingredient: "Tofu",
    cuisine: "Thai",
    dietTags: ["vegan", "asian"],
  },
  {
    ingredient: "Ground Turkey",
    cuisine: "Mexican",
    dietTags: ["high-protein", "low-fat"],
  },
  {
    ingredient: "Avocado",
    cuisine: "American",
    dietTags: ["vegetarian", "keto"],
  },
  {
    ingredient: "Quinoa",
    cuisine: "Indian",
    dietTags: ["vegan", "gluten-free"],
  },
  {
    ingredient: "Shrimp",
    cuisine: "Italian",
    dietTags: ["pescatarian", "low-carb"],
  },
  {
    ingredient: "Sweet Potato",
    cuisine: "Korean",
    dietTags: ["vegan", "paleo"],
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
    dietTags: ["vegetarian", "high-protein"],
  },
] as const;

const IMAGES_DIR = path.resolve(process.cwd(), "assets/images/recipes");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

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

  // Create a dietary profile for the demo user
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

async function generateImage(
  recipeTitle: string,
  ingredient: string,
): Promise<Buffer | null> {
  try {
    const prompt = `Appetizing food photography of "${recipeTitle}" featuring ${ingredient}. Professional studio lighting, top-down angle, styled on a ceramic plate with garnishes. Clean background, photorealistic, no text or labels.`;

    const response = await dalleClient.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;

    return Buffer.from(b64, "base64");
  } catch (error) {
    console.error(`  Image generation failed: ${error}`);
    return null;
  }
}

async function main() {
  console.log("=== Seed Recipes Script ===\n");

  // Check which ingredients are already seeded
  const alreadySeeded = await getSeededIngredients();
  if (alreadySeeded.size >= RECIPE_TARGETS.length) {
    console.log(
      "All 12 seed recipes already exist. Delete them manually to re-seed.",
    );
    await pool.end();
    return;
  }
  if (alreadySeeded.size > 0) {
    console.log(
      `Found ${alreadySeeded.size} existing seed recipes, will skip those.\n`,
    );
  }

  // Ensure demo user
  const demoUserId = await ensureDemoUser();

  // Ensure images directory
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  let successCount = 0;

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

      // Generate image
      const slug = slugify(content.title);
      let imageUrl: string | null = null;

      const imageBuffer = await generateImage(content.title, target.ingredient);
      if (imageBuffer) {
        const imagePath = path.join(IMAGES_DIR, `${slug}.png`);
        fs.writeFileSync(imagePath, imageBuffer);
        imageUrl = `/assets/images/recipes/${slug}.png`;
        console.log(`  Image saved: ${imageUrl}`);
      } else {
        console.log("  No image generated (continuing without)");
      }

      // Insert into DB
      await db.insert(communityRecipes).values({
        authorId: demoUserId,
        barcode: null,
        normalizedProductName: `seed-${normalizeProductName(target.ingredient)}`,
        title: content.title,
        description: content.description,
        difficulty: content.difficulty,
        timeEstimate: content.timeEstimate,
        servings: 2,
        dietTags: [...content.dietTags, ...target.dietTags],
        instructions: content.instructions,
        imageUrl,
        isPublic: true,
        likeCount: Math.floor(Math.random() * 50) + 5,
      });

      successCount++;
      console.log("  Inserted into DB");

      // Delay between DALL-E calls to respect rate limits
      if (i < RECIPE_TARGETS.length - 1) {
        console.log("  Waiting 15s for rate limit...");
        await new Promise((r) => setTimeout(r, 15_000));
      }
    } catch (error) {
      console.error(`  FAILED for ${target.ingredient}:`, error);
      console.log("  Continuing to next recipe...");
    }
  }

  console.log(
    `\n=== Done! ${successCount}/${RECIPE_TARGETS.length} recipes seeded. ===`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  pool.end().then(() => process.exit(1));
});
