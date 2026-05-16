import {
  type Cookbook,
  type InsertCookbook,
  type CookbookRecipe,
  type CookbookWithCount,
  type ResolvedCookbookRecipe,
  cookbooks,
  cookbookRecipes,
  mealPlanRecipes,
  communityRecipes,
} from "@shared/schema";
import { db } from "../db";
import { fireAndForget } from "../lib/fire-and-forget";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

// ============================================================================
// COOKBOOKS
// ============================================================================

export async function createCookbook(data: InsertCookbook): Promise<Cookbook> {
  const [created] = await db.insert(cookbooks).values(data).returning();
  return created;
}

export async function getUserCookbooks(
  userId: string,
  limit = 50,
): Promise<CookbookWithCount[]> {
  // Count only junction rows whose target recipes still exist (polymorphic FK — no DB-level FK).
  //
  // Column refs inside this correlated subquery use literal SQL (`cookbooks.id`,
  // `meal_plan_recipes.id`, `community_recipes.id`) instead of `${cookbooks.id}`
  // etc. — Drizzle's `sql` template parameterizes every `${}` interpolation, so
  // `${cookbooks.id}` would emit `$N` (a bound value) and the correlation
  // would silently always return 0. See
  // `docs/legacy-patterns/database.md` → "Drizzle `sql` Template Treats `${column}`
  // as Bound Parameters". Table interpolations (`${cookbookRecipes}`, etc.)
  // are safe — they emit qualified table names, not parameters.
  const recipeCountSql = sql<number>`(
    SELECT count(*) FROM ${cookbookRecipes} cr
    WHERE cr.cookbook_id = cookbooks.id
    AND (
      (cr.recipe_type = 'mealPlan' AND EXISTS (
        SELECT 1 FROM ${mealPlanRecipes} WHERE meal_plan_recipes.id = cr.recipe_id
      ))
      OR
      (cr.recipe_type = 'community' AND EXISTS (
        SELECT 1 FROM ${communityRecipes} WHERE community_recipes.id = cr.recipe_id
      ))
    )
  )`;

  const rows = await db
    .select({
      id: cookbooks.id,
      userId: cookbooks.userId,
      name: cookbooks.name,
      description: cookbooks.description,
      coverImageUrl: cookbooks.coverImageUrl,
      createdAt: cookbooks.createdAt,
      updatedAt: cookbooks.updatedAt,
      recipeCount: recipeCountSql,
    })
    .from(cookbooks)
    .where(eq(cookbooks.userId, userId))
    .orderBy(desc(cookbooks.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, recipeCount: Number(r.recipeCount) }));
}

export async function getCookbook(
  id: number,
  userId: string,
): Promise<Cookbook | undefined> {
  const [cookbook] = await db
    .select()
    .from(cookbooks)
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)));
  return cookbook || undefined;
}

export async function updateCookbook(
  id: number,
  userId: string,
  data: Partial<Pick<Cookbook, "name" | "description" | "coverImageUrl">>,
): Promise<Cookbook | undefined> {
  const [updated] = await db
    .update(cookbooks)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)))
    .returning();
  return updated || undefined;
}

export async function deleteCookbook(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(cookbooks)
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)))
    .returning({ id: cookbooks.id });
  return result.length > 0;
}

// ============================================================================
// COOKBOOK RECIPES (junction table)
// ============================================================================

export async function addRecipeToCookbook(
  cookbookId: number,
  recipeId: number,
  recipeType: "mealPlan" | "community",
  userId: string,
): Promise<CookbookRecipe | undefined> {
  return db.transaction(async (tx) => {
    // The target recipe must also be visible to `userId` — a mealPlan recipe
    // they own, or a community recipe that is public or authored by them.
    // Without this guard, a caller could add a junction row pointing at
    // another user's private recipe and read its metadata back via
    // getResolvedCookbookRecipes (IDOR).
    const recipeAccessGuard =
      recipeType === "mealPlan"
        ? sql`AND EXISTS (
            SELECT 1 FROM ${mealPlanRecipes}
            WHERE ${mealPlanRecipes.id} = ${recipeId}
              AND ${mealPlanRecipes.userId} = ${userId}
          )`
        : sql`AND EXISTS (
            SELECT 1 FROM ${communityRecipes}
            WHERE ${communityRecipes.id} = ${recipeId}
              AND (
                ${communityRecipes.isPublic} = true
                OR ${communityRecipes.authorId} = ${userId}
              )
          )`;

    // Single-statement INSERT...SELECT guarded by a WHERE EXISTS on
    // `cookbooks.user_id` (cookbook ownership) AND the recipe-access guard
    // above (target visibility) — the row is inserted only when both hold.
    // See docs/legacy-patterns/security.md → "Storage-Layer Defense-in-Depth".
    // The ON CONFLICT clause preserves idempotent-add semantics: a duplicate
    // junction row yields no returned row, same as if a guard failed.
    const inserted = await tx.execute<CookbookRecipe>(sql`
      INSERT INTO ${cookbookRecipes} (cookbook_id, recipe_id, recipe_type)
      SELECT ${cookbookId}, ${recipeId}, ${recipeType}
      WHERE EXISTS (
        SELECT 1 FROM ${cookbooks}
        WHERE ${cookbooks.id} = ${cookbookId}
          AND ${cookbooks.userId} = ${userId}
      )
      ${recipeAccessGuard}
      ON CONFLICT DO NOTHING
      RETURNING id, cookbook_id AS "cookbookId", recipe_id AS "recipeId",
                recipe_type AS "recipeType", added_at AS "addedAt"
    `);
    const added = inserted.rows[0];

    // Only bump updatedAt if the insert actually succeeded (not a duplicate
    // and not blocked by the ownership guard). Filtering by userId here too
    // prevents touching a cookbook that the caller does not own.
    if (added) {
      await tx
        .update(cookbooks)
        .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.userId, userId)));
    }

    return added || undefined;
  });
}

