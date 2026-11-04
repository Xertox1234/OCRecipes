import {
  type User,
  type Transaction,
  type InsertTransaction,
  users,
  transactions,
} from "@shared/schema";
import type { SubscriptionTier } from "@shared/types/premium";
import { db } from "../db";
import { eq, and, gt, isNull, lt, ne, or, sql } from "drizzle-orm";

// ============================================================================
// TRANSACTIONS
// ============================================================================

export async function getTransaction(
  transactionId: string,
): Promise<Transaction | undefined> {
  const [txn] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.transactionId, transactionId));
  return txn || undefined;
}

export async function createTransaction(
  data: InsertTransaction,
): Promise<Transaction> {
  const [txn] = await db.insert(transactions).values(data).returning();
  return txn;
}

export type ClaimResult =
  | { status: "created"; transaction: Transaction; user: User }
  | { status: "renewed"; transaction: Transaction; user: User }
  | { status: "conflict"; existingUserId: string }
  | { status: "revoked" };

/**
 * True when a refunded/revoked transaction row must NOT be re-activated by the
 * incoming receipt. A client-supplied receipt is a static snapshot, so one
 * captured before the refund carries no revocationDate and still validates.
 * Only a purchase made AFTER the revocation (an Apple re-subscription reuses
 * the same originalTransactionId) may bring the row back; with no purchase
 * date to compare we fail closed. The cutoff is the STORE's revocation time
 * (`revokedAt`), not when we processed the notification — a late delivery must
 * not refuse a purchase made in between. Legacy rows without it fall back to
 * `updatedAt`.
 */
function isRevokedForReceipt(
  existing: Transaction,
  purchasedAt: Date | null | undefined,
): boolean {
  if (existing.status !== "revoked") return false;
  const cutoff = existing.revokedAt ?? existing.updatedAt;
  return !purchasedAt || purchasedAt.getTime() <= cutoff.getTime();
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The renewal write shared by a same-user re-claim and a store renewal
 * notification: set the tier and extend expiry MONOTONICALLY. GREATEST keeps
 * expiry from moving BACKWARD on a stale / out-of-order receipt (Apple emits
 * the renewal txn ~24h before the period ends, so both validate during the
 * overlap), and it ignores a NULL incoming, so it never wipes an existing date.
 */
async function applyRenewalInTx(
  tx: Tx,
  userId: string,
  tier: SubscriptionTier,
  expiresAt: Date | null,
): Promise<User> {
  const [user] = await tx
    .update(users)
    .set({
      subscriptionTier: tier,
      subscriptionExpiresAt: sql`GREATEST(${users.subscriptionExpiresAt}, ${expiresAt})`,
    })
    .where(eq(users.id, userId))
    .returning();
  if (!user) {
    throw new Error(`User ${userId} not found during subscription renewal`);
  }
  return user;
}

/**
 * Claim a subscription for a user, keyed by the validated receipt's STABLE id
 * (`data.transactionId` = Apple `originalTransactionId` / Google purchaseToken,
 * derived server-side — never client-supplied). The global unique constraint on
 * `transactions.transactionId` enforces anti-sharing:
 *  - first claim of an id        → `created` (insert + upgrade)
 *  - same user re-claims the id  → `renewed` (a renewal carries the same id with
 *                                  a later expiry; refresh receipt + tier/expiry)
 *  - a different user claims it   → `conflict` (no writes; the caller rejects)
 *  - same user, row was refunded/revoked and the receipt was purchased before
 *    that (`purchasedAt`)          → `revoked` (no writes; fail closed)
 *
 * Atomic: the transaction write and the user upgrade succeed or roll back
 * together. `onConflictDoNothing()` (no target — the only non-PK unique is
 * `transactionId`) makes the constraint the arbiter for concurrent claims.
 */
export async function claimTransactionAndUpgrade(
  data: InsertTransaction,
  tier: SubscriptionTier,
  expiresAt: Date | null,
  purchasedAt?: Date | null,
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(transactions)
      .values(data)
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      const [user] = await tx
        .update(users)
        .set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt })
        .where(eq(users.id, data.userId))
        .returning();
      if (!user) {
        throw new Error(
          `User ${data.userId} not found during subscription claim`,
        );
      }
      return { status: "created", transaction: inserted, user };
    }

    // Conflict: a row already holds this transactionId. Lock it so a refund
    // committing concurrently is seen (and never overwritten) below.
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, data.transactionId))
      .for("update");

    // Different account (or a vanished row) — never grant entitlement.
    if (!existing || existing.userId !== data.userId) {
      return { status: "conflict", existingUserId: existing?.userId ?? "" };
    }

    // A replayed pre-refund receipt must never flip a revoked row back.
    if (isRevokedForReceipt(existing, purchasedAt)) {
      return { status: "revoked" };
    }

    // Same user re-claiming — a renewal. Refresh the stored receipt and extend
    // the user's expiry (monotonic; see applyRenewalInTx).
    const [txn] = await tx
      .update(transactions)
      .set({
        receipt: data.receipt,
        status: data.status ?? "completed",
        revokedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(transactions.transactionId, data.transactionId))
      .returning();
    const user = await applyRenewalInTx(tx, data.userId, tier, expiresAt);
    return { status: "renewed", transaction: txn, user };
  });
}

