import {
  type User,
  type InsertUser,
  type UserProfile,
  type InsertUserProfile,
  type Transaction,
  type InsertTransaction,
  users,
  userProfiles,
  transactions,
  communityRecipes,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";
import {
  isValidSubscriptionTier,
  resolveEffectiveTier,
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";
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
} from "drizzle-orm";
import { removeFromIndex } from "../lib/search-index";

// ============================================================================
// USER CRUD
// ============================================================================

// Exclude password from default queries — defense-in-depth against accidental leaks.
// Only getUserForAuth / getUserByUsernameForAuth return the password hash.
const { password: _password, ...safeUserColumns } = getTableColumns(users);

/** User row without password hash */
export type SafeUser = Omit<User, "password">;

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

export async function createUser(insertUser: InsertUser): Promise<User> {
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
  | "timezone"
>;

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
    .set({ email: newEmail, emailVerified: false, pendingEmail: null })
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
 * undefined if no user matches either branch.
 */
export async function applyEmailVerification(
  id: string,
  tokenEmail: string,
): Promise<SafeUser | undefined> {
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
  // succeeds) — do NOT "fix" it with a transaction, there is no corruption.
  const [committed] = await db
    .update(users)
    .set({
      email: sql`${users.pendingEmail}`,
      emailVerified: true,
      pendingEmail: null,
    })
    .where(
      and(
        eq(users.id, id),
        isNotNull(users.pendingEmail),
        sql`lower(${users.pendingEmail}) = lower(${tokenEmail})`,
      ),
    )
    .returning(safeUserColumns);
  return committed || undefined;
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
  const [user] = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, id))
    .returning();
  return user || undefined;
}

/**
 * Permanently delete a user and all associated data.
 * Relies on ON DELETE CASCADE foreign keys to clean up child tables.
 * Community recipes (which use SET NULL) are explicitly deleted first.
 */
export async function deleteUser(id: string): Promise<boolean> {
  // Collect recipe IDs before the transaction so we can evict from the
  // in-memory search index AFTER commit — side effects inside the callback
  // fire before the transaction commits and can't be rolled back if the
  // subsequent tx.delete(users) throws. (See docs/legacy-patterns/database.md
  // "Side-Effect Ordering Around db.transaction".)
  const orphanedRecipes = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(eq(communityRecipes.authorId, id));

  const deleted = await db.transaction(async (tx) => {
    if (orphanedRecipes.length > 0) {
      const recipeIds = orphanedRecipes.map((r) => r.id);
      await tx
        .delete(cookbookRecipes)
        .where(
          and(
            inArray(cookbookRecipes.recipeId, recipeIds),
            eq(cookbookRecipes.recipeType, "community"),
          ),
        );
      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            inArray(favouriteRecipes.recipeId, recipeIds),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );
      await tx
        .delete(communityRecipes)
        .where(eq(communityRecipes.authorId, id));
    }

    const result = await tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return result.length > 0;
  });

  // Post-commit: evict deleted recipes from the MiniSearch index so they
  // stop surfacing in search results. Only fires when the transaction succeeded.
  if (deleted && orphanedRecipes.length > 0) {
    for (const recipe of orphanedRecipes) {
      removeFromIndex(`community:${recipe.id}`);
    }
  }

  return deleted;
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
 * through `parseTimezone` (server/routes/_helpers.ts) to collapse
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

// ============================================================================
// USER PROFILES
// ============================================================================

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | undefined> {
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return profile || undefined;
}

export async function createUserProfile(
  profile: InsertUserProfile,
): Promise<UserProfile> {
  const [newProfile] = await db
    .insert(userProfiles)
    .values(profile)
    .returning();
  return newProfile;
}

/** Whitelist of fields callers may update on a user profile.
 *  `userId` is excluded — it's a foreign key and immutable after creation.
 *  `healthDataConsentAt` is excluded — it's a legally significant timestamp
 *  generated internally; callers signal intent via the `recordConsent` flag. */
type UpdatableProfileFields = Pick<
  InsertUserProfile,
  | "allergies"
  | "healthConditions"
  | "dietType"
  | "foodDislikes"
  | "primaryGoal"
  | "activityLevel"
  | "householdSize"
  | "cuisinePreferences"
  | "cookingSkillLevel"
  | "cookingTimeAvailable"
  | "glp1Mode"
  | "glp1Medication"
  | "glp1StartDate"
  | "reminderMutes"
>;

