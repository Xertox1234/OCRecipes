import {
  mfaChallenges,
  mfaRecoveryCodes,
  mfaTrustedDevices,
  passwordUpgradePasses,
  userMfa,
  users,
  type MfaChallenge,
} from "@shared/schema";
import {
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_CHALLENGE_TTL_MINUTES,
  MFA_ENROLL_TTL_MINUTES,
  MFA_LOCK_EVERY_FAILURES,
  MFA_LOCK_MINUTES,
  MFA_TRUST_DAYS,
} from "@shared/constants/mfa";
import { db } from "../db";
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

// Second factor — spec docs/superpowers/specs/2026-10-10-totp-second-factor-design.md.
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

const pendingLive = and(
  isNotNull(userMfa.pendingSecretEnc),
  gt(userMfa.pendingExpiresAt, sql`now()`),
);

const notLocked = or(
  isNull(userMfa.lockedUntil),
  lte(userMfa.lockedUntil, sql`now()`),
);

/**
 * Stage a candidate secret (first setup, or a new phone). The active secret is
 * untouched. Stages only while the account is still in the MFA state the
 * caller checked (`mfaEnabled`: false = setup, true = new phone) — the user
 * row is locked, so a setup racing the owner's confirm can no longer leave a
 * pending secret on an MFA-on account that a bare session could then confirm
 * as a "new phone" (audit L13). Returns false when the state has changed.
 * Lock order is users → user_mfa (as confirmNewPhone); a rare race with
 * confirmTotpEnrollment's opposite order is a Postgres deadlock abort — one
 * request errors and is retried, nothing is staged wrongly.
 */
export async function startTotpEnrollment(
  userId: string,
  pendingSecretEnc: string,
  expected: { mfaEnabled: boolean },
): Promise<boolean> {
  const expires = sql`now() + (${MFA_ENROLL_TTL_MINUTES} * interval '1 minute')`;
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({ mfaEnabledAt: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!u || (u.mfaEnabledAt !== null) !== expected.mfaEnabled) return false;
    await tx
      .insert(userMfa)
      .values({ userId, pendingSecretEnc, pendingExpiresAt: expires })
      .onConflictDoUpdate({
        target: userMfa.userId,
        set: { pendingSecretEnc, pendingExpiresAt: expires },
      });
    return true;
  });
}

export async function getPendingTotpSecret(
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ enc: userMfa.pendingSecretEnc })
    .from(userMfa)
    // Unavailable while locked: confirm counts wrong codes toward the same
    // lock as every other factor check (spec §6, audit L9).
    .where(and(eq(userMfa.userId, userId), pendingLive, notLocked));
  return row?.enc ?? undefined;
}

/** Pending → active secret, with the replay floor and counters reset. */
const PROMOTE_PENDING = (acceptedStep: number) => ({
  totpSecretEnc: sql`${userMfa.pendingSecretEnc}`,
  totpLastStep: acceptedStep,
  pendingSecretEnc: null,
  pendingExpiresAt: null,
  failedAttempts: 0,
  lockedUntil: null,
});

/**
 * First setup. Guarded on a live pending secret AND MFA being off; returns the
 * new tokenVersion (every other session ends), or undefined when the guard fails.
 * Through a short password's pass (password policy spec §6) the pass is
 * consumed in this same transaction and the account's tokenVersion must still
 * be the pass's, so a double submit can't enrol twice or mint two sessions.
 */
export async function confirmTotpEnrollment(
  userId: string,
  opts: {
    acceptedStep: number;
    recoveryHashes: string[];
    upgradePass?: { idHash: string; tokenVersion: number };
  },
): Promise<number | undefined> {
  const pass = opts.upgradePass;
  return guarded(() =>
    db.transaction(async (tx) => {
      if (pass) {
        const [consumed] = await tx
          .update(passwordUpgradePasses)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(passwordUpgradePasses.idHash, pass.idHash),
              eq(passwordUpgradePasses.userId, userId),
              isNull(passwordUpgradePasses.consumedAt),
              gt(passwordUpgradePasses.expiresAt, sql`now()`),
            ),
          )
          .returning({ idHash: passwordUpgradePasses.idHash });
        if (!consumed) throw new GuardFailed();
      }
      const [promoted] = await tx
        .update(userMfa)
        .set(PROMOTE_PENDING(opts.acceptedStep))
        .where(and(eq(userMfa.userId, userId), pendingLive))
        .returning({ userId: userMfa.userId });
      if (!promoted) throw new GuardFailed();
      const [u] = await tx
        .update(users)
        .set({
          mfaEnabledAt: sql`now()`,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(
          and(
            eq(users.id, userId),
            isNull(users.mfaEnabledAt),
            pass ? eq(users.tokenVersion, pass.tokenVersion) : undefined,
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!u) throw new GuardFailed();
      await tx
        .delete(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, userId));
      if (opts.recoveryHashes.length > 0) {
        await tx.insert(mfaRecoveryCodes).values(
          [...new Set(opts.recoveryHashes)].map((codeHash) => ({
            userId,
            codeHash,
          })),
        );
      }
      return u.tokenVersion;
    }),
  );
}

/**
 * New phone on an account that already has MFA. Recovery codes are kept;
 * trusted phones are forgotten. Returns the new tokenVersion or undefined.
 */
