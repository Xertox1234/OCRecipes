/**
 * Cross-domain batch storage functions for batch scan operations.
 * Each function uses transactions and batch INSERTs for atomicity and performance.
 */
import { eq, and, sql } from "drizzle-orm";
import { toDateString } from "@shared/lib/date";
import { db } from "../db";
import {
  scannedItems,
  dailyLogs,
  pantryItems,
  groceryLists,
  groceryListItems,
} from "@shared/schema";
import type { ResolvedBatchItem } from "@shared/types/batch-scan";

export class BatchStorageError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "LIMIT_REACHED",
  ) {
    super(message);
    this.name = "BatchStorageError";
  }
}

/**
 * Batch create scanned items and corresponding daily logs in a single transaction.
 * Insert ordering: scannedItems first (dailyLogs.scannedItemId is a FK).
 */
export async function batchCreateScannedItemsWithLogs(
  items: ResolvedBatchItem[],
  userId: string,
  mealType?: string,
): Promise<{ scannedCount: number; logCount: number }> {
  return db.transaction(async (tx) => {
    // Step 1: Batch insert scanned items
    const scannedRows = await tx
      .insert(scannedItems)
      .values(
        items.map((item) => ({
          userId,
          barcode: item.barcode ?? null,
          productName: item.productName,
          brandName: item.brandName ?? null,
          servingSize: item.servingSize ?? null,
          calories: item.calories.toString(),
          protein: item.protein.toString(),
          carbs: item.carbs.toString(),
          fat: item.fat.toString(),
          sourceType: "batch_scan",
        })),
      )
      .returning({ id: scannedItems.id });

    // Step 2: Batch insert daily logs referencing the scanned item IDs
    const logRows = await tx
      .insert(dailyLogs)
      .values(
        scannedRows.map((row, i) => ({
          userId,
          scannedItemId: row.id,
          source: "batch_scan",
          servings: (items[i].quantity ?? 1).toString(),
          mealType: mealType ?? null,
        })),
      )
      .returning({ id: dailyLogs.id });

    return { scannedCount: scannedRows.length, logCount: logRows.length };
  });
}

/**
 * Batch create pantry items from batch scan.
 */
export async function batchCreatePantryItems(
  items: ResolvedBatchItem[],
  userId: string,
): Promise<{ count: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(pantryItems)
      .values(
        items.map((item) => ({
          userId,
          name: item.productName,
          quantity: item.quantity.toString(),
          unit: item.servingSize ?? null,
          category: "other" as const,
        })),
      )
      .returning({ id: pantryItems.id });

    return { count: rows.length };
  });
}

/**
 * Batch create grocery list items from batch scan.
 * If no groceryListId provided, auto-creates a list named "Batch Scan - {date}".
 * Enforces IDOR check and 50-list-per-user limit.
 */
export async function batchCreateGroceryItems(
  items: ResolvedBatchItem[],
  userId: string,
  groceryListId?: number,
): Promise<{ count: number; groceryListId: number }> {
  return db.transaction(async (tx) => {
    let listId = groceryListId;

    if (listId) {
      // IDOR check: verify ownership
      const [list] = await tx
        .select({ id: groceryLists.id })
        .from(groceryLists)
        .where(
          and(eq(groceryLists.id, listId), eq(groceryLists.userId, userId)),
        );
      if (!list) {
        throw new BatchStorageError("Grocery list not found", "NOT_FOUND");
      }
    } else {
      // Auto-create grocery list
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(groceryLists)
        .where(eq(groceryLists.userId, userId));
      if (countResult.count >= 50) {
        throw new BatchStorageError(
          "Maximum grocery list limit reached (50). Delete an existing list first.",
          "LIMIT_REACHED",
        );
      }

      const today = toDateString(new Date());
      const [newList] = await tx
        .insert(groceryLists)
        .values({
          userId,
          title: `Batch Scan - ${today}`,
          dateRangeStart: today,
          dateRangeEnd: today,
        })
        .returning({ id: groceryLists.id });
      listId = newList.id;
    }

    // Batch insert grocery items
    const rows = await tx
      .insert(groceryListItems)
      .values(
        items.map((item) => ({
          groceryListId: listId!,
          name: item.productName,
          quantity: item.quantity.toString(),
          unit: item.servingSize ?? null,
          category: "other" as const,
          isManual: false,
        })),
      )
      .returning({ id: groceryListItems.id });

    return { count: rows.length, groceryListId: listId! };
  });
}
