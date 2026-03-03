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
const { createMenuScan, getMenuScans, deleteMenuScan } = await import(
  "../menu"
);

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("menu storage", () => {
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

  describe("createMenuScan", () => {
    it("creates a menu scan and returns it", async () => {
      const scan = await createMenuScan({
        userId: testUser.id,
        restaurantName: "Test Restaurant",
        menuItems: [{ name: "Burger", price: "$10" }],
      });

      expect(scan).toBeDefined();
      expect(scan.id).toBeDefined();
      expect(scan.userId).toBe(testUser.id);
      expect(scan.restaurantName).toBe("Test Restaurant");
    });
  });

  describe("getMenuScans", () => {
    it("returns scans for the user ordered by scannedAt desc", async () => {
      const earlier = new Date("2024-01-01T10:00:00Z");
      const later = new Date("2024-01-01T12:00:00Z");

      await createMenuScan({
        userId: testUser.id,
        restaurantName: "First",
        menuItems: [],

        scannedAt: earlier,
      });
      await createMenuScan({
        userId: testUser.id,
        restaurantName: "Second",
        menuItems: [],

        scannedAt: later,
      });

      const scans = await getMenuScans(testUser.id);
      expect(scans).toHaveLength(2);
      // Most recent first
      expect(scans[0].restaurantName).toBe("Second");
      expect(scans[1].restaurantName).toBe("First");
    });

    it("respects the limit parameter", async () => {
      await createMenuScan({
        userId: testUser.id,
        restaurantName: "A",
        menuItems: [],
      });
      await createMenuScan({
        userId: testUser.id,
        restaurantName: "B",
        menuItems: [],
      });
      await createMenuScan({
        userId: testUser.id,
        restaurantName: "C",
        menuItems: [],
      });

      const scans = await getMenuScans(testUser.id, 2);
      expect(scans).toHaveLength(2);
    });

    it("does not return scans from other users", async () => {
      const otherUser = await createTestUser(tx);
      await createMenuScan({
        userId: otherUser.id,
        restaurantName: "Other",
        menuItems: [],
      });

      const scans = await getMenuScans(testUser.id);
      expect(scans).toHaveLength(0);
    });
  });

  describe("deleteMenuScan", () => {
    it("deletes a scan owned by the user and returns true", async () => {
      const scan = await createMenuScan({
        userId: testUser.id,
        restaurantName: "ToDelete",
        menuItems: [],
      });

      const deleted = await deleteMenuScan(scan.id, testUser.id);
      expect(deleted).toBe(true);

      const remaining = await getMenuScans(testUser.id);
      expect(remaining).toHaveLength(0);
    });

    it("returns false when scan belongs to another user (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx);
      const scan = await createMenuScan({
        userId: otherUser.id,
        restaurantName: "Other's scan",
        menuItems: [],
      });

      const deleted = await deleteMenuScan(scan.id, testUser.id);
      expect(deleted).toBe(false);
    });

    it("returns false when scan does not exist", async () => {
      const deleted = await deleteMenuScan(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });
});
