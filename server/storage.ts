import {
  type User,
  type InsertUser,
  type ScannedItem,
  type InsertScannedItem,
  type DailyLog,
  type InsertDailyLog,
  type UserProfile,
  type InsertUserProfile,
  users,
  scannedItems,
  dailyLogs,
  userProfiles,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;

  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(
    userId: string,
    updates: Partial<InsertUserProfile>,
  ): Promise<UserProfile | undefined>;

  getScannedItems(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: ScannedItem[]; total: number }>;
  getScannedItem(id: number): Promise<ScannedItem | undefined>;
  createScannedItem(item: InsertScannedItem): Promise<ScannedItem>;

  getDailyLogs(userId: string, date: Date): Promise<DailyLog[]>;
  createDailyLog(log: InsertDailyLog): Promise<DailyLog>;
  getDailySummary(
    userId: string,
    date: Date,
  ): Promise<{
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    itemCount: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(
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

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [newProfile] = await db
      .insert(userProfiles)
      .values(profile)
      .returning();
    return newProfile;
  }

  async updateUserProfile(
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

  async getScannedItems(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: ScannedItem[]; total: number }> {
    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(scannedItems)
        .where(eq(scannedItems.userId, userId))
        .orderBy(desc(scannedItems.scannedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(scannedItems)
        .where(eq(scannedItems.userId, userId)),
    ]);
    return { items, total: Number(countResult[0]?.count ?? 0) };
  }

  async getScannedItem(id: number): Promise<ScannedItem | undefined> {
    const [item] = await db
      .select()
      .from(scannedItems)
      .where(eq(scannedItems.id, id));
    return item || undefined;
  }

  async createScannedItem(item: InsertScannedItem): Promise<ScannedItem> {
    const [scannedItem] = await db
      .insert(scannedItems)
      .values(item)
      .returning();
    return scannedItem;
  }

  async getDailyLogs(userId: string, date: Date): Promise<DailyLog[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return db
      .select()
      .from(dailyLogs)
      .where(
        and(
          eq(dailyLogs.userId, userId),
          gte(dailyLogs.loggedAt, startOfDay),
          lt(dailyLogs.loggedAt, endOfDay),
        ),
      )
      .orderBy(desc(dailyLogs.loggedAt));
  }

  async createDailyLog(log: InsertDailyLog): Promise<DailyLog> {
    const [dailyLog] = await db.insert(dailyLogs).values(log).returning();
    return dailyLog;
  }

  async getDailySummary(
    userId: string,
    date: Date,
  ): Promise<{
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    itemCount: number;
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({
        totalCalories: sql<number>`COALESCE(SUM(CAST(${scannedItems.calories} AS DECIMAL) * CAST(${dailyLogs.servings} AS DECIMAL)), 0)`,
        totalProtein: sql<number>`COALESCE(SUM(CAST(${scannedItems.protein} AS DECIMAL) * CAST(${dailyLogs.servings} AS DECIMAL)), 0)`,
        totalCarbs: sql<number>`COALESCE(SUM(CAST(${scannedItems.carbs} AS DECIMAL) * CAST(${dailyLogs.servings} AS DECIMAL)), 0)`,
        totalFat: sql<number>`COALESCE(SUM(CAST(${scannedItems.fat} AS DECIMAL) * CAST(${dailyLogs.servings} AS DECIMAL)), 0)`,
        itemCount: sql<number>`COUNT(${dailyLogs.id})`,
      })
      .from(dailyLogs)
      .innerJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
      .where(
        and(
          eq(dailyLogs.userId, userId),
          gte(dailyLogs.loggedAt, startOfDay),
          lt(dailyLogs.loggedAt, endOfDay),
        ),
      );

    return (
      result[0] || {
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      }
    );
  }
}

export const storage = new DatabaseStorage();