export async function updateUserProfile(
  userId: string,
  updates: Partial<UpdatableProfileFields>,
  recordConsent = false,
): Promise<UserProfile | undefined> {
  // Append-only consent: SQL `COALESCE(existing, new)` keeps the first
  // non-null `healthDataConsentAt` so a re-stamp request cannot overwrite
  // the original consent record. The timestamp is generated here from
  // `new Date()` rather than accepted as a parameter so callers cannot
  // supply (or accidentally forward) a backdated value.
  //
  // Runtime strip: even though `UpdatableProfileFields` excludes the column
  // at compile time, defensively destructure it out of the spread so a
  // caller that bypasses TS (`as any`, JS scripts, malformed objects)
  // cannot smuggle a `Date` into the SET clause.
  const { healthDataConsentAt: _strip, ...safeUpdates } =
    updates as Partial<UpdatableProfileFields> & {
      healthDataConsentAt?: Date | null;
    };
  void _strip;
  const setClause: Record<string, unknown> = {
    ...safeUpdates,
    updatedAt: new Date(),
  };
  if (recordConsent) {
    setClause.healthDataConsentAt = sql`COALESCE(${userProfiles.healthDataConsentAt}, ${new Date()})`;
  }
  const [profile] = await db
    .update(userProfiles)
    .set(setClause)
    .where(eq(userProfiles.userId, userId))
    .returning();
  return profile || undefined;
}

/**
 * Atomically upserts a user profile and marks onboarding as complete.
 * Used by the POST /api/user/dietary-profile onboarding endpoint.
 *
 * `healthDataConsentAt` is omitted from `profileData` because the timestamp
 * is generated internally; callers signal intent via `recordConsent`.
 */
export async function upsertProfileWithOnboarding(
  userId: string,
  profileData: Omit<InsertUserProfile, "userId" | "healthDataConsentAt">,
  recordConsent = false,
): Promise<UserProfile> {
  // Runtime strip: the parameter type excludes `healthDataConsentAt` at
  // compile time, but defensively destructure it out of the spread so a
  // caller that bypasses TS (`as any`, JS scripts, malformed objects)
  // cannot smuggle a `Date` into the upsert.
  const { healthDataConsentAt: _strip, ...safeProfileData } =
    profileData as Omit<InsertUserProfile, "userId" | "healthDataConsentAt"> & {
      healthDataConsentAt?: Date | null;
    };
  void _strip;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    let result: UserProfile;
    if (existing) {
      // Append-only consent: never overwrite a previously recorded
      // `healthDataConsentAt`. Once consent has been captured, replays of
      // this onboarding endpoint preserve the original timestamp as the
      // legally significant record of agreement. The timestamp is generated
      // here from `new Date()` so callers cannot supply a backdated value.
      const safeData: Omit<InsertUserProfile, "userId"> =
        recordConsent && !existing.healthDataConsentAt
          ? { ...safeProfileData, healthDataConsentAt: new Date() }
          : safeProfileData;
      [result] = await tx
        .update(userProfiles)
        .set({ ...safeData, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId))
        .returning();
    } else {
      const insertData: Omit<InsertUserProfile, "userId"> = recordConsent
        ? { ...safeProfileData, healthDataConsentAt: new Date() }
        : safeProfileData;
      [result] = await tx
        .insert(userProfiles)
        .values({ ...insertData, userId })
        .returning();
    }

    await tx
      .update(users)
      .set({ onboardingCompleted: true })
      .where(eq(users.id, userId));

    return result;
  });
}

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export async function getSubscriptionStatus(userId: string): Promise<
  | {
      tier: SubscriptionTier;
      expiresAt: Date | null;
    }
  | undefined
