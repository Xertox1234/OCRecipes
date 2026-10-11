import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { mfaTrustedDevices, passwordChangeCodes, users } from "@shared/schema";
import {
  CHANGE_CODE_DAILY_ISSUE_CAP,
  CHANGE_CODE_MAX_ATTEMPTS,
  CHANGE_CODE_TTL_MINUTES,
} from "@shared/constants/password-change";
import { CLEARED_RESET_CODE } from "./password-reset";

/**
 * Store a new change-password code (replacing any live one, guesses back to
 * 0) IF the account is under CHANGE_CODE_DAILY_ISSUE_CAP codes in its fixed
 * 24 h window. One atomic upsert; expiry on the DB clock. Only a signed-in
 * session reaches this (change-password spec §4.1), so a stranger can't use
 * the cap up. Returns false at the cap (nothing stored).
 */
export async function issuePasswordChangeCode(
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const windowExpired = sql`${passwordChangeCodes.windowStart} <= now() - interval '24 hours'`;
  const expiresAt = sql`now() + (${CHANGE_CODE_TTL_MINUTES} * interval '1 minute')`;
  const [row] = await db
    .insert(passwordChangeCodes)
    .values({
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      issueCount: 1,
      windowStart: sql`now()`,
    })
    .onConflictDoUpdate({
      target: passwordChangeCodes.userId,
      set: {
        codeHash,
        expiresAt,
        attempts: 0,
        issueCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${passwordChangeCodes.issueCount} + 1 END`,
        windowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${passwordChangeCodes.windowStart} END`,
      },
      setWhere: sql`${windowExpired} OR ${passwordChangeCodes.issueCount} < ${CHANGE_CODE_DAILY_ISSUE_CAP}`,
    })
    .returning({ userId: passwordChangeCodes.userId });
  return Boolean(row);
}

/**
 * Use up one guess against the live code, atomically (concurrent guesses
 * serialize on the row, so attempts never pass the cap). Returns the stored
 * hash to compare against, or undefined when there is no live, unexpired,
 * under-cap code.
 */
export async function reservePasswordChangeAttempt(
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .update(passwordChangeCodes)
    .set({ attempts: sql`${passwordChangeCodes.attempts} + 1` })
    .where(
      and(
        eq(passwordChangeCodes.userId, userId),
        isNotNull(passwordChangeCodes.codeHash),
        gt(passwordChangeCodes.expiresAt, sql`now()`),
        lt(passwordChangeCodes.attempts, CHANGE_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ codeHash: passwordChangeCodes.codeHash });
  return row?.codeHash ?? undefined;
}

/** Thrown inside the transaction to roll it back when the code was already spent. */
class CodeAlreadyUsed extends Error {}

/**
 * Commit a signed-in password change in one transaction (change-password
 * spec §4.2): new hash, tokenVersion + 1 (signs out every other device),
 * a staged email change dropped, any Forgot password code cleared (as
 * completePasswordReset does), trusted phones forgotten — pinned to the
 * version the route checked, so a concurrent reset or sign-out wins.
 * With `consumeCodeHash`, the emailed code is spent in the same
 * transaction; a code already spent rolls everything back. emailVerified
 * is NOT touched: a password or Google/Apple proof says nothing about the
 * inbox. The change-code issue window is kept (its cap must persist).
 * Returns the new tokenVersion, or undefined (nothing written).
 */
export async function changePassword(opts: {
  userId: string;
  expectedTokenVersion: number;
  newPasswordHash: string;
  consumeCodeHash?: string;
}): Promise<number | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          password: opts.newPasswordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          pendingEmail: null,
          ...CLEARED_RESET_CODE,
        })
        .where(
          and(
            eq(users.id, opts.userId),
            eq(users.tokenVersion, opts.expectedTokenVersion),
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!row) return undefined;
      if (opts.consumeCodeHash !== undefined) {
        const [used] = await tx
          .update(passwordChangeCodes)
          .set({ codeHash: null, expiresAt: null })
          .where(
            and(
              eq(passwordChangeCodes.userId, opts.userId),
              eq(passwordChangeCodes.codeHash, opts.consumeCodeHash),
            ),
          )
          .returning({ userId: passwordChangeCodes.userId });
        if (!used) throw new CodeAlreadyUsed();
      }
      await tx
        .delete(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, opts.userId));
      return row.tokenVersion;
    });
  } catch (err) {
    if (err instanceof CodeAlreadyUsed) return undefined;
    throw err;
  }
}
