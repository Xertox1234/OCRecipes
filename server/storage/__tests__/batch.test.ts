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
import {
  scannedItems,
  dailyLogs,
  pantryItems,
  groceryLists,
  groceryListItems,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import type { ResolvedBatchItem } from "@shared/types/batch-scan";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  batchCreateScannedItemsWithLogs,
  batchCreatePantryItems,
  batchCreateGroceryItems,
  BatchStorageError,
} = await import("../batch");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/**
 * Per-test unique seq. `batch.ts` functions call `db.transaction()`
 * internally; per-test unique data sidesteps any unique-constraint collisions
 * if a savepoint leaks past rollback (see todos/2026-05-11-db-test-utils-savepoint-leak.md).
 */
let seq = 0;
function uniqueName(prefix: string): string {
  seq++;
  return `${prefix}-${Date.now()}-${seq}`;
}

function makeItem(
  overrides: Partial<ResolvedBatchItem> = {},
): ResolvedBatchItem {
  return {
    id: uniqueName("batch-item-id"),
    status: "resolved",
    productName: uniqueName("Item"),
    calories: 100,
    protein: 5,
    carbs: 20,
    fat: 3,
    quantity: 1,
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

  describe("batchCreateScannedItemsWithLogs", () => {
    it("inserts scanned items and matching daily logs in one transaction", async () => {
      const items = [makeItem(), makeItem({ quantity: 2 })];
      const result = await batchCreateScannedItemsWithLogs(
        items,
        testUser.id,
        "lunch",
      );
      expect(result).toEqual({ scannedCount: 2, logCount: 2 });

      const scanned = await tx
        .select()
        .from(scannedItems)
        .where(eq(scannedItems.userId, testUser.id));
      expect(scanned).toHaveLength(2);
      const logs = await tx
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.userId, testUser.id));
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.mealType === "lunch")).toBe(true);
    });
  });

  describe("batchCreatePantryItems", () => {
    it("inserts pantry items for each batch entry", async () => {
      const items = [makeItem(), makeItem()];
      const result = await batchCreatePantryItems(items, testUser.id);
      expect(result).toEqual({ count: 2 });
      const rows = await tx
        .select()
        .from(pantryItems)
        .where(eq(pantryItems.userId, testUser.id));
      expect(rows).toHaveLength(2);
    });
  });

  describe("batchCreateGroceryItems", () => {
    it("auto-creates a grocery list and inserts items when no listId is provided", async () => {
      const items = [makeItem()];
      const result = await batchCreateGroceryItems(items, testUser.id, "UTC");
      expect(result.count).toBe(1);
      expect(result.groceryListId).toBeGreaterThan(0);

      const lists = await tx
        .select()
        .from(groceryLists)
        .where(eq(groceryLists.userId, testUser.id));
      expect(lists).toHaveLength(1);
      const listItems = await tx
        .select()
        .from(groceryListItems)
        .where(eq(groceryListItems.groceryListId, result.groceryListId));
      expect(listItems).toHaveLength(1);
    });

    it("adds items to an existing list owned by the user", async () => {
      const [list] = await tx
        .insert(groceryLists)
        .values({
          userId: testUser.id,
          title: uniqueName("Existing"),
          dateRangeStart: "2026-05-15",
          dateRangeEnd: "2026-05-22",
        })
        .returning();

      const items = [makeItem(), makeItem()];
      const result = await batchCreateGroceryItems(
        items,
        testUser.id,
        "UTC",
        list.id,
      );
      expect(result).toEqual({ count: 2, groceryListId: list.id });
    });

    it("throws NOT_FOUND when groceryListId belongs to another user (IDOR guard)", async () => {
      const otherUser = await createTestUser(tx);
      const [list] = await tx
        .insert(groceryLists)
        .values({
          userId: otherUser.id,
          title: uniqueName("Other"),
          dateRangeStart: "2026-05-15",
          dateRangeEnd: "2026-05-22",
        })
        .returning();

      await expect(
        batchCreateGroceryItems([makeItem()], testUser.id, "UTC", list.id),
      ).rejects.toMatchObject({
        name: "BatchStorageError",
        code: "NOT_FOUND",
      });

      // Dual-assertion: the foreign list got no leaked items.
      const items = await tx
        .select()
        .from(groceryListItems)
        .where(eq(groceryListItems.groceryListId, list.id));
      expect(items).toHaveLength(0);
    });

    it("throws LIMIT_REACHED when the user has 50 grocery lists already", async () => {
      // Seed 50 lists for the user.
      const rows = Array.from({ length: 50 }, () => ({
        userId: testUser.id,
        title: uniqueName("Many"),
        dateRangeStart: "2026-05-15",
        dateRangeEnd: "2026-05-22",
      }));
      await tx.insert(groceryLists).values(rows);

      await expect(
        batchCreateGroceryItems([makeItem()], testUser.id, "UTC"),
      ).rejects.toBeInstanceOf(BatchStorageError);

      // No 51st list and no items should have been written.
      const lists = await tx
        .select()
        .from(groceryLists)
        .where(eq(groceryLists.userId, testUser.id));
      expect(lists).toHaveLength(50);
      const listIds = lists.map((l) => l.id);
      const items = await tx
        .select()
        .from(groceryListItems)
        .where(inArray(groceryListItems.groceryListId, listIds));
      expect(items).toHaveLength(0);
    });

    // The auto-created list's title/dateRangeStart/dateRangeEnd must be the
    // CIVIL day in the caller's timezone, not the UTC day of the server
    // clock's instant. Each fixture is frozen at an instant chosen so the two
    // bases actually disagree (see docs/solutions/logic-errors/
    // a-date-cannot-express-a-calendar-day-2026-08-31.md) — a shared instant
    // cannot discriminate both signs, so each zone gets its own instant where
    // ONLY that zone's basis puts it on a different day than the UTC instant.
    // Only `Date` is faked (not timers/network) so the real Postgres pool
    // used by `tx` is unaffected.
    describe("auto-created list's calendar day follows the caller's timezone", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("uses the civil day in a UTC-negative zone (America/Los_Angeles)", async () => {
        // 2026-09-04T02:30:00Z is 2026-09-03 19:30 PDT (UTC-7): the LA civil
        // day is ONE DAY BEHIND the UTC day of this instant. The reverted
        // UTC-basis code (`toDateString(new Date())`) would compute
        // "2026-09-04" here.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-09-04T02:30:00Z"));

        const result = await batchCreateGroceryItems(
          [makeItem()],
          testUser.id,
          "America/Los_Angeles",
        );

        const [list] = await tx
          .select()
          .from(groceryLists)
          .where(eq(groceryLists.id, result.groceryListId));
        expect(list.title).toBe("Batch Scan - 2026-09-03");
        expect(list.dateRangeStart).toBe("2026-09-03");
        expect(list.dateRangeEnd).toBe("2026-09-03");
      });

      it("uses the civil day in a UTC-positive zone (Asia/Kolkata)", async () => {
        // 2026-09-03T19:00:00Z is 2026-09-04 00:30 IST (UTC+5:30): the
        // Kolkata civil day is ONE DAY AHEAD of the UTC day of this instant.
        // The reverted UTC-basis code would compute "2026-09-03" here.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-09-03T19:00:00Z"));

        const result = await batchCreateGroceryItems(
          [makeItem()],
          testUser.id,
          "Asia/Kolkata",
        );

        const [list] = await tx
          .select()
          .from(groceryLists)
          .where(eq(groceryLists.id, result.groceryListId));
        expect(list.title).toBe("Batch Scan - 2026-09-04");
        expect(list.dateRangeStart).toBe("2026-09-04");
        expect(list.dateRangeEnd).toBe("2026-09-04");
      });
    });
  });
});
