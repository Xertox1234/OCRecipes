import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { barcodeVerifications, verificationHistory } from "@shared/schema";
import type { ConsensusNutritionData } from "@shared/types/verification";
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

/** Get the total number of verifications a user has submitted */
export async function getUserVerificationCount(
  userId: string,
): Promise<number> {
  const results = await db
    .select({ id: verificationHistory.id })
    .from(verificationHistory)
    .where(eq(verificationHistory.userId, userId));
  return results.length;
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
