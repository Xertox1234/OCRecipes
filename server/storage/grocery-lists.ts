import {
  type GroceryList,
  type InsertGroceryList,
  type GroceryListItem,
  type InsertGroceryListItem,
  groceryLists,
  groceryListItems,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";

// ============================================================================
// GROCERY LISTS
// ============================================================================

export async function createGroceryList(
  list: InsertGroceryList,
): Promise<GroceryList> {
  const [created] = await db.insert(groceryLists).values(list).returning();
  return created;
}

export async function getGroceryListCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(groceryLists)
    .where(eq(groceryLists.userId, userId));
  return Number(result[0]?.count ?? 0);
}

export async function getGroceryLists(
  userId: string,
  limit = 100,
): Promise<GroceryList[]> {
  return db
    .select()
    .from(groceryLists)
    .where(eq(groceryLists.userId, userId))
    .orderBy(desc(groceryLists.createdAt))
    .limit(limit);
}

export async function getGroceryListWithItems(
  id: number,
  userId: string,
): Promise<(GroceryList & { items: GroceryListItem[] }) | undefined> {
  const [lists, items] = await Promise.all([
    db
      .select()
      .from(groceryLists)
      .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId))),
    db
      .select()
      .from(groceryListItems)
      .where(eq(groceryListItems.groceryListId, id))
      .orderBy(groceryListItems.category, groceryListItems.name),
  ]);
  if (lists.length === 0) return undefined;

  return { ...lists[0], items };
}

export async function verifyGroceryListOwnership(
  id: number,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: groceryLists.id })
    .from(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)));
  return !!row;
}

export async function deleteGroceryList(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)))
    .returning({ id: groceryLists.id });
  return result.length > 0;
}

export async function addGroceryListItem(
  item: InsertGroceryListItem,
): Promise<GroceryListItem> {
  const [created] = await db.insert(groceryListItems).values(item).returning();
  return created;
}

export async function addGroceryListItems(
  items: InsertGroceryListItem[],
): Promise<GroceryListItem[]> {
  if (items.length === 0) return [];
  return db.insert(groceryListItems).values(items).returning();
}

/** Atomically check list count limit, create list, and insert items (TOCTOU-safe) */
export async function createGroceryListWithLimitCheck(
  list: InsertGroceryList,
  items: Omit<InsertGroceryListItem, "groceryListId">[],
  maxLists: number,
): Promise<{ list: GroceryList; items: GroceryListItem[] } | null> {
  return db.transaction(async (tx) => {
    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(groceryLists)
      .where(eq(groceryLists.userId, list.userId));
    const listCount = Number(countResult[0]?.count ?? 0);
    if (listCount >= maxLists) return null;

    const [createdList] = await tx
      .insert(groceryLists)
      .values(list)
      .returning();

    const createdItems =
      items.length > 0
        ? await tx
            .insert(groceryListItems)
            .values(
              items.map((item) => ({
                ...item,
                groceryListId: createdList.id,
              })),
            )
            .returning()
        : [];

    return { list: createdList, items: createdItems };
  });
}

export async function updateGroceryListItemChecked(
  id: number,
  groceryListId: number,
  isChecked: boolean,
  userId?: string,
): Promise<GroceryListItem | undefined> {
  if (userId) {
    // Defense-in-depth: verify list ownership via JOIN before mutating
    const [owned] = await db
      .select({ id: groceryLists.id })
      .from(groceryLists)
      .where(
        and(
          eq(groceryLists.id, groceryListId),
          eq(groceryLists.userId, userId),
        ),
      );
    if (!owned) return undefined;
  }
  const [updated] = await db
    .update(groceryListItems)
    .set({
      isChecked,
      checkedAt: isChecked ? new Date() : null,
    })
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning();
  return updated || undefined;
}

export async function deleteGroceryListItem(
  id: number,
  groceryListId: number,
  userId?: string,
): Promise<boolean> {
  if (userId) {
    // Defense-in-depth: verify list ownership via JOIN before mutating
    const [owned] = await db
      .select({ id: groceryLists.id })
      .from(groceryLists)
      .where(
        and(
          eq(groceryLists.id, groceryListId),
          eq(groceryLists.userId, userId),
        ),
      );
    if (!owned) return false;
  }
  const result = await db
    .delete(groceryListItems)
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning({ id: groceryListItems.id });
  return result.length > 0;
}

export async function updateGroceryListItemPantryFlag(
  id: number,
  groceryListId: number,
  addedToPantry: boolean,
  userId?: string,
): Promise<GroceryListItem | undefined> {
  if (userId) {
    // Defense-in-depth: verify list ownership via JOIN before mutating
    const [owned] = await db
      .select({ id: groceryLists.id })
      .from(groceryLists)
      .where(
        and(
          eq(groceryLists.id, groceryListId),
          eq(groceryLists.userId, userId),
        ),
      );
    if (!owned) return undefined;
  }
  const [updated] = await db
    .update(groceryListItems)
    .set({ addedToPantry })
    .where(
      and(
        eq(groceryListItems.id, id),
        eq(groceryListItems.groceryListId, groceryListId),
      ),
    )
    .returning();
  return updated || undefined;
}
