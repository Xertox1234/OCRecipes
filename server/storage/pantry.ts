import {
  type PantryItem,
  type InsertPantryItem,
  pantryItems,
  groceryListItems,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, or, isNull, lte, gte, sql } from "drizzle-orm";

// ============================================================================
// PANTRY ITEMS
// ============================================================================

export async function getPantryItemCount(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId));
  return result?.count ?? 0;
}

export async function getPantryItems(
  userId: string,
  limit = 200,
): Promise<PantryItem[]> {
  return db
    .select()
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId))
    .orderBy(pantryItems.category, pantryItems.name)
    .limit(limit);
}

export async function getPantryItem(
  id: number,
  userId: string,
): Promise<PantryItem | undefined> {
  const [item] = await db
    .select()
    .from(pantryItems)
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)));
  return item || undefined;
}

export async function createPantryItem(
  item: InsertPantryItem,
): Promise<PantryItem> {
  const [created] = await db.insert(pantryItems).values(item).returning();
  return created;
}

/**
 * Atomically create a pantry item from a grocery item and flag it as added.
 *
 * The flag is claimed first, and only while it is still false — so a double
 * tap or a retried request adds the item once. Returns `undefined` when the
 * item was already added (or is not in that list).
 */
export async function addGroceryItemToPantryAtomically(
  item: InsertPantryItem,
  groceryItemId: number,
  groceryListId: number,
): Promise<PantryItem | undefined> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(groceryListItems)
      .set({ addedToPantry: true })
      .where(
        and(
          eq(groceryListItems.id, groceryItemId),
          eq(groceryListItems.groceryListId, groceryListId),
          // The column is nullable; NULL means not added yet.
          or(
            eq(groceryListItems.addedToPantry, false),
            isNull(groceryListItems.addedToPantry),
          ),
        ),
      )
      .returning({ id: groceryListItems.id });
    if (!claimed) return undefined;
    const [created] = await tx.insert(pantryItems).values(item).returning();
    return created;
  });
}

/**
 * Batch insert pantry items (used by receipt scanner).
 */
export async function createPantryItems(
  items: InsertPantryItem[],
): Promise<PantryItem[]> {
  if (items.length === 0) return [];
  return db.insert(pantryItems).values(items).returning();
}

export type PantryItemUpdates = Partial<
  Pick<
    InsertPantryItem,
    "name" | "quantity" | "unit" | "category" | "expiresAt"
  >
>;

export async function updatePantryItem(
  id: number,
  userId: string,
  updates: PantryItemUpdates,
): Promise<PantryItem | undefined> {
  const [updated] = await db
    .update(pantryItems)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
    .returning();
  return updated || undefined;
}

export async function deletePantryItem(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(pantryItems)
    .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
    .returning({ id: pantryItems.id });
  return result.length > 0;
}

export async function getExpiringPantryItems(
  userId: string,
  withinDays: number,
): Promise<PantryItem[]> {
  const now = new Date();
  const deadline = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  return db
    .select()
    .from(pantryItems)
    .where(
      and(
        eq(pantryItems.userId, userId),
        sql`${pantryItems.expiresAt} IS NOT NULL`,
        lte(pantryItems.expiresAt, deadline),
        gte(pantryItems.expiresAt, now),
      ),
    )
    .orderBy(pantryItems.expiresAt);
}
