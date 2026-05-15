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
import { receiptScans } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { createReceiptScan, getMonthlyReceiptScanCount } = await import(
  "../receipt"
);

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("receipt storage", () => {
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

  describe("createReceiptScan", () => {
    it("creates and returns a receipt scan row", async () => {
      const scan = await createReceiptScan({
        userId: testUser.id,
        itemCount: 5,
        photoCount: 2,
        status: "completed",
      });
      expect(scan.id).toBeGreaterThan(0);
      expect(scan.userId).toBe(testUser.id);
      expect(scan.itemCount).toBe(5);
      expect(scan.photoCount).toBe(2);
      expect(scan.status).toBe("completed");
      expect(scan.scannedAt).toBeInstanceOf(Date);
    });
  });

  describe("getMonthlyReceiptScanCount", () => {
    it("returns 0 when the user has no scans", async () => {
      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(0);
    });

    it("counts non-failed scans within the month containing the given date", async () => {
      const now = new Date();
      await createReceiptScan({
        userId: testUser.id,
        status: "completed",
      });
      await createReceiptScan({
        userId: testUser.id,
        status: "completed",
      });
      const count = await getMonthlyReceiptScanCount(testUser.id, now);
      expect(count).toBe(2);
    });

    it("excludes failed scans", async () => {
      await createReceiptScan({
        userId: testUser.id,
        status: "completed",
      });
      await createReceiptScan({
        userId: testUser.id,
        status: "failed",
      });
      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(1);
    });

    it("excludes scans from other months", async () => {
      // Insert a row dated 60 days in the past (well outside this month's bounds).
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      await tx.insert(receiptScans).values({
        userId: testUser.id,
        status: "completed",
        scannedAt: sixtyDaysAgo,
      });
      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(0);
    });

    it("scopes by userId — other users' scans are excluded", async () => {
      const otherUser = await createTestUser(tx);
      await createReceiptScan({
        userId: otherUser.id,
        status: "completed",
      });
      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(0);
    });
  });
});
