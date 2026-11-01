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

/** Hard cap on pantry rows per user, enforced on every insert path. */
export const MAX_PANTRY_ITEMS = 500;

export type PantryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Take the per-user pantry lock (released at commit) and return how many more
 * items fit under the cap. The lock key is feature-scoped so pantry inserts do
 * not queue behind unrelated per-user locks. Must be the first statement of the
 * transaction that goes on to insert.
 */
async function lockPantryAndGetRoom(
  tx: PantryTx,
  userId: string,
): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${"pantry:" + userId}, 0))`,
  );
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId));
  return Math.max(0, MAX_PANTRY_ITEMS - (result?.count ?? 0));
}

/**
 * Insert pantry items under the cap, inside the caller's transaction. Adds as
 * many as fit (in order) and reports how many were left out. The single cap
 * check behind every pantry insert path: single add, receipt confirm and batch
 * scan all go through it.
 */
export async function insertPantryItemsUnderCap(
  tx: PantryTx,
  userId: string,
  items: InsertPantryItem[],
): Promise<{ created: PantryItem[]; skipped: number }> {
  const room = await lockPantryAndGetRoom(tx, userId);
  const fitting = items.slice(0, room);
  const created =
    fitting.length > 0
      ? await tx
          .insert(pantryItems)
          .values(fitting.map((item) => ({ ...item, userId })))
          .returning()
      : [];
  return { created, skipped: items.length - created.length };
}

/** Insert pantry items under the cap in a fresh transaction. */
export async function createPantryItemsUnderCap(
  userId: string,
  items: InsertPantryItem[],
): Promise<{ created: PantryItem[]; skipped: number }> {
  return db.transaction((tx) => insertPantryItemsUnderCap(tx, userId, items));
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

/**
 * Atomically create a pantry item from a grocery item and flag it as added.
 *
 * The cap is checked first, under the pantry lock, so a full pantry leaves the
 * grocery item unflagged. The flag is then claimed only while it is still
 * false, so a double tap or a retried request adds the item once.
 * Returns `undefined` when the item was already added (or is not in that list)
 * and `"limit_reached"` when the pantry is full.
 */
export async function addGroceryItemToPantryAtomically(
  item: InsertPantryItem,
  groceryItemId: number,
  groceryListId: number,
): Promise<PantryItem | undefined | "limit_reached"> {
  return db.transaction(async (tx) => {
    const room = await lockPantryAndGetRoom(tx, item.userId);
    if (room < 1) return "limit_reached";
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
