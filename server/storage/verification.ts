import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { db } from "../db";
import { barcodeVerifications, verificationHistory } from "@shared/schema";
import type {
  ConsensusNutritionData,
  VerificationNutrition,
} from "@shared/types/verification";
import type { FrontLabelData } from "@shared/types/front-label";
import {
  computeConsensus,
  CONSENSUS_THRESHOLD,
  compareWithVerifications,
} from "../lib/verification-consensus";

/** Get the verification status for a barcode */
export async function getVerification(barcode: string) {
  const [result] = await db
    .select()
    .from(barcodeVerifications)
    .where(eq(barcodeVerifications.barcode, barcode));
  return result ?? null;
}

/**
 * Get verification by trying multiple barcode variants.
 * Returns the row matching the highest-priority variant (earliest in the array).
 * Mirrors `getBarcodeNutrition` in api-keys.ts so both lookups agree when
 * variants map to different products.
 */
export async function getVerificationByBarcodes(variants: string[]) {
  if (variants.length === 0) return null;
  const results = await db
    .select()
    .from(barcodeVerifications)
    .where(inArray(barcodeVerifications.barcode, variants));

  if (results.length === 0) return null;

  // Return the result matching the highest-priority variant (earliest in the array)
  const indexMap = new Map(variants.map((v, i) => [v, i]));
  results.sort(
    (a, b) =>
      (indexMap.get(a.barcode) ?? Infinity) -
      (indexMap.get(b.barcode) ?? Infinity),
  );
  return results[0];
}

/** Get verification history entries for a barcode (most recent first, capped) */
export async function getVerificationHistory(barcode: string) {
  return db
    .select()
    .from(verificationHistory)
    .where(eq(verificationHistory.barcode, barcode))
    .orderBy(desc(verificationHistory.createdAt))
    .limit(200);
}

/** Check if a user has already verified a specific barcode */
export async function hasUserVerified(
  barcode: string,
  userId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: verificationHistory.id })
    .from(verificationHistory)
    .where(
      and(
        eq(verificationHistory.barcode, barcode),
        eq(verificationHistory.userId, userId),
      ),
    );
  return !!existing;
}

/**
 * Get the user's verification stats: total count + current streak.
 * Streak = consecutive calendar days (UTC) with at least one verification,
 * counting backwards from today.
 */
export async function getUserVerificationStats(userId: string): Promise<{
  count: number;
  frontLabelCount: number;
  compositeScore: number;
  streak: number;
}> {
  // Run both queries in parallel — count + activity dates
  const [countResult, activityRows] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        frontLabelCount: sql<number>`count(*) filter (where ${verificationHistory.frontLabelScanned} = true)::int`,
      })
      .from(verificationHistory)
      .where(eq(verificationHistory.userId, userId)),
    db
      .select({
        backDay: sql<string>`DATE(${verificationHistory.createdAt} AT TIME ZONE 'UTC')`,
        frontDay: sql<
          string | null
        >`DATE(${verificationHistory.frontLabelScannedAt} AT TIME ZONE 'UTC')`,
      })
      .from(verificationHistory)
      .where(
        and(
          eq(verificationHistory.userId, userId),
          sql`${verificationHistory.createdAt} >= NOW() - INTERVAL '90 days'`,
        ),
      )
      .limit(90), // Performance guard: max 90 distinct dates in 90 days; multiple per day is fine
  ]);

  const count = countResult[0]?.count ?? 0;
  const frontLabelCount = countResult[0]?.frontLabelCount ?? 0;
  const compositeScore = count + frontLabelCount * 0.5;

  if (count === 0)
    return { count: 0, frontLabelCount: 0, compositeScore: 0, streak: 0 };

  // Collect unique dates from both columns
  const dateSet = new Set<string>();
  for (const row of activityRows) {
    dateSet.add(row.backDay);
    if (row.frontDay) dateSet.add(row.frontDay);
  }
  const dates = [...dateSet]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({ day }));

  // Walk backwards from today counting consecutive days
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let streak = 0;
  let expectedDate = new Date(today);

  for (const row of dates) {
    const verificationDate = new Date(row.day);
    verificationDate.setUTCHours(0, 0, 0, 0);

    const diffDays = Math.round(
      (expectedDate.getTime() - verificationDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) {
      streak++;
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
    } else if (diffDays === 1 && streak === 0) {
      // Yesterday counts as start of streak (user hasn't verified today yet)
      streak++;
      expectedDate = new Date(verificationDate);
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
    } else {
      break;
    }
  }

  return { count, frontLabelCount, compositeScore, streak };
}

