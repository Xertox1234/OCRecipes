import {
  type User,
  type InsertUser,
  type InsertUserProfile,
  users,
  userProfiles,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, inArray, sql, gt, asc, isNull } from "drizzle-orm";
import { deleteAllPushTokensForUser } from "./push-tokens";
import { safeUserColumns, type SafeUser } from "./user-columns";

export type { SafeUser } from "./user-columns";

// ============================================================================
// USER CRUD
// ============================================================================

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
  updateUserEmail,
  stagePendingEmail,
  applyEmailVerification,
} from "./user-email";
export {
  getUserProfile,
  createUserProfile,
  updateUserProfile,
  saveReminderMutes,
  upsertProfileWithOnboarding,
  withdrawHealthConsent,
} from "./user-profiles";
export {
  getSubscriptionStatus,
  getEffectiveTierForUser,
  updateSubscription,
} from "./subscription-status";
