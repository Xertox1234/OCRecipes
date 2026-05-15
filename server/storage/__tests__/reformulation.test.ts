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
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import type * as schema from "@shared/schema";
import { barcodeVerifications, verificationHistory } from "@shared/schema";
import type { ConsensusNutritionData } from "@shared/types/verification";

// Mock the db import so the storage functions use our test transaction.
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getReformulationFlag,
  getReformulationFlags,
  flagReformulation,
  resolveReformulationFlag,
  getReformulationFlagCount,
} = await import("../reformulation");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// Per-test unique barcodes — flagReformulation calls db.transaction() internally
// and the same transaction-leak workaround used in verification.test.ts applies
// here (see todos/2026-05-11-db-test-utils-savepoint-leak.md).
let barcodeSeq = 0;
function makeBarcode(): string {
  barcodeSeq++;
  const rand = crypto.randomBytes(4).readUInt32BE() % 10_000_000;
  return `99${String(rand).padStart(7, "0")}${String(barcodeSeq).padStart(
    4,
    "0",
  )}`;
}

/**
 * Seed a barcodeVerifications parent row. The reformulation_flags.barcode FK
 * references barcode_verifications.barcode, so the parent must exist before
 * any flagReformulation call.
 */
async function seedBarcodeVerification(
  barcode: string,
  overrides: Partial<schema.InsertBarcodeVerification> = {},
) {
  const [row] = await tx
    .insert(barcodeVerifications)
    .values({
      barcode,
      verificationLevel: "verified",
      verificationCount: 3,
      ...overrides,
    })
    .returning();
  return row;
}

