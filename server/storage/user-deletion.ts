import {
  users,
  communityRecipes,
  cookbookRecipes,
  favouriteRecipes,
  savedItems,
  recipeDismissals,
  verificationHistory,
  barcodeVerifications,
  transactions,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { logger, toError } from "../lib/logger";
import { removeFromIndex } from "../lib/search-index";
import { lockBarcodes, recomputeAggregatesForBarcodes } from "./verification";

// Account deletion, split out of users.ts (pure move). users.ts re-exports
// both symbols, so the storage facade and existing imports are unchanged.

/**
 * Most barcodes `deleteUser` locks inside the deletion transaction. Each lock
 * holds a slot in Postgres's shared lock table until commit; past this a
 * deletion could fail with "out of shared memory", so the aggregates are
 * recomputed after commit instead, this many barcodes per transaction.
 */
export const DELETE_USER_LOCK_THRESHOLD = 1000;

/**
 * Permanently delete a user and all associated data.
 * Relies on ON DELETE CASCADE foreign keys to clean up child tables, except
 * store purchases (`transactions`), which are kept anonymised (see below).
 * Community recipes (which use SET NULL) are explicitly deleted first.
 */
export async function deleteUser(id: string): Promise<boolean> {
  // Collect recipe IDs before the transaction so we can evict from the
  // in-memory search index AFTER commit — side effects inside the callback
  // fire before the transaction commits and can't be rolled back if the
  // subsequent tx.delete(users) throws. (See docs/legacy-patterns/database.md
  // "Side-Effect Ordering Around db.transaction".)
  const orphanedRecipes = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(eq(communityRecipes.authorId, id));

  let votedBarcodes: string[] = [];
  const deleted = await db.transaction(async (tx) => {
    if (orphanedRecipes.length > 0) {
      const recipeIds = orphanedRecipes.map((r) => r.id);
      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, recipeIds),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );
      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            inArray(favouriteRecipes.recipeId, recipeIds),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );
      // Same polymorphic cleanup as deleteCommunityRecipe — these rows
      // belong to OTHER users and have no FK to cascade.
      await tx
        .delete(savedItems)
        .where(
          and(
            inArray(savedItems.recipeId, recipeIds),
            eq(savedItems.recipeType, "community"),
          ),
        );
      await tx
        .delete(recipeDismissals)
        .where(
          and(
            inArray(recipeDismissals.recipeIdentifier, recipeIds.map(String)),
            eq(recipeDismissals.source, "community"),
          ),
        );
      await tx
        .delete(communityRecipes)
        .where(eq(communityRecipes.authorId, id));
    }

    // verification_history cascades with the user; remember which barcodes
    // that touches so their stored aggregates can be recomputed after.
    votedBarcodes = [
      ...new Set(
        (
          await tx
            .select({ barcode: verificationHistory.barcode })
            .from(verificationHistory)
            .where(eq(verificationHistory.userId, id))
        ).map((r) => r.barcode),
      ),
    ];
    const recomputeHere = votedBarcodes.length <= DELETE_USER_LOCK_THRESHOLD;

    // Lock before the user-row delete: a concurrent submitVerification holds
    // this lock and then needs a key-share on the user row we are deleting.
    // Past the threshold no barcode lock is held here, so there is nothing
    // for that submit to deadlock against.
    if (recomputeHere) await lockBarcodes(tx, votedBarcodes);

    // Front-label data stored before the route stopped recording the scanner
    // carries the user's id in JSON, on a shared product row with no FK to
    // cascade (privacy audit 2026-11-10, L1). The rest of the label stays.
    await tx
      .update(barcodeVerifications)
      .set({
        frontLabelData: sql`${barcodeVerifications.frontLabelData} - 'scannedByUserId'`,
      })
      .where(
        sql`${barcodeVerifications.frontLabelData}->>'scannedByUserId' = ${id}`,
      );

    // Store purchases outlive the account (migration 0038: the FK sets
    // user_id NULL) so a refunded purchase cannot be replayed on a new
    // account. Keep only the store transaction id and its refund state.
    // updatedAt is left alone: a legacy revoked row without revokedAt uses it
    // as its refund cutoff (isRevokedForReceipt).
    await tx
      .update(transactions)
      .set({ receipt: "" })
      .where(eq(transactions.userId, id));

    const result = await tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (result.length > 0 && recomputeHere && votedBarcodes.length > 0) {
      await recomputeAggregatesForBarcodes(tx, votedBarcodes);
    }
    return result.length > 0;
  });

  // Past the threshold: the user's history rows are gone, so each batch
  // recomputes from what remains under its own locks. The account is already
  // deleted, so a failed batch is logged (its aggregates stay stale) rather
  // than failing the request.
  if (deleted && votedBarcodes.length > DELETE_USER_LOCK_THRESHOLD) {
    const sorted = [...votedBarcodes].sort();
    for (let i = 0; i < sorted.length; i += DELETE_USER_LOCK_THRESHOLD) {
      const batch = sorted.slice(i, i + DELETE_USER_LOCK_THRESHOLD);
      try {
        await db.transaction((tx) => recomputeAggregatesForBarcodes(tx, batch));
      } catch (err) {
        logger.error(
          { err: toError(err), userId: id, barcodes: batch.length },
          "deleteUser: barcode aggregate recompute failed",
        );
      }
    }
  }

  // Post-commit: evict deleted recipes from the MiniSearch index so they
  // stop surfacing in search results. Only fires when the transaction succeeded.
  if (deleted && orphanedRecipes.length > 0) {
    for (const recipe of orphanedRecipes) {
      removeFromIndex(`community:${recipe.id}`);
    }
  }

  return deleted;
}
