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
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import type * as schema from "@shared/schema";
import { barcodeVerifications, verificationHistory } from "@shared/schema";
import type {
  ConsensusNutritionData,
  VerificationNutrition,
} from "@shared/types/verification";
import type { FrontLabelData } from "@shared/types/front-label";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getVerification,
  getVerificationByBarcodes,
  getVerificationHistory,
  hasUserVerified,
  getUserVerificationStats,
  submitVerification,
  hasUserFrontLabelScanned,
  confirmFrontLabelData,
  getUserCompositeScore,
} = await import("../verification");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique 13-digit barcode for test isolation.
 *
 * Reason: storage functions like `submitVerification` and
 * `confirmFrontLabelData` call `db.transaction()` internally. When `db` is
 * mocked to return the outer test transaction's Drizzle instance (not a
 * NodePgTransaction), Drizzle's session-level `transaction()` issues a top-
 * level `COMMIT` that ends up committing the outer test BEGIN as well,
 * leaking writes past `rollbackTestTransaction()`. Per-test unique barcodes
 * sidestep the resulting unique-constraint collisions between runs without
 * changing the established test-utility pattern.
 *
 * Underlying isolation fix is tracked in
 * `todos/2026-05-11-db-test-utils-savepoint-leak.md`.
 */
let barcodeSeq = 0;
function makeBarcode(): string {
  barcodeSeq++;
  // 13 digits, prefixed with 99 so we don't collide with realistic barcodes.
  // 7 digits from crypto random + 4-digit per-test sequence guarantees no
  // collisions across runs or concurrent workers (see comment above re: leak).
  const rand = crypto.randomBytes(4).readUInt32BE() % 10_000_000;
  return `99${String(rand).padStart(7, "0")}${String(barcodeSeq).padStart(
    4,
    "0",
  )}`;
}

/**
 * Seed a barcodeVerifications row. The verification_history.barcode FK is NOT
 * deferrable (confirmed via pg_constraint), so the parent row must exist
 * before any submitVerification or direct verificationHistory insert.
 */
async function seedBarcodeVerification(
  barcode: string,
  overrides: Partial<schema.InsertBarcodeVerification> = {},
) {
  const [row] = await tx
    .insert(barcodeVerifications)
    .values({
      barcode,
      verificationLevel: "unverified",
      verificationCount: 0,
      ...overrides,
    })
    .returning();
  return row;
}

function makeNutrition(
  overrides: Partial<VerificationNutrition> = {},
): VerificationNutrition {
  return {
    calories: 200,
    protein: 10,
    totalCarbs: 25,
    totalFat: 8,
    ...overrides,
  };
}

function makeConsensus(
  overrides: Partial<ConsensusNutritionData> = {},
): ConsensusNutritionData {
  return {
    calories: 200,
    protein: 10,
    carbs: 25,
    fat: 8,
    ...overrides,
  };
}

function makeFrontLabel(
  userId: string,
  overrides: Partial<FrontLabelData> = {},
): FrontLabelData {
  return {
    brand: "Test Brand",
    productName: "Test Product",
    netWeight: "100g",
    claims: ["organic"],
    scannedByUserId: userId,
    scannedAt: new Date("2026-01-01").toISOString(),
    ...overrides,
  };
}

