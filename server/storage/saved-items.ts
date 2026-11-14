import { type SavedItem, savedItems } from "@shared/schema";
import {
  type CreateSavedItemInput,
  type SavedRecipeLinkStatus,
} from "@shared/schemas/saved-items";
import { TIER_FEATURES } from "@shared/types/premium";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import { getEffectiveTierForUser } from "./subscription-status";

// ============================================================================
// SAVED ITEMS
// ============================================================================

export async function getSavedItems(
  userId: string,
  limit = 100,
): Promise<SavedItem[]> {
  return db
    .select()
    .from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt))
    .limit(limit);
}

export async function getSavedItemCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(savedItems)
    .where(eq(savedItems.userId, userId));
  return result[0]?.count ?? 0;
}

export async function createSavedItem(
  userId: string,
  itemData: CreateSavedItemInput,
): Promise<SavedItem | null> {
  // Resolve the effective tier OUTSIDE the transaction — `getEffectiveTierForUser`
  // applies the expired-premium downgrade and uses the canonical single-call path.
  // Tier changes do not race in practice with limit-checked inserts, so a separate
  // pool connection for this read is acceptable (and matches `getSubscriptionStatus`).
  const effectiveTier = await getEffectiveTierForUser(userId);
  const limit = TIER_FEATURES[effectiveTier].maxSavedItems;

  return db.transaction(async (tx) => {
    // Serialize concurrent saved-item inserts for the same user so the count
    // read and the limited insert are atomic. Without this lock, two parallel
    // requests under READ COMMITTED can both see count = N, both pass the
    // limit check, and both insert — landing the user above the tier cap.
    // Mirrors `toggleFavouriteRecipe`; hashtextextended is the 64-bit form
    // (eliminates the ~65k-user birthday-collision risk of 32-bit hashtext).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );

    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, userId));
    const count = countResult[0]?.count ?? 0;

    if (count >= limit) {
      return null; // Signal limit reached
    }

    const [item] = await tx
      .insert(savedItems)
      .values({ ...itemData, userId })
      .returning();

    return item;
  });
}

/**
 * Put a recipe the user just saved (catalog or chat Save) into Saved Items as
 * a row linked to it. Idempotent per (user, recipeType, recipeId): an
 * already-linked recipe reads "exists" and never counts against the cap.
 * Same lock + cap as createSavedItem.
 */
export async function saveRecipeToSavedItems(
  userId: string,
  link: {
    recipeId: number;
    recipeType: "mealPlan" | "community";
    title: string;
    description?: string | null;
    difficulty?: string | null;
    timeEstimate?: string | null;
  },
): Promise<SavedRecipeLinkStatus> {
  const effectiveTier = await getEffectiveTierForUser(userId);
  const limit = TIER_FEATURES[effectiveTier].maxSavedItems;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );

    const [existing] = await tx
      .select({ id: savedItems.id })
      .from(savedItems)
      .where(
        and(
          eq(savedItems.userId, userId),
          eq(savedItems.recipeType, link.recipeType),
          eq(savedItems.recipeId, link.recipeId),
        ),
      );
    if (existing) return "exists";

    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, userId));
    if ((countResult[0]?.count ?? 0) >= limit) return "limit_reached";

    await tx.insert(savedItems).values({
      userId,
      type: "recipe",
      title: link.title.slice(0, 200),
      description: link.description ?? null,
      difficulty: link.difficulty ?? null,
      timeEstimate: link.timeEstimate ?? null,
      recipeId: link.recipeId,
      recipeType: link.recipeType,
    });
    return "linked";
  });
}

export async function deleteSavedItem(
  id: number,
  userId: string,
): Promise<boolean> {
  // IDOR protection: only delete if owned by user
  const result = await db
    .delete(savedItems)
    .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId)))
    .returning({ id: savedItems.id });

  return result.length > 0;
}
