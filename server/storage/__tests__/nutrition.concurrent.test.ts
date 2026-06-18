/**
 * Multi-connection concurrency test for `createSavedItem`.
 *
 * This file deliberately does NOT mock `../../db` and does NOT use
 * `test/db-test-utils` (savepoint isolation). Both would force every call
 * onto a single connection, which cannot exercise a true concurrent-insert
 * race. Instead it runs against the real connection pool: parallel
 * `createSavedItem` calls naturally check out distinct pool connections,
 * so each runs as a genuine separate transaction.
 *
 * Regression target: two concurrent `createSavedItem` calls for the same
 * user at the limit boundary must not both succeed. Without the
 * `pg_advisory_xact_lock` inside the transaction, READ COMMITTED lets both
 * transactions see `count = limit - 1`, both pass the gate, and both insert
 * — landing the user above the tier cap. With the lock, the two calls
 * serialize and exactly one succeeds.
 *
 * Isolation: there is no transaction rollback here — the test commits real
 * rows and cleans them up explicitly in `afterAll`. `saved_items` FK-cascades
 * from `users` on delete, so removing the user removes its saved items too.
 *
 * Modelled on `verification.concurrent.test.ts` per
 * `docs/solutions/best-practices/multi-connection-concurrency-test-harness-2026-05-17.md`.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, savedItems } from "@shared/schema";
import { TIER_FEATURES } from "@shared/types/premium";
import { createSavedItem, getSavedItemCount } from "../nutrition";

const FREE_LIMIT = TIER_FEATURES.free.maxSavedItems;

const createdUserIds: string[] = [];

/** Insert a committed user (visible across all pool connections). */
async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `saved_items_concurrent_${crypto.randomUUID()}`,
      email: `saved_items_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  // saved_items FK-cascades from users on delete, so removing the user
  // removes its saved items too.
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  // Close the real pool this file opened. Vitest isolates modules per file
  // (forks pool), so this ends only this file's pool, not sibling files'.
  await pool.end();
});

describe("createSavedItem — concurrent multi-connection safety", () => {
  it("does not exceed the tier limit under concurrent inserts at the limit boundary", async () => {
    // Loop so the race fires reliably — a single concurrent pair may not race
    // every run on a fast pool. Mirrors the ITERATIONS pattern in
    // verification.concurrent.test.ts. Each iteration uses a fresh user so
    // the previous iteration's saved_items do not perturb the next.
    const ITERATIONS = 20;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const userId = await createCommittedUser();

      // Pre-fill to limit - 1 so the next two concurrent inserts both see
      // room for exactly one more under their READ COMMITTED snapshots.
      for (let i = 0; i < FREE_LIMIT - 1; i++) {
        await db.insert(savedItems).values({
          userId,
          type: "recipe",
          title: `Preexisting ${i}`,
        });
      }

      // Race two `createSavedItem` calls for the same user. Without the
      // advisory lock, both transactions can see count = FREE_LIMIT - 1 and
      // both insert, landing the user at FREE_LIMIT + 1.
      const [a, b] = await Promise.all([
        createSavedItem(userId, { type: "recipe", title: "Race A" }),
        createSavedItem(userId, { type: "recipe", title: "Race B" }),
      ]);

      // Exactly one should succeed and one should return null (limit reached).
      const successes = [a, b].filter((r) => r !== null);
      const rejections = [a, b].filter((r) => r === null);
      expect(successes).toHaveLength(1);
      expect(rejections).toHaveLength(1);

      // Final committed count must equal the tier limit — never above.
      const finalCount = await getSavedItemCount(userId);
      expect(finalCount).toBe(FREE_LIMIT);
    }
  });
});
