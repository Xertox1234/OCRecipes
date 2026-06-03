import {
  type CommunityRecipe,
  type InsertCommunityRecipe,
  communityRecipes,
  mealPlanRecipes,
  recipeGenerationLog,
  cookbookRecipes,
  favouriteRecipes,
  recipeDismissals,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql, or, ilike, inArray } from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";
import {
  addToIndex,
  removeFromIndex,
  communityToSearchable,
  type SearchIndexableCommunityRecipe,
} from "../lib/search-index";
import { deriveRecipeAllergens } from "@shared/constants/allergens";

// ============================================================================
// COMMUNITY RECIPES
// ============================================================================

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
  // Derive the `allergens` cache from the JSONB ingredient names so new
  // recipes are searchable by the "Safe for me" filter without a backfill.
  const allergens = deriveRecipeAllergens(
    (data.ingredients ?? []).map((i) => i.name),
  );
  const [recipe] = await db
    .insert(communityRecipes)
    .values({ ...data, allergens })
    .returning();
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
  tz: string = "UTC",
): Promise<CommunityRecipe | null> {
  const recipe = await db.transaction(async (tx) => {
    // Check daily limit inside transaction
    const { startOfDay, endOfDay } = getDayBounds(new Date(), tz);
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

    // Create recipe — callers must supply pre-computed mealTypes (storage-layer
    // purity). `allergens` is derived inline from ingredient names via the
    // pure `deriveRecipeAllergens` shared function (no service deps).
    const allergens = deriveRecipeAllergens(
      (data.ingredients ?? []).map((i) => i.name),
    );
    const [created] = await tx
      .insert(communityRecipes)
      .values({ ...data, allergens })
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

export async function updateCommunityRecipeImageUrl( // idor-safe: internal background patcher — recipeId from DB result, no user input
  recipeId: number,
  imageUrl: string,
): Promise<void> {
  await db
    .update(communityRecipes)
    .set({ imageUrl, updatedAt: new Date() })
    .where(eq(communityRecipes.id, recipeId));
}

/**
 * Fetch a single community recipe, scoped to what the requesting user may see.
 *
 * Visibility is enforced in SQL: a recipe is returned only when it is public
 * OR owned by `userId`. A private recipe owned by someone else resolves to
 * `undefined` — identical to a missing id — so callers cannot probe whether a
 * private recipe exists (no existence leak). All call-sites supply
 * `req.userId`; there is no internal/unscoped read of this function.
 */
export async function getCommunityRecipe(
  id: number,
  userId: string,
): Promise<CommunityRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.id, id),
        or(
          eq(communityRecipes.isPublic, true),
          eq(communityRecipes.authorId, userId),
        ),
      ),
    );
  return recipe || undefined;
}

/**
 * Display columns for browse/featured endpoints.
 * Excludes the heavy `instructions` JSONB column — browse cards never render step-by-step instructions.
 */
export const FEATURED_COLUMNS = {
  id: communityRecipes.id,
  authorId: communityRecipes.authorId,
  barcode: communityRecipes.barcode,
  normalizedProductName: communityRecipes.normalizedProductName,
  title: communityRecipes.title,
  description: communityRecipes.description,
  difficulty: communityRecipes.difficulty,
  timeEstimate: communityRecipes.timeEstimate,
  servings: communityRecipes.servings,
  dietTags: communityRecipes.dietTags,
  mealTypes: communityRecipes.mealTypes,
  allergens: communityRecipes.allergens,
  ingredients: communityRecipes.ingredients,
  caloriesPerServing: communityRecipes.caloriesPerServing,
  proteinPerServing: communityRecipes.proteinPerServing,
  carbsPerServing: communityRecipes.carbsPerServing,
  fatPerServing: communityRecipes.fatPerServing,
  imageUrl: communityRecipes.imageUrl,
  isPublic: communityRecipes.isPublic,
  remixedFromId: communityRecipes.remixedFromId,
  remixedFromTitle: communityRecipes.remixedFromTitle,
  createdAt: communityRecipes.createdAt,
  updatedAt: communityRecipes.updatedAt,
  // Popularity tracking
  popularityFavorites: communityRecipes.popularityFavorites,
  popularityMealPlans: communityRecipes.popularityMealPlans,
  popularityCookSessions: communityRecipes.popularityCookSessions,
  popularityScore: communityRecipes.popularityScore,
  // Promotion state
  isCanonical: communityRecipes.isCanonical,
  canonicalizedAt: communityRecipes.canonicalizedAt,
  canonicalEnrichedAt: communityRecipes.canonicalEnrichedAt,
  // Canonical content
  canonicalImages: communityRecipes.canonicalImages,
  instructionDetails: communityRecipes.instructionDetails,
  toolsRequired: communityRecipes.toolsRequired,
  chefTips: communityRecipes.chefTips,
  cuisineOrigin: communityRecipes.cuisineOrigin,
  videoUrl: communityRecipes.videoUrl,
} as const;

export type FeaturedRecipe = Omit<
  CommunityRecipe,
  "instructions" | "sourceMessageId"
>;

export async function getFeaturedRecipes(
  limit = 12,
  offset = 0,
): Promise<FeaturedRecipe[]> {
  return db
    .select(FEATURED_COLUMNS)
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
      allergens: communityRecipes.allergens,
      difficulty: communityRecipes.difficulty,
      servings: communityRecipes.servings,
      caloriesPerServing: communityRecipes.caloriesPerServing,
      proteinPerServing: communityRecipes.proteinPerServing,
      carbsPerServing: communityRecipes.carbsPerServing,
      fatPerServing: communityRecipes.fatPerServing,
      imageUrl: communityRecipes.imageUrl,
      isCanonical: communityRecipes.isCanonical,
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
      tx
        .delete(recipeDismissals)
        .where(
          and(
            eq(recipeDismissals.recipeIdentifier, String(recipeId)),
            eq(recipeDismissals.source, "community"),
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
): Promise<{ items: FeaturedRecipe[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db
      .select(FEATURED_COLUMNS)
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

/**
 * Resolve a batch of community recipe IDs → display titles, scoped to recipes
 * the given user has dismissed. Used to build the dismissed-recipe context for
 * the meal-suggestion prompt (so the LLM does not re-suggest rejected recipes).
 *
 * Visibility is intentionally NOT filtered by `isPublic`: a recipe that was
 * public when dismissed but later made private must still resolve its title, or
 * the dismissed-context map silently loses entries. Instead the query is scoped
 * by an INNER JOIN through `recipe_dismissals` (source `community`, the same
 * user) — the dismissal record is the authorization. This makes the function
 * self-enforcing: it can only ever return titles for recipes THIS user has
 * dismissed, so a caller cannot pass arbitrary ids and read another user's
 * private recipe titles. Returns a Map for order-preserving id→title lookup.
 */
export async function getCommunityRecipeTitlesByIds(
  ids: number[],
  userId: string,
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: communityRecipes.id, title: communityRecipes.title })
    .from(communityRecipes)
    .innerJoin(
      recipeDismissals,
      and(
        eq(
          recipeDismissals.recipeIdentifier,
          sql`${communityRecipes.id}::text`,
        ),
        eq(recipeDismissals.userId, userId),
        eq(recipeDismissals.source, "community"),
      ),
    )
    .where(inArray(communityRecipes.id, ids));
  return new Map(rows.map((r) => [r.id, r.title]));
}
