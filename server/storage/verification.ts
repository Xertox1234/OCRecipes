import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { barcodeVerifications, verificationHistory } from "@shared/schema";
import type { ConsensusNutritionData } from "@shared/types/verification";
import type { FrontLabelData } from "@shared/types/front-label";
import type { VerificationNutrition } from "../services/verification-comparison";

/** Get the verification status for a barcode */
export async function getVerification(barcode: string) {
  const [result] = await db
    .select()
    .from(barcodeVerifications)
    .where(eq(barcodeVerifications.barcode, barcode));
  return result ?? null;
}

/** Get all verification history entries for a barcode */
export async function getVerificationHistory(barcode: string) {
  return db
    .select()
    .from(verificationHistory)
    .where(eq(verificationHistory.barcode, barcode));
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
  // Get counts (back-label + front-label)
  const [countResult] = await db
    .select({
      count: sql<number>`count(*)::int`,
      frontLabelCount: sql<number>`count(*) filter (where ${verificationHistory.frontLabelScanned} = true)::int`,
    })
    .from(verificationHistory)
    .where(eq(verificationHistory.userId, userId));
  const count = countResult?.count ?? 0;
  const frontLabelCount = countResult?.frontLabelCount ?? 0;
  const compositeScore = count + frontLabelCount * 0.5;

  if (count === 0)
    return { count: 0, frontLabelCount: 0, compositeScore: 0, streak: 0 };

  // Get distinct activity dates (UTC), ordered most recent first.
  // Query back-label dates and front-label dates separately, then merge in JS.
  // This ensures both verification day and front-label scan day count as
  // separate activity days for streak purposes (GREATEST would collapse them).
  const backLabelDates = await db
    .select({
      day: sql<string>`DATE(${verificationHistory.createdAt} AT TIME ZONE 'UTC')`,
    })
    .from(verificationHistory)
    .where(eq(verificationHistory.userId, userId))
    .groupBy(sql`DATE(${verificationHistory.createdAt} AT TIME ZONE 'UTC')`);

  const frontLabelDates = await db
    .select({
      day: sql<string>`DATE(${verificationHistory.frontLabelScannedAt} AT TIME ZONE 'UTC')`,
    })
    .from(verificationHistory)
    .where(
      and(
        eq(verificationHistory.userId, userId),
        sql`${verificationHistory.frontLabelScannedAt} IS NOT NULL`,
      ),
    )
    .groupBy(
      sql`DATE(${verificationHistory.frontLabelScannedAt} AT TIME ZONE 'UTC')`,
    );

  // Merge and deduplicate dates, sort descending
  const dateSet = new Set<string>();
  for (const row of backLabelDates) dateSet.add(row.day);
  for (const row of frontLabelDates) dateSet.add(row.day);
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

/**
 * Submit a verification: record history entry and update barcode status.
 * All writes wrapped in a single transaction for atomicity.
 */
export async function submitVerification(
  barcode: string,
  userId: string,
  extractedNutrition: VerificationNutrition,
  ocrConfidence: number,
  isMatch: boolean,
  newLevel: string,
  newCount: number,
  consensusData: ConsensusNutritionData | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Insert verification history entry
    await tx.insert(verificationHistory).values({
      barcode,
      userId,
      extractedNutrition: extractedNutrition as unknown as Record<
        string,
        unknown
      >,
      ocrConfidence: ocrConfidence.toFixed(2),
      isMatch,
    });

    // Upsert barcode verification status
    await tx
      .insert(barcodeVerifications)
      .values({
        barcode,
        verificationLevel: newLevel,
        verificationCount: newCount,
        consensusNutritionData: consensusData as unknown as Record<
          string,
          unknown
        > | null,
      })
      .onConflictDoUpdate({
        target: barcodeVerifications.barcode,
        set: {
          verificationLevel: newLevel,
          verificationCount: newCount,
          consensusNutritionData: consensusData as unknown as Record<
            string,
            unknown
          > | null,
          updatedAt: new Date(),
        },
      });
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
