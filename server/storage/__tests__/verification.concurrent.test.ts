/**
 * Multi-connection concurrency test for `submitVerification`.
 *
 * This file deliberately does NOT mock `../../db` and does NOT use
 * `test/db-test-utils` (savepoint isolation). Both would force every call
 * onto a single connection, which cannot exercise a true concurrent-update
 * race. Instead it runs against the real connection pool: parallel
 * `submitVerification` calls naturally check out distinct pool connections,
 * so each runs as a genuine separate transaction.
 *
 * Regression target: two (or more) users verifying the SAME barcode
 * concurrently must not lose-update the aggregate `verification_count`. The
 * fix recomputes the aggregate from `verification_history` inside the
 * transaction under a per-barcode advisory lock.
 *
 * Isolation: there is no transaction rollback here — the test commits real
 * rows and cleans them up explicitly in `afterAll` (FK cascade from
 * `barcode_verifications` removes the `verification_history` children).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { barcodeVerifications, users } from "@shared/schema";
import { submitVerification } from "../verification";
import type { VerificationNutrition } from "@shared/types/verification";

const NUTRITION: VerificationNutrition = {
  calories: 200,
  protein: 10,
  totalCarbs: 25,
  totalFat: 8,
};

const createdUserIds: string[] = [];
const createdBarcodes: string[] = [];

/** Unique 13-digit barcode, prefixed 98 to avoid colliding with real data. */
function makeBarcode(): string {
  const rand = crypto.randomBytes(5).readUIntBE(0, 5) % 10_000_000_000;
  return `98${String(rand).padStart(11, "0")}`;
}

/** Insert a committed user (visible across all pool connections). */
async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `concurrent_${crypto.randomUUID()}`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

describe("submitVerification — concurrent multi-connection safety", () => {
  afterAll(async () => {
    // Cascade from barcode_verifications removes verification_history rows.
    for (const barcode of createdBarcodes) {
      await db
        .delete(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
    }
    for (const userId of createdUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }
    // Close the real pool this file opened. Vitest isolates modules per file
    // (forks pool), so this ends only this file's pool, not sibling files'.
    await pool.end();
  });

  it("does not lose-update verification_count under concurrent different-user submits", async () => {
    const barcode = makeBarcode();
    createdBarcodes.push(barcode);

    // Five distinct users verify the SAME barcode concurrently.
    const userIds = await Promise.all([
      createCommittedUser(),
      createCommittedUser(),
      createCommittedUser(),
      createCommittedUser(),
      createCommittedUser(),
    ]);

    const results = await Promise.all(
      userIds.map((userId) =>
        submitVerification(barcode, userId, NUTRITION, 0.95),
      ),
    );

    // Every submit succeeded and recorded a distinct history row.
    expect(results).toHaveLength(5);

    // The persisted aggregate count must equal the matching history-row count.
    // Without the advisory lock + post-insert recompute, concurrent writers
    // would race on a stale pre-submit count and leave this below 5.
    const [agg] = await db
      .select({
        verificationLevel: barcodeVerifications.verificationLevel,
        verificationCount: barcodeVerifications.verificationCount,
      })
      .from(barcodeVerifications)
      .where(eq(barcodeVerifications.barcode, barcode));

    expect(agg.verificationCount).toBe(5);
    // 5 matching rows is at/above CONSENSUS_THRESHOLD (3) — promoted to verified.
    expect(agg.verificationLevel).toBe("verified");

    // The final submit's returned aggregate reflects the fully-applied state.
    const maxReturnedCount = Math.max(
      ...results.map((r) => r.verificationCount),
    );
    expect(maxReturnedCount).toBe(5);
  });

  it("computes per-row isMatch under the lock for a concurrent divergent first-N burst", async () => {
    // Regression target for the per-row isMatch race: when isMatch was
    // derived from a route-level pre-transaction read, every request in a
    // concurrent first-N burst on a brand-new barcode saw `existing = []`
    // and stored its row as `isMatch = true` — even divergent scans. With
    // the comparison moved inside the advisory lock, exactly one submission
    // (the first to commit) matches against empty history, and every
    // divergent later submission is compared against that committed row and
    // stored as `isMatch = false`.
    const barcode = makeBarcode();
    createdBarcodes.push(barcode);

    const userIds = await Promise.all([
      createCommittedUser(),
      createCommittedUser(),
      createCommittedUser(),
    ]);

    // Each user submits genuinely divergent nutrition (calories far apart).
    const nutritions: VerificationNutrition[] = [
      { calories: 100, protein: 5, totalCarbs: 10, totalFat: 2 },
      { calories: 500, protein: 30, totalCarbs: 60, totalFat: 20 },
      { calories: 900, protein: 50, totalCarbs: 90, totalFat: 40 },
    ];

    const results = await Promise.all(
      userIds.map((userId, i) =>
        submitVerification(barcode, userId, nutritions[i], 0.95),
      ),
    );

    // Exactly one submission matched (the first to acquire the lock with
    // empty history); the other two diverged and were marked non-matching.
    const matchCount = results.filter((r) => r.isMatch).length;
    expect(matchCount).toBe(1);

    // The persisted aggregate counts only the single matching row.
    const [agg] = await db
      .select({
        verificationLevel: barcodeVerifications.verificationLevel,
        verificationCount: barcodeVerifications.verificationCount,
      })
      .from(barcodeVerifications)
      .where(eq(barcodeVerifications.barcode, barcode));

    expect(agg.verificationCount).toBe(1);
    expect(agg.verificationLevel).toBe("single_verified");
  });
});
