import {
  communityRecipes,
  mealPlanRecipes,
  recipeDismissals,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql, or, inArray, isNull } from "drizzle-orm";
import { FEATURED_COLUMNS, type FeaturedRecipe } from "./community-recipes";

// Read-only community recipe queries: a user's own recipes, the share
// payload, batch title lookup and trending search terms. Split from
// ./community-recipes (500-line storage rule); exported via ./community.

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
          isNull(mealPlanRecipes.deletedAt),
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

/**
 * Top "trending search" terms derived from the popular public recipe set:
 * unnested diet tags + cuisine origins, ranked by summed popularityScore.
 * Returns display-ready term strings (original casing). Powers the Home
 * search drawer's trending carousel.
 */
export async function getTrendingSearchTerms(limit = 8): Promise<string[]> {
  const result = await db.execute(sql`
    WITH terms AS (
      SELECT tag AS term, popularity_score AS score
      FROM community_recipes,
           jsonb_array_elements_text(diet_tags) AS tag
      WHERE is_public = true AND tag <> ''
      UNION ALL
      SELECT cuisine_origin AS term, popularity_score AS score
      FROM community_recipes
      WHERE is_public = true
        AND cuisine_origin IS NOT NULL
        AND cuisine_origin <> ''
    )
    SELECT term, SUM(score) AS weight, COUNT(*) AS n
    FROM terms
    GROUP BY term
    ORDER BY SUM(score) DESC, COUNT(*) DESC, term ASC
    LIMIT ${limit}
  `);
  const rows = result.rows as { term: string }[];
  return rows.map((r) => r.term);
}