export async function confirmNewPhone(
  userId: string,
  opts: { acceptedStep: number },
): Promise<number | undefined> {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(and(eq(users.id, userId), isNotNull(users.mfaEnabledAt)))
        .returning({ tokenVersion: users.tokenVersion });
      if (!u) throw new GuardFailed();
      const [promoted] = await tx
        .update(userMfa)
        .set(PROMOTE_PENDING(opts.acceptedStep))
        .where(and(eq(userMfa.userId, userId), pendingLive))
        .returning({ userId: userMfa.userId });
      if (!promoted) throw new GuardFailed();
      await tx
        .delete(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, userId));
      return u.tokenVersion;
    }),
  );
}

export async function getActiveTotp(
  userId: string,
): Promise<
  { secretEnc: string; failedAttempts: number; locked: boolean } | undefined
> {
  const [row] = await db
    .select({
      secretEnc: userMfa.totpSecretEnc,
      failedAttempts: userMfa.failedAttempts,
      locked: sql<boolean>`coalesce(${userMfa.lockedUntil} > now(), false)`,
    })
    .from(userMfa)
    .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.totpSecretEnc)));
  if (!row?.secretEnc) return undefined;
  return {
    secretEnc: row.secretEnc,
    failedAttempts: row.failedAttempts,
    locked: row.locked,
  };
}

/** Accept a matched TOTP step once (replay guard); refused while locked. Resets failures. */
export async function acceptTotpStep(
  userId: string,
  step: number,
): Promise<boolean> {
  const [row] = await db
    .update(userMfa)
    .set({ totpLastStep: step, failedAttempts: 0, lockedUntil: null })
    .where(
      and(
        eq(userMfa.userId, userId),
        isNotNull(userMfa.totpSecretEnc),
        or(isNull(userMfa.totpLastStep), lt(userMfa.totpLastStep, step)),
        notLocked,
      ),
    )
    .returning({ userId: userMfa.userId });
  return Boolean(row);
}

/**
 * One failed second-factor check. Every MFA_LOCK_EVERY_FAILURES-th consecutive
 * failure locks for MFA_LOCK_MINUTES; the count never resets on lock, so it can
 * reach MFA_TOTP_FAILURE_CAP (plan deviation 1). A failure while locked is not
 * counted. `tripped` is true exactly once per lock — the row lock serialises
 * concurrent calls, and each re-evaluates the lock after the previous commit.
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
    // guesses can no longer race failed_attempts past the cap during a lock.
    .where(and(eq(userMfa.userId, userId), notLocked))
    .returning({ failedAttempts: userMfa.failedAttempts });
  if (!row) return { failedAttempts: 0, tripped: false };
  return {
    failedAttempts: row.failedAttempts,
    tripped: row.failedAttempts % MFA_LOCK_EVERY_FAILURES === 0,
  };
}

/**
 * Spend a recovery code and store its replacement in one transaction. Refused
 * (false, nothing written) while the second factor is locked. Resets failures.
 */
export async function consumeRecoveryCode(
  userId: string,
  codeHash: string,
  replacementHash: string,
): Promise<boolean> {
  const done = await guarded(() =>
    db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(mfaRecoveryCodes)
        .where(
          and(
            eq(mfaRecoveryCodes.userId, userId),
            eq(mfaRecoveryCodes.codeHash, codeHash),
            sql`NOT EXISTS (SELECT 1 FROM ${userMfa}
              WHERE ${userMfa.userId} = ${userId}
                AND ${userMfa.lockedUntil} > now())`,
          ),
        )
        .returning({ id: mfaRecoveryCodes.id });
      if (!deleted) throw new GuardFailed();
      await tx
        .insert(mfaRecoveryCodes)
        .values({ userId, codeHash: replacementHash });
      await tx
        .update(userMfa)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(userMfa.userId, userId));
      return true;
    }),
  );
  return done === true;
}

export async function replaceRecoveryCodes(
  userId: string,
  hashes: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    if (hashes.length > 0) {
      await tx
        .insert(mfaRecoveryCodes)
        .values([...new Set(hashes)].map((codeHash) => ({ userId, codeHash })));
    }
  });
}

/** Turn MFA off: every MFA row goes, and every session ends. */
/**
 * Turn two-step off. With `newPasswordHash` (a password under 15 must be
 * replaced in the same step, spec §5.4) the password changes in the same
 * transaction, and a staged email change is dropped: its link is a JWT that
 * tokenVersion cannot cancel.
 */
export async function disableMfa(
  userId: string,
  // clearPendingEmail: the manual reset (scripts/mfa-reset.ts) is account
  // recovery, so like every password change it drops a staged email change.
  opts: { newPasswordHash?: string; clearPendingEmail?: boolean } = {},
): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    await Promise.all([
      tx.delete(userMfa).where(eq(userMfa.userId, userId)),
      tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId)),
      tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId)),
      tx.delete(mfaTrustedDevices).where(eq(mfaTrustedDevices.userId, userId)),
    ]);
    const [u] = await tx
      .update(users)
      .set({
        mfaEnabledAt: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        ...(opts.newPasswordHash ? { password: opts.newPasswordHash } : {}),
        ...(opts.newPasswordHash || opts.clearPendingEmail
          ? { pendingEmail: null }
          : {}),
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

export async function createMfaChallenge(c: NewMfaChallenge): Promise<void> {
  const ttl = sql`now() + (${MFA_CHALLENGE_TTL_MINUTES} * interval '1 minute')`;
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