/** Result of a verification submission — the authoritative aggregate state. */
export interface SubmitVerificationResult {
  verificationLevel: string;
  verificationCount: number;
  consensusNutritionData: ConsensusNutritionData | null;
  /**
   * Whether this submission matched the committed history under the lock.
   * Computed authoritatively inside the transaction — not caller-supplied —
   * so a concurrent first-N burst on a brand-new barcode cannot store
   * divergent rows all as `isMatch = true`.
   */
  isMatch: boolean;
}

/**
 * Narrow a raw `verification_history.extractedNutrition` JSONB blob into the
 * domain `VerificationNutrition` shape. Mirrors the route's parsing.
 */
function parseHistoryNutrition(raw: unknown): VerificationNutrition {
  const n = (raw ?? {}) as Record<string, unknown>;
  return {
    calories: typeof n.calories === "number" ? n.calories : null,
    protein: typeof n.protein === "number" ? n.protein : null,
    totalCarbs: typeof n.totalCarbs === "number" ? n.totalCarbs : null,
    totalFat: typeof n.totalFat === "number" ? n.totalFat : null,
  };
}

/**
 * Submit a verification: record a history entry and recompute the barcode's
 * aggregate status. All writes wrapped in a single transaction for atomicity.
 *
 * Concurrency: a transaction-scoped advisory lock on the barcode serializes
 * concurrent submissions for the SAME barcode. Both the per-row `isMatch`
 * decision and the aggregate (`verificationLevel` / `verificationCount` /
 * `consensusNutritionData`) are computed from `verification_history` read
 * UNDER the lock — never trusted from a caller-supplied pre-submit snapshot.
 *
 * `isMatch` in particular must be computed inside the lock: a route-level
 * pre-transaction read sees `existing = []` for every request in a concurrent
 * first-N burst on a brand-new barcode, so all N rows would be stored as
 * `isMatch = true` even when their nutrition diverges. Reading the matching
 * history rows under the lock serializes the comparison, so each row is
 * compared against the rows committed before it.
 *
 * The under-lock history read is the correctness mechanism (not an avoidable
 * round-trip): it reads the authoritative row set under the lock, and because
 * the lock prevents any concurrent insert for this barcode, the post-insert
 * matching set is exactly those rows plus this submission's own row.
 */
