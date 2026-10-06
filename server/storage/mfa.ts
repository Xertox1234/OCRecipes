import {
  users,
  userMfa,
  mfaRecoveryCodes,
  mfaChallenges,
  type MfaChallenge,
} from "@shared/schema";
import {
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_CHALLENGE_TTL_MINUTES,
  MFA_ENROLL_TTL_MINUTES,
  MFA_LOCK_EVERY_FAILURES,
  MFA_LOCK_MINUTES,
} from "@shared/constants/mfa";
import { db } from "../db";
import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  count,
} from "drizzle-orm";

// Second factor (authenticator app + recovery codes) — plan
// docs/superpowers/plans/2026-10-05-totp-second-factor.md. Like
// password-reset.ts, every expiry / attempt / replay / lock check is ONE
// atomic statement evaluated on the database clock (now()).

const notLocked = or(
  isNull(userMfa.lockedUntil),
  sql`${userMfa.lockedUntil} <= now()`,
);

/** Store (or replace) the candidate secret of a setup in progress. */
export async function startTotpEnrollment(
  userId: string,
  pendingSecretEnc: string,
): Promise<void> {
  const pendingExpiresAt = sql`now() + (${MFA_ENROLL_TTL_MINUTES} * interval '1 minute')`;
  await db
    .insert(userMfa)
    .values({ userId, pendingSecretEnc, pendingExpiresAt })
    .onConflictDoUpdate({
      target: userMfa.userId,
      set: { pendingSecretEnc, pendingExpiresAt },
    });
}

/** The unexpired candidate secret, if a setup is in progress. */
export async function getPendingTotpSecret(
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ enc: userMfa.pendingSecretEnc })
    .from(userMfa)
    .where(
      and(
        eq(userMfa.userId, userId),
        isNotNull(userMfa.pendingSecretEnc),
        sql`${userMfa.pendingExpiresAt} > now()`,
      ),
    );
  return row?.enc ?? undefined;
}

/**
 * Turn 2FA on, in ONE transaction: the unexpired candidate secret becomes the
 * active one, the confirming code's step is recorded (so it can't be replayed),
 * the recovery codes are replaced, users.mfa_enabled_at is set and
 * token_version is bumped (the caller MUST invalidateTokenVersionCache and
 * hand the current device a fresh token). Returns the new token_version, or
 * undefined when there is no live candidate or 2FA is already on.
 */
export async function confirmTotpEnrollment(
  userId: string,
  opts: { acceptedStep: number; recoveryHashes: string[] },
): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({
        mfaEnabledAt: sql`now()`,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(
        and(
          eq(users.id, userId),
          isNull(users.mfaEnabledAt),
          sql`EXISTS (SELECT 1 FROM ${userMfa} WHERE ${userMfa.userId} = ${userId}
            AND ${userMfa.pendingSecretEnc} IS NOT NULL
            AND ${userMfa.pendingExpiresAt} > now())`,
        ),
      )
      .returning({ tokenVersion: users.tokenVersion });
    if (!user) return undefined;

    await tx
      .update(userMfa)
      .set({
        totpSecretEnc: sql`${userMfa.pendingSecretEnc}`,
        totpLastStep: opts.acceptedStep,
        pendingSecretEnc: null,
        pendingExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(userMfa.userId, userId));
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    await tx.insert(mfaRecoveryCodes).values(
      [...new Set(opts.recoveryHashes)].map((codeHash) => ({
        userId,
        codeHash,
      })),
    );
    return user.tokenVersion;
  });
}

/** The active authenticator for a 2FA account; `locked` is decided in SQL. */
export async function getActiveTotp(userId: string): Promise<
  | {
      secretEnc: string;
      lastStep: number | null;
      failedAttempts: number;
      locked: boolean;
    }
  | undefined
> {
  const [row] = await db
    .select({
      secretEnc: userMfa.totpSecretEnc,
      lastStep: userMfa.totpLastStep,
      failedAttempts: userMfa.failedAttempts,
      locked: sql<boolean>`coalesce(${userMfa.lockedUntil} > now(), false)`,
    })
    .from(userMfa)
    .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.totpSecretEnc)));
  if (!row?.secretEnc) return undefined;
  return { ...row, secretEnc: row.secretEnc };
}