function makeConsensus(
  overrides: Partial<ConsensusNutritionData> = {},
): ConsensusNutritionData {
  return {
    calories: 200,
    protein: 10,
    totalCarbs: 25,
    totalFat: 8,
    ...overrides,
  } as ConsensusNutritionData;
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
  // getReformulationFlag — returns active (flagged) row for a barcode
  // --------------------------------------------------------------------------
  describe("getReformulationFlag", () => {
    it("returns null when no flag exists for barcode", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const result = await getReformulationFlag(barcode);
      expect(result).toBeNull();
    });

    it("returns the active flag for a flagged barcode", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);

      const result = await getReformulationFlag(barcode);
      expect(result).not.toBeNull();
      expect(result!.barcode).toBe(barcode);
      expect(result!.status).toBe("flagged");
      expect(result!.divergentScanCount).toBe(5);
    });

    it("returns null after the flag is resolved", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);
      const flag = await getReformulationFlag(barcode);
      await resolveReformulationFlag(flag!.id);

      const result = await getReformulationFlag(barcode);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getReformulationFlags — list with status filter, limit, offset
  // --------------------------------------------------------------------------
  describe("getReformulationFlags", () => {
    it("returns all flags created in this test when no status filter is given", async () => {
      const b1 = makeBarcode();
      const b2 = makeBarcode();
      await seedBarcodeVerification(b1);
      await seedBarcodeVerification(b2);
      await flagReformulation(b1, 5, makeConsensus(), "verified", 3);
      await flagReformulation(b2, 7, makeConsensus(), "verified", 3);

      const rows = await getReformulationFlags(undefined, 1000);
      const barcodes = rows.map((r) => r.barcode);
      expect(barcodes).toContain(b1);
      expect(barcodes).toContain(b2);
    });

    it("filters by status=flagged", async () => {
      const b1 = makeBarcode();
      const b2 = makeBarcode();
      await seedBarcodeVerification(b1);
      await seedBarcodeVerification(b2);
      await flagReformulation(b1, 5, makeConsensus(), "verified", 3);
      await flagReformulation(b2, 7, makeConsensus(), "verified", 3);

      // Resolve b2 so only b1 remains "flagged" (for our barcodes).
      const b2Flag = await getReformulationFlag(b2);
      await resolveReformulationFlag(b2Flag!.id);

      const rows = await getReformulationFlags("flagged", 1000);
      const barcodes = rows.map((r) => r.barcode);
      expect(barcodes).toContain(b1);
      expect(barcodes).not.toContain(b2);
    });

    it("filters by status=resolved", async () => {
      const b1 = makeBarcode();
      const b2 = makeBarcode();
      await seedBarcodeVerification(b1);
      await seedBarcodeVerification(b2);
      await flagReformulation(b1, 5, makeConsensus(), "verified", 3);
      await flagReformulation(b2, 7, makeConsensus(), "verified", 3);

      const b2Flag = await getReformulationFlag(b2);
      await resolveReformulationFlag(b2Flag!.id);

      const rows = await getReformulationFlags("resolved", 1000);
      const barcodes = rows.map((r) => r.barcode);
      expect(barcodes).toContain(b2);
      expect(barcodes).not.toContain(b1);
    });

    it("respects limit parameter", async () => {
      const barcodes = [makeBarcode(), makeBarcode(), makeBarcode()];
      for (const b of barcodes) {
        await seedBarcodeVerification(b);
        await flagReformulation(b, 5, makeConsensus(), "verified", 3);
      }

      const rows = await getReformulationFlags(undefined, 2);
      expect(rows).toHaveLength(2);
    });

    it("respects offset parameter", async () => {
      // getReformulationFlags orders by `desc(detectedAt)` — and detectedAt is
      // CURRENT_TIMESTAMP which is fixed per-transaction, so multiple flags
      // inserted in this test can share a timestamp. We therefore assert
      // page-size only, plus that the offset window advances at least one
      // row (no overlap), without depending on a specific tie-break order.
      // Parallel-worker safety: query a wide window first to capture the
      // count we control, then derive expected page sizes from it.
      const before = await getReformulationFlagCount();
      const myBarcodes = [makeBarcode(), makeBarcode(), makeBarcode()];
      for (const b of myBarcodes) {
        await seedBarcodeVerification(b);
        await flagReformulation(b, 5, makeConsensus(), "verified", 3);
      }
      const after = await getReformulationFlagCount();
      const totalNow = after; // includes other workers' rows
      expect(after - before).toBe(3);

      const firstPage = await getReformulationFlags(undefined, 2, 0);
      const secondPage = await getReformulationFlags(undefined, 2, 2);

      // Each page is bounded by min(limit, total - offset).
      expect(firstPage.length).toBe(Math.min(2, totalNow));
      expect(secondPage.length).toBe(Math.min(2, Math.max(totalNow - 2, 0)));

      // No id overlaps the offset window.
      const firstIds = new Set(firstPage.map((r) => r.id));
      for (const row of secondPage) {
        expect(firstIds.has(row.id)).toBe(false);
      }
    });
  });

  // --------------------------------------------------------------------------
  // flagReformulation — the audit-snapshot + reset transaction
  // --------------------------------------------------------------------------
  describe("flagReformulation", () => {
    it("inserts a flagged row with audit snapshot fields", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const consensus = makeConsensus({ calories: 250 });

      await flagReformulation(barcode, 5, consensus, "community", 12);

      const flag = await getReformulationFlag(barcode);
      expect(flag).not.toBeNull();
      expect(flag!.divergentScanCount).toBe(5);
      expect(flag!.previousVerificationLevel).toBe("community");
      expect(flag!.previousVerificationCount).toBe(12);
      // previousConsensus is stored as JSONB
      expect(flag!.previousConsensus).toMatchObject({ calories: 250 });
    });

    it("resets the parent barcodeVerifications row to unverified", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode, {
        verificationLevel: "verified",
        verificationCount: 7,
        consensusNutritionData: makeConsensus() as unknown as Record<
          string,
          unknown
        >,
      });

      await flagReformulation(barcode, 5, makeConsensus(), "verified", 7);

      const [parent] = await tx
        .select()
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      expect(parent.verificationLevel).toBe("unverified");
      expect(parent.verificationCount).toBe(0);
      expect(parent.consensusNutritionData).toBeNull();
    });

    it("marks existing verification history rows as non-matching", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      // Seed two history rows (one match, one null) for this barcode.
      const otherUser = await createTestUser(tx);
      await tx.insert(verificationHistory).values([
        {
          barcode,
          userId: testUser.id,
          extractedNutrition: { calories: 200 },
          ocrConfidence: "0.95",
          isMatch: true,
        },
        {
          barcode,
          userId: otherUser.id,
          extractedNutrition: { calories: 210 },
          ocrConfidence: "0.90",
          isMatch: null,
        },
      ]);

      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);

      const histRows = await tx
        .select()
        .from(verificationHistory)
        .where(eq(verificationHistory.barcode, barcode));
      expect(histRows).toHaveLength(2);
      for (const row of histRows) {
        expect(row.isMatch).toBe(false);
      }
    });

    it("handles null previousConsensus", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);

      await flagReformulation(barcode, 5, null, "unverified", 0);

      const flag = await getReformulationFlag(barcode);
      expect(flag).not.toBeNull();
      expect(flag!.previousConsensus).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // resolveReformulationFlag
  // --------------------------------------------------------------------------
  describe("resolveReformulationFlag", () => {
    it("returns true and marks the flag resolved", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);
      const flag = await getReformulationFlag(barcode);

      const result = await resolveReformulationFlag(flag!.id);
      expect(result).toBe(true);

      const resolvedRows = await getReformulationFlags("resolved", 1000);
      const stamped = resolvedRows.find((r) => r.id === flag!.id);
      expect(stamped).toBeDefined();
      // resolvedAt is stamped server-side
      expect(stamped!.resolvedAt).not.toBeNull();
      expect(stamped!.status).toBe("resolved");
    });

    it("returns false when flag id does not exist", async () => {
      const result = await resolveReformulationFlag(999999);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getReformulationFlagCount
  // --------------------------------------------------------------------------
  describe("getReformulationFlagCount", () => {
    // These tests use specific status filters and assert that this-test
    // additions are reflected in the count delta — never an absolute count,
    // because parallel test workers may share rows in the un-filtered query.
    // (Verification tests use the same delta pattern.)
    it("counts flagged rows", async () => {
      const before = await getReformulationFlagCount("flagged");

      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);

      const after = await getReformulationFlagCount("flagged");
      expect(after - before).toBe(1);
    });

    it("counts resolved rows", async () => {
      const before = await getReformulationFlagCount("resolved");

      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await flagReformulation(barcode, 5, makeConsensus(), "verified", 3);
      const flag = await getReformulationFlag(barcode);
      await resolveReformulationFlag(flag!.id);

      const after = await getReformulationFlagCount("resolved");
      expect(after - before).toBe(1);
    });

    // The "no status filter" branch is covered transitively by the two
    // filtered count tests above (`status ? eq(...) : undefined`). Asserting
    // an unscoped delta is flake-prone under the documented test-tx leak
    // (`todos/2026-05-11-db-test-utils-savepoint-leak.md`) because parallel
    // workers can insert rows between the `before` and `after` snapshots.
  });
});
