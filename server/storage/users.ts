import {
  type User,
  type InsertUser,
  type InsertUserProfile,
  users,
  userProfiles,
} from "@shared/schema";
import { db } from "../db";
import {
  eq,
  and,
  inArray,
  sql,
  getTableColumns,
  gt,
  asc,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { CLEARED_RESET_CODE } from "./password-reset";
import { deleteAllPushTokensForUser } from "./push-tokens";

// ============================================================================
// USER CRUD
// ============================================================================

// Exclude password AND the password-reset columns from default queries —
// defense-in-depth against accidental leaks. Only the *ForAuth getters return
// the password hash. The REAL guard for HTTP responses is response shaping
// (serializeUser / explicit picks in routes); full-row paths (createUser,
// updateUser .returning(), *ForAuth) still carry these columns — never strip
// them here instead of shaping the response.
const {
  password: _password,
  resetCodeHash: _resetCodeHash,
  resetCodeExpiresAt: _resetCodeExpiresAt,
  resetCodeAttempts: _resetCodeAttempts,
  resetIssueCount: _resetIssueCount,
  resetIssueWindowStart: _resetIssueWindowStart,
  ...safeUserColumns
} = getTableColumns(users);

type ResetColumnKey =
  | "resetCodeHash"
  | "resetCodeExpiresAt"
  | "resetCodeAttempts"
  | "resetIssueCount"
  | "resetIssueWindowStart";

/** User row without password hash or password-reset state */
export type SafeUser = Omit<User, "password" | ResetColumnKey>;

export async function getUser(id: string): Promise<SafeUser | undefined> {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, id));
  return user || undefined;
}

export async function getUserByUsername(
  username: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.username, username));
  return user || undefined;
}

export async function getUserByEmail(
  email: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.email, email));
  return user || undefined;
}

/** Full user row including password hash — only for login/delete-account flows */
export async function getUserForAuth(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || undefined;
}

/** Full user row including password hash — only for login flow */
export async function getUserByUsernameForAuth(
  username: string,
): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));
  return user || undefined;
}

/**
 * Full user row by VERIFIED email (the `email` column), case-insensitive —
 * login-by-email and forgot-password. NEVER matches `pending_email`: a staged,
 * unproven address must not receive a reset code or sign anyone in.
 * lower() on both sides tolerates a legacy row stored mixed-case and uses the
 * users_email_lower_unique index.
 */
export async function getUserByEmailForAuth(
  email: string,
): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return user || undefined;
}

/**
 * Usernames that may not be registered by a real person.
 *
 * `demo` is here because two cleanup scripts resolve their PERMANENT-DELETE
 * scope by that exact string — `scripts/cleanup-junk-recipes.ts:54` and
 * `server/scripts/cleanup-seed-recipes.ts` both do
 * `eq(users.username, "demo")`. In an environment with no pre-existing demo
 * account, a real user could register the name and their junk-matching
 * recipes would enter that deletion perimeter.
 *
 * Keep this list TINY and tied to a concrete hazard — it is not a vanity
 * blocklist. Entries are compared trimmed and lowercased (see
 * `isReservedUsername`), so they must be written lowercase here.
 */
export const RESERVED_USERNAMES = ["demo"] as const;

/** Thrown by `createUser` when the requested username is reserved. */
export class ReservedUsernameError extends Error {
  constructor(public readonly username: string) {
    super(`Username "${username}" is reserved and cannot be registered`);
    this.name = "ReservedUsernameError";
  }
}

/**
 * Trim + lowercase before comparing: the lookup this protects is an
 * exact-string match on the stored value, so `Demo`/`DEMO`/` demo ` are all
 * just as dangerous as `demo`. Whole-string, never a prefix — `demo_user`
 * and `demonstration` stay registerable.
 *
 * EXPORTED so `server/routes/auth.ts` can reject a reserved name at its
 * username pre-check — the one signup slot that is deliberately NOT the
 * neutral check-inbox response. Rejecting only via `createUser`'s throw put
 * the 409 AFTER the neutral email-existence branch, which made
 * `POST /api/auth/register` a single-request email-existence oracle: with a
 * reserved username held fixed, a taken email returned the neutral 200 and a
 * free email returned the 409 (review, 2026-08-17). Route and storage MUST
 * share this one normalizer — a re-implemented trim/lowercase in the route
 * can drift and the differential comes straight back.
 */
export function isReservedUsername(username: string): boolean {
  return (RESERVED_USERNAMES as readonly string[]).includes(
    username.trim().toLowerCase(),
  );
}

/**
 * NOTE ON THE SEED SCRIPT (load-bearing): `npm run seed:recipes` legitimately
 * owns the name `demo` and is NOT blocked by this check, because
 * `server/scripts/seed-recipes.ts:261` inserts into `users` DIRECTLY rather
 * than calling `createUser`. That is the whole bypass — no flag, no
 * parameter. If the seed is ever refactored to route through `createUser`,
 * seeding will start failing here, and the fix is an explicit internal
 * bypass at that call site, NOT deleting the reservation.
 */
export async function createUser(insertUser: InsertUser): Promise<User> {
  if (isReservedUsername(insertUser.username)) {
    throw new ReservedUsernameError(insertUser.username);
  }
  const [user] = await db.insert(users).values(insertUser).returning();
  return user;
}

/** Whitelist of fields callers may update on a user.
 *  Excludes dangerous fields: id, username, password, tokenVersion,
 *  subscriptionTier, subscriptionExpiresAt, createdAt. */
