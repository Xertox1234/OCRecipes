import { users } from "@shared/schema";
import {
  RESET_CODE_TTL_MINUTES,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_DAILY_ISSUE_CAP,
} from "@shared/constants/password-reset";
import { db } from "../db";
import { eq, and, sql, lt, isNotNull } from "drizzle-orm";

// Password reset by emailed 6-digit code — spec
// docs/superpowers/specs/2026-10-03-password-reset-design.md §3–§4. Every
// expiry / attempt / issuance check is ONE atomic UPDATE predicate evaluated
// on the database clock (now()), never against a JS Date.

/**
 * Column values that kill a live reset code (issuance counters untouched).
 * Spread into every write that must invalidate a code: a completed reset and
 * both email-change commit points in users.ts.
 */
export const CLEARED_RESET_CODE = {
  resetCodeHash: null,
  resetCodeExpiresAt: null,
  resetCodeAttempts: 0,
} as const;

/**
 * Store a new reset code (overwriting any live one) IF the account is under
 * the durable issuance cap: RESET_CODE_DAILY_ISSUE_CAP codes per rolling 24 h.
 * One atomic UPDATE enforces the cap and writes the code, so it survives
 * deploys and concurrent requests. Expiry is computed on the DB clock.
 * Returns false when the cap is hit (nothing stored) — callers stay silent,
 * since only real accounts can hit it (surfacing it would leak existence).
 */
export async function issuePasswordResetCode(
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const windowExpired = sql`(${users.resetIssueWindowStart} IS NULL OR ${users.resetIssueWindowStart} <= now() - interval '24 hours')`;
  const [row] = await db
    .update(users)
    .set({
      resetCodeHash: codeHash,
      resetCodeExpiresAt: sql`now() + (${RESET_CODE_TTL_MINUTES} * interval '1 minute')`,
      resetCodeAttempts: 0,
      resetIssueCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${users.resetIssueCount} + 1 END`,
      resetIssueWindowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${users.resetIssueWindowStart} END`,
    })
    .where(
      and(
        eq(users.id, userId),
        sql`(${windowExpired} OR ${users.resetIssueCount} < ${RESET_CODE_DAILY_ISSUE_CAP})`,
      ),
    )
    .returning({ id: users.id });
  return Boolean(row);
}

/**
 * Use up one guess against the live code for `email`, atomically. The SAME
 * statement runs for real and unknown emails (uniform work); concurrent
 * guesses serialize on the row lock, so attempts can never exceed the cap.
 * Matches the VERIFIED `email` only (never `pending_email`), case-insensitively
 * via the users_email_lower_unique index.
 * Returns the row's id/username/email and stored HMAC, or undefined when there
 * is no live, unexpired, under-cap code (or no such verified email).
 */
export async function reservePasswordResetAttempt(
  email: string,
): Promise<
  | { id: string; username: string; email: string; resetCodeHash: string }
  | undefined
> {
  const [row] = await db
    .update(users)
    .set({ resetCodeAttempts: sql`${users.resetCodeAttempts} + 1` })
    .where(
      and(
        sql`lower(${users.email}) = lower(${email})`,
        isNotNull(users.resetCodeHash),
        sql`${users.resetCodeExpiresAt} > now()`,
        lt(users.resetCodeAttempts, RESET_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      resetCodeHash: users.resetCodeHash,
    });
  if (!row?.resetCodeHash) return undefined;
  return { ...row, resetCodeHash: row.resetCodeHash };
}

/**
 * Commit a reset in ONE statement: new password hash, tokenVersion + 1 (the
 * caller MUST also invalidateTokenVersionCache), email verified (the code
 * proved inbox control), staged email change DISCARDED (an outstanding
 * change-email link is a 24 h JWT with no tokenVersion — clearing
 * pending_email makes applyEmailVerification's commit branch match nothing),
 * and the code cleared. Guarded on the matched hash so a code reissued in the
 * meantime is never consumed by mistake. Issuance counters are kept.
 */
export async function completePasswordReset(
  userId: string,
  matchedHash: string,
  newPasswordHash: string,
): Promise<boolean> {
  const [row] = await db
    .update(users)
    .set({
      password: newPasswordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
      emailVerified: true,
      pendingEmail: null,
      ...CLEARED_RESET_CODE,
    })
    .where(and(eq(users.id, userId), eq(users.resetCodeHash, matchedHash)))
    .returning({ id: users.id });
  return Boolean(row);
}
