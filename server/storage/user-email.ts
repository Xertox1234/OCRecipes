import { users } from "@shared/schema";
import { db } from "../db";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { CLEARED_RESET_CODE } from "./password-reset";
import { safeUserColumns, type SafeUser } from "./user-columns";

/**
 * Atomically change a user's email AND reset email_verified to false — a
 * changed address must re-prove ownership before it counts as verified.
 * `emailVerified` is forced false here (it is NOT a caller-settable field) so a
 * changed email can never inherit the previous address's verified state. Any
 * staged `pending_email` is cleared too: an immediate change supersedes a
 * pending one, so a stale verification link for the old pending address can't
 * later commit a now-wrong value. Case-insensitive uniqueness is enforced by
 * the DB (users_email_unique + users_email_lower_unique); a collision surfaces
 * as a 23505 the caller maps to a neutral / 409 response. Callers must
 * normalize `newEmail` (trim + lowercase) before calling, to match every other
 * write path. Returns the updated SafeUser, or undefined if no user matches.
 *
 * This is the fail-open (verification-OFF / dev) path. When verification is ON,
 * the route stages via `stagePendingEmail` instead and the swap happens in
 * `applyEmailVerification` once the new address proves control.
 */
export async function updateUserEmail(
  id: string,
  newEmail: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .update(users)
    .set({
      email: newEmail,
      emailVerified: false,
      pendingEmail: null,
      // The verified address changed: a reset code issued to the OLD address
      // must die here (spec §3).
      ...CLEARED_RESET_CODE,
    })
    .where(eq(users.id, id))
    .returning(safeUserColumns);
  return user || undefined;
}

/**
 * Stage a new email for verification WITHOUT touching the current `email` or
 * `emailVerified` — the heart of the staged change-email flow. The account's
 * login-gating address is unchanged until `applyEmailVerification` swaps the
 * staged value in, so a typo can never lock the user out and `/api/auth/me`
 * reveals nothing about a target address's existence.
 *
 * Deliberately CANNOT raise a 23505: `pending_email` has no unique constraint
 * (by design — see the schema comment), so staging an address already held by
 * another account simply succeeds. The collision, if any, surfaces only at
 * commit time against the `email` unique index. This is what lets the route
 * return a uniform neutral response regardless of whether the target is taken
 * (no enumeration oracle). Callers must normalize `newEmail` (trim + lowercase)
 * first. Returns the updated SafeUser, or undefined if no user matches.
 */
export async function stagePendingEmail(
  id: string,
  newEmail: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ pendingEmail: newEmail })
    .where(eq(users.id, id))
    .returning(safeUserColumns);
  return user || undefined;
}

/**
 * Apply an email-verification token, handling BOTH signup verification and the
 * commit of a staged email change in one idempotent operation. Two ordered,
 * mutually-exclusive branches keyed on which column the token's `email` claim
 * matches (compared case-insensitively, to match the lower(email) index):
 *
 *  1. token email == current `email` → mark verified. Covers signup
 *     verification, a re-sent current-address link, and (idempotently) a second
 *     fetch of a change token AFTER it already committed (the address now equals
 *     the token, so it lands here harmlessly).
 *  2. token email == a staged `pending_email` → COMMIT the change: swap the
 *     pending value into `email`, set verified, and clear `pending_email`. The
 *     swap is subject to the `email` unique index, so a pending address that was
 *     taken in the meantime raises a 23505 that propagates to the caller (the
 *     verify simply fails — no row is half-updated).
 *
 * A token matching NEITHER (a stale link for a previous address, before a
 * further change) updates zero rows in both branches and returns undefined — so
 * it can never flip a wrong address verified. This is the cross-check guard,
 * now keyed on `pending_email` rather than the immediately-mutated `email`.
 *
 * `emailVerified` / `email` / `pendingEmail` are intentionally NOT in
 * UpdatableUserFields — verification is a dedicated, single-purpose mutation,
 * not a client-settable profile field. Returns the updated SafeUser, or
 * undefined if no user matches either branch. A Branch 2 commit also returns
 * `previousEmail` — the address it replaced — so the caller can tell it the
 * account moved (auth audit 2026-10-10 L4); Branch 1 moves nothing and omits it.
 */
export async function applyEmailVerification(
  id: string,
  tokenEmail: string,
): Promise<(SafeUser & { previousEmail?: string }) | undefined> {
  // Branch 1: the token matches the current address — verify it in place.
  const [verified] = await db
    .update(users)
    .set({ emailVerified: true })
    .where(
      and(eq(users.id, id), sql`lower(${users.email}) = lower(${tokenEmail})`),
    )
    .returning(safeUserColumns);
  if (verified) return verified;

  // Branch 2: the token matches a staged change — commit the swap atomically.
  // `email = pending_email` reads the pre-update value; the email unique index
  // is the arbiter if the staged address was taken since (raises 23505). After
  // a successful commit, pending is NULLed so a duplicate fetch falls through
  // to Branch 1 above on the next call (idempotent). No transaction wraps the
  // two UPDATEs: they are mutually exclusive predicates and each is atomic, so
  // under READ COMMITTED concurrent commits cannot both win (the loser
  // re-evaluates against the locked row, sees pending NULL, updates 0 rows).
  // The only residual anomaly is a benign, self-healing false-negative (a racing
  // verifier gets undefined → neutral fail; a retry lands on Branch 1 and
  // succeeds) — do NOT "fix" it with a transaction across the two branches,
  // there is no corruption. The transaction below wraps Branch 2 ALONE: it
  // reads the address being replaced under a row lock, so the previousEmail it
  // returns is the one this UPDATE overwrote, never one a racing commit moved.
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    if (!before) return undefined;
    const [committed] = await tx
      .update(users)
      .set({
        email: sql`${users.pendingEmail}`,
        emailVerified: true,
        pendingEmail: null,
        // Committing a change moves the verified address: kill any reset code
        // issued to the previous one (spec §3). Branch 1 (same address) keeps it.
        ...CLEARED_RESET_CODE,
      })
      .where(
        and(
          eq(users.id, id),
          isNotNull(users.pendingEmail),
          sql`lower(${users.pendingEmail}) = lower(${tokenEmail})`,
        ),
      )
      .returning(safeUserColumns);
    return committed
      ? { ...committed, previousEmail: before.email }
      : undefined;
  });
}