export type UpdatableUserFields = Pick<
  User,
  | "weight"
  | "height"
  | "age"
  | "gender"
  | "displayName"
  | "avatarUrl"
  | "dailyCalorieGoal"
  | "dailyProteinGoal"
  | "dailyCarbsGoal"
  | "dailyFatGoal"
  | "goalWeight"
  | "goalsCalculatedAt"
  | "onboardingCompleted"
  | "measurementUnit"
>;

/**
 * Store the user's quota timezone, ONCE. The conditional `timezone IS NULL`
 * write is the cap: every daily quota resets at midnight in this zone
 * (`quotaDayBounds`), so a freely rewritable value would let a client earn an
 * extra reset by switching zones. Deliberately not part of `UpdatableUserFields`
 * (that spread would overwrite). Returns true when this call stored it, false
 * when a timezone was already set (no change). Callers pass an IANA name
 * validated at the route boundary.
 */
export async function setUserTimezoneIfUnset(
  userId: string,
  timezone: string,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ timezone })
    .where(and(eq(users.id, userId), isNull(users.timezone)))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function updateUser(
  id: string,
  updates: Partial<UpdatableUserFields>,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();
  return user || undefined;
}

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

/**
 * Atomically update user goals AND upsert profile data in a single transaction.
 * Prevents partial writes where one table is updated but the other fails.
 */
export async function updateUserGoalsAndProfile(
  userId: string,
  userUpdates: Partial<UpdatableUserFields>,
  profileData: Omit<InsertUserProfile, "userId">,
): Promise<User | undefined> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set(userUpdates)
      .where(eq(users.id, userId))
      .returning();

    if (!user) return undefined;

    const [existing] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    if (existing) {
      await tx
        .update(userProfiles)
        .set({ ...profileData, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId));
    } else {
      await tx.insert(userProfiles).values({ ...profileData, userId });
    }

    return user;
  });
}

/**
 * Atomically increment tokenVersion via SQL to avoid TOCTOU race conditions.
 * Returns the updated user, or undefined if not found.
 */
export async function incrementTokenVersion(
  id: string,
): Promise<User | undefined> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id))
      .returning();
    if (!user) return undefined;
    // Every session just ended, so no phone may keep getting pushes.
    await deleteAllPushTokensForUser(tx, id);
    return user;
  });
}

/**
 * Upgrade a legacy hash to pv2 after a successful legacy sign-in. Compare-and-
 * swap on the hash that was checked: a reset or password change that committed
 * in between wins, and the old password is never written back. Spec §3.
 */
export async function upgradePasswordHash(
  userId: string,
  expectedHash: string,
  newHash: string,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ password: newHash })
    .where(and(eq(users.id, userId), eq(users.password, expectedHash)))
    .returning({ id: users.id });
  return rows.length === 1;
}

/**
 * Record that the user used the app now, for the retention cleanup's "used
 * the app in the last 30 days" check. The once-an-hour guard is in SQL against
 * now(), so writes stay bounded across restarts and multiple instances.
 */
export async function touchLastActive(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ lastActiveAt: sql`now()` })
    .where(
      and(
        eq(users.id, userId),
        sql`(${users.lastActiveAt} IS NULL OR ${users.lastActiveAt} < now() - interval '1 hour')`,
      ),
    );
}

/**
 * Fetch a page of user IDs ordered by id for cursor-based iteration.
 * Pass `afterId: null` to start from the beginning; pass the last ID from the
 * previous page to advance the cursor. Returns an empty array when exhausted.
 *
 * idor-safe: This function intentionally iterates all users — it is only
 * called by the notification scheduler (server-side cron job) and is never
 * exposed per-user via a route handler.
 */
export async function getUserIdPage( // idor-safe
  afterId: string | null,
  limit = 500,
): Promise<string[]> {
  const query = db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.id))
    .limit(limit);
  const rows = await (afterId ? query.where(gt(users.id, afterId)) : query);
  return rows.map((r) => r.id);
}

/**
 * Batch-fetch the raw `timezone` column for a set of user IDs in a single
 * `WHERE id = ANY(...)` query (no N+1). Returns a Map keyed by user id whose
 * value is the stored IANA string or `null` when the column was never written.
 *
 * The value is intentionally NOT validated/normalized here — callers pass it
 * through `parseTimezone` (server/lib/civil-date.ts) to collapse
 * null/undefined/invalid → `"UTC"`. Validating in storage would require
 * importing from the routes layer, creating a `storage → routes → storage`
 * import cycle (`_helpers` imports the storage barrel).
 *
 * idor-safe: only the notification scheduler (server-side cron) calls this; it
 * is never reachable per-user via a route handler.
 */
export async function getUserTimezones( // idor-safe
  userIds: string[],
): Promise<Map<string, string | null>> {
  // inArray(col, []) generates degenerate SQL — short-circuit empty input.
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, timezone: users.timezone })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.id, r.timezone]));
}

// Moved out of this file (pure move); re-exported so the storage facade
// (`import * as users`) and existing importers need no change.
export { DELETE_USER_LOCK_THRESHOLD, deleteUser } from "./user-deletion";
export {
  getUserProfile,
  createUserProfile,
  updateUserProfile,
  saveReminderMutes,
  upsertProfileWithOnboarding,
} from "./user-profiles";
export {
  getSubscriptionStatus,
  getEffectiveTierForUser,
  updateSubscription,
} from "./subscription-status";
