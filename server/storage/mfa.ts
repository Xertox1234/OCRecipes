import {
  mfaChallenges,
  mfaEmailCodes,
  mfaTrustedDevices,
  userMfa,
  users,
  type MfaChallenge,
} from "@shared/schema";
import {
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_EMAIL_CODE_TTL_MINUTES,
  MFA_LOCK_EVERY_FAILURES,
  MFA_LOCK_MINUTES,
  MFA_TRUST_DAYS,
} from "@shared/constants/mfa";
import { db } from "../db";
import { and, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";

// Second factor (an emailed code; the codes themselves are in mfa-email.ts) —
// spec docs/superpowers/specs/2026-10-10-totp-second-factor-design.md.
// Every expiry / counter / single-use check is ONE atomic statement on the
// database clock (now()), the pattern of password-reset.ts. Multi-row changes
// run in one transaction.

/** Rolls a transaction back when its guarded first write matched nothing. */
export class GuardFailed extends Error {}

export async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GuardFailed) return undefined;
    throw err;
  }
}

const notLocked = or(
  isNull(userMfa.lockedUntil),
  lte(userMfa.lockedUntil, sql`now()`),
);

/**
 * One failed second-factor check. Every MFA_LOCK_EVERY_FAILURES-th consecutive
 * failure locks for MFA_LOCK_MINUTES; the count never resets on lock (plan
 * deviation 1). A failure while locked is not counted. `tripped` is true
 * exactly once per lock — the row lock serialises concurrent calls, and each
 * re-evaluates the lock after the previous commit.
 */
export async function recordMfaFailure(
  userId: string,
): Promise<{ failedAttempts: number; tripped: boolean }> {
  const next = sql`${userMfa.failedAttempts} + 1`;
  const [row] = await db
    .update(userMfa)
    .set({
      failedAttempts: next,
      lockedUntil: sql`CASE WHEN (${next}) % ${MFA_LOCK_EVERY_FAILURES} = 0
        THEN now() + (${MFA_LOCK_MINUTES} * interval '1 minute')
        ELSE ${userMfa.lockedUntil} END`,
    })
    // A lock refuses without counting (audit L10): a concurrent burst of wrong
    // guesses cannot pile up failures during a lock.
    .where(and(eq(userMfa.userId, userId), notLocked))
    .returning({ failedAttempts: userMfa.failedAttempts });
  if (!row) return { failedAttempts: 0, tripped: false };
  return {
    failedAttempts: row.failedAttempts,
    tripped: row.failedAttempts % MFA_LOCK_EVERY_FAILURES === 0,
  };
}

/** Turn MFA off: every MFA row goes, and every session ends. */
export async function disableMfa(
  userId: string,
  // clearPendingEmail: the manual reset (scripts/mfa-reset.ts) is account
  // recovery, so like every password change it drops a staged email change
  // (its link is a JWT that tokenVersion cannot cancel).
  opts: { clearPendingEmail?: boolean } = {},
): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    await Promise.all([
      tx.delete(userMfa).where(eq(userMfa.userId, userId)),
      tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId)),
      tx.delete(mfaTrustedDevices).where(eq(mfaTrustedDevices.userId, userId)),
      tx.delete(mfaEmailCodes).where(eq(mfaEmailCodes.userId, userId)),
    ]);
    const [u] = await tx
      .update(users)
      .set({
        mfaEnabledAt: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        ...(opts.clearPendingEmail ? { pendingEmail: null } : {}),
      })
      .where(eq(users.id, userId))
      .returning({ tokenVersion: users.tokenVersion });
    return u?.tokenVersion;
  });
}

export interface NewMfaChallenge {
  tokenHash: string;
  userId: string;
  tokenVersion: number;
  purpose: "login" | "link";
  linkTicketHash?: string;
  linkMarkEmailVerified?: boolean;
  /** A link challenge never outlives its pending link row. */
  notAfter?: Date;
}

/** A challenge lives as long as the emailed code it waits for. */
export async function createMfaChallenge(c: NewMfaChallenge): Promise<void> {
  const ttl = sql`now() + (${MFA_EMAIL_CODE_TTL_MINUTES} * interval '1 minute')`;
  const expiresAt = c.notAfter
    ? sql`LEAST(${ttl}, ${c.notAfter.toISOString()}::timestamptz)`
    : ttl;
  await db
    .delete(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.userId, c.userId),
        lte(mfaChallenges.expiresAt, sql`now()`),
      ),
    );
  await db.insert(mfaChallenges).values({
    tokenHash: c.tokenHash,
    userId: c.userId,
    tokenVersion: c.tokenVersion,
    purpose: c.purpose,
    linkTicketHash: c.linkTicketHash ?? null,
    linkMarkEmailVerified: c.linkMarkEmailVerified ?? false,
    expiresAt,
  });
}

/** Count one attempt against a live challenge; undefined once dead or spent. */
export async function reserveMfaChallengeAttempt(
  tokenHash: string,
): Promise<MfaChallenge | undefined> {
  const [row] = await db
    .update(mfaChallenges)
    .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
    .where(
      and(
        eq(mfaChallenges.tokenHash, tokenHash),
        gt(mfaChallenges.expiresAt, sql`now()`),
        lt(mfaChallenges.attempts, MFA_CHALLENGE_MAX_ATTEMPTS),
      ),
    )
    .returning();
  return row;
}

/** Single use: exactly one caller gets true. */
export async function consumeMfaChallenge(tokenHash: string): Promise<boolean> {
  const [row] = await db
    .delete(mfaChallenges)
    .where(eq(mfaChallenges.tokenHash, tokenHash))
    .returning({ tokenHash: mfaChallenges.tokenHash });
  return Boolean(row);
}

export async function trustDevice(
  userId: string,
  keyHash: string,
): Promise<void> {
  await db
    .delete(mfaTrustedDevices)
    .where(
      and(
        eq(mfaTrustedDevices.userId, userId),
        lte(mfaTrustedDevices.expiresAt, sql`now()`),
      ),
    );
  await db.insert(mfaTrustedDevices).values({
    userId,
    keyHash,
    expiresAt: sql`now() + (${MFA_TRUST_DAYS} * interval '1 day')`,
  });
}

/** Keys are per user: another account's key never matches. */
export async function isTrustedDevice(
  userId: string,
  keyHash: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: mfaTrustedDevices.id })
    .from(mfaTrustedDevices)
    .where(
      and(
        eq(mfaTrustedDevices.userId, userId),
        eq(mfaTrustedDevices.keyHash, keyHash),
        gt(mfaTrustedDevices.expiresAt, sql`now()`),
      ),
    );
  return Boolean(row);
}

export async function forgetTrustedDevices(userId: string): Promise<void> {
  await db
    .delete(mfaTrustedDevices)
    .where(eq(mfaTrustedDevices.userId, userId));
}
