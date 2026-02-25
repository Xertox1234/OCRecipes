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
} from "@shared/schema";
import {
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";
import { db } from "../db";
import { eq } from "drizzle-orm";

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