/**
 * Extend a subscription from a store RENEWAL notification (Apple DID_RENEW /
 * Google SUBSCRIPTION_RENEWED|RECOVERED), keyed by its stable transaction id.
 * `expiresAt` must come from store-verified data (the notification's signed
 * transaction, or a live Play API read), never from a client.
 *
 * Applies the same rules as a same-user re-claim in claimTransactionAndUpgrade:
 *  - unknown id                        → `null` (no writes; the receipt flow
 *                                        has not stored it yet)
 *  - row revoked and the renewal was purchased before that (or no purchase
 *    date)                             → `revoked` (no writes; fail closed)
 *  - otherwise                         → `extended`: tier premium, expiry
 *    GREATEST(current, expiresAt) so an out-of-order renewal never moves it
 *    backward, and the row marked `completed`.
 *
 * Not user-scoped by design (idor-safe): like revokeSubscriptionByTransactionId
 * the store calls the webhook, the route verifies the Apple JWS / Google OIDC
 * signature first, and the globally unique transactionId resolves the owner.
 */
export async function extendSubscriptionByTransactionId( // idor-safe
  transactionId: string,
  expiresAt: Date,
  purchasedAt?: Date | null,
): Promise<{ status: "extended" | "revoked"; userId: string } | null> {
  return db.transaction(async (tx) => {
    // Row lock: serializes renewal / refund / expiry on this transaction so a
    // renewal never overwrites a concurrently committed refund.
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId))
      .for("update");

    if (!txn) return null;

    if (isRevokedForReceipt(txn, purchasedAt)) {
      return { status: "revoked", userId: txn.userId };
    }

    await tx
      .update(transactions)
      .set({ status: "completed", revokedAt: null, updatedAt: new Date() })
      .where(eq(transactions.transactionId, transactionId));
    await applyRenewalInTx(tx, txn.userId, "premium", expiresAt);
    return { status: "extended", userId: txn.userId };
  });
}

/**
 * Revoke a subscription identified by its stable transaction id (Apple
 * `originalTransactionId` / Google `purchaseToken`) — used by the store
 * refund/revoke/expire webhooks. Atomically downgrades the owning user to
 * `free` and marks the transaction `revoked`, recording `revokedAt` — the
 * STORE's revocation time when given (else now). A repeat revoke never moves
 * an existing `revokedAt` later (LEAST). Idempotent: an unknown id is a
 * no-op (returns `null`); re-revoking is a no-op. Returns the affected userId
 * so the caller can evict the tier cache.
 *
 * Not user-scoped by design (idor-safe): the store calls the webhook, so there
 * is no authenticated user to scope by. The route verifies the Apple JWS /
 * Google OIDC signature BEFORE calling — the signature is the authorization, an
 * external caller cannot reach this with an arbitrary id, and the globally
 * unique transactionId is what resolves the owning user.
 */
export async function revokeSubscriptionByTransactionId( // idor-safe
  transactionId: string,
  revokedAt?: Date,
): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    // Row lock: serializes renewal / refund / expiry on this transaction so a
    // renewal never overwrites a concurrently committed refund.
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId))
      .for("update");

    if (!txn) return null;

    await tx
      .update(transactions)
      .set({
        status: "revoked",
        revokedAt: sql`LEAST(${transactions.revokedAt}, ${revokedAt ?? new Date()})`,
        updatedAt: new Date(),
      })
      .where(eq(transactions.transactionId, transactionId));

    await downgradeIfActiveSourceInTx(tx, txn);
    return { userId: txn.userId };
  });
}

