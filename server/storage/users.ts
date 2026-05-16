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

/**
 * Atomically record a transaction and update the user's subscription tier.
 * Both operations succeed or both are rolled back.
 */
export async function createTransactionAndUpgrade(
  data: InsertTransaction,
  tier: SubscriptionTier,
  expiresAt: Date | null,
): Promise<{ transaction: Transaction; user: User }> {
  return db.transaction(async (tx) => {
    const [txn] = await tx.insert(transactions).values(data).returning();
    const [user] = await tx
      .update(users)
      .set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt })
      .where(eq(users.id, data.userId))
      .returning();
    if (!user) {
      throw new Error(
        `User ${data.userId} not found during subscription upgrade`,
      );
    }
    return { transaction: txn, user };
  });
}
