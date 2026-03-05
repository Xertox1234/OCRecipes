import { db } from "../db";
import { mealPlanRecipes, recipeIngredients } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const MEAL_TYPE_KEYWORDS: Record<string, string[]> = {
  breakfast: [
    "oatmeal",
    "pancake",
    "waffle",
    "cereal",
    "omelet",
    "omelette",
    "toast",
    "granola",
    "smoothie bowl",
    "french toast",
    "bagel",
    "croissant",
    "eggs",
    "scramble",
    "hash brown",
    "porridge",
    "yogurt parfait",
    "breakfast",
    "brunch",
    "crepe",
    "frittata",
    "muesli",
    "acai bowl",
  ],
  lunch: [
    "sandwich",
    "wrap",
    "salad",
    "soup",
    "bowl",
    "quesadilla",
    "taco",
    "burrito",
    "panini",
    "pita",
    "sushi",
    "ramen",
    "pho",
    "club sandwich",
    "sub sandwich",
    "hoagie",
    "gyro",
    "lunch",
    "blt",
    "po boy",
    "grain bowl",
    "cobb",
    "caesar",
  ],
  dinner: [
    "steak",
    "pasta",
    "curry",
    "stir fry",
    "stir-fry",
    "casserole",
    "lasagna",
    "risotto",
    "roast",
    "brisket",
    "pot roast",
    "grilled chicken",
    "salmon",
    "meatloaf",
    "enchilada",
    "fajita",
    "paella",
    "dinner",
    "tikka masala",
    "bolognese",
    "alfredo",
    "teriyaki",
    "fried rice",
    "biryani",
    "shepherd pie",
    "pot pie",
  ],
  snack: [
    "energy ball",
    "energy bite",
    "trail mix",
    "hummus",
    "popcorn",
    "protein shake",
    "protein bar",
    "protein ball",
    "granola bar",
    "chips",
    "veggie dip",
    "guacamole",
    "salsa",
    "cracker",
    "nuts",
    "fruit cup",
    "smoothie",
    "snack",
    "bites",
    "muffin",
  ],
};

// Keywords that belong to multiple meal types. Checked before MEAL_TYPE_KEYWORDS
// so both types are added. Entries here may also appear in MEAL_TYPE_KEYWORDS above
// — the Set deduplicates.
const MULTI_TYPE_OVERRIDES: Record<string, string[]> = {
  muffin: ["breakfast", "snack"],
  smoothie: ["breakfast", "snack"],
  yogurt: ["breakfast", "snack"],
  wrap: ["lunch", "dinner"],
  bowl: ["lunch", "dinner"],
  taco: ["lunch", "dinner"],
  burrito: ["lunch", "dinner"],
};

/** Word-boundary match to avoid substring false positives (e.g. "chip" in "chipotle"). */
function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

export function inferMealTypes(
  title: string,
  ingredientNames?: string[],
): string[] {
  const text = [title, ...(ingredientNames ?? [])].join(" ").toLowerCase();
  const matched = new Set<string>();

  // Check multi-type overrides first
  for (const [keyword, types] of Object.entries(MULTI_TYPE_OVERRIDES)) {
    if (matchesKeyword(text, keyword)) {
      for (const t of types) matched.add(t);
    }
  }

  // Check standard keywords
  for (const [mealType, keywords] of Object.entries(MEAL_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (matchesKeyword(text, keyword)) {
        matched.add(mealType);
        break;
      }
    }
  }

  // Universal recipe if nothing matched
  if (matched.size === 0) {
    return ["breakfast", "lunch", "dinner", "snack"];
  }

  return [...matched];
}

export async function backfillMealTypes(): Promise<number> {
  const recipes = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
    })
    .from(mealPlanRecipes)
    .where(
      sql`${mealPlanRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${mealPlanRecipes.mealTypes} IS NULL`,
    );

  if (recipes.length === 0) return 0;

  // Batch-fetch ingredients for all recipes
  const recipeIds = recipes.map((r) => r.id);
  const allIngredients = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      name: recipeIngredients.name,
    })
    .from(recipeIngredients)
    .where(sql`${recipeIngredients.recipeId} = ANY(${recipeIds})`);

  const ingredientsByRecipe = new Map<number, string[]>();
  for (const ing of allIngredients) {
    const existing = ingredientsByRecipe.get(ing.recipeId) ?? [];
    existing.push(ing.name);
    ingredientsByRecipe.set(ing.recipeId, existing);
  }

  let updated = 0;
  await db.transaction(async (tx) => {
    for (const recipe of recipes) {
      const ingredientNames = ingredientsByRecipe.get(recipe.id);
      const mealTypes = inferMealTypes(recipe.title, ingredientNames);
      await tx
        .update(mealPlanRecipes)
        .set({ mealTypes })
        .where(eq(mealPlanRecipes.id, recipe.id));
      updated++;
    }
  });

  return updated;
}
