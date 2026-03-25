import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  reformulationFlags,
  barcodeVerifications,
  verificationHistory,
} from "@shared/schema";
import type { ConsensusNutritionData } from "@shared/types/verification";

/** Get active (unflagged) reformulation flag for a barcode, if any */
export async function getReformulationFlag(barcode: string) {
  const [result] = await db
    .select()
    .from(reformulationFlags)
    .where(
      and(
        eq(reformulationFlags.barcode, barcode),
        eq(reformulationFlags.status, "flagged"),
      ),
    );
  return result ?? null;
}

/** Get all reformulation flags, optionally filtered by status */
export async function getReformulationFlags(
  status?: "flagged" | "resolved",
  limit = 50,
  offset = 0,
) {
  const conditions = status ? eq(reformulationFlags.status, status) : undefined;

  return db
    .select()
    .from(reformulationFlags)
    .where(conditions)
    .orderBy(desc(reformulationFlags.detectedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Flag a product as possibly reformulated.
 * Stores previous consensus for audit trail, then resets the product
 * to "unverified" so new verifications can build fresh consensus.
 */
export async function flagReformulation(
  barcode: string,
  divergentScanCount: number,
  previousConsensus: ConsensusNutritionData | null,
  previousLevel: string,
  previousCount: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Insert reformulation flag with audit snapshot
    await tx.insert(reformulationFlags).values({
      barcode,
      status: "flagged",
      divergentScanCount,
      previousConsensus: previousConsensus as unknown as Record<
        string,
        unknown
      > | null,
      previousVerificationLevel: previousLevel,
      previousVerificationCount: previousCount,
    });

    // Reset product verification status — keep record but clear consensus
    await tx
      .update(barcodeVerifications)
      .set({
        verificationLevel: "unverified",
        verificationCount: 0,
        consensusNutritionData: null,
        updatedAt: new Date(),
      })
      .where(eq(barcodeVerifications.barcode, barcode));

    // Mark all existing history entries as non-matching so they don't
    // pollute new consensus building
    await tx
      .update(verificationHistory)
      .set({ isMatch: false })
      .where(eq(verificationHistory.barcode, barcode));
  });
}

/** Resolve a reformulation flag. Returns true if the flag existed, false if not found. */
export async function resolveReformulationFlag(
  flagId: number,
): Promise<boolean> {
  const rows = await db
    .update(reformulationFlags)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
    })
    .where(eq(reformulationFlags.id, flagId))
    .returning({ id: reformulationFlags.id });
  return rows.length > 0;
}

/** Count reformulation flags, optionally filtered by status */
export async function getReformulationFlagCount(
  status?: "flagged" | "resolved",
): Promise<number> {
  const conditions = status ? eq(reformulationFlags.status, status) : undefined;
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reformulationFlags)
    .where(conditions);
  return result?.count ?? 0;
}
