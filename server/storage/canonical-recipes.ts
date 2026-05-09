import { db } from "../db";
import { eq, and, or, gte, desc, sql, isNull } from "drizzle-orm";
import { communityRecipes, type CommunityRecipe } from "@shared/schema";

const PROMOTION_THRESHOLD = {
  favorites: 5,
  mealPlans: 3,
  cookSessions: 1, // intentionally lenient during early growth; raise without schema change
} as const;

type PopularityEvent = "favorite" | "mealPlan" | "cookSession";

/** Increment a popularity counter and recompute the weighted score. */
export async function incrementRecipePopularity(
  recipeId: number,
  event: PopularityEvent,
): Promise<void> {
  const updates =
    event === "favorite"
      ? {
          popularityFavorites: sql`${communityRecipes.popularityFavorites} + 1`,
          popularityScore: sql`${communityRecipes.popularityScore} + 1`,
        }
      : event === "mealPlan"
        ? {
            popularityMealPlans: sql`${communityRecipes.popularityMealPlans} + 1`,
            popularityScore: sql`${communityRecipes.popularityScore} + 2`,
          }
        : {
            popularityCookSessions: sql`${communityRecipes.popularityCookSessions} + 1`,
            popularityScore: sql`${communityRecipes.popularityScore} + 3`,
          };

  await db
    .update(communityRecipes)
    .set(updates)
    .where(eq(communityRecipes.id, recipeId));
}

/** Mark a recipe as canonical. */
export async function markCanonical(recipeId: number): Promise<void> {
  await db
    .update(communityRecipes)
    .set({
      isCanonical: true,
      canonicalizedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(communityRecipes.id, recipeId));
}

/** Mark enrichment as complete. */
export async function markEnriched(
  recipeId: number,
  enrichment: {
    canonicalImages: string[];
    instructionDetails: (string | null)[];
    toolsRequired: { name: string; affiliateUrl?: string }[];
    chefTips: string[];
    cuisineOrigin: string;
  },
): Promise<void> {
  await db
    .update(communityRecipes)
    .set({
      ...enrichment,
      canonicalEnrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(communityRecipes.id, recipeId));
}

/** Find non-canonical recipes that cross the promotion threshold. */
export async function getEligibleForPromotion(
  limit = 10,
): Promise<CommunityRecipe[]> {
  // Two cases:
  // 1. Not yet canonical and popularity threshold met → promote + enrich
  // 2. Already canonical but enrichment failed (canonicalEnrichedAt IS NULL) → re-enrich
  return db
    .select()
    .from(communityRecipes)
    .where(
      or(
        and(
          eq(communityRecipes.isCanonical, false),
          or(
            gte(
              communityRecipes.popularityFavorites,
              PROMOTION_THRESHOLD.favorites,
            ),
            gte(
              communityRecipes.popularityMealPlans,
              PROMOTION_THRESHOLD.mealPlans,
            ),
            gte(
              communityRecipes.popularityCookSessions,
              PROMOTION_THRESHOLD.cookSessions,
            ),
          )!,
        ),
        and(
          eq(communityRecipes.isCanonical, true),
          isNull(communityRecipes.canonicalEnrichedAt),
        ),
      )!,
    )
    .orderBy(desc(communityRecipes.popularityScore))
    .limit(limit);
}

/** Paginated list of curated recipes for API and home carousel. */
export async function getCuratedRecipes(opts?: {
  limit?: number;
  offset?: number;
}): Promise<CommunityRecipe[]> {
  return db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.isCanonical, true),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .orderBy(desc(communityRecipes.popularityScore))
    .limit(opts?.limit ?? 20)
    .offset(opts?.offset ?? 0);
}

/** Single curated recipe by ID. Returns null if not curated. */
export async function getCuratedRecipeById(
  id: number,
): Promise<CommunityRecipe | null> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.id, id),
        eq(communityRecipes.isCanonical, true),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .limit(1);
  return recipe ?? null;
}

/** Find a recipe by ID regardless of canonical status (used by seed script). */
export async function getRecipeById(
  id: number,
): Promise<CommunityRecipe | null> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, id))
    .limit(1);
  return recipe ?? null;
}
