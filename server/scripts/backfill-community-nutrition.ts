/* eslint-disable no-console */
/**
 * One-time backfill: estimates per-serving macros for community recipes that
 * have null nutrition columns (caloriesPerServing, proteinPerServing, etc.).
 *
 * Uses GPT-4o-mini for cost-efficient estimation — treats each recipe's title
 * and ingredient list as input. Skips recipes that already have calories set.
 *
 * Pairs with the H10-followup schema migration that adds nutrition columns to
 * `community_recipes`. Run after `npm run db:push`.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-community-nutrition.ts
 *   DRY_RUN=1 npx tsx server/scripts/backfill-community-nutrition.ts
 */
import "dotenv/config";
import { db, pool } from "../db";
import { communityRecipes } from "@shared/schema";
import { isNull, eq } from "drizzle-orm";
import { openai, MODEL_FAST } from "../lib/openai";

const DRY_RUN = process.env.DRY_RUN === "1";

interface RecipeMacros {
  caloriesPerServing: string;
  proteinPerServing: string;
  carbsPerServing: string;
  fatPerServing: string;
}

async function estimateMacros(
  title: string,
  ingredients: { name: string; quantity: string; unit: string }[],
  servings: number,
): Promise<RecipeMacros | null> {
  const ingredientList = ingredients
    .map((i) => `${i.quantity} ${i.unit} ${i.name}`.trim())
    .join(", ");
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        temperature: 0,
        max_completion_tokens: 200,
        messages: [
          {
            role: "system",
            content:
              "You are a nutritionist. Given a recipe title, ingredient list, and servings, estimate the per-serving macros. " +
              'Respond with JSON only: {"calories": number, "protein": number, "carbs": number, "fat": number}. ' +
              "Values are per serving, rounded to integers.",
          },
          {
            role: "user",
            content: `Recipe: ${title}\nIngredients: ${ingredientList}\nServings: ${servings}`,
          },
        ],
        response_format: { type: "json_object" },
      },
      { timeout: 15_000 },
    );
    const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    const cal = Math.round(Number(raw.calories));
    const protein = Math.round(Number(raw.protein));
    const carbs = Math.round(Number(raw.carbs));
    const fat = Math.round(Number(raw.fat));
    if (
      Number.isFinite(cal) &&
      cal >= 0 &&
      Number.isFinite(protein) &&
      protein >= 0 &&
      Number.isFinite(carbs) &&
      carbs >= 0 &&
      Number.isFinite(fat) &&
      fat >= 0
    ) {
      return {
        caloriesPerServing: String(cal),
        proteinPerServing: String(protein),
        carbsPerServing: String(carbs),
        fatPerServing: String(fat),
      };
    }
    return null;
  } catch (err) {
    console.error(`  Macro estimation error for "${title}":`, err);
    return null;
  }
}

async function main() {
  console.log(
    `=== Backfill Community Recipe Nutrition${DRY_RUN ? " (DRY RUN)" : ""} ===\n`,
  );

  const recipes = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
      servings: communityRecipes.servings,
    })
    .from(communityRecipes)
    .where(isNull(communityRecipes.caloriesPerServing));

  if (recipes.length === 0) {
    console.log("No community recipes need nutrition backfill.");
    await pool.end();
    return;
  }

  console.log(`Found ${recipes.length} recipes without nutrition data.\n`);

  let updated = 0;
  let failed = 0;

  for (const recipe of recipes) {
    const ingredients = (recipe.ingredients ?? []) as {
      name: string;
      quantity: string;
      unit: string;
    }[];
    const servings = recipe.servings ?? 2;

    process.stdout.write(
      `[${updated + failed + 1}/${recipes.length}] "${recipe.title}"... `,
    );

    const macros = await estimateMacros(recipe.title, ingredients, servings);

    if (!macros) {
      console.log("SKIPPED (estimation failed)");
      failed++;
      continue;
    }

    console.log(
      `${macros.caloriesPerServing} kcal / ${macros.proteinPerServing}g protein`,
    );

    if (!DRY_RUN) {
      await db
        .update(communityRecipes)
        .set(macros)
        .where(eq(communityRecipes.id, recipe.id));
    }

    updated++;
  }

  console.log(`\n=== Done: ${updated} updated, ${failed} failed ===`);
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