/**
 * Downgrade the owning user ONLY if `txn` was their active entitlement source
 * (shared by a refund/revoke and a plain expiry).
 */
async function downgradeIfActiveSourceInTx(
  tx: Tx,
  txn: Transaction,
): Promise<void> {
  // Downgrade the owning user ONLY if this transaction was their active
  // entitlement source. Assumption: single-tier app, at most one active
  // subscription at a time, so the newest non-revoked `completed` transaction
  // is the source. If a NEWER completed transaction exists, the user
  // re-subscribed — a stale refund of the old sub must NOT cut off a paying
  // customer. (Residual: a newer-but-expired row briefly preserves premium —
  // it fails safe and self-heals via that row's own EXPIRED event, since
  // resolveEffectiveTier also downgrades expired-premium at read time.)
  const [newerActive] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, txn.userId),
        eq(transactions.status, "completed"),
        gt(transactions.createdAt, txn.createdAt),
      ),
    )
    .limit(1);

  if (!newerActive) {
    await tx
      .update(users)
      .set({ subscriptionTier: "free", subscriptionExpiresAt: null })
      .where(eq(users.id, txn.userId));
  }
}

/**
 * Record a store EXPIRY (Apple EXPIRED / GRACE_PERIOD_EXPIRED, Google
 * SUBSCRIPTION_EXPIRED) for a stable transaction id. Unlike a refund it does
 * NOT mark the row `revoked`: the row becomes `expired` and a re-subscription
 * or late renewal re-activates it without the purchase-date gate. A row that
 * is already `revoked` stays revoked (an expiry never clears a refund). The
 * owning user is downgraded exactly as on a revoke. Returns `null` for an
 * unknown id.
 *
 * Not user-scoped by design (idor-safe): same as
 * revokeSubscriptionByTransactionId — the route verifies the store signature
 * first and the globally unique transactionId resolves the owner.
 */
export async function expireSubscriptionByTransactionId( // idor-safe
  transactionId: string,
): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    // Row lock: serializes renewal / refund / expiry on this transaction so a
    // renewal never overwrites a concurrently committed refund.
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId))
      .for("update");

    if (!txn) return null;

    await tx
      .update(transactions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(transactions.transactionId, transactionId),
          ne(transactions.status, "revoked"),
        ),
      );

    await downgradeIfActiveSourceInTx(tx, txn);

    return { userId: txn.userId };
  });
}

/**
 * Undo a refund the store REVERSED (Apple REFUND_REVERSED). The caller must
 * pass only store-verified data: the notification's signed transaction, which
 * must no longer be revoked. A `revoked` row goes back to `completed` with
 * `revokedAt` cleared; this skips the purchase-date gate because Apple's
 * signed notification itself authorizes it. Premium is re-applied (monotonic
 * expiry, see applyRenewalInTx) only while `expiresAt` is still in the
 * future — a reversed refund of an already-ended period restores the row
 * status only. A row that is not `revoked` keeps its status. Returns `null`
 * for an unknown id.
 *
 * Out-of-order guard: Apple delivers notifications out of order and retries
 * for ~72h, so a reversal signed at or before the row's `revokedAt` reverses
 * an EARLIER refund, not the one on the row. That is a no-op returning
 * `stale: true` (no status flip, no premium). A legacy revoked row with no
 * `revokedAt` cannot be ordered and is reinstated.
 *
 * Not user-scoped by design (idor-safe): same as
 * revokeSubscriptionByTransactionId.
 */
export async function reinstateSubscriptionByTransactionId( // idor-safe
  transactionId: string,
  expiresAt: Date | null,
  signedAt: Date,
): Promise<{ userId: string; stale: boolean } | null> {
  return db.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId))
      .for("update");

    if (!txn) return null;

    if (txn.revokedAt && txn.revokedAt.getTime() >= signedAt.getTime()) {
      return { userId: txn.userId, stale: true };
    }

    await tx
      .update(transactions)
      .set({ status: "completed", revokedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.transactionId, transactionId),
          eq(transactions.status, "revoked"),
          or(
            isNull(transactions.revokedAt),
            lt(transactions.revokedAt, signedAt),
          ),
        ),
      );

    if (expiresAt && expiresAt.getTime() > Date.now()) {
      await applyRenewalInTx(tx, txn.userId, "premium", expiresAt);
    }

    return { userId: txn.userId, stale: false };
  });
}
