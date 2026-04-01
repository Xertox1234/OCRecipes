import {
  type User,
  type InsertUser,
  type UserProfile,
  type InsertUserProfile,
  type Transaction,
  type InsertTransaction,
  type WeightLog,
  type InsertWeightLog,
  type HealthKitSyncEntry,
  users,
  userProfiles,
  transactions,
  weightLogs,
  healthKitSync,
  communityRecipes,
  cookbookRecipes,
} from "@shared/schema";
import {
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";
import { db } from "../db";
import { eq, desc, and, gte, lte, inArray } from "drizzle-orm";

// ============================================================================
// USER CRUD
// ============================================================================

export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || undefined;
}

export async function getUserByUsername(
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

export async function updateUser(
  id: string,
  updates: Partial<User>,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set(updates)
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
  return db.transaction(async (tx) => {
    // Community recipes use onDelete: "set null" so they must be explicitly removed.
    // Also clean up any cookbook junction rows referencing those recipes.
    const orphanedRecipes = await tx
      .select({ id: communityRecipes.id })
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, id));

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
        .delete(communityRecipes)
        .where(eq(communityRecipes.authorId, id));
    }

    const result = await tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return result.length > 0;
  });
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

export async function updateUserProfile(
  userId: string,
  updates: Partial<InsertUserProfile>,
): Promise<UserProfile | undefined> {
  const [profile] = await db
    .update(userProfiles)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId))
    .returning();
  return profile || undefined;
}

/**
 * Atomically upserts a user profile and marks onboarding as complete.
 * Used by the POST /api/user/dietary-profile onboarding endpoint.
 */
export async function upsertProfileWithOnboarding(
  userId: string,
  profileData: Omit<InsertUserProfile, "userId">,
): Promise<UserProfile> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    let result: UserProfile;
    if (existing) {
      [result] = await tx
        .update(userProfiles)
        .set({ ...profileData, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId))
        .returning();
    } else {
      [result] = await tx
        .insert(userProfiles)
        .values({ ...profileData, userId })
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

// ============================================================================
// WEIGHT LOGS
// ============================================================================

export async function getWeightLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<WeightLog[]> {
  const conditions = [eq(weightLogs.userId, userId)];
  if (options?.from) {
    conditions.push(gte(weightLogs.loggedAt, options.from));
  }
  if (options?.to) {
    conditions.push(lte(weightLogs.loggedAt, options.to));
  }
  const effectiveLimit = options?.limit ?? 100;
  return db
    .select()
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(desc(weightLogs.loggedAt))
    .limit(effectiveLimit);
}

export async function createWeightLog(
  log: InsertWeightLog,
): Promise<WeightLog> {
  const [created] = await db
    .insert(weightLogs)
    .values(log)
    .onConflictDoUpdate({
      target: [weightLogs.userId, weightLogs.loggedAt],
      set: { weight: log.weight, source: log.source, note: log.note },
    })
    .returning();
  return created;
}

/** Create weight log and update user's current weight atomically */
export async function createWeightLogAndUpdateUser(
  log: InsertWeightLog,
): Promise<WeightLog> {
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(weightLogs)
      .values(log)
      .onConflictDoUpdate({
        target: [weightLogs.userId, weightLogs.loggedAt],
        set: { weight: log.weight, source: log.source, note: log.note },
      })
      .returning();
    await tx
      .update(users)
      .set({ weight: log.weight })
      .where(eq(users.id, log.userId));
    return created;
  });
}

/** Delete weight log and update user's current weight to the latest remaining log */
export async function deleteWeightLog(
  id: number,
  userId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = await tx
      .delete(weightLogs)
      .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)))
      .returning({ id: weightLogs.id });
    if (result.length === 0) return false;

    // Revert users.weight to the latest remaining log (or null if none)
    const [latest] = await tx
      .select({ weight: weightLogs.weight })
      .from(weightLogs)
      .where(eq(weightLogs.userId, userId))
      .orderBy(desc(weightLogs.loggedAt))
      .limit(1);
    await tx
      .update(users)
      .set({ weight: latest?.weight ?? null })
      .where(eq(users.id, userId));
    return true;
  });
}

export async function getLatestWeight(
  userId: string,
): Promise<WeightLog | undefined> {
  const [latest] = await db
    .select()
    .from(weightLogs)
    .where(eq(weightLogs.userId, userId))
    .orderBy(desc(weightLogs.loggedAt))
    .limit(1);
  return latest;
}

// ============================================================================
// HEALTHKIT SYNC
// ============================================================================

export async function getHealthKitSyncSettings(
  userId: string,
): Promise<HealthKitSyncEntry[]> {
  return db
    .select()
    .from(healthKitSync)
    .where(eq(healthKitSync.userId, userId));
}

export async function upsertHealthKitSyncSetting(
  userId: string,
  dataType: string,
  enabled: boolean,
  syncDirection?: string,
): Promise<HealthKitSyncEntry> {
  const [result] = await db
    .insert(healthKitSync)
    .values({
      userId,
      dataType,
      enabled,
      syncDirection: syncDirection ?? "read",
    })
    .onConflictDoUpdate({
      target: [healthKitSync.userId, healthKitSync.dataType],
      set: {
        enabled,
        ...(syncDirection ? { syncDirection } : {}),
      },
    })
    .returning();
  return result;
}

export async function updateHealthKitLastSync(
  userId: string,
  dataType: string,
): Promise<void> {
  await db
    .update(healthKitSync)
    .set({ lastSyncAt: new Date() })
    .where(
      and(
        eq(healthKitSync.userId, userId),
        eq(healthKitSync.dataType, dataType),
      ),
    );
}
