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
import { eq, and, inArray, sql, getTableColumns, gt, asc } from "drizzle-orm";
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
  | "adaptiveGoalsEnabled"
  | "lastGoalAdjustmentAt"
  | "onboardingCompleted"
  | "measurementUnit"
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
