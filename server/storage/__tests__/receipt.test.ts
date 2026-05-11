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

  // --------------------------------------------------------------------------
  // createReceiptScan
  // --------------------------------------------------------------------------
  describe("createReceiptScan", () => {
    it("creates a receipt scan and returns it", async () => {
      const scan = await createReceiptScan({
        userId: testUser.id,
        status: "success",
        rawText: "Some receipt text",
      });

      expect(scan.id).toBeDefined();
      expect(scan.userId).toBe(testUser.id);
      expect(scan.status).toBe("success");
      expect(scan.rawText).toBe("Some receipt text");
      expect(scan.scannedAt).toBeInstanceOf(Date);
    });

    it("creates a receipt scan with failed status", async () => {
      const scan = await createReceiptScan({
        userId: testUser.id,
        status: "failed",
      });

      expect(scan.id).toBeDefined();
      expect(scan.status).toBe("failed");
    });
  });

  // --------------------------------------------------------------------------
  // getMonthlyReceiptScanCount
  // --------------------------------------------------------------------------
  describe("getMonthlyReceiptScanCount", () => {
    it("returns 0 when no scans exist for the month", async () => {
      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(0);
    });

    it("counts non-failed scans in the current month", async () => {
      await createReceiptScan({ userId: testUser.id, status: "success" });
      await createReceiptScan({ userId: testUser.id, status: "success" });

      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(2);
    });

    it("excludes failed scans from the count", async () => {
      await createReceiptScan({ userId: testUser.id, status: "success" });
      await createReceiptScan({ userId: testUser.id, status: "failed" });

      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(1);
    });

    it("only counts scans for the requesting user", async () => {
      const otherUser = await createTestUser(tx);
      await createReceiptScan({ userId: otherUser.id, status: "success" });
      await createReceiptScan({ userId: testUser.id, status: "success" });

      const count = await getMonthlyReceiptScanCount(testUser.id, new Date());
      expect(count).toBe(1);
    });

    it("does not count scans from a different month", async () => {
      await createReceiptScan({ userId: testUser.id, status: "success" });

      // Query for last month
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

      const count = await getMonthlyReceiptScanCount(testUser.id, lastMonth);
      expect(count).toBe(0);
    });
  });
});
