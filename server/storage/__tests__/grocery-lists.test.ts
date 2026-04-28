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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  createGroceryList: _createGroceryList,
  getGroceryLists,
  getGroceryListWithItems,
  deleteGroceryList,
  addGroceryListItem,
  updateGroceryListItemChecked,
  deleteGroceryListItem,
  updateGroceryListItemPantryFlag,
} = await import("../grocery-lists");

// Widen the insert type to allow passing `createdAt` for ordering tests.
const createGroceryList = _createGroceryList as (
  list: Parameters<typeof _createGroceryList>[0] & { createdAt?: Date },
) => ReturnType<typeof _createGroceryList>;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("grocery-lists storage", () => {
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

  // ==========================================================================
  // GROCERY LISTS
  // ==========================================================================

  describe("createGroceryList", () => {
    it("creates a grocery list and returns it", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Weekly Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      expect(list.id).toBeDefined();
      expect(list.title).toBe("Weekly Shop");
      expect(list.userId).toBe(testUser.id);
      expect(list.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("getGroceryLists", () => {
    it("returns lists for the user ordered by createdAt desc", async () => {
      await createGroceryList({
        userId: testUser.id,
        title: "First",
        dateRangeStart: "2025-06-01",
        dateRangeEnd: "2025-06-07",
        createdAt: new Date("2025-01-01T10:00:00Z"),
      });
      await createGroceryList({
        userId: testUser.id,
        title: "Second",
        dateRangeStart: "2025-06-08",
        dateRangeEnd: "2025-06-14",
        createdAt: new Date("2025-01-01T12:00:00Z"),
      });

      const lists = await getGroceryLists(testUser.id);
      expect(lists).toHaveLength(2);
      // Most recent first
      expect(lists[0].title).toBe("Second");
      expect(lists[1].title).toBe("First");
    });

    it("does not return lists from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createGroceryList({
        userId: otherUser.id,
        title: "Other User List",
        dateRangeStart: "2025-06-01",
        dateRangeEnd: "2025-06-07",
      });

      const lists = await getGroceryLists(testUser.id);
      expect(lists).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createGroceryList({
          userId: testUser.id,
          title: `List ${i}`,
          dateRangeStart: "2025-06-01",
          dateRangeEnd: "2025-06-07",
        });
      }

      const lists = await getGroceryLists(testUser.id, 3);
      expect(lists).toHaveLength(3);
    });
  });

  describe("getGroceryListWithItems", () => {
    it("returns list with its items", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
        category: "dairy",
      });
      await addGroceryListItem({
        groceryListId: list.id,
        name: "Bread",
        category: "bakery",
      });

      const result = await getGroceryListWithItems(list.id, testUser.id);
      expect(result).toBeDefined();
      expect(result!.title).toBe("Shop");
      expect(result!.items).toHaveLength(2);
    });

    it("returns undefined for a different user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const list = await createGroceryList({
        userId: testUser.id,
        title: "My List",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const result = await getGroceryListWithItems(list.id, otherUser.id);
      expect(result).toBeUndefined();
    });
  });

  describe("deleteGroceryList", () => {
    it("deletes a list owned by the user and returns true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Delete Me",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const deleted = await deleteGroceryList(list.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getGroceryListWithItems(list.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Protected",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const deleted = await deleteGroceryList(list.id, otherUser.id);
      expect(deleted).toBe(false);

      const found = await getGroceryListWithItems(list.id, testUser.id);
      expect(found).toBeDefined();
    });
  });

  describe("addGroceryListItem", () => {
    it("creates a grocery list item and returns it", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });

      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Bananas",
        quantity: "6",
        unit: "pcs",
        category: "produce",
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe("Bananas");
      expect(item.isChecked).toBe(false);
      expect(item.addedToPantry).toBe(false);
    });
  });

  describe("updateGroceryListItemChecked", () => {
    it("checks an item and sets checkedAt", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      const updated = await updateGroceryListItemChecked(
        item.id,
        list.id,
        true,
      );
      expect(updated).toBeDefined();
      expect(updated!.isChecked).toBe(true);
      expect(updated!.checkedAt).toBeInstanceOf(Date);
    });

    it("unchecks an item and clears checkedAt", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      // Check first
      await updateGroceryListItemChecked(item.id, list.id, true);
      // Then uncheck
      const unchecked = await updateGroceryListItemChecked(
        item.id,
        list.id,
        false,
      );
      expect(unchecked!.isChecked).toBe(false);
      expect(unchecked!.checkedAt).toBeNull();
    });

    it("returns undefined for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Milk",
      });

      const result = await updateGroceryListItemChecked(item.id, 999999, true);
      expect(result).toBeUndefined();
    });
  });

  describe("deleteGroceryListItem", () => {
    it("deletes the item and returns true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Eggs",
      });

      const deleted = await deleteGroceryListItem(item.id, list.id);
      expect(deleted).toBe(true);

      // Verify it's gone
      const listWithItems = await getGroceryListWithItems(list.id, testUser.id);
      expect(listWithItems!.items).toHaveLength(0);
    });

    it("returns false for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Eggs",
      });

      const deleted = await deleteGroceryListItem(item.id, 999999);
      expect(deleted).toBe(false);
    });
  });

  describe("updateGroceryListItemPantryFlag", () => {
    it("sets addedToPantry to true", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      const updated = await updateGroceryListItemPantryFlag(
        item.id,
        list.id,
        true,
      );
      expect(updated).toBeDefined();
      expect(updated!.addedToPantry).toBe(true);
    });

    it("sets addedToPantry back to false", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      await updateGroceryListItemPantryFlag(item.id, list.id, true);
      const updated = await updateGroceryListItemPantryFlag(
        item.id,
        list.id,
        false,
      );
      expect(updated!.addedToPantry).toBe(false);
    });

    it("returns undefined for wrong groceryListId", async () => {
      const list = await createGroceryList({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2025-06-15",
        dateRangeEnd: "2025-06-21",
      });
      const item = await addGroceryListItem({
        groceryListId: list.id,
        name: "Rice",
      });

      const result = await updateGroceryListItemPantryFlag(
        item.id,
        999999,
        true,
      );
      expect(result).toBeUndefined();
    });
  });
});
