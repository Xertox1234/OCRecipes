import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  mfaChallenges,
  mfaEmailCodes,
  userMfa,
  users,
  type MfaChallenge,
} from "@shared/schema";
import {
  MFA_CHALLENGE_MAX_ATTEMPTS,
  MFA_EMAIL_CODE_DAILY_ISSUE_CAP,
  MFA_EMAIL_CODE_MAX_ATTEMPTS,
  MFA_EMAIL_CODE_TTL_MINUTES,
  MFA_EMAIL_RESEND_COOLDOWN_SECONDS,
} from "@shared/constants/mfa";
import { GuardFailed, guarded } from "./mfa";

// Two-step by emailed code (owner ruling 4, 2026-10-12). Same shape as
// password-change.ts: one row per user, every check one atomic statement on
// the database clock.

export type IssueResult = "issued" | "cooldown" | "capped";

/**
 * Store a new code (replacing any live one, guesses back to 0) unless the last
 * one went out under MFA_EMAIL_RESEND_COOLDOWN_SECONDS ago or the account has
 * had MFA_EMAIL_CODE_DAILY_ISSUE_CAP codes in its fixed 24 h window. The
 * caller sends the email only on "issued", so a refusal is never a silent
 * "code sent" with nothing in the inbox.
 */
export async function issueMfaEmailCode(
  userId: string,
  codeHash: string,
): Promise<IssueResult> {
  const windowExpired = sql`${mfaEmailCodes.windowStart} <= now() - interval '24 hours'`;
  const cooledDown = sql`${mfaEmailCodes.lastSentAt} <= now() - (${MFA_EMAIL_RESEND_COOLDOWN_SECONDS} * interval '1 second')`;
  const expiresAt = sql`now() + (${MFA_EMAIL_CODE_TTL_MINUTES} * interval '1 minute')`;
  const [row] = await db
    .insert(mfaEmailCodes)
    .values({
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      issueCount: 1,
      windowStart: sql`now()`,
      lastSentAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: mfaEmailCodes.userId,
      set: {
        codeHash,
        expiresAt,
        attempts: 0,
        lastSentAt: sql`now()`,
        issueCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${mfaEmailCodes.issueCount} + 1 END`,
        windowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${mfaEmailCodes.windowStart} END`,
      },
      setWhere: sql`${cooledDown} AND (${windowExpired} OR ${mfaEmailCodes.issueCount} < ${MFA_EMAIL_CODE_DAILY_ISSUE_CAP})`,
    })
    .returning({ userId: mfaEmailCodes.userId });
  if (row) return "issued";
  // Refused: say which, so the screen can tell "wait a moment" from "tomorrow".
  const [existing] = await db
    .select({ cooledDown: sql<boolean>`${cooledDown}` })
    .from(mfaEmailCodes)
    .where(eq(mfaEmailCodes.userId, userId));
  return existing && !existing.cooledDown ? "cooldown" : "capped";
}

/**
 * Use up one guess against the live code, atomically. Returns the stored hash
 * to compare against, or undefined when there is no live, unexpired, under-cap
 * code.
 */
export async function reserveMfaEmailAttempt(
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .update(mfaEmailCodes)
    .set({ attempts: sql`${mfaEmailCodes.attempts} + 1` })
    .where(
      and(
        eq(mfaEmailCodes.userId, userId),
        isNotNull(mfaEmailCodes.codeHash),
        gt(mfaEmailCodes.expiresAt, sql`now()`),
        lt(mfaEmailCodes.attempts, MFA_EMAIL_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ codeHash: mfaEmailCodes.codeHash });
  return row?.codeHash ?? undefined;
}

const notLocked = or(
  isNull(userMfa.lockedUntil),
  lte(userMfa.lockedUntil, sql`now()`),
);

/** Spend `codeHash` inside `tx`; throws GuardFailed when it is no longer the live code. */
async function spendCode(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  codeHash: string,
) {
  const [used] = await tx
    .update(mfaEmailCodes)
    .set({ codeHash: null, expiresAt: null })
    .where(
      and(
        eq(mfaEmailCodes.userId, userId),
        eq(mfaEmailCodes.codeHash, codeHash),
      ),
    )
    .returning({ userId: mfaEmailCodes.userId });
  if (!used) throw new GuardFailed();
}

/**
 * Turn two-step on, spending the setup code in the same transaction. Guarded
 * on two-step being off (the check is in the write). A stale row's failures
 * and lock are cleared. Returns the new tokenVersion (every other session
 * ends), or undefined when two-step is already on or the code was spent or
 * replaced.
 */
export async function enableEmailMfa(
  userId: string,
  codeHash: string,
): Promise<number | undefined> {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [u] = await tx
        .update(users)
        .set({
          mfaEnabledAt: sql`now()`,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(and(eq(users.id, userId), isNull(users.mfaEnabledAt)))
        .returning({ tokenVersion: users.tokenVersion });
      if (!u) throw new GuardFailed();
      await spendCode(tx, userId, codeHash);
      const fresh = { failedAttempts: 0, lockedUntil: null };
      await tx
        .insert(userMfa)
        .values({ userId, ...fresh })
        .onConflictDoUpdate({ target: userMfa.userId, set: fresh });
      return u.tokenVersion;
    }),
  );
}

/**
 * The second factor's failure state, or undefined when two-step is off (a
 * leftover row on an account with two-step off does not count).
 */
export async function getMfaState(
  userId: string,
): Promise<{ failedAttempts: number; locked: boolean } | undefined> {
  const [row] = await db
    .select({
      failedAttempts: userMfa.failedAttempts,
      locked: sql<boolean>`coalesce(${userMfa.lockedUntil} > now(), false)`,
    })
    .from(userMfa)
    .innerJoin(users, eq(users.id, userMfa.userId))
    .where(and(eq(userMfa.userId, userId), isNotNull(users.mfaEnabledAt)));
  return row;
}

/**
 * Spend a matched sign-in code once and clear the failure count. Refused
 * (false, nothing written) while two-step is locked or when the code was
 * already spent or replaced.
 */
export async function acceptMfaEmailCode(
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const done = await guarded(() =>
    db.transaction(async (tx) => {
      const [reset] = await tx
        .update(userMfa)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(and(eq(userMfa.userId, userId), notLocked))
        .returning({ userId: userMfa.userId });
      if (!reset) throw new GuardFailed();
      await spendCode(tx, userId, codeHash);
      return true;
    }),
  );
  return done === true;
}

/** A live challenge, read WITHOUT spending one of its attempts (for resend). */
export async function getLiveMfaChallenge(
  tokenHash: string,
): Promise<MfaChallenge | undefined> {
  const [row] = await db
    .select()
    .from(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.tokenHash, tokenHash),
        gt(mfaChallenges.expiresAt, sql`now()`),
        lt(mfaChallenges.attempts, MFA_CHALLENGE_MAX_ATTEMPTS),
      ),
    );
  return row;
}