export async function removeRecipeFromCookbook(
  cookbookId: number,
  recipeId: number,
  recipeType: "mealPlan" | "community",
  userId: string,
): Promise<boolean> {
  // Single-statement DELETE guarded by a correlated `EXISTS` on `cookbooks` —
  // ownership is enforced in the same statement, no separate SELECT.
  const result = await db
    .delete(cookbookRecipes)
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbookRecipes.recipeId, recipeId),
        eq(cookbookRecipes.recipeType, recipeType),
        sql`EXISTS (
          SELECT 1 FROM ${cookbooks}
          WHERE ${cookbooks.id} = ${cookbookRecipes.cookbookId}
            AND ${cookbooks.userId} = ${userId}
        )`,
      ),
    )
    .returning({ id: cookbookRecipes.id });
  return result.length > 0;
}

export async function getCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<CookbookRecipe[]> {
  const rows = await db
    .select({ recipe: cookbookRecipes })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbooks.userId, userId),
      ),
    )
    .orderBy(desc(cookbookRecipes.addedAt));
  return rows.map((r) => r.recipe);
}

/**
 * Resolve cookbook recipes into displayable data using partitioned batch fetch.
 * Partitions junction rows by recipeType, batch-fetches from each source table,
 * merges via Map lookup, and fire-and-forget cleans orphaned junction rows.
 */
export async function getResolvedCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<ResolvedCookbookRecipe[]> {
  const junctionRows = await getCookbookRecipes(cookbookId, userId);
  if (junctionRows.length === 0) return [];

  // Partition by recipeType
  const mealPlanIds: number[] = [];
  const communityIds: number[] = [];
  for (const row of junctionRows) {
    if (row.recipeType === "mealPlan") {
      mealPlanIds.push(row.recipeId);
    } else if (row.recipeType === "community") {
      communityIds.push(row.recipeId);
    }
  }

  // Batch fetch from both tables in parallel
  const [mealPlanRows, communityRows] = await Promise.all([
    mealPlanIds.length
      ? db
          .select()
          .from(mealPlanRecipes)
          .where(inArray(mealPlanRecipes.id, mealPlanIds))
      : [],
    communityIds.length
      ? db
          .select()
          .from(communityRecipes)
          .where(inArray(communityRecipes.id, communityIds))
      : [],
  ]);

  // Map lookup for O(1) access
  const mealPlanMap = new Map(mealPlanRows.map((r) => [r.id, r]));
  const communityMap = new Map(communityRows.map((r) => [r.id, r]));

  // Resolve + detect orphans
  const resolved: ResolvedCookbookRecipe[] = [];
  const orphanIds: number[] = [];

  for (const row of junctionRows) {
    if (row.recipeType === "mealPlan") {
      const recipe = mealPlanMap.get(row.recipeId);
      if (!recipe) {
        orphanIds.push(row.id);
      } else if (recipe.userId === userId) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "mealPlan",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          addedAt: row.addedAt.toISOString(),
        });
      }
      // recipe exists but is owned by another user → hidden, junction row
      // kept (not an orphan) — defense-in-depth against any pre-guard leak row.
    } else if (row.recipeType === "community") {
      const recipe = communityMap.get(row.recipeId);
      if (!recipe) {
        orphanIds.push(row.id);
      } else if (recipe.isPublic || recipe.authorId === userId) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "community",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          addedAt: row.addedAt.toISOString(),
        });
      }
      // recipe exists but is private and not authored by the caller → hidden,
      // junction row kept so it reappears if the recipe is re-published.
    }
  }

  // Fire-and-forget orphan cleanup
  if (orphanIds.length) {
    fireAndForget(
      "cookbook-orphan-cleanup",
      db.delete(cookbookRecipes).where(inArray(cookbookRecipes.id, orphanIds)),
    );
  }

  return resolved;
}
