import { GroceryListNotFoundError } from "./grocery-list-errors";
import {
  type GroceryList,
  type InsertGroceryList,
  type GroceryListItem,
  type InsertGroceryListItem,
  groceryLists,
  groceryListItems,
} from "@shared/schema";
import { db } from "../db";
import { MAX_GROCERY_LIST_ITEMS } from "@shared/constants/grocery";
import {
  eq,
  desc,
  and,
  sql,
  ilike,
  inArray,
  lte,
  getTableColumns,
} from "drizzle-orm";
import { escapeLike } from "./helpers";

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

export type GroceryListWithOpenItems = GroceryList & {
  /** The items still to buy, at most `itemsPerList` of them. */
  items: GroceryListItem[];
  /** How many items are still to buy, including any past the cap. */
  openCount: number;
  /** How many items are already ticked off. */
  boughtCount: number;
};

/** Default cap on the open items returned per list. */
const OPEN_ITEMS_PER_LIST = 60;

/**
 * The user's newest lists (optionally those whose title contains some text)
 * with the items still to buy. For Coach's read tool: bought items are only
 * counted. The items query reads lists this user-scoped query returned.
 */
export async function getGroceryListsWithOpenItems(
  userId: string,
  opts: { titleContains?: string; limit?: number; itemsPerList?: number } = {},
): Promise<GroceryListWithOpenItems[]> {
  const lists = await db
    .select()
    .from(groceryLists)
    .where(
      and(
        eq(groceryLists.userId, userId),
        opts.titleContains
          ? ilike(groceryLists.title, `%${escapeLike(opts.titleContains)}%`)
          : undefined,
      ),
    )
    .orderBy(desc(groceryLists.createdAt))
    .limit(opts.limit ?? 4);
  if (lists.length === 0) return [];
  const listIds = lists.map((l) => l.id);
  // is_checked is nullable: NULL counts as not yet bought.
  const open = sql`${groceryListItems.isChecked} IS NOT TRUE`;

  // The cap is applied per list in the query, so a list of thousands of lines
  // is never read whole; the counts come from their own aggregate.
  const ranked = db
    .select({
      ...getTableColumns(groceryListItems),
      pos: sql<number>`row_number() OVER (PARTITION BY ${groceryListItems.groceryListId} ORDER BY ${groceryListItems.category}, ${groceryListItems.name}, ${groceryListItems.id})`.as(
        "pos",
      ),
    })
    .from(groceryListItems)
    .where(and(inArray(groceryListItems.groceryListId, listIds), open))
    .as("ranked");
  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.pos, opts.itemsPerList ?? OPEN_ITEMS_PER_LIST))
    .orderBy(ranked.groceryListId, ranked.pos);
  const counts = await db
    .select({
      groceryListId: groceryListItems.groceryListId,
      openCount: sql<number>`count(*) FILTER (WHERE ${open})::int`,
      boughtCount: sql<number>`count(*) FILTER (WHERE ${groceryListItems.isChecked} IS TRUE)::int`,
    })
    .from(groceryListItems)
    .where(inArray(groceryListItems.groceryListId, listIds))
    .groupBy(groceryListItems.groceryListId);
  const countsById = new Map(counts.map((c) => [c.groceryListId, c]));

  return lists.map((list) => ({
    ...list,
    items: rows
      .filter((r) => r.groceryListId === list.id)
      .map(({ pos: _pos, ...item }) => item),
    openCount: countsById.get(list.id)?.openCount ?? 0,
    boughtCount: countsById.get(list.id)?.boughtCount ?? 0,
  }));
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

/**
 * A caller inside a transaction (a write-card save or undo) passes its `tx`
 * as `executor`; everyone else gets the pool `db`.
 */
type Executor = Pick<typeof db, "select" | "insert" | "delete" | "transaction">;

export async function deleteGroceryList(
  id: number,
  userId: string,
  executor: Executor = db,
): Promise<boolean> {
  const result = await executor
    .delete(groceryLists)
    .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)))
    .returning({ id: groceryLists.id });
  return result.length > 0;
}

export { MAX_GROCERY_LIST_ITEMS };

/**
 * Insert items onto one list under the cap. Adds as many as fit (in order)
 * and reports how many were left out. The single cap check behind every
 * grocery item insert: manual add, generated lists, batch scan and the
 * Coach grocery and plan cards all go through it. Callers check the list is
 * the user's first (for their own 404); the check is repeated here under the
 * lock so no path can add to another user's list.
 */
