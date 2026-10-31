/**
 * Multi-connection race: a store renewal (or same-user re-claim) running
 * while a refund is in flight must never restore premium after the refund.
 *
 * Like verification.concurrent.test.ts, this file deliberately does NOT mock
 * `../../db` or use `test/db-test-utils` (savepoint isolation forces one
 * connection and cannot race). It commits real rows on the real pool and
 * removes them in `afterAll` (transactions FK-cascade from users).
 *
 * The interleaving is forced, not left to timing:
 *  1. A raw client C locks the user's row (`SELECT ... FOR UPDATE`).
 *  2. The real revoke starts: it reads + marks the transaction `revoked`, then
 *     blocks on C when it downgrades the user — the refund is in flight and
 *     holds the transaction row.
 *  3. The real renewal starts and blocks behind the revoke.
 *  4. C commits; the revoke commits; the renewal resumes.
 * Without a row lock on the renewal's SELECT, it had already read the
 * pre-refund `completed` snapshot and overwrote the committed refund.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import pg from "pg";
import { db, pool } from "../../db";
import { transactions, users } from "@shared/schema";
import {
  claimTransactionAndUpgrade,
  extendSubscriptionByTransactionId,
  revokeSubscriptionByTransactionId,
} from "../users";

const DAY = 24 * 60 * 60 * 1000;
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

async function createPremiumUserWithTxn(transactionId: string) {
  const [user] = await db
    .insert(users)
    .values({
      username: `iap_race_${crypto.randomUUID()}`,
      email: `iap_race_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  const claim = await claimTransactionAndUpgrade(
    {
      transactionId,
      userId: user.id,
      receipt: "receipt_race",
      platform: "apple",
      productId: "com.ocrecipes.premium.monthly",
      status: "completed",
    },
    "premium",
    new Date(Date.now() + 5 * DAY),
    new Date(Date.now() - 30 * DAY),
  );
  expect(claim.status).toBe("created");
  return user.id;
}

/** Resolve once some backend is blocked by `blockerPid`; returns its pid. */
async function waitForBlockedBy(
  client: pg.Client,
  blockerPid: number,
): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [blockerPid],
    );
    if (rows.length > 0) return rows[0].pid;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no backend became blocked by pid ${blockerPid}`);
}

const renewals = {
  "a store renewal (extendSubscriptionByTransactionId)": (
    transactionId: string,
  ) =>
    extendSubscriptionByTransactionId(
      transactionId,
      new Date(Date.now() + 60 * DAY),
      new Date(Date.now() - 2 * DAY),
    ).then((r) => r?.status),
  "a same-user re-claim (claimTransactionAndUpgrade)": (
    transactionId: string,
    userId: string,
  ) =>
    claimTransactionAndUpgrade(
      {
        transactionId,
        userId,
        receipt: "receipt_race_replay",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
      },
      "premium",
      new Date(Date.now() + 60 * DAY),
      new Date(Date.now() - 2 * DAY),
    ).then((r) => r.status),
};

describe("subscription renewal vs refund — concurrent multi-connection safety", () => {
  it.each(Object.entries(renewals))(
    "the refund wins when %s races an in-flight refund",
    async (_label, runRenewal) => {
      const transactionId = `orig_race_${crypto.randomUUID()}`;
      const userId = await createPremiumUserWithTxn(transactionId);

      const blocker = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      const observer = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await blocker.connect();
      await observer.connect();
      try {
        const {
          rows: [{ pid: blockerPid }],
        } = await blocker.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
          userId,
        ]);

        // Refund processed by the store 1 day ago: the renewal's purchase
        // (2 days ago) predates it, so it must be refused.
        const revoke = revokeSubscriptionByTransactionId(
          transactionId,
          new Date(Date.now() - 1 * DAY),
        );
        const revokePid = await waitForBlockedBy(observer, blockerPid);

        const renewal = runRenewal(transactionId, userId);
        await waitForBlockedBy(observer, revokePid);

        await blocker.query("COMMIT");
        const [revokeResult, renewalStatus] = await Promise.all([
          revoke,
          renewal,
        ]);

        expect(revokeResult).toEqual({ userId });
        expect(renewalStatus).toBe("revoked");
        const [txn] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.transactionId, transactionId));
        expect(txn.status).toBe("revoked");
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId));
        expect(user.subscriptionTier).toBe("free");
        expect(user.subscriptionExpiresAt).toBeNull();
      } finally {
        await blocker.query("ROLLBACK").catch(() => undefined);
        await blocker.end();
        await observer.end();
      }
    },
    20_000,
  );
});
