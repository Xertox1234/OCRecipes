import {
  mfaTrustedDevices,
  passwordUpgradePasses,
  users,
  type PasswordUpgradePass,
} from "@shared/schema";
import {
  UPGRADE_PASS_MAX_ATTEMPTS,
  UPGRADE_PASS_TTL_MINUTES,
} from "@shared/constants/password-upgrade";
import { db } from "../db";
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { GuardFailed, guarded } from "./mfa";

// A short password's restricted pass — password policy spec
// docs/superpowers/specs/2026-10-10-password-policy-design.md §6. Every expiry
// / counter / single-use check is ONE statement on the database clock, the
// pattern of mfa.ts.

/** Unconsumed and unexpired. Attempts are checked where they matter. */
const unspent = (idHash: string) =>
  and(
    eq(passwordUpgradePasses.idHash, idHash),
    isNull(passwordUpgradePasses.consumedAt),
    gt(passwordUpgradePasses.expiresAt, sql`now()`),
  );

const underAttemptCap = lt(
  passwordUpgradePasses.attempts,
  UPGRADE_PASS_MAX_ATTEMPTS,
);

/** Mint a pass; drops this user's dead ones first (as createMfaChallenge does). */
export async function createUpgradePass(p: {
  idHash: string;
  userId: string;
  tokenVersion: number;
  twoStepAllowed: boolean;
}): Promise<void> {
  await db
    .delete(passwordUpgradePasses)
    .where(
      and(
        eq(passwordUpgradePasses.userId, p.userId),
        or(
          lte(passwordUpgradePasses.expiresAt, sql`now()`),
          isNotNull(passwordUpgradePasses.consumedAt),
        ),
      ),
    );
  await db.insert(passwordUpgradePasses).values({
    ...p,
    expiresAt: sql`now() + (${UPGRADE_PASS_TTL_MINUTES} * interval '1 minute')`,
  });
}

/** Unconsumed, unexpired, and not yet out of code attempts. */
export async function getLiveUpgradePass(
  idHash: string,
): Promise<PasswordUpgradePass | undefined> {
  const [row] = await db
    .select()
    .from(passwordUpgradePasses)
    .where(and(unspent(idHash), underAttemptCap));
  return row;
}

/** Count one code attempt; undefined once the pass is dead, spent or capped. */
export async function reserveUpgradePassAttempt(
  idHash: string,
): Promise<PasswordUpgradePass | undefined> {
  const [row] = await db
    .update(passwordUpgradePasses)
    .set({ attempts: sql`${passwordUpgradePasses.attempts} + 1` })
    .where(and(unspent(idHash), underAttemptCap))
    .returning();
  return row;
}

/**
 * "Choose a longer password": consume the pass, write the hash, end every
 * session, forget trusted phones and drop a staged email change (its link is
 * a JWT tokenVersion can't cancel) — one transaction. Undefined when the pass
 * was already used, or the account's tokenVersion moved on since it was
 * minted (a reset elsewhere wins). The awaits are sequential on purpose: each
 * statement is the guard for the next, so Promise.all doesn't apply.
 */
export async function completePasswordUpgrade(p: {
  idHash: string;
  userId: string;
  tokenVersion: number;
  newPasswordHash: string;
}): Promise<number | undefined> {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(passwordUpgradePasses)
        .set({ consumedAt: sql`now()` })
        .where(
          and(unspent(p.idHash), eq(passwordUpgradePasses.userId, p.userId)),
        )
        .returning({ idHash: passwordUpgradePasses.idHash });
      if (!consumed) throw new GuardFailed();
      const [u] = await tx
        .update(users)
        .set({
          password: p.newPasswordHash,
          pendingEmail: null,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(
          and(
            eq(users.id, p.userId),
            eq(users.tokenVersion, p.tokenVersion),
            isNull(users.mfaEnabledAt),
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!u) throw new GuardFailed();
      await tx
        .delete(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, p.userId));
      return u.tokenVersion;
    }),
  );
}
