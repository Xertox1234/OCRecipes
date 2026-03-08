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
} from "@shared/schema";
import {
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";
import { db } from "../db";
import { eq, desc, and, gte, lte } from "drizzle-orm";

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
  const [created] = await db.insert(weightLogs).values(log).returning();
  return created;
}

export async function deleteWeightLog(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(weightLogs)
    .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)))
    .returning({ id: weightLogs.id });
  return result.length > 0;
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
