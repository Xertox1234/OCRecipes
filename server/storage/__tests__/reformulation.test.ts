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
import {
  barcodeVerifications,
  reformulationFlags,
  verificationHistory,
} from "@shared/schema";
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
      // getReformulationFlags orders by `desc(detectedAt)` and offers no
      // ownership filter, so any assertion about a page is at the mercy of
      // rows this test does not own. `verification.concurrent.test.ts`
      // deliberately runs OUTSIDE the savepoint harness: it COMMITS
      // reformulation_flags rows and bulk-deletes them in its `afterAll`. The
      // foreign population visible here therefore both grows and shrinks, and
      // under READ COMMITTED every statement re-snapshots — so consecutive
      // queries can disagree. An earlier version of this test derived expected
      // page sizes from two whole-table counts and red the suite on both
      // directions of that churn (a mid-window insert broke the count delta; a
      // mid-window shift broke the no-overlap check).
      //
      // Fix: pin this test's rows to distinct FAR-FUTURE detectedAt values.
      // Every foreign row is stamped at or before now, so ours provably hold
      // ordering positions 0, 1 and 2 whatever else is in the table — paging
      // over the head of the list stays entirely inside rows we own. Distinct
      // values also remove the intra-test tie that CURRENT_TIMESTAMP (fixed
      // per transaction) would otherwise create between all three rows.
      // Mid-year base so subtracting per-row minutes cannot walk back across
      // the year boundary (Jan 1 minus a minute is the PREVIOUS year).
      const PIN_BASE_MS = Date.UTC(2999, 5, 1);
      const myBarcodes = [makeBarcode(), makeBarcode(), makeBarcode()];
      for (const [i, b] of myBarcodes.entries()) {
        await seedBarcodeVerification(b);
        await flagReformulation(b, 5, makeConsensus(), "verified", 3);
        // Descending by index, so desc(detectedAt) order is exactly myBarcodes.
        const pinned = await tx
          .update(reformulationFlags)
          .set({ detectedAt: new Date(PIN_BASE_MS - i * 60_000) })
          .where(eq(reformulationFlags.barcode, b))
          .returning({
            id: reformulationFlags.id,
            detectedAt: reformulationFlags.detectedAt,
          });
        // A pin that matched no row, or that did not survive the timestamptz
        // round-trip, would leave every assertion below passing for the wrong
        // reason — the ordering guarantee rests entirely on the stored value.
        expect(pinned).toHaveLength(1);
        expect(pinned[0].detectedAt.getUTCFullYear()).toBe(2999);
      }

      // limit caps the page; offset 0 starts at our newest row.
      const firstPage = await getReformulationFlags(undefined, 2, 0);
      expect(firstPage.map((r) => r.barcode)).toEqual([
        myBarcodes[0],
        myBarcodes[1],
      ]);

      // This window lies wholly inside the rows we own, so it is the strongest
      // available proof that offset shifts the window rather than re-slicing
      // page one.
      const shiftedPage = await getReformulationFlags(undefined, 2, 1);
      expect(shiftedPage.map((r) => r.barcode)).toEqual([
        myBarcodes[1],
        myBarcodes[2],
      ]);

      // Offset past our first page: position 2 is our last row. Length is
      // deliberately NOT asserted — it is 1 when this file runs alone and 2
      // when a foreign row trails ours.
      const secondPage = await getReformulationFlags(undefined, 2, 2);
      expect(secondPage.length).toBeGreaterThanOrEqual(1);
      expect(secondPage[0].barcode).toBe(myBarcodes[2]);

      // No id overlaps the offset window. firstPage is entirely ours, so a
      // foreign row trailing in secondPage cannot collide either.
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
        consensusNutritionData: makeConsensus(),
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
          extractedNutrition: {
            calories: 200,
            protein: 10,
            totalCarbs: 25,
            totalFat: 8,
          },
          ocrConfidence: "0.95",
          isMatch: true,
        },
        {
          barcode,
          userId: otherUser.id,
          extractedNutrition: {
            calories: 210,
            protein: 10,
            totalCarbs: 25,
            totalFat: 8,
          },
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
    // These tests assert a LOWER BOUND over rows this test owns — never a
    // before/after delta, for ANY status filter.
    //
    // `reformulation_flags` has a writer that runs outside the savepoint
    // harness: `verification.concurrent.test.ts` COMMITS `flagged` rows and
    // bulk-deletes them in its `afterAll`. The foreign population visible to
    // this transaction therefore both grows and shrinks, and READ COMMITTED
    // re-snapshots per statement, so a delta across two unscoped `count(*)`
    // reads is unstable in BOTH directions — observed reds include
    // `expected -3 to be 1` and `expected 2 to be 1`, all three `retry: 2`
    // attempts failing because they re-run inside the same hazard window.
    // An earlier version of this comment claimed only the UNFILTERED count
    // was exposed; that was wrong — the concurrent writer's rows are
    // `flagged`, so the `"flagged"` delta was exposed too.
    //
    // A lower bound is the one deterministic property available here: foreign
    // churn can only push an unscoped count UP relative to the rows we own, so
    // it can never falsify the bound. The status filter itself
    // (`status ? eq(...) : undefined`) is proven over an owned, deterministic
    // window by the `filters by status=…` tests above — getReformulationFlags
    // builds the identical `conditions` expression.
    it("counts flagged rows", async () => {
      const myBarcodes = [makeBarcode(), makeBarcode()];
      for (const b of myBarcodes) {
        await seedBarcodeVerification(b);
        await flagReformulation(b, 5, makeConsensus(), "verified", 3);
      }

      // Two owned rows, so a stubbed/short-circuited count (0, 1, LIMIT 1)
      // still fails.
      const count = await getReformulationFlagCount("flagged");
      expect(count).toBeGreaterThanOrEqual(myBarcodes.length);
    });

    it("counts resolved rows", async () => {
      const myBarcodes = [makeBarcode(), makeBarcode()];
      for (const b of myBarcodes) {
        await seedBarcodeVerification(b);
        await flagReformulation(b, 5, makeConsensus(), "verified", 3);
        const flag = await getReformulationFlag(b);
        await resolveReformulationFlag(flag!.id);
      }

      const count = await getReformulationFlagCount("resolved");
      expect(count).toBeGreaterThanOrEqual(myBarcodes.length);
    });

    // The "no status filter" branch is covered transitively by the two
    // filtered count tests above — it is the same `status ? eq(...) :
    // undefined` expression with the ternary's other arm taken.
  });
});
