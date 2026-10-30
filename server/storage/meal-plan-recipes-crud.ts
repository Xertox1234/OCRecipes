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
  savedItems,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import {
  addToIndex,
  removeFromIndex,
  mealPlanToSearchable,
} from "../lib/search-index";
import { deriveRecipeAllergens } from "@shared/constants/allergens";
import { deriveRecipeDietConflicts } from "@shared/constants/diet-conflicts";
import { deleteImagesIfUnreferenced } from "./account-images";
import { fireAndForget } from "../lib/fire-and-forget";
import {
  normalizeRecipeFields,
  normalizeIngredient,
} from "../lib/recipe-normalization";

// ============================================================================
// MEAL PLAN RECIPES (CRUD)
// ============================================================================

export async function getMealPlanRecipe(
  id: number,
  userId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.id, id),
        eq(mealPlanRecipes.userId, userId),
        isNull(mealPlanRecipes.deletedAt),
      ),
    );
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
  const live = and(
    eq(mealPlanRecipes.userId, userId),
    isNull(mealPlanRecipes.deletedAt),
  );
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(mealPlanRecipes)
      .where(live)
      .orderBy(desc(mealPlanRecipes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(mealPlanRecipes)
      .where(live),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/** Matches a clean decimal string like "2" or "1.5" that fits `recipeIngredients.quantity`
 * (a nullable `decimal(10,2)` column: precision 10, scale 2, so at most 8 integer digits —
 * `99999999.99` is the largest value the column accepts). Anything else, including a
 * numerically-shaped but over-magnitude string like "123456789", can't be stored. */
const DECIMAL_QUANTITY_RE = /^\d{1,8}(\.\d+)?$/;

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
  //
  // Normalization runs here (not in the route layer) so every creation path
  // routed through this function — import, manual entry, catalog save — is
  // guaranteed to be normalized, structurally, rather than depending on each
  // route remembering to call normalizeRecipeFields itself. Note:
  // createMealPlanFromSuggestions and saveRecipeFromChat write mealPlanRecipes/
  // communityRecipes independently and are NOT covered by this guarantee.
  const normalized = normalizeRecipeFields({
    title: recipe.title,
    description: recipe.description,
    difficulty: recipe.difficulty,
    instructions: recipe.instructions,
    ingredients: ingredients?.map((ing) => ({
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
    })),
  });

  const normalizedRecipe: InsertMealPlanRecipe = {
    ...recipe,
    title: normalized.title ?? recipe.title,
    description: normalized.description,
    difficulty: normalized.difficulty,
    instructions: normalized.instructions ?? recipe.instructions,
  };

  // normalizeIngredient never produces null (see recipe-normalization.ts) —
  // the nullable-decimal coercion is this caller's own fallback policy,
  // scoped here because this targets the nullable recipeIngredients.quantity
  // decimal column (communityRecipes' JSONB ingredients column has no such
  // constraint; see Task 6). createMealPlanFromSuggestions below applies the
  // identical coercion for the same reason — it targets the same column.
  const normalizedIngredients = ingredients?.map((ing, i) => {
    const n = normalized.ingredients?.[i];
    if (!n) return ing;
    return {
      ...ing,
      name: n.name,
      unit: n.unit,
      quantity: DECIMAL_QUANTITY_RE.test(n.quantity) ? n.quantity : null,
    };
  });

  if (normalizedIngredients && normalizedIngredients.length > 0) {
    const ingredientNames = normalizedIngredients.map((i) => i.name);
    const allergens = deriveRecipeAllergens(ingredientNames);
    const dietConflicts = deriveRecipeDietConflicts(ingredientNames);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mealPlanRecipes)
        .values({ ...normalizedRecipe, allergens, dietConflicts })
        .returning();
      await tx.insert(recipeIngredients).values(
        normalizedIngredients.map((ing, idx) => ({
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
    // No ingredients: diet conflicts are unchecked (null), never "none found".
    .values({ ...normalizedRecipe, allergens: [], dietConflicts: null })
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

  // Normalize each meal's ingredient name/unit/quantity the same way
  // createMealPlanRecipe does. This is an independent AI-suggestion save path
  // (see the note on createMealPlanRecipe above) that targets the same
  // nullable recipeIngredients.quantity decimal(10,2) column — an
  // AI-generated quantity like "1/2" or "½" must be normalized to a decimal
  // or coerced to null, never inserted raw (it would throw "invalid input
  // syntax for type numeric").
  const normalizedMeals = meals.map((m) => ({
    ...m,
    ingredients: m.ingredients.map((ing) => {
      const n = normalizeIngredient({
        name: ing.name,
        quantity: ing.quantity ?? "",
        unit: ing.unit ?? "",
      });
      return {
        ...ing,
        name: n.name,
        unit: n.unit,
        quantity: DECIMAL_QUANTITY_RE.test(n.quantity) ? n.quantity : null,
      };
    }),
  }));

  const result = await db.transaction(async (tx) => {
    // Batch-insert all recipes at once, deriving each recipe's allergen and
    // diet-conflict caches from its ingredient names (pure shared functions —
    // no service deps).
    const recipes = await tx
      .insert(mealPlanRecipes)
      .values(
        normalizedMeals.map((m) => {
          const names = m.ingredients.map((i) => i.name);
          return {
            ...m.recipe,
            allergens: deriveRecipeAllergens(names),
            dietConflicts: deriveRecipeDietConflicts(names),
          };
        }),
      )
      .returning();

    // Batch-insert all ingredients at once (with correct recipeIds)
    const allIngredients = recipes.flatMap((recipe, i) =>
      normalizedMeals[i].ingredients.map((ing, idx) => ({
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
          ...normalizedMeals[i].planItem,
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
  // Normalize only the fields present in this partial update — a
  // difficulty-only edit must not require a title. Spreading `normalized`
  // after `updates` overrides just the title/description/difficulty keys
  // that were actually present; every other field in `updates` (imageUrl,
  // servings, etc.) passes through untouched.
  const normalized = normalizeRecipeFields({
    ...("title" in updates ? { title: updates.title } : {}),
    ...("description" in updates ? { description: updates.description } : {}),
    ...("difficulty" in updates ? { difficulty: updates.difficulty } : {}),
  });
  const normalizedUpdates: Partial<UpdatableMealPlanRecipeFields> = {
    ...updates,
    ...normalized,
  };

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
  const dietConflicts = deriveRecipeDietConflicts(ingredientNames);

  // Capture the current imageUrl when it's being replaced so the old stored
  // object can be cleaned up — post-R2 these are durable, billed objects.
  // A deleted recipe is not editable — and the UPDATE must not match it, or
  // the addToIndex below would put it back into search.
  const liveOwned = and(
    eq(mealPlanRecipes.id, id),
    eq(mealPlanRecipes.userId, userId),
    isNull(mealPlanRecipes.deletedAt),
  );
  let previousImageUrl: string | null = null;
  if (normalizedUpdates.imageUrl !== undefined) {
    const [existing] = await db
      .select({ imageUrl: mealPlanRecipes.imageUrl })
      .from(mealPlanRecipes)
      .where(liveOwned);
    previousImageUrl = existing?.imageUrl ?? null;
  }

  const [recipe] = await db
    .update(mealPlanRecipes)
    .set({
      ...normalizedUpdates,
      allergens,
      dietConflicts,
      updatedAt: new Date(),
    })
    .where(liveOwned)
    .returning();
  if (recipe) {
    addToIndex(mealPlanToSearchable(recipe, ingredientNames));
    // Fire-and-forget: object-store failure must not fail the update.
    // imageUrl is client-suppliable, so the old URL may be another user's
    // image: delete it only if no row references it any more. The "recipe"
    // kind keeps the delete inside recipe-images/.
    if (previousImageUrl && previousImageUrl !== recipe.imageUrl) {
      fireAndForget(
        "meal-plan-recipe-image-replace-cleanup",
        deleteImagesIfUnreferenced([{ url: previousImageUrl, kind: "recipe" }]),
      );
    }
  }
  return recipe || undefined;
}

/**
 * Soft-deletes a personal recipe: stamps `deleted_at` instead of removing the
 * row. `daily_logs.recipe_id` references this table ON DELETE CASCADE and
 * `getDailySummary` joins the recipe's per-serving values, so a hard delete
 * erased the calories of every day the user logged it. The row stays for that
 * history; every user-facing read filters `deleted_at IS NULL`.
 *
 * Returns false when no live recipe with this id belongs to `userId` (missing,
 * another user's, or already deleted).
 */
export async function deleteMealPlanRecipe(
  id: number,
  userId: string,
): Promise<boolean> {
  const deletedRow = await db.transaction(async (tx) => {
    const result = await tx
      .update(mealPlanRecipes)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(mealPlanRecipes.id, id),
          eq(mealPlanRecipes.userId, userId),
          isNull(mealPlanRecipes.deletedAt),
        ),
      )
      .returning({ id: mealPlanRecipes.id });
    if (result.length === 0) return null;

    // Clear what used to go with the row: the hard delete cascaded the
    // recipe's meal-plan items, and removed its junction rows below. A
    // daily log confirmed from one of those items keeps its recipe_id
    // (meal_plan_item_id is ON DELETE SET NULL), so the history survives.
    // One query at a time: a transaction has one connection, and pg@9
    // removes the queue that today lets Promise.all'd queries share it.
    await tx.delete(mealPlanItems).where(eq(mealPlanItems.recipeId, id));
    await tx
      .delete(cookbookRecipes)
      .where(
        and(
          eq(cookbookRecipes.recipeId, id),
          eq(cookbookRecipes.recipeType, "mealPlan"),
        ),
      );
    await tx
      .delete(favouriteRecipes)
      .where(
        and(
          eq(favouriteRecipes.recipeId, id),
          eq(favouriteRecipes.recipeType, "mealPlan"),
        ),
      );
    await tx
      .delete(savedItems)
      .where(
        and(eq(savedItems.recipeId, id), eq(savedItems.recipeType, "mealPlan")),
      );
    return result[0];
  });

  // Update search index AFTER transaction commits — if the tx rolls back,
  // we don't want the index to forget a recipe that still exists in the DB.
  // The stored image is deliberately kept: the soft-deleted row still
  // references it (so deleteImagesIfUnreferenced would find it referenced
  // anyway), and it goes when the row is finally purged — by account
  // deletion today.
  if (deletedRow) removeFromIndex(`personal:${id}`);
  return deletedRow !== null;
}
