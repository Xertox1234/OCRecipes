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
import { barcodeVerifications, verificationHistory } from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getReformulationFlag,
  getReformulationFlags,
  flagReformulation,
  resolveReformulationFlag,
  getReformulationFlagCount,
} = await import("../reformulation");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/**
 * Insert a barcode_verifications row required as FK parent for reformulation_flags.
 */
async function createTestBarcode(barcode: string): Promise<void> {
  await tx
    .insert(barcodeVerifications)
    .values({
      barcode,
      verificationLevel: "verified",
      verificationCount: 3,
    })
    .onConflictDoNothing();
}

/**
 * Insert a verification_history row so flagReformulation can mark isMatch = false.
 */
async function createTestVerificationHistory(
  barcode: string,
  userId: string,
): Promise<void> {
  await tx.insert(verificationHistory).values({
    barcode,
    userId,
    extractedNutrition: { calories: 100 },
    ocrConfidence: "0.95",
    isMatch: true,
  });
}

describe("reformulation storage", () => {
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
  // getReformulationFlag
  // --------------------------------------------------------------------------
  describe("getReformulationFlag", () => {
    it("returns null when no flag exists for the barcode", async () => {
      const result = await getReformulationFlag("0000000000000");
      expect(result).toBeNull();
    });

    it("returns the active flag for a barcode", async () => {
      const barcode = "1234567890123";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 5, null, "verified", 3);

      const result = await getReformulationFlag(barcode);
      expect(result).not.toBeNull();
      expect(result!.barcode).toBe(barcode);
      expect(result!.status).toBe("flagged");
    });

    it("returns null after the flag has been resolved", async () => {
      const barcode = "9876543210000";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 3, null, "verified", 2);

      const flag = await getReformulationFlag(barcode);
      expect(flag).not.toBeNull();
      await resolveReformulationFlag(flag!.id);

      const result = await getReformulationFlag(barcode);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getReformulationFlags
  // --------------------------------------------------------------------------
  describe("getReformulationFlags", () => {
    it("returns empty array when no flags exist", async () => {
      const result = await getReformulationFlags();
      expect(result).toEqual([]);
    });

    it("returns all flags when no status filter is provided", async () => {
      const barcode1 = "1111111111111";
      const barcode2 = "2222222222222";
      await createTestBarcode(barcode1);
      await createTestBarcode(barcode2);
      await flagReformulation(barcode1, 2, null, "unverified", 0);

      const flag2 = await getReformulationFlag(barcode1);

      // Resolve barcode1's flag and create a new barcode2 flag
      await resolveReformulationFlag(flag2!.id);
      await flagReformulation(barcode2, 4, null, "verified", 5);

      const result = await getReformulationFlags();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by status=flagged", async () => {
      const barcode = "3333333333333";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 1, null, "unverified", 0);

      const result = await getReformulationFlags("flagged");
      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const row of result) {
        expect(row.status).toBe("flagged");
      }
    });

    it("filters by status=resolved", async () => {
      const barcode = "4444444444444";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 2, null, "verified", 3);

      const flag = await getReformulationFlag(barcode);
      await resolveReformulationFlag(flag!.id);

      const result = await getReformulationFlags("resolved");
      expect(result.length).toBeGreaterThanOrEqual(1);
      for (const row of result) {
        expect(row.status).toBe("resolved");
      }
    });

    it("respects limit and offset", async () => {
      const barcodes = ["5555555555555", "6666666666666", "7777777777777"];
      for (const bc of barcodes) {
        await createTestBarcode(bc);
        await flagReformulation(bc, 1, null, "unverified", 0);
      }

      const page1 = await getReformulationFlags(undefined, 2, 0);
      expect(page1.length).toBeLessThanOrEqual(2);

      const page2 = await getReformulationFlags(undefined, 2, 2);
      // Combined should cover all flags created
      expect(page1.length + page2.length).toBeGreaterThanOrEqual(3);
    });
  });

  // --------------------------------------------------------------------------
  // flagReformulation
  // --------------------------------------------------------------------------
  describe("flagReformulation", () => {
    it("inserts a reformulation flag and resets barcode verification", async () => {
      const barcode = "8888888888888";
      await createTestBarcode(barcode);
      await createTestVerificationHistory(barcode, testUser.id);

      await flagReformulation(
        barcode,
        6,
        { calories: 200, protein: 10, carbs: 30, fat: 5 },
        "verified",
        4,
      );

      const flag = await getReformulationFlag(barcode);
      expect(flag).not.toBeNull();
      expect(flag!.divergentScanCount).toBe(6);
      expect(flag!.previousVerificationLevel).toBe("verified");
      expect(flag!.previousVerificationCount).toBe(4);

      // Barcode verification should be reset
      const [bv] = await tx
        .select()
        .from(barcodeVerifications)
        .where(
          (await import("drizzle-orm")).eq(
            barcodeVerifications.barcode,
            barcode,
          ),
        );
      expect(bv.verificationLevel).toBe("unverified");
      expect(bv.verificationCount).toBe(0);
      expect(bv.consensusNutritionData).toBeNull();

      // Verification history entries should be marked non-matching
      const history = await tx
        .select()
        .from(verificationHistory)
        .where(
          (await import("drizzle-orm")).eq(
            verificationHistory.barcode,
            barcode,
          ),
        );
      for (const h of history) {
        expect(h.isMatch).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  // resolveReformulationFlag
  // --------------------------------------------------------------------------
  describe("resolveReformulationFlag", () => {
    it("resolves an existing flag and returns true", async () => {
      const barcode = "9999999999999";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 1, null, "unverified", 0);

      const flag = await getReformulationFlag(barcode);
      const result = await resolveReformulationFlag(flag!.id);

      expect(result).toBe(true);

      const resolved = await getReformulationFlag(barcode);
      expect(resolved).toBeNull(); // no longer "flagged"
    });

    it("returns false for a nonexistent flag id", async () => {
      const result = await resolveReformulationFlag(999999);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getReformulationFlagCount
  // --------------------------------------------------------------------------
  describe("getReformulationFlagCount", () => {
    it("returns 0 when no flags exist", async () => {
      const count = await getReformulationFlagCount();
      expect(count).toBe(0);
    });

    it("returns total count of all flags", async () => {
      const barcode1 = "1010101010101";
      const barcode2 = "1212121212121";
      await createTestBarcode(barcode1);
      await createTestBarcode(barcode2);
      await flagReformulation(barcode1, 1, null, "unverified", 0);
      await flagReformulation(barcode2, 2, null, "unverified", 0);

      const count = await getReformulationFlagCount();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("filters by flagged status", async () => {
      const barcode = "1313131313131";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 1, null, "unverified", 0);

      const flaggedCount = await getReformulationFlagCount("flagged");
      expect(flaggedCount).toBeGreaterThanOrEqual(1);

      const resolvedCount = await getReformulationFlagCount("resolved");
      expect(resolvedCount).toBeGreaterThanOrEqual(0);
    });

    it("filters by resolved status after resolving a flag", async () => {
      const barcode = "1414141414141";
      await createTestBarcode(barcode);
      await flagReformulation(barcode, 1, null, "unverified", 0);

      const flag = await getReformulationFlag(barcode);
      await resolveReformulationFlag(flag!.id);

      const resolvedCount = await getReformulationFlagCount("resolved");
      expect(resolvedCount).toBeGreaterThanOrEqual(1);
    });
  });
});
