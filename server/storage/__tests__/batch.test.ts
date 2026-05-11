import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { groceryLists } from "@shared/schema";
import type { ResolvedBatchItem } from "@shared/types/batch-scan";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  batchCreateScannedItemsWithLogs,
  batchCreatePantryItems,
  batchCreateGroceryItems,
  BatchStorageError,
} = await import("../batch");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Minimal resolved batch item for testing. */
function makeResolvedItem(
  overrides: Partial<ResolvedBatchItem> = {},
): ResolvedBatchItem {
  return {
    id: crypto.randomUUID(),
    status: "resolved",
    productName: "Test Product",
    quantity: 1,
    calories: 100,
    protein: 5,
    carbs: 15,
    fat: 3,
    ...overrides,
  };
}

describe("batch storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // --------------------------------------------------------------------------
  // batchCreateScannedItemsWithLogs
  // --------------------------------------------------------------------------
  describe("batchCreateScannedItemsWithLogs", () => {
    it("creates scanned items and daily logs atomically", async () => {
      const items = [
        makeResolvedItem({ productName: "Apple", barcode: "111" }),
        makeResolvedItem({ productName: "Banana", barcode: "222" }),
      ];

      const result = await batchCreateScannedItemsWithLogs(
        items,
        testUser.id,
        "breakfast",
      );

      expect(result.scannedCount).toBe(2);
      expect(result.logCount).toBe(2);
    });

    it("creates items without a mealType", async () => {
      const items = [makeResolvedItem()];
      const result = await batchCreateScannedItemsWithLogs(items, testUser.id);
      expect(result.scannedCount).toBe(1);
      expect(result.logCount).toBe(1);
    });

    it("handles quantity > 1 for servings", async () => {
      const items = [makeResolvedItem({ quantity: 3 })];
      const result = await batchCreateScannedItemsWithLogs(items, testUser.id);
      expect(result.scannedCount).toBe(1);
      expect(result.logCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // batchCreatePantryItems
  // --------------------------------------------------------------------------
  describe("batchCreatePantryItems", () => {
    it("creates pantry items and returns count", async () => {
      const items = [
        makeResolvedItem({ productName: "Olive Oil", servingSize: "1 tbsp" }),
        makeResolvedItem({ productName: "Salt" }),
      ];

      const result = await batchCreatePantryItems(items, testUser.id);
      expect(result.count).toBe(2);
    });

    it("uses servingSize as unit when present", async () => {
      const items = [makeResolvedItem({ servingSize: "250ml" })];
      const result = await batchCreatePantryItems(items, testUser.id);
      expect(result.count).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // batchCreateGroceryItems
  // --------------------------------------------------------------------------
  describe("batchCreateGroceryItems", () => {
    it("auto-creates a grocery list when no groceryListId is provided", async () => {
      const items = [makeResolvedItem({ productName: "Milk" })];

      const result = await batchCreateGroceryItems(items, testUser.id);

      expect(result.count).toBe(1);
      expect(result.groceryListId).toBeGreaterThan(0);
    });

    it("adds items to an existing grocery list", async () => {
      const [list] = await tx
        .insert(groceryLists)
        .values({
          userId: testUser.id,
          title: "My Grocery List",
          dateRangeStart: "2025-01-01",
          dateRangeEnd: "2025-01-07",
        })
        .returning();

      const items = [
        makeResolvedItem({ productName: "Eggs" }),
        makeResolvedItem({ productName: "Bread" }),
      ];

      const result = await batchCreateGroceryItems(items, testUser.id, list.id);

      expect(result.count).toBe(2);
      expect(result.groceryListId).toBe(list.id);
    });

    it("throws BatchStorageError NOT_FOUND for a nonexistent groceryListId", async () => {
      const items = [makeResolvedItem()];

      await expect(
        batchCreateGroceryItems(items, testUser.id, 999999),
      ).rejects.toThrow(BatchStorageError);

      await expect(
        batchCreateGroceryItems(items, testUser.id, 999999),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BatchStorageError NOT_FOUND for a list owned by another user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const [otherList] = await tx
        .insert(groceryLists)
        .values({
          userId: otherUser.id,
          title: "Other List",
          dateRangeStart: "2025-01-01",
          dateRangeEnd: "2025-01-07",
        })
        .returning();

      const items = [makeResolvedItem()];

      await expect(
        batchCreateGroceryItems(items, testUser.id, otherList.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws BatchStorageError LIMIT_REACHED when user has 50 lists", async () => {
      // Create 50 grocery lists for the user
      for (let i = 0; i < 50; i++) {
        await tx.insert(groceryLists).values({
          userId: testUser.id,
          title: `List ${i}`,
          dateRangeStart: "2025-01-01",
          dateRangeEnd: "2025-01-07",
        });
      }

      const items = [makeResolvedItem()];

      await expect(
        batchCreateGroceryItems(items, testUser.id),
      ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    });
  });
});