export async function submitVerification(
  barcode: string,
  userId: string,
  extractedNutrition: VerificationNutrition,
  ocrConfidence: number,
): Promise<SubmitVerificationResult> {
  return db.transaction(async (tx) => {
    // Serialize concurrent submissions for this barcode. Acquired first so it
    // also covers the first-ever-barcode parent-row race below. Mirrors the
    // advisory-lock pattern in server/storage/chat.ts.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${barcode}, 0))`,
    );

    // Ensure the parent row exists before inserting verificationHistory; the
    // FK is immediate, so child-before-parent fails for first-ever barcodes.
    await tx
      .insert(barcodeVerifications)
      .values({ barcode })
      .onConflictDoNothing({ target: barcodeVerifications.barcode });

    // Read the committed matching history UNDER the lock, BEFORE the insert.
    // Only matching entries (isMatch IS NOT FALSE) are comparison candidates —
    // this mirrors the consensus filter. The lock guarantees no concurrent
    // submission for this barcode commits between this read and our insert, so
    // this set is authoritative for both the `isMatch` comparison and the
    // post-insert aggregate recompute.
    const existingMatchingRows = await tx
      .select({ extractedNutrition: verificationHistory.extractedNutrition })
      .from(verificationHistory)
      .where(
        and(
          eq(verificationHistory.barcode, barcode),
          sql`${verificationHistory.isMatch} IS NOT FALSE`,
        ),
      );
    const existingMatchingNutrition = existingMatchingRows.map((r) =>
      parseHistoryNutrition(r.extractedNutrition),
    );

    // Compare this submission against the committed matching history. First
    // submission (empty history) always matches — nothing to compare against.
    const isMatch = compareWithVerifications(
      extractedNutrition,
      existingMatchingNutrition,
    ).isMatch;

    // Insert verification history entry with the under-lock `isMatch`.
    const [inserted] = await tx
      .insert(verificationHistory)
      .values({
        barcode,
        userId,
        extractedNutrition: extractedNutrition as unknown as Record<
          string,
          unknown
        >,
        ocrConfidence: ocrConfidence.toFixed(2),
        isMatch,
      })
      .onConflictDoNothing({
        target: [verificationHistory.barcode, verificationHistory.userId],
      })
      .returning({ id: verificationHistory.id });

    // Concurrent/duplicate submission — this user already verified this
    // barcode. Return the current aggregate WITHOUT mutating it: duplicate
    // submissions must not change the aggregate status.
    if (!inserted) {
      const [current] = await tx
        .select({
          verificationLevel: barcodeVerifications.verificationLevel,
          verificationCount: barcodeVerifications.verificationCount,
          consensusNutritionData: barcodeVerifications.consensusNutritionData,
        })
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      return {
        verificationLevel: current?.verificationLevel ?? "unverified",
        verificationCount: current?.verificationCount ?? 0,
        consensusNutritionData:
          (current?.consensusNutritionData as ConsensusNutritionData | null) ??
          null,
        isMatch,
      };
    }

    // Recompute the aggregate from the authoritative matching row set. Because
    // the lock serializes submissions for this barcode, the post-insert
    // matching set is exactly the pre-insert matching rows plus our own row
    // when it matches — no re-query needed.
    const matchingNutrition = isMatch
      ? [...existingMatchingNutrition, extractedNutrition]
      : existingMatchingNutrition;
    const matchingCount = matchingNutrition.length;

    let newLevel: string;
    if (matchingCount >= CONSENSUS_THRESHOLD) {
      newLevel = "verified";
    } else if (matchingCount >= 1) {
      newLevel = "single_verified";
    } else {
      newLevel = "unverified";
    }

    const consensusData =
      matchingCount >= CONSENSUS_THRESHOLD
        ? computeConsensus(matchingNutrition)
        : null;

    // Write the recomputed aggregate. Runs only after a new history row
    // exists; duplicate submissions return early above and never reach here.
    await tx
      .update(barcodeVerifications)
      .set({
        verificationLevel: newLevel,
        verificationCount: matchingCount,
        consensusNutritionData: consensusData as unknown as Record<
          string,
          unknown
        > | null,
        updatedAt: new Date(),
      })
      .where(eq(barcodeVerifications.barcode, barcode));

    return {
      verificationLevel: newLevel,
      verificationCount: matchingCount,
      consensusNutritionData: consensusData,
      isMatch,
    };
  });
}

/** Check if a user has already submitted a front-label scan for a barcode */
export async function hasUserFrontLabelScanned(
  barcode: string,
  userId: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ frontLabelScanned: verificationHistory.frontLabelScanned })
    .from(verificationHistory)
    .where(
      and(
        eq(verificationHistory.barcode, barcode),
        eq(verificationHistory.userId, userId),
      ),
    );
  return existing?.frontLabelScanned ?? false;
}

/**
 * Store front-label data and mark user's history in a single transaction.
 * Matches the atomicity pattern used by submitVerification.
 */
export async function confirmFrontLabelData(
  barcode: string,
  userId: string,
  data: FrontLabelData,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Store front-label data on the product-level record (overwrites previous)
    await tx
      .update(barcodeVerifications)
      .set({
        frontLabelData: data as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(barcodeVerifications.barcode, barcode));

    // Mark user's verification history entry as having completed a front-label scan
    await tx
      .update(verificationHistory)
      .set({
        frontLabelScanned: true,
        frontLabelScannedAt: new Date(),
      })
      .where(
        and(
          eq(verificationHistory.barcode, barcode),
          eq(verificationHistory.userId, userId),
        ),
      );
  });
}

/**
 * Get composite verification score for a user.
 * Back-label verification = 1.0 credit, front-label scan = 0.5 credit.
 */
export async function getUserCompositeScore(userId: string): Promise<{
  verificationCount: number;
  frontLabelCount: number;
  compositeScore: number;
}> {
  const [result] = await db
    .select({
      verificationCount: sql<number>`count(*)::int`,
      frontLabelCount: sql<number>`count(*) filter (where ${verificationHistory.frontLabelScanned} = true)::int`,
    })
    .from(verificationHistory)
    .where(eq(verificationHistory.userId, userId));

  const verificationCount = result?.verificationCount ?? 0;
  const frontLabelCount = result?.frontLabelCount ?? 0;
  const compositeScore = verificationCount + frontLabelCount * 0.5;

  return { verificationCount, frontLabelCount, compositeScore };
}
