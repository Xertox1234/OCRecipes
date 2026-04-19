import {
  type CommunityRecipe,
  type InsertCommunityRecipe,
  communityRecipes,
  mealPlanRecipes,
  recipeGenerationLog,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql, or, ilike } from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";
import {
  addToIndex,
  removeFromIndex,
  communityToSearchable,
  getDocumentStore,
  type SearchIndexableCommunityRecipe,
} from "../lib/search-index";
import { inferMealTypes } from "../lib/meal-type-inference";

/**
 * Ensures the caller-supplied `data` has a populated `mealTypes` array.
 * Falls back to `inferMealTypes(title, ingredientNames)` when callers don't
 * provide one so the community search index can filter symmetrically with
 * meal-plan recipes (M9 fix — community recipes used to hard-code `[]`).
 */
function withInferredMealTypes<
  T extends Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
>(data: T): T {
  if (data.mealTypes && data.mealTypes.length > 0) return data;
  const ingredientNames = (data.ingredients ?? []).map((i) => i.name);
  return { ...data, mealTypes: inferMealTypes(data.title, ingredientNames) };
}

// ============================================================================
// COMMUNITY RECIPES
// ============================================================================

export async function getDailyRecipeGenerationCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeGenerationLog)
    .where(
      and(
        eq(recipeGenerationLog.userId, userId),
        gte(recipeGenerationLog.generatedAt, startOfDay),
        lt(recipeGenerationLog.generatedAt, endOfDay),
      ),
    );

  return Number(result[0]?.count ?? 0);
}

export async function logRecipeGeneration(
  userId: string,
  recipeId: number,
): Promise<void> {
  await db.insert(recipeGenerationLog).values({
    userId,
    recipeId,
  });
}

/**
 * Atomically re-check the daily generation quota and log a generation in one
 * transaction. Returns false when the caller is over the limit so the route
 * can respond 429. Used by preview endpoints that burn an AI call without
 * persisting a recipe — pass `recipeId: null` for those so the row still
 * counts against the quota.
 */
export async function logRecipeGenerationWithLimitCheck(
  userId: string,
  dailyLimit: number,
  recipeId: number | null = null,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );
    const count = Number(result[0]?.count ?? 0);
    if (count >= dailyLimit) return false;
    await tx.insert(recipeGenerationLog).values({ userId, recipeId });
    return true;
  });
}

export async function getCommunityRecipes(
  barcode: string | null,
  normalizedProductName: string,
): Promise<CommunityRecipe[]> {
  // Try exact barcode match first, then fall back to fuzzy name match
  const conditions = [eq(communityRecipes.isPublic, true)];

  if (barcode) {
    // With barcode: match by barcode OR similar product name
    conditions.push(
      or(
        eq(communityRecipes.barcode, barcode),
        ilike(
          communityRecipes.normalizedProductName,
          `%${escapeLike(normalizedProductName)}%`,
        ),
      )!,
    );
  } else {
    // Without barcode: fuzzy match on product name only
    conditions.push(
      ilike(
        communityRecipes.normalizedProductName,
        `%${escapeLike(normalizedProductName)}%`,
      ),
    );
  }

  return db
    .select()
    .from(communityRecipes)
    .where(and(...conditions))
    .orderBy(desc(communityRecipes.createdAt))
    .limit(10);
}

export async function createCommunityRecipe(
  data: Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
): Promise<CommunityRecipe> {
  const values = withInferredMealTypes(data);
  const [recipe] = await db.insert(communityRecipes).values(values).returning();
  if (recipe.isPublic) {
    addToIndex(communityToSearchable(recipe));
  }
  return recipe;
}

/**
 * Atomically checks the daily generation limit and creates a recipe + log entry.
 * Prevents TOCTOU race where concurrent requests both pass the limit check.
 * Returns the created recipe, or null if the daily limit has been reached.
 */