/**
 * Record a matched TOTP step IF it is newer than the last accepted one and the
 * account is not locked — the replay guard. A success also clears the failure
 * count and lock. Two requests with the same code: exactly one returns true.
 */
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
 * Count one failed second-factor check. Every MFA_LOCK_EVERY_FAILURES-th
 * consecutive failure locks the second factor for MFA_LOCK_MINUTES. Returns
 * the new count (0 when the account has no MFA row).
 */
export async function recordMfaFailure(userId: string): Promise<number> {
  const next = sql`${userMfa.failedAttempts} + 1`;
  const [row] = await db
    .update(userMfa)
    .set({
      failedAttempts: next,
      lockedUntil: sql`CASE WHEN (${next}) % ${MFA_LOCK_EVERY_FAILURES} = 0
        THEN now() + (${MFA_LOCK_MINUTES} * interval '1 minute')
        ELSE ${userMfa.lockedUntil} END`,
    })
    .where(eq(userMfa.userId, userId))
    .returning({ failedAttempts: userMfa.failedAttempts });
  return row?.failedAttempts ?? 0;
}

/**
 * Use one recovery code, in ONE transaction: delete it (single use, so two
 * concurrent redemptions can't both succeed), store its replacement, and clear
 * the failure count and lock. The caller checks the lock BEFORE calling.
 */
export async function consumeRecoveryCode(
  userId: string,
  codeHash: string,
  replacementHash: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [used] = await tx
      .delete(mfaRecoveryCodes)
      .where(
        and(
          eq(mfaRecoveryCodes.userId, userId),
          eq(mfaRecoveryCodes.codeHash, codeHash),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });
    if (!used) return false;
    await tx
      .insert(mfaRecoveryCodes)
      .values({ userId, codeHash: replacementHash });
    await tx
      .update(userMfa)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(eq(userMfa.userId, userId));
    return true;
  });
}

export async function replaceRecoveryCodes(
  userId: string,
  hashes: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    await tx
      .insert(mfaRecoveryCodes)
      .values([...new Set(hashes)].map((codeHash) => ({ userId, codeHash })));
  });
}

export async function countRecoveryCodes(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(mfaRecoveryCodes)
    .where(eq(mfaRecoveryCodes.userId, userId));
  return row?.n ?? 0;
}

/**
 * Turn 2FA off, in ONE transaction: every MFA row goes, mfa_enabled_at is
 * cleared and token_version is bumped (caller invalidates the cache and hands
 * the current device a fresh token). Undefined when 2FA was not on.
 */
export async function disableMfa(userId: string): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ mfaEnabledAt: null, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(and(eq(users.id, userId), isNotNull(users.mfaEnabledAt)))
      .returning({ tokenVersion: users.tokenVersion });
    if (!user) return undefined;
    await tx.delete(userMfa).where(eq(userMfa.userId, userId));
    await tx
      .delete(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, userId));
    await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));
    return user.tokenVersion;
  });
}

/** Open a challenge (and sweep this user's expired ones). */
export async function createMfaChallenge(input: {
  tokenHash: string;
  userId: string;
  tokenVersion: number;
  purpose: "login" | "link";
  linkTicketHash?: string;
  linkMarkEmailVerified?: boolean;
}): Promise<void> {
  await db
    .delete(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.userId, input.userId),
        sql`${mfaChallenges.expiresAt} <= now()`,
      ),
    );
  await db.insert(mfaChallenges).values({
    tokenHash: input.tokenHash,
    userId: input.userId,
    tokenVersion: input.tokenVersion,
    purpose: input.purpose,
    linkTicketHash: input.linkTicketHash ?? null,
    linkMarkEmailVerified: input.linkMarkEmailVerified ?? false,
    expiresAt: sql`now() + (${MFA_CHALLENGE_TTL_MINUTES} * interval '1 minute')`,
  });
}

/**
 * Use up one try against a live challenge, atomically (concurrent tries
 * serialize on the row lock, so attempts never exceed the cap). Undefined when
 * the challenge is unknown, expired or out of tries.
 */
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

/** Single use: true for exactly one caller. */
export async function consumeMfaChallenge(tokenHash: string): Promise<boolean> {
  const [row] = await db
    .delete(mfaChallenges)
    .where(eq(mfaChallenges.tokenHash, tokenHash))
    .returning({ tokenHash: mfaChallenges.tokenHash });
  return Boolean(row);
}