describe("verification storage", () => {
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
  // getVerification
  // ==========================================================================

  describe("getVerification", () => {
    it("returns the row when barcode matches", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode, {
        verificationLevel: "verified",
        verificationCount: 3,
      });
      const result = await getVerification(barcode);
      expect(result).not.toBeNull();
      expect(result!.barcode).toBe(barcode);
      expect(result!.verificationLevel).toBe("verified");
      expect(result!.verificationCount).toBe(3);
    });

    it("returns null when barcode does not exist", async () => {
      const result = await getVerification(makeBarcode());
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getVerificationByBarcodes (variants)
  // ==========================================================================

  describe("getVerificationByBarcodes", () => {
    it("returns null when variants array is empty", async () => {
      const result = await getVerificationByBarcodes([]);
      expect(result).toBeNull();
    });

    it("returns null when no variants match", async () => {
      const result = await getVerificationByBarcodes([makeBarcode()]);
      expect(result).toBeNull();
    });

    it("returns the row matching a variant", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const result = await getVerificationByBarcodes([barcode]);
      expect(result).not.toBeNull();
      expect(result!.barcode).toBe(barcode);
    });

    it("returns a match when any variant is in the DB (limit 1)", async () => {
      // NOTE: `getVerificationByBarcodes` uses `WHERE barcode IN (...)` +
      // `LIMIT 1` with no `ORDER BY`, so the row returned is whichever the
      // DB happens to pick when multiple variants are present. The test
      // asserts only that a match is returned — it does NOT assert array-
      // order priority because the production function does not provide it.
      // Contrast with `getBarcodeNutrition` (api-keys.ts), which does sort
      // by array index. If priority is desired here, the production code
      // should change first, then the test.
      const barcode = makeBarcode();
      const missing = makeBarcode();
      await seedBarcodeVerification(barcode);
      const result = await getVerificationByBarcodes([missing, barcode]);
      expect(result).not.toBeNull();
      expect(result!.barcode).toBe(barcode);
    });
  });

  // ==========================================================================
  // getVerificationHistory
  // ==========================================================================

  describe("getVerificationHistory", () => {
    it("returns empty array when no history exists", async () => {
      const result = await getVerificationHistory(makeBarcode());
      expect(result).toEqual([]);
    });

    it("returns history entries ordered most-recent first", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);

      const userB = await createTestUser(tx);

      // Insert two history rows manually with distinct timestamps
      await tx.insert(verificationHistory).values({
        barcode,
        userId: testUser.id,
        extractedNutrition: makeNutrition() as unknown as Record<
          string,
          unknown
        >,
        ocrConfidence: "0.90",
        isMatch: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      await tx.insert(verificationHistory).values({
        barcode,
        userId: userB.id,
        extractedNutrition: makeNutrition() as unknown as Record<
          string,
          unknown
        >,
        ocrConfidence: "0.95",
        isMatch: true,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });

      const result = await getVerificationHistory(barcode);
      expect(result.length).toBe(2);
      // Most recent first
      expect(result[0].userId).toBe(userB.id);
      expect(result[1].userId).toBe(testUser.id);
    });
  });

  // ==========================================================================
  // hasUserVerified
  // ==========================================================================

  describe("hasUserVerified", () => {
    it("returns false when no history exists", async () => {
      const result = await hasUserVerified(makeBarcode(), testUser.id);
      expect(result).toBe(false);
    });

    it("returns true after the user submits a verification", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const result = await hasUserVerified(barcode, testUser.id);
      expect(result).toBe(true);
    });

    it("returns false for a different user (IDOR scoping)", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const otherUser = await createTestUser(tx);
      const result = await hasUserVerified(barcode, otherUser.id);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // submitVerification — idempotency & duplicate prevention
  // ==========================================================================

  describe("submitVerification", () => {
    it("creates a history row and updates the verification status", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);

      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );

      const history = await getVerificationHistory(barcode);
      expect(history.length).toBe(1);
      expect(history[0].userId).toBe(testUser.id);
      expect(history[0].isMatch).toBe(true);
      expect(history[0].ocrConfidence).toBe("0.95");

      const verification = await getVerification(barcode);
      expect(verification!.verificationLevel).toBe("single_verified");
      expect(verification!.verificationCount).toBe(1);
    });

    it("persists consensus data when provided", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const consensus = makeConsensus({ calories: 250 });
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "verified",
        3,
        consensus,
      );
      const verification = await getVerification(barcode);
      expect(verification!.consensusNutritionData).toEqual(consensus);
    });

    it("does NOT double-count when the same user submits twice for the same barcode (idempotency via unique constraint)", async () => {
      // SCOPE: This is SQL-coverage only — `Promise.all` inside one test
      // transaction serializes on the single PG connection, so it does not
      // exercise true multi-connection race conditions. The behavioral
      // guarantee under test is that the unique(barcode, userId) constraint +
      // onConflictDoNothing produces "exactly one row per (user, barcode)"
      // regardless of submission order. A real multi-connection race would
      // also be safe because the unique index is enforced at the row level,
      // but proving that requires a different test harness (multiple pool
      // clients, parallel transactions) and is intentionally out of scope.
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);

      await Promise.all([
        submitVerification(
          barcode,
          testUser.id,
          makeNutrition(),
          0.95,
          true,
          "single_verified",
          1,
          null,
        ),
        submitVerification(
          barcode,
          testUser.id,
          makeNutrition(),
          0.93,
          true,
          "single_verified",
          1,
          null,
        ),
      ]);

      const history = await getVerificationHistory(barcode);
      expect(history.length).toBe(1);
    });

    it("allows different users to verify the same barcode", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const userB = await createTestUser(tx);

      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      await submitVerification(
        barcode,
        userB.id,
        makeNutrition(),
        0.92,
        true,
        "verified",
        2,
        makeConsensus(),
      );

      const history = await getVerificationHistory(barcode);
      expect(history.length).toBe(2);
      const verification = await getVerification(barcode);
      expect(verification!.verificationLevel).toBe("verified");
      expect(verification!.verificationCount).toBe(2);
    });

    it("skips status update when history insert is a no-op (duplicate)", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode, {
        verificationLevel: "single_verified",
        verificationCount: 1,
      });
      // First submission: succeeds, would update to "verified" if level/count argued.
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      // Second submission from same user — history insert is a no-op.
      // The status update inside the transaction should be skipped (guard
      // on `if (!inserted) return;`).
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.99,
        true,
        "verified",
        99,
        makeConsensus(),
      );

      const verification = await getVerification(barcode);
      // Status should still reflect the first call, not the second's args
      expect(verification!.verificationLevel).toBe("single_verified");
      expect(verification!.verificationCount).toBe(1);
    });
  });

  // ==========================================================================
  // hasUserFrontLabelScanned
  // ==========================================================================

  describe("hasUserFrontLabelScanned", () => {
    it("returns false when user has no verification history for barcode", async () => {
      const result = await hasUserFrontLabelScanned(makeBarcode(), testUser.id);
      expect(result).toBe(false);
    });

    it("returns false when user has history but no front-label scan", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const result = await hasUserFrontLabelScanned(barcode, testUser.id);
      expect(result).toBe(false);
    });

    it("returns true after confirmFrontLabelData", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      await confirmFrontLabelData(
        barcode,
        testUser.id,
        makeFrontLabel(testUser.id),
      );
      const result = await hasUserFrontLabelScanned(barcode, testUser.id);
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // confirmFrontLabelData
  // ==========================================================================

  describe("confirmFrontLabelData", () => {
    it("stores front-label data on the barcode row and stamps history", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const data = makeFrontLabel(testUser.id, {
        brand: "Acme",
        productName: "Granola",
      });
      await confirmFrontLabelData(barcode, testUser.id, data);

      // barcodeVerifications.frontLabelData populated
      const verification = await getVerification(barcode);
      expect(verification!.frontLabelData).toEqual(data);

      // verificationHistory row marked scanned with timestamp
      const [history] = await tx
        .select()
        .from(verificationHistory)
        .where(
          and(
            eq(verificationHistory.barcode, barcode),
            eq(verificationHistory.userId, testUser.id),
          ),
        );
      expect(history.frontLabelScanned).toBe(true);
      expect(history.frontLabelScannedAt).toBeInstanceOf(Date);
    });

    it("only marks the calling user's history row (IDOR scoping)", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const userB = await createTestUser(tx);

      // Both users verify
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      await submitVerification(
        barcode,
        userB.id,
        makeNutrition(),
        0.92,
        true,
        "verified",
        2,
        null,
      );

      // Only testUser confirms front-label
      await confirmFrontLabelData(
        barcode,
        testUser.id,
        makeFrontLabel(testUser.id),
      );

      // Other user's history is untouched
      expect(await hasUserFrontLabelScanned(barcode, testUser.id)).toBe(true);
      expect(await hasUserFrontLabelScanned(barcode, userB.id)).toBe(false);
    });

    it("overwrites previous front-label data on subsequent confirm", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const first = makeFrontLabel(testUser.id, { brand: "First" });
      const second = makeFrontLabel(testUser.id, { brand: "Second" });
      await confirmFrontLabelData(barcode, testUser.id, first);
      await confirmFrontLabelData(barcode, testUser.id, second);

      const verification = await getVerification(barcode);
      expect(
        (verification!.frontLabelData as unknown as FrontLabelData).brand,
      ).toBe("Second");
    });
  });

  // ==========================================================================
  // getUserCompositeScore
  // ==========================================================================

  describe("getUserCompositeScore", () => {
    it("returns zeros when user has no history", async () => {
      const result = await getUserCompositeScore(testUser.id);
      expect(result.verificationCount).toBe(0);
      expect(result.frontLabelCount).toBe(0);
      expect(result.compositeScore).toBeCloseTo(0, 2);
    });

    it("returns 1.0 for a single verification with no front-label", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const result = await getUserCompositeScore(testUser.id);
      expect(result.verificationCount).toBe(1);
      expect(result.frontLabelCount).toBe(0);
      expect(result.compositeScore).toBeCloseTo(1.0, 2);
    });

    it("adds 0.5 for each front-label scan on top of the verification count", async () => {
      const barcodes = [makeBarcode(), makeBarcode(), makeBarcode()];
      for (const barcode of barcodes) {
        await seedBarcodeVerification(barcode);
        await submitVerification(
          barcode,
          testUser.id,
          makeNutrition(),
          0.95,
          true,
          "single_verified",
          1,
          null,
        );
      }
      // 2 of the 3 also get front-label confirmation
      await confirmFrontLabelData(
        barcodes[0],
        testUser.id,
        makeFrontLabel(testUser.id),
      );
      await confirmFrontLabelData(
        barcodes[1],
        testUser.id,
        makeFrontLabel(testUser.id),
      );

      const result = await getUserCompositeScore(testUser.id);
      expect(result.verificationCount).toBe(3);
      expect(result.frontLabelCount).toBe(2);
      // 3 + (2 * 0.5) = 4.0
      expect(result.compositeScore).toBeCloseTo(4.0, 2);
    });

    it("counts isMatch=false ('disputed') verifications equally", async () => {
      // Note: getUserCompositeScore uses count(*) filtered only by userId —
      // both matched and disputed verifications count toward verificationCount.
      const matchBarcode = makeBarcode();
      const disputedBarcode = makeBarcode();
      await seedBarcodeVerification(matchBarcode);
      await seedBarcodeVerification(disputedBarcode);

      await submitVerification(
        matchBarcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      await submitVerification(
        disputedBarcode,
        testUser.id,
        makeNutrition(),
        0.9,
        false,
        "unverified",
        0,
        null,
      );

      const result = await getUserCompositeScore(testUser.id);
      expect(result.verificationCount).toBe(2);
      expect(result.frontLabelCount).toBe(0);
      expect(result.compositeScore).toBeCloseTo(2.0, 2);
    });

    it("only counts the calling user's history (IDOR scoping)", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      const userB = await createTestUser(tx);

      await submitVerification(
        barcode,
        userB.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const result = await getUserCompositeScore(testUser.id);
      expect(result.verificationCount).toBe(0);
      expect(result.compositeScore).toBeCloseTo(0, 2);
    });
  });

  // ==========================================================================
  // getUserVerificationStats — count + streak
  // ==========================================================================

  describe("getUserVerificationStats", () => {
    it("returns zeros when user has no history", async () => {
      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(0);
      expect(result.frontLabelCount).toBe(0);
      expect(result.compositeScore).toBeCloseTo(0, 2);
      expect(result.streak).toBe(0);
    });

    it("returns count=1, streak=1 for a verification today", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(1);
      // Streak is 1 because today's verification counts.
      expect(result.streak).toBe(1);
    });

    it("includes front-label count and composite score", async () => {
      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await submitVerification(
        barcode,
        testUser.id,
        makeNutrition(),
        0.95,
        true,
        "single_verified",
        1,
        null,
      );
      await confirmFrontLabelData(
        barcode,
        testUser.id,
        makeFrontLabel(testUser.id),
      );
      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(1);
      expect(result.frontLabelCount).toBe(1);
      expect(result.compositeScore).toBeCloseTo(1.5, 2);
    });

    // Streak edge cases — calendar-day walk in `getUserVerificationStats`.
    // We seed verification_history rows directly with backdated createdAt so
    // we can control the date sequence without depending on transaction
    // timestamps.
    async function seedHistoryOnDay(barcode: string, day: Date): Promise<void> {
      await tx.insert(verificationHistory).values({
        barcode,
        userId: testUser.id,
        extractedNutrition: makeNutrition() as unknown as Record<
          string,
          unknown
        >,
        ocrConfidence: "0.95",
        isMatch: true,
        createdAt: day,
      });
    }

    it("counts a consecutive 3-day streak (today, yesterday, 2-days-ago)", async () => {
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setUTCDate(today.getUTCDate() - 2);

      const b1 = makeBarcode();
      const b2 = makeBarcode();
      const b3 = makeBarcode();
      await seedBarcodeVerification(b1);
      await seedBarcodeVerification(b2);
      await seedBarcodeVerification(b3);
      await seedHistoryOnDay(b1, today);
      await seedHistoryOnDay(b2, yesterday);
      await seedHistoryOnDay(b3, twoDaysAgo);

      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(3);
      expect(result.streak).toBe(3);
    });

    it("breaks streak on a missed day (counts only the unbroken run from today)", async () => {
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);
      // Gap day (2-days-ago has no verification)
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setUTCDate(today.getUTCDate() - 3);

      const b1 = makeBarcode();
      const b2 = makeBarcode();
      const b3 = makeBarcode();
      await seedBarcodeVerification(b1);
      await seedBarcodeVerification(b2);
      await seedBarcodeVerification(b3);
      await seedHistoryOnDay(b1, today);
      await seedHistoryOnDay(b2, yesterday);
      await seedHistoryOnDay(b3, threeDaysAgo);

      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(3);
      // Streak = today + yesterday only; 3-days-ago is past the gap.
      expect(result.streak).toBe(2);
    });

    it("counts yesterday-only as streak=1 when today has no verification", async () => {
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const yesterday = new Date(today);
      yesterday.setUTCDate(today.getUTCDate() - 1);

      const barcode = makeBarcode();
      await seedBarcodeVerification(barcode);
      await seedHistoryOnDay(barcode, yesterday);

      const result = await getUserVerificationStats(testUser.id);
      expect(result.count).toBe(1);
      expect(result.streak).toBe(1);
    });
  });
});
