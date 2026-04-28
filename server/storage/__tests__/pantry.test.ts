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
  getPantryItems,
  getPantryItem,
  createPantryItem,
  updatePantryItem,
  deletePantryItem,
  getExpiringPantryItems,
} = await import("../pantry");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("pantry storage", () => {
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
  // PANTRY ITEMS
  // ==========================================================================

  describe("createPantryItem", () => {
    it("creates a pantry item and returns it", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Olive Oil",
        quantity: "1",
        unit: "bottle",
        category: "oils",
      });

      expect(item.id).toBeDefined();
      expect(item.name).toBe("Olive Oil");
      expect(item.userId).toBe(testUser.id);
      expect(item.addedAt).toBeInstanceOf(Date);
    });
  });

  describe("getPantryItems", () => {
    it("returns pantry items for the user", async () => {
      await createPantryItem({
        userId: testUser.id,
        name: "Salt",
        category: "spices",
      });
      await createPantryItem({
        userId: testUser.id,
        name: "Pepper",
        category: "spices",
      });

      const items = await getPantryItems(testUser.id);
      expect(items).toHaveLength(2);
    });

    it("does not return items from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createPantryItem({
        userId: otherUser.id,
        name: "Secret Spice",
      });

      const items = await getPantryItems(testUser.id);
      expect(items).toHaveLength(0);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createPantryItem({
          userId: testUser.id,
          name: `Item ${i}`,
        });
      }

      const items = await getPantryItems(testUser.id, 3);
      expect(items).toHaveLength(3);
    });
  });

  describe("getPantryItem", () => {
    it("returns the item for the correct user", async () => {
      const created = await createPantryItem({
        userId: testUser.id,
        name: "Flour",
      });

      const found = await getPantryItem(created.id, testUser.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("Flour");
    });

    it("returns undefined for a different user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const created = await createPantryItem({
        userId: testUser.id,
        name: "Flour",
      });

      const found = await getPantryItem(created.id, otherUser.id);
      expect(found).toBeUndefined();
    });
  });

  describe("updatePantryItem", () => {
    it("updates a pantry item and sets updatedAt", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Old Name",
        quantity: "1",
      });

      const updated = await updatePantryItem(item.id, testUser.id, {
        name: "New Name",
        quantity: "5",
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("New Name");
      expect(updated!.quantity).toBe("5.00");
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        item.addedAt.getTime(),
      );
    });

    it("returns undefined when another user tries to update (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Protected",
      });

      const result = await updatePantryItem(item.id, otherUser.id, {
        name: "Hacked",
      });
      expect(result).toBeUndefined();

      const original = await getPantryItem(item.id, testUser.id);
      expect(original!.name).toBe("Protected");
    });
  });

  describe("deletePantryItem", () => {
    it("deletes the item and returns true", async () => {
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Delete Me",
      });

      const deleted = await deletePantryItem(item.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getPantryItem(item.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const item = await createPantryItem({
        userId: testUser.id,
        name: "Protected",
      });

      const deleted = await deletePantryItem(item.id, otherUser.id);
      expect(deleted).toBe(false);

      const found = await getPantryItem(item.id, testUser.id);
      expect(found).toBeDefined();
    });

    it("returns false for non-existent item", async () => {
      const deleted = await deletePantryItem(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("getExpiringPantryItems", () => {
    it("returns items expiring within the given number of days", async () => {
      const soonExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days
      const laterExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createPantryItem({
        userId: testUser.id,
        name: "Expiring Soon",
        expiresAt: soonExpiry,
      });
      await createPantryItem({
        userId: testUser.id,
        name: "Expires Later",
        expiresAt: laterExpiry,
      });
      await createPantryItem({
        userId: testUser.id,
        name: "No Expiry",
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(1);
      expect(expiring[0].name).toBe("Expiring Soon");
    });

    it("does not return already expired items", async () => {
      const pastExpiry = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // yesterday

      await createPantryItem({
        userId: testUser.id,
        name: "Already Expired",
        expiresAt: pastExpiry,
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(0);
    });

    it("does not return expiring items from other users", async () => {
      const otherUser = await createTestUser(tx);
      const soonExpiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

      await createPantryItem({
        userId: otherUser.id,
        name: "Other User Expiring",
        expiresAt: soonExpiry,
      });

      const expiring = await getExpiringPantryItems(testUser.id, 7);
      expect(expiring).toHaveLength(0);
    });
  });
});