> {
  const [user] = await db
    .select({
      tier: users.subscriptionTier,
      expiresAt: users.subscriptionExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return undefined;

  // Validate tier with Zod schema, fallback to "free" if invalid
  const parsedTier = subscriptionTierSchema.safeParse(user.tier);
  return {
    tier: parsedTier.success ? parsedTier.data : "free",
    expiresAt: user.expiresAt,
  };
}

/**
 * Resolve the *effective* subscription tier for a user, accounting for
 * premium expiry. The raw `users.subscriptionTier` is NOT reset on expiry, so
 * indexing `TIER_FEATURES` with it directly grants paid features/limits to
 * lapsed subscribers (revenue leak). This helper is the canonical path: a
 * single `users` select + `resolveEffectiveTier`, with no cache and no
 * additional dependencies. Use it everywhere a feature gate needs the user's
 * current tier — route gates, storage limit checks, inline feature reads.
 *
 * Returns `"free"` for unknown users or invalid stored tiers (fail-closed).
 *
 * EXEMPTION: B2B `ApiTier` (api-key) sites must NOT pass through this helper —
 * they have no expiry concept.
 */
export async function getEffectiveTierForUser(
  userId: string,
): Promise<SubscriptionTier> {
  const [row] = await db
    .select({
      tier: users.subscriptionTier,
      expiresAt: users.subscriptionExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const storedTier = row?.tier ?? "free";
  const { effectiveTier } = resolveEffectiveTier(
    isValidSubscriptionTier(storedTier) ? storedTier : "free",
    row?.expiresAt ?? null,
  );
  return effectiveTier;
}

export async function updateSubscription(
  userId: string,
  tier: SubscriptionTier,
  expiresAt: Date | null,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt })
    .where(eq(users.id, userId))
    .returning();
  return user || undefined;
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export async function getTransaction(
  transactionId: string,
): Promise<Transaction | undefined> {
  const [txn] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.transactionId, transactionId));
  return txn || undefined;
}

export async function createTransaction(
  data: InsertTransaction,
): Promise<Transaction> {
  const [txn] = await db.insert(transactions).values(data).returning();
  return txn;
}

export type ClaimResult =
  | { status: "created"; transaction: Transaction; user: User }
  | { status: "renewed"; transaction: Transaction; user: User }
  | { status: "conflict"; existingUserId: string };

/**
 * Claim a subscription for a user, keyed by the validated receipt's STABLE id
 * (`data.transactionId` = Apple `originalTransactionId` / Google purchaseToken,
 * derived server-side — never client-supplied). The global unique constraint on
 * `transactions.transactionId` enforces anti-sharing:
 *  - first claim of an id        → `created` (insert + upgrade)
 *  - same user re-claims the id  → `renewed` (a renewal carries the same id with
 *                                  a later expiry; refresh receipt + tier/expiry)
 *  - a different user claims it   → `conflict` (no writes; the caller rejects)
 *
 * Atomic: the transaction write and the user upgrade succeed or roll back
 * together. `onConflictDoNothing()` (no target — the only non-PK unique is
 * `transactionId`) makes the constraint the arbiter for concurrent claims.
 */
export async function claimTransactionAndUpgrade(
  data: InsertTransaction,
  tier: SubscriptionTier,
  expiresAt: Date | null,
): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(transactions)
      .values(data)
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      const [user] = await tx
        .update(users)
        .set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt })
        .where(eq(users.id, data.userId))
        .returning();
      if (!user) {
        throw new Error(
          `User ${data.userId} not found during subscription claim`,
        );
      }
      return { status: "created", transaction: inserted, user };
    }

    // Conflict: a row already holds this transactionId.
    const [existing] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, data.transactionId));

    // Different account (or a vanished row) — never grant entitlement.
    if (!existing || existing.userId !== data.userId) {
      return { status: "conflict", existingUserId: existing?.userId ?? "" };
    }

    // Same user re-claiming — a renewal. Refresh the stored receipt and extend
    // the user's expiry. GREATEST keeps expiry MONOTONIC so a stale / out-of-
    // order receipt (Apple emits the renewal txn ~24h before the period ends,
    // so both validate during the overlap) can never move expiry BACKWARD.
    // GREATEST ignores a NULL incoming, so it never wipes an existing date.
    const [txn] = await tx
      .update(transactions)
      .set({
        receipt: data.receipt,
        status: data.status ?? "completed",
        updatedAt: new Date(),
      })
      .where(eq(transactions.transactionId, data.transactionId))
      .returning();
    const [user] = await tx
      .update(users)
      .set({
        subscriptionTier: tier,
        subscriptionExpiresAt: sql`GREATEST(${users.subscriptionExpiresAt}, ${expiresAt})`,
      })
      .where(eq(users.id, data.userId))
      .returning();
    if (!user) {
      throw new Error(
        `User ${data.userId} not found during subscription renewal`,
      );
    }
    return { status: "renewed", transaction: txn, user };
  });
}

/**
 * Revoke a subscription identified by its stable transaction id (Apple
 * `originalTransactionId` / Google `purchaseToken`) — used by the store
 * refund/revoke/expire webhooks. Atomically downgrades the owning user to
 * `free` and marks the transaction `revoked`. Idempotent: an unknown id is a
 * no-op (returns `null`); re-revoking is a no-op. Returns the affected userId
 * so the caller can evict the tier cache.
 *
 * Not user-scoped by design (idor-safe): the store calls the webhook, so there
 * is no authenticated user to scope by. The route verifies the Apple JWS /
 * Google OIDC signature BEFORE calling — the signature is the authorization, an
 * external caller cannot reach this with an arbitrary id, and the globally
 * unique transactionId is what resolves the owning user.
 */
export async function revokeSubscriptionByTransactionId( // idor-safe
  transactionId: string,
): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    const [txn] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));

    if (!txn) return null;

    await tx
      .update(transactions)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(transactions.transactionId, transactionId));

    // Downgrade the owning user ONLY if this transaction was their active
    // entitlement source. Assumption: single-tier app, at most one active
    // subscription at a time, so the newest non-revoked `completed` transaction
    // is the source. If a NEWER completed transaction exists, the user
    // re-subscribed — a stale refund of the old sub must NOT cut off a paying
    // customer. (Residual: a newer-but-expired row briefly preserves premium —
    // it fails safe and self-heals via that row's own EXPIRED event, since
    // resolveEffectiveTier also downgrades expired-premium at read time.)
    const [newerActive] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, txn.userId),
          eq(transactions.status, "completed"),
          gt(transactions.createdAt, txn.createdAt),
        ),
      )
      .limit(1);

    if (!newerActive) {
      await tx
        .update(users)
        .set({ subscriptionTier: "free", subscriptionExpiresAt: null })
        .where(eq(users.id, txn.userId));
    }

    return { userId: txn.userId };
  });
}