export async function createRecipeWithLimitCheck(
  userId: string,
  dailyLimit: number,
  data: Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
): Promise<CommunityRecipe | null> {
  const recipe = await db.transaction(async (tx) => {
    // Check daily limit inside transaction
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );

    const generationsToday = Number(result[0]?.count ?? 0);
    if (generationsToday >= dailyLimit) {
      return null;
    }

    // Create recipe (classify meal types if caller didn't supply any — M9)
    const values = withInferredMealTypes(data);
    const [created] = await tx
      .insert(communityRecipes)
      .values(values)
      .returning();

    // Log the generation
    await tx.insert(recipeGenerationLog).values({
      userId,
      recipeId: created.id,
    });

    return created;
  });

  // Update search index after transaction commits
  if (recipe?.isPublic) {
    addToIndex(communityToSearchable(recipe));
  }

  return recipe;
}

export async function updateRecipePublicStatus(
  recipeId: number,
  authorId: string,
  isPublic: boolean,
): Promise<CommunityRecipe | undefined> {
  const [recipe] = await db
    .update(communityRecipes)
    .set({ isPublic, updatedAt: new Date() })
    .where(
      and(
        eq(communityRecipes.id, recipeId),
        eq(communityRecipes.authorId, authorId),
      ),
    )
    .returning();
  if (recipe) {
    if (recipe.isPublic) {
      addToIndex(communityToSearchable(recipe));
    } else {
      removeFromIndex(`community:${recipe.id}`);
    }
  }
  return recipe || undefined;
}

export async function getCommunityRecipe(
  id: number,
): Promise<CommunityRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, id));
  return recipe || undefined;
}