export async function insertGroceryListItemsUnderCap(
  groceryListId: number,
  userId: string,
  items: Omit<InsertGroceryListItem, "groceryListId">[],
  executor: Executor = db,
): Promise<{ created: GroceryListItem[]; skipped: number }> {
  if (items.length === 0) return { created: [], skipped: 0 };
  return executor.transaction(async (tx) => {
    // Per-list lock (released at commit) before the count: READ COMMITTED
    // alone lets two parallel adds both see room and both insert. A
    // feature-scoped key, so it never queues behind the per-user list lock.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"grocery-list-items:" + groceryListId}, 0))`,
    );
    const [owned] = await tx
      .select({ id: groceryLists.id })
      .from(groceryLists)
      .where(
        and(
          eq(groceryLists.id, groceryListId),
          eq(groceryLists.userId, userId),
        ),
      );
    if (!owned) throw new GroceryListNotFoundError();
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(groceryListItems)
      .where(eq(groceryListItems.groceryListId, groceryListId));
    const room = Math.max(0, MAX_GROCERY_LIST_ITEMS - (countRow?.count ?? 0));
    const fitting = items.slice(0, room);
    const created =
      fitting.length > 0
        ? await tx
            .insert(groceryListItems)
            .values(fitting.map((item) => ({ ...item, groceryListId })))
            .returning()
        : [];
    return { created, skipped: items.length - created.length };
  });
}

/** The lines still to buy on one of the user's lists (none for another's). */
export async function getUncheckedGroceryListItems(
  groceryListId: number,
  userId: string,
  executor: Executor = db,
): Promise<GroceryListItem[]> {
  const rows = await executor
    .select({ item: groceryListItems })
    .from(groceryListItems)
    .innerJoin(
      groceryLists,
      eq(groceryLists.id, groceryListItems.groceryListId),
    )
    .where(
      and(
        eq(groceryListItems.groceryListId, groceryListId),
        eq(groceryLists.userId, userId),
        // is_checked is nullable: NULL counts as not yet bought.
        sql`${groceryListItems.isChecked} IS NOT TRUE`,
      ),
    );
  return rows.map((r) => r.item);
}

/**
 * Check the list count limit, create the list and insert its items in one
 * transaction. A per-user advisory lock (taken first, released at commit)
 * serialises concurrent creates: READ COMMITTED alone lets two parallel calls
 * both count below the cap and both insert.
 */
export async function createGroceryListWithLimitCheck(
  list: InsertGroceryList,
  items: Omit<InsertGroceryListItem, "groceryListId">[],
  maxLists: number,
  executor: Executor = db,
): Promise<{
  list: GroceryList;
  items: GroceryListItem[];
  skipped: number;
} | null> {
  return executor.transaction(async (tx) => {
    // Feature-scoped key so this lock never queues behind unrelated per-user
    // locks (pantry, nutrition, ...). Must precede the count.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${"grocery-lists:" + list.userId}, 0))`,
    );
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

    // A new list is empty, so only an over-long `items` is cut; callers that
    // can produce one check its length first (the generate route).
    const { created, skipped } = await insertGroceryListItemsUnderCap(
      createdList.id,
      list.userId,
      items,
      tx,
    );

    return { list: createdList, items: created, skipped };
  });
}

/** One item of a list, only if the list belongs to `userId`. */
export async function getGroceryListItemForUser(
  itemId: number,
  groceryListId: number,
  userId: string,
): Promise<GroceryListItem | undefined> {
  const [row] = await db
    .select({ item: groceryListItems })
    .from(groceryListItems)
    .innerJoin(
      groceryLists,
      eq(groceryLists.id, groceryListItems.groceryListId),
    )
    .where(
      and(
        eq(groceryListItems.id, itemId),
        eq(groceryListItems.groceryListId, groceryListId),
        eq(groceryLists.userId, userId),
      ),
    );
  return row?.item;
}

/**
 * `also.addedToPantry` sets the pantry flag in the SAME update, so a request
 * carrying both flags never leaves the item half-updated.
 */
export async function updateGroceryListItemChecked(
  id: number,
  groceryListId: number,
  isChecked: boolean,
  userId?: string,
  also: { addedToPantry?: boolean } = {},
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
      ...(also.addedToPantry !== undefined
        ? { addedToPantry: also.addedToPantry }
        : {}),
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
  executor: Executor = db,
): Promise<boolean> {
  if (userId) {
    // Defense-in-depth: verify list ownership via JOIN before mutating
    const [owned] = await executor
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
  const result = await executor
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
