import {
  type MealPlanRecipe,
  type InsertMealPlanRecipe,
  type RecipeIngredient,
  type InsertRecipeIngredient,
  type InsertMealPlanItem,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  addToIndex,
  removeFromIndex,
  mealPlanToSearchable,
} from "../lib/search-index";
import { deriveRecipeAllergens } from "@shared/constants/allergens";

// ============================================================================
// MEAL PLAN RECIPES (CRUD)
// ============================================================================

export async function findMealPlanRecipeByExternalId(
  userId: string,
  externalId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.userId, userId),
        eq(mealPlanRecipes.externalId, externalId),
      ),
    );
  return recipe || undefined;
}

export async function getMealPlanRecipe(
  id: number,
  userId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)));
  return recipe || undefined;
}

export async function getMealPlanRecipeWithIngredients(
  id: number,
  userId: string,
): Promise<(MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined> {
  const [recipe, ingredients] = await Promise.all([
    getMealPlanRecipe(id, userId),
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(recipeIngredients.displayOrder),
  ]);

  if (!recipe) return undefined;

  return { ...recipe, ingredients };
}

export async function getUserMealPlanRecipes(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ items: MealPlanRecipe[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId))
      .orderBy(desc(mealPlanRecipes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId)),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

export async function createMealPlanRecipe(
  recipe: InsertMealPlanRecipe,
  ingredients?: InsertRecipeIngredient[],
): Promise<MealPlanRecipe> {
  // mealTypes should be set by the caller (route/service layer).
  // Storage is a pure data-access layer and should not call service functions.
  // `allergens` is the exception: `deriveRecipeAllergens` is a pure shared
  // function (no service deps), so the denormalized cache is computed inline
  // here from the ingredient names — new/edited recipes stay current without
  // a backfill re-run.

  if (ingredients && ingredients.length > 0) {
    const ingredientNames = ingredients.map((i) => i.name);
    const allergens = deriveRecipeAllergens(ingredientNames);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mealPlanRecipes)
        .values({ ...recipe, allergens })
        .returning();
      await tx.insert(recipeIngredients).values(
        ingredients.map((ing, idx) => ({
          ...ing,
          recipeId: row.id,
          displayOrder: ing.displayOrder ?? idx,
        })),
      );
      return row;
    });
    // Update search index after transaction commits
    addToIndex(mealPlanToSearchable(created, ingredientNames));
    return created;
  }

  const [created] = await db
    .insert(mealPlanRecipes)
    .values({ ...recipe, allergens: [] })
    .returning();
  addToIndex(mealPlanToSearchable(created, []));
  return created;
}

export interface MealPlanSuggestionInput {
  recipe: InsertMealPlanRecipe;
  ingredients: Omit<InsertRecipeIngredient, "recipeId">[];
  planItem: Omit<InsertMealPlanItem, "recipeId">;
}

/**
 * Atomically creates multiple meal plan recipes with their ingredients
 * and plan items. Uses batch inserts to minimize DB round trips.
 */
export async function createMealPlanFromSuggestions(
  meals: MealPlanSuggestionInput[],
): Promise<{ recipeId: number; mealPlanItemId: number }[]> {
  if (meals.length === 0) return [];

  const result = await db.transaction(async (tx) => {
    // Batch-insert all recipes at once, deriving each recipe's allergen cache
    // from its ingredient names (pure shared function — no service deps).
    const recipes = await tx
      .insert(mealPlanRecipes)
      .values(
        meals.map((m) => ({
          ...m.recipe,
          allergens: deriveRecipeAllergens(m.ingredients.map((i) => i.name)),
        })),
      )
      .returning();

    // Batch-insert all ingredients at once (with correct recipeIds)
    const allIngredients = recipes.flatMap((recipe, i) =>
      meals[i].ingredients.map((ing, idx) => ({
        ...ing,
        recipeId: recipe.id,
        displayOrder: ing.displayOrder ?? idx,
      })),
    );
    if (allIngredients.length > 0) {
      await tx.insert(recipeIngredients).values(allIngredients);
    }

    // Batch-insert all plan items at once
    const planItems = await tx
      .insert(mealPlanItems)
      .values(
        recipes.map((recipe, i) => ({
          ...meals[i].planItem,
          recipeId: recipe.id,
        })),
      )
      .returning();

    return { recipes, allIngredients, planItems };
  });

  // Update search index after transaction commits
  for (const recipe of result.recipes) {
    const ingNames = result.allIngredients
      .filter((i) => i.recipeId === recipe.id)
      .map((i) => i.name);
    addToIndex(mealPlanToSearchable(recipe, ingNames));
  }

  return result.recipes.map((recipe, i) => ({
    recipeId: recipe.id,
    mealPlanItemId: result.planItems[i].id,
  }));
}

type UpdatableMealPlanRecipeFields = Pick<
  InsertMealPlanRecipe,
  | "title"
  | "description"
  | "imageUrl"
  | "servings"
  | "prepTimeMinutes"
  | "cookTimeMinutes"
  | "difficulty"
  | "cuisine"
  | "mealTypes"
>;

export async function updateMealPlanRecipe(
  id: number,
  userId: string,
  updates: Partial<UpdatableMealPlanRecipeFields>,
): Promise<MealPlanRecipe | undefined> {
  // Fetch the recipe's ingredient names first so we can recompute the
  // `allergens` cache in the same UPDATE — keeps the denormalized column
  // self-healing without a backfill re-run. `UpdatableMealPlanRecipeFields`
  // intentionally omits `ingredients`: meal-plan ingredients are immutable
  // after creation, so the freshly-fetched names are authoritative here. If
  // that type ever gains `ingredients`, move this derivation after the write.
  const ings = await db
    .select({ name: recipeIngredients.name })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id));
  const ingredientNames = ings.map((i) => i.name);
  const allergens = deriveRecipeAllergens(ingredientNames);

  const [recipe] = await db
    .update(mealPlanRecipes)
    .set({ ...updates, allergens, updatedAt: new Date() })
    .where(and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)))
    .returning();
  if (recipe) {
    addToIndex(mealPlanToSearchable(recipe, ingredientNames));
  }
  return recipe || undefined;
}

export async function deleteMealPlanRecipe(
  id: number,
  userId: string,
): Promise<boolean> {
  const deleted = await db.transaction(async (tx) => {
    const result = await tx
      .delete(mealPlanRecipes)
      .where(
        and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)),
      )
      .returning({ id: mealPlanRecipes.id });
    if (result.length === 0) return false;

    // Clean up junction rows that referenced this recipe
    await Promise.all([
      tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, id),
            eq(cookbookRecipes.recipeType, "mealPlan"),
          ),
        ),
      tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.recipeId, id),
            eq(favouriteRecipes.recipeType, "mealPlan"),
          ),
        ),
    ]);
    return true;
  });

  // Update search index AFTER transaction commits — if the tx rolls back,
  // we don't want the index to forget a recipe that still exists in the DB.
  if (deleted) removeFromIndex(`personal:${id}`);
  return deleted;
}