export async function getFeaturedRecipes(
  limit = 12,
  offset = 0,
): Promise<CommunityRecipe[]> {
  return db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isPublic, true),
        // Quality gate: exclude recipes with empty instructions
        sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) > 0`,
      ),
    )
    .orderBy(desc(communityRecipes.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Load all public community recipes for search index initialization.
 * Skips heavy JSONB `instructions` column that the index never consumes.
 */
export async function getAllPublicCommunityRecipes(): Promise<
  SearchIndexableCommunityRecipe[]
> {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      description: communityRecipes.description,
      ingredients: communityRecipes.ingredients,
      dietTags: communityRecipes.dietTags,
      mealTypes: communityRecipes.mealTypes,
      difficulty: communityRecipes.difficulty,
      servings: communityRecipes.servings,
      caloriesPerServing: communityRecipes.caloriesPerServing,
      proteinPerServing: communityRecipes.proteinPerServing,
      carbsPerServing: communityRecipes.carbsPerServing,
      fatPerServing: communityRecipes.fatPerServing,
      imageUrl: communityRecipes.imageUrl,
      createdAt: communityRecipes.createdAt,
    })
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isPublic, true),
        sql`COALESCE(jsonb_array_length(${communityRecipes.instructions}), 0) > 0`,
      ),
    )
    .orderBy(desc(communityRecipes.createdAt));
}

// ============================================================================
// MEAL TYPE BACKFILL (used by backfill-community-meal-types script)
// ============================================================================

/**
 * Get community recipes with empty or null mealTypes. Returns the data needed
 * to infer mealTypes (title + ingredient names).
 *
 * Note: community recipe ingredients live in the JSONB `ingredients` column
 * (unlike meal-plan recipes which use a separate `recipe_ingredients` table),
 * so there's no join here.
 *
 * Defense-in-depth (L28): if a `discardedAt` soft-delete column is ever added
 * to `communityRecipes`, add `isNull(communityRecipes.discardedAt)` to the
 * where clause below so discarded recipes are excluded from backfill processing.
 */
export async function getCommunityRecipesWithEmptyMealTypes(): Promise<
  {
    id: number;
    title: string;
    ingredients: { name: string; quantity: string; unit: string }[] | null;
  }[]
> {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes)
    .where(
      sql`${communityRecipes.mealTypes}::jsonb = '[]'::jsonb OR ${communityRecipes.mealTypes} IS NULL`,
    );
}

/**
 * Update mealTypes for multiple community recipes in a single round-trip and
 * refresh the MiniSearch index so the backfill is visible without a server
 * restart. (H8 — 2026-04-18: was a per-row UPDATE loop with no index call.)
 */
export async function batchUpdateCommunityMealTypes(
  updates: { id: number; mealTypes: string[] }[],
): Promise<number> {
  if (updates.length === 0) return 0;

  const valueTuples = updates.map(
    (u) => sql`(${u.id}::int, ${JSON.stringify(u.mealTypes)}::jsonb)`,
  );
  await db.execute(
    sql`UPDATE ${communityRecipes}
        SET meal_types = v.meal_types, updated_at = NOW()
        FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(id, meal_types)
        WHERE ${communityRecipes.id} = v.id`,
  );

  const store = getDocumentStore();
  for (const { id, mealTypes } of updates) {
    const existing = store.get(`community:${id}`);
    if (existing) addToIndex({ ...existing, mealTypes });
  }

  return updates.length;
}

export async function deleteCommunityRecipe(
  recipeId: number,
  authorId: string,
  /** Allow deleting orphaned recipes (NULL authorId). Callers must verify admin status. */
  allowOrphanDelete = false,
): Promise<boolean> {
  // IDOR protection: only delete if owned by the requesting user.
  // Orphan deletion (NULL authorId from cascaded user delete) is opt-in
  // and should only be enabled for admin callers.
  const ownershipCondition = allowOrphanDelete
    ? or(
        eq(communityRecipes.authorId, authorId),
        sql`${communityRecipes.authorId} IS NULL`,
      )
    : eq(communityRecipes.authorId, authorId);

  const deleted = await db.transaction(async (tx) => {
    const result = await tx
      .delete(communityRecipes)
      .where(and(eq(communityRecipes.id, recipeId), ownershipCondition))
      .returning({ id: communityRecipes.id });
    if (result.length === 0) return false;

    // Clean up junction rows that referenced this recipe
    await Promise.all([
      tx
        .delete(cookbookRecipes)
        .where(
          and(
            eq(cookbookRecipes.recipeId, recipeId),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        ),
      tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.recipeId, recipeId),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        ),
    ]);
    return true;
  });

  // Update search index AFTER transaction commits — if the tx rolls back,
  // we don't want the index to forget a recipe that still exists in the DB.
  if (deleted) removeFromIndex(`community:${recipeId}`);
  return deleted;
}

export async function getUserRecipes(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ items: CommunityRecipe[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId))
      .orderBy(desc(communityRecipes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId)),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}

/** Fetch recipe data for sharing. Returns null if not found or not accessible. */
export async function getRecipeSharePayload(
  recipeId: number,
  recipeType: "mealPlan" | "community",
  userId: string,
): Promise<{
  title: string;
  description: string;
  imageUrl: string | null;
} | null> {
  if (recipeType === "community") {
    // Community recipes must be public OR owned by the requesting user
    const [recipe] = await db
      .select({
        title: communityRecipes.title,
        description: communityRecipes.description,
        imageUrl: communityRecipes.imageUrl,
      })
      .from(communityRecipes)
      .where(
        and(
          eq(communityRecipes.id, recipeId),
          or(
            eq(communityRecipes.isPublic, true),
            eq(communityRecipes.authorId, userId),
          ),
        ),
      );
    if (!recipe) return null;
    return {
      title: recipe.title,
      description: recipe.description ?? "",
      imageUrl: recipe.imageUrl ?? null,
    };
  } else {
    // mealPlan recipes are personal — verify ownership
    const [recipe] = await db
      .select({
        title: mealPlanRecipes.title,
        description: mealPlanRecipes.description,
        imageUrl: mealPlanRecipes.imageUrl,
      })
      .from(mealPlanRecipes)
      .where(
        and(
          eq(mealPlanRecipes.id, recipeId),
          eq(mealPlanRecipes.userId, userId),
        ),
      );
    if (!recipe) return null;
    return {
      title: recipe.title,
      description: recipe.description ?? "",
      imageUrl: recipe.imageUrl ?? null,
    };
  }
}
