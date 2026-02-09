import {
  type User,
  type InsertUser,
  type ScannedItem,
  type InsertScannedItem,
  type DailyLog,
  type InsertDailyLog,
  type UserProfile,
  type InsertUserProfile,
  type SavedItem,
  type SuggestionData,
  type CommunityRecipe,
  type InsertCommunityRecipe,
  type MealPlanRecipe,
  type InsertMealPlanRecipe,
  type RecipeIngredient,
  type InsertRecipeIngredient,
  type MealPlanItem,
  type InsertMealPlanItem,
  type Transaction,
  type InsertTransaction,
  type GroceryList,
  type InsertGroceryList,
  type GroceryListItem,
  type InsertGroceryListItem,
  type MealSuggestionCacheEntry,
  users,
  scannedItems,
  dailyLogs,
  userProfiles,
  savedItems,
  suggestionCache,
  instructionCache,
  communityRecipes,
  recipeGenerationLog,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  transactions,
  groceryLists,
  groceryListItems,
  mealSuggestionCache,
} from "@shared/schema";
import { type CreateSavedItemInput } from "@shared/schemas/saved-items";
import { db } from "./db";
import { eq, desc, and, gte, lte, lt, gt, sql, or, ilike } from "drizzle-orm";
import {
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";

/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

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

  getSubscriptionStatus(userId: string): Promise<
    | {
        tier: SubscriptionTier;
        expiresAt: Date | null;
      }
    | undefined
  >;
  updateSubscription(
    userId: string,
    tier: SubscriptionTier,
    expiresAt: Date | null,
  ): Promise<User | undefined>;
  getDailyScanCount(userId: string, date: Date): Promise<number>;

  // Saved items
  getSavedItems(userId: string): Promise<SavedItem[]>;
  getSavedItemCount(userId: string): Promise<number>;
  createSavedItem(
    userId: string,
    item: CreateSavedItemInput,
  ): Promise<SavedItem | null>;
  deleteSavedItem(id: number, userId: string): Promise<boolean>;

  // Suggestion cache
  getSuggestionCache(
    scannedItemId: number,
    userId: string,
    profileHash: string,
  ): Promise<{ id: number; suggestions: SuggestionData[] } | undefined>;
  createSuggestionCache(
    scannedItemId: number,
    userId: string,
    profileHash: string,
    suggestions: SuggestionData[],
    expiresAt: Date,
  ): Promise<{ id: number }>;
  incrementSuggestionCacheHit(id: number): Promise<void>;

  // Instruction cache
  getInstructionCache(
    suggestionCacheId: number,
    suggestionIndex: number,
  ): Promise<{ id: number; instructions: string } | undefined>;
  createInstructionCache(
    suggestionCacheId: number,
    suggestionIndex: number,
    suggestionTitle: string,
    suggestionType: string,
    instructions: string,
  ): Promise<void>;
  incrementInstructionCacheHit(id: number): Promise<void>;

  // Invalidation
  invalidateSuggestionCacheForUser(userId: string): Promise<number>;

  // Community recipes
  getDailyRecipeGenerationCount(userId: string, date: Date): Promise<number>;
  logRecipeGeneration(userId: string, recipeId: number): Promise<void>;
  getCommunityRecipes(
    barcode: string | null,
    normalizedProductName: string,
  ): Promise<CommunityRecipe[]>;
  createCommunityRecipe(
    data: Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
  ): Promise<CommunityRecipe>;
  updateRecipePublicStatus(
    recipeId: number,
    authorId: string,
    isPublic: boolean,
  ): Promise<CommunityRecipe | undefined>;
  getCommunityRecipe(id: number): Promise<CommunityRecipe | undefined>;
  deleteCommunityRecipe(recipeId: number, authorId: string): Promise<boolean>;
  getUserRecipes(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: CommunityRecipe[]; total: number }>;

  // Transactions
  getTransaction(transactionId: string): Promise<Transaction | undefined>;
  createTransaction(data: InsertTransaction): Promise<Transaction>;

  // Meal plan recipes
  findMealPlanRecipeByExternalId(
    userId: string,
    externalId: string,
  ): Promise<MealPlanRecipe | undefined>;
  getMealPlanRecipe(id: number): Promise<MealPlanRecipe | undefined>;
  getMealPlanRecipeWithIngredients(
    id: number,
  ): Promise<
    (MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined
  >;
  getUserMealPlanRecipes(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: MealPlanRecipe[]; total: number }>;
  createMealPlanRecipe(
    recipe: InsertMealPlanRecipe,
    ingredients?: InsertRecipeIngredient[],
  ): Promise<MealPlanRecipe>;
  updateMealPlanRecipe(
    id: number,
    userId: string,
    updates: Partial<InsertMealPlanRecipe>,
  ): Promise<MealPlanRecipe | undefined>;
  deleteMealPlanRecipe(id: number, userId: string): Promise<boolean>;

  // Meal plan items
  getMealPlanItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    (MealPlanItem & {
      recipe: MealPlanRecipe | null;
      scannedItem: ScannedItem | null;
    })[]
  >;
  addMealPlanItem(item: InsertMealPlanItem): Promise<MealPlanItem>;
  removeMealPlanItem(id: number, userId: string): Promise<boolean>;

  // Grocery lists
  createGroceryList(list: InsertGroceryList): Promise<GroceryList>;
  getGroceryLists(userId: string): Promise<GroceryList[]>;
  getGroceryListWithItems(
    id: number,
    userId: string,
  ): Promise<(GroceryList & { items: GroceryListItem[] }) | undefined>;
  deleteGroceryList(id: number, userId: string): Promise<boolean>;
  addGroceryListItem(item: InsertGroceryListItem): Promise<GroceryListItem>;
  updateGroceryListItemChecked(
    id: number,
    groceryListId: number,
    isChecked: boolean,
  ): Promise<GroceryListItem | undefined>;
  deleteGroceryListItem(id: number, groceryListId: number): Promise<boolean>;

  // Meal suggestion cache
  getMealSuggestionCache(
    cacheKey: string,
  ): Promise<MealSuggestionCacheEntry | undefined>;
  createMealSuggestionCache(
    cacheKey: string,
    userId: string,
    suggestions: unknown,
    expiresAt: Date,
  ): Promise<MealSuggestionCacheEntry>;
  incrementMealSuggestionCacheHit(id: number): Promise<void>;
  getDailyMealSuggestionCount(userId: string, date: Date): Promise<number>;

  // Aggregation
  getMealPlanIngredientsForDateRange(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<RecipeIngredient[]>;
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

  async getSubscriptionStatus(userId: string): Promise<
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

  async updateSubscription(
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

  async getDailyScanCount(userId: string, date: Date): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(scannedItems)
      .where(
        and(
          eq(scannedItems.userId, userId),
          gte(scannedItems.scannedAt, startOfDay),
          lt(scannedItems.scannedAt, endOfDay),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }

  async getSavedItems(userId: string): Promise<SavedItem[]> {
    return db
      .select()
      .from(savedItems)
      .where(eq(savedItems.userId, userId))
      .orderBy(desc(savedItems.createdAt));
  }

  async getSavedItemCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, userId));
    return result[0]?.count ?? 0;
  }

  async createSavedItem(
    userId: string,
    itemData: CreateSavedItemInput,
  ): Promise<SavedItem | null> {
    // Simple count check - sufficient for single-user mobile app
    // Worst case race condition: user gets 7 items instead of 6. Not catastrophic.
    const count = await this.getSavedItemCount(userId);
    const subscription = await this.getSubscriptionStatus(userId);
    const isPremium = subscription?.tier === "premium";
    const limit = isPremium ? Infinity : 6;

    if (count >= limit) {
      return null; // Signal limit reached
    }

    const [item] = await db
      .insert(savedItems)
      .values({ ...itemData, userId })
      .returning();

    return item;
  }

  async deleteSavedItem(id: number, userId: string): Promise<boolean> {
    // IDOR protection: only delete if owned by user
    const result = await db
      .delete(savedItems)
      .where(and(eq(savedItems.id, id), eq(savedItems.userId, userId)))
      .returning({ id: savedItems.id });

    return result.length > 0;
  }

  async getSuggestionCache(
    scannedItemId: number,
    userId: string,
    profileHash: string,
  ): Promise<{ id: number; suggestions: SuggestionData[] } | undefined> {
    const [cached] = await db
      .select({
        id: suggestionCache.id,
        suggestions: suggestionCache.suggestions,
      })
      .from(suggestionCache)
      .where(
        and(
          eq(suggestionCache.scannedItemId, scannedItemId),
          eq(suggestionCache.userId, userId),
          eq(suggestionCache.profileHash, profileHash),
          gt(suggestionCache.expiresAt, new Date()),
        ),
      );
    return cached || undefined;
  }

  async createSuggestionCache(
    scannedItemId: number,
    userId: string,
    profileHash: string,
    suggestions: SuggestionData[],
    expiresAt: Date,
  ): Promise<{ id: number }> {
    const [result] = await db
      .insert(suggestionCache)
      .values({
        scannedItemId,
        userId,
        profileHash,
        suggestions,
        expiresAt,
      })
      .returning({ id: suggestionCache.id });
    return result;
  }

  async incrementSuggestionCacheHit(id: number): Promise<void> {
    await db
      .update(suggestionCache)
      .set({ hitCount: sql`${suggestionCache.hitCount} + 1` })
      .where(eq(suggestionCache.id, id));
  }

  async getInstructionCache(
    suggestionCacheId: number,
    suggestionIndex: number,
  ): Promise<{ id: number; instructions: string } | undefined> {
    const [cached] = await db
      .select({
        id: instructionCache.id,
        instructions: instructionCache.instructions,
      })
      .from(instructionCache)
      .where(
        and(
          eq(instructionCache.suggestionCacheId, suggestionCacheId),
          eq(instructionCache.suggestionIndex, suggestionIndex),
        ),
      );
    return cached || undefined;
  }

  async createInstructionCache(
    suggestionCacheId: number,
    suggestionIndex: number,
    suggestionTitle: string,
    suggestionType: string,
    instructions: string,
  ): Promise<void> {
    await db.insert(instructionCache).values({
      suggestionCacheId,
      suggestionIndex,
      suggestionTitle,
      suggestionType,
      instructions,
    });
  }

  async incrementInstructionCacheHit(id: number): Promise<void> {
    await db
      .update(instructionCache)
      .set({ hitCount: sql`${instructionCache.hitCount} + 1` })
      .where(eq(instructionCache.id, id));
  }

  async invalidateSuggestionCacheForUser(userId: string): Promise<number> {
    const result = await db
      .delete(suggestionCache)
      .where(eq(suggestionCache.userId, userId))
      .returning({ id: suggestionCache.id });
    return result.length;
  }

  // Community recipes methods

  async getDailyRecipeGenerationCount(
    userId: string,
    date: Date,
  ): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }

  async logRecipeGeneration(userId: string, recipeId: number): Promise<void> {
    await db.insert(recipeGenerationLog).values({
      userId,
      recipeId,
    });
  }

  async getCommunityRecipes(
    barcode: string | null,
    normalizedProductName: string,
  ): Promise<CommunityRecipe[]> {
    // Try exact barcode match first, then fall back to fuzzy name match
    const conditions = [eq(communityRecipes.isPublic, true)];

    if (barcode) {
      // With barcode: match by barcode OR similar product name
      conditions.push(
        or(
          eq(communityRecipes.barcode, barcode),
          ilike(
            communityRecipes.normalizedProductName,
            `%${escapeLike(normalizedProductName)}%`,
          ),
        )!,
      );
    } else {
      // Without barcode: fuzzy match on product name only
      conditions.push(
        ilike(
          communityRecipes.normalizedProductName,
          `%${escapeLike(normalizedProductName)}%`,
        ),
      );
    }

    return db
      .select()
      .from(communityRecipes)
      .where(and(...conditions))
      .orderBy(
        desc(communityRecipes.likeCount),
        desc(communityRecipes.createdAt),
      )
      .limit(10);
  }

  async createCommunityRecipe(
    data: Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
  ): Promise<CommunityRecipe> {
    const [recipe] = await db.insert(communityRecipes).values(data).returning();
    return recipe;
  }

  async updateRecipePublicStatus(
    recipeId: number,
    authorId: string,
    isPublic: boolean,
  ): Promise<CommunityRecipe | undefined> {
    const [recipe] = await db
      .update(communityRecipes)
      .set({ isPublic, updatedAt: new Date() })
      .where(
        and(
          eq(communityRecipes.id, recipeId),
          eq(communityRecipes.authorId, authorId),
        ),
      )
      .returning();
    return recipe || undefined;
  }

  async getCommunityRecipe(id: number): Promise<CommunityRecipe | undefined> {
    const [recipe] = await db
      .select()
      .from(communityRecipes)
      .where(eq(communityRecipes.id, id));
    return recipe || undefined;
  }

  async deleteCommunityRecipe(
    recipeId: number,
    authorId: string,
  ): Promise<boolean> {
    // IDOR protection: only delete if owned by user
    const result = await db
      .delete(communityRecipes)
      .where(
        and(
          eq(communityRecipes.id, recipeId),
          eq(communityRecipes.authorId, authorId),
        ),
      )
      .returning({ id: communityRecipes.id });

    return result.length > 0;
  }

  async getUserRecipes(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: CommunityRecipe[]; total: number }> {
    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.authorId, userId))
        .orderBy(desc(communityRecipes.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(communityRecipes)
        .where(eq(communityRecipes.authorId, userId)),
    ]);
    return { items, total: Number(countResult[0]?.count ?? 0) };
  }

  // ============================================================================
  // TRANSACTIONS
  // ============================================================================

  async getTransaction(
    transactionId: string,
  ): Promise<Transaction | undefined> {
    const [txn] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionId, transactionId));
    return txn || undefined;
  }

  async createTransaction(data: InsertTransaction): Promise<Transaction> {
    const [txn] = await db.insert(transactions).values(data).returning();
    return txn;
  }

  // ============================================================================
  // MEAL PLAN RECIPES
  // ============================================================================

  async findMealPlanRecipeByExternalId(
    userId: string,
    externalId: string,
  ): Promise<MealPlanRecipe | undefined> {
    const [recipe] = await db
      .select()
      .from(mealPlanRecipes)
      .where(
        and(
          eq(mealPlanRecipes.userId, userId),
          eq(mealPlanRecipes.externalId, externalId),
        ),
      );
    return recipe || undefined;
  }

  async getMealPlanRecipe(id: number): Promise<MealPlanRecipe | undefined> {
    const [recipe] = await db
      .select()
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.id, id));
    return recipe || undefined;
  }

  async getMealPlanRecipeWithIngredients(
    id: number,
  ): Promise<
    (MealPlanRecipe & { ingredients: RecipeIngredient[] }) | undefined
  > {
    const [recipe, ingredients] = await Promise.all([
      this.getMealPlanRecipe(id),
      db
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, id))
        .orderBy(recipeIngredients.displayOrder),
    ]);

    if (!recipe) return undefined;

    return { ...recipe, ingredients };
  }

  async getUserMealPlanRecipes(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: MealPlanRecipe[]; total: number }> {
    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.userId, userId))
        .orderBy(desc(mealPlanRecipes.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.userId, userId)),
    ]);
    return { items, total: Number(countResult[0]?.count ?? 0) };
  }

  async createMealPlanRecipe(
    recipe: InsertMealPlanRecipe,
    ingredients?: InsertRecipeIngredient[],
  ): Promise<MealPlanRecipe> {
    if (ingredients && ingredients.length > 0) {
      return db.transaction(async (tx) => {
        const [created] = await tx
          .insert(mealPlanRecipes)
          .values(recipe)
          .returning();
        await tx.insert(recipeIngredients).values(
          ingredients.map((ing, idx) => ({
            ...ing,
            recipeId: created.id,
            displayOrder: ing.displayOrder ?? idx,
          })),
        );
        return created;
      });
    }

    const [created] = await db
      .insert(mealPlanRecipes)
      .values(recipe)
      .returning();
    return created;
  }

  async updateMealPlanRecipe(
    id: number,
    userId: string,
    updates: Partial<InsertMealPlanRecipe>,
  ): Promise<MealPlanRecipe | undefined> {
    const [recipe] = await db
      .update(mealPlanRecipes)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)),
      )
      .returning();
    return recipe || undefined;
  }

  async deleteMealPlanRecipe(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(mealPlanRecipes)
      .where(
        and(eq(mealPlanRecipes.id, id), eq(mealPlanRecipes.userId, userId)),
      )
      .returning({ id: mealPlanRecipes.id });
    return result.length > 0;
  }

  // ============================================================================
  // MEAL PLAN ITEMS
  // ============================================================================

  async getMealPlanItems(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<
    (MealPlanItem & {
      recipe: MealPlanRecipe | null;
      scannedItem: ScannedItem | null;
    })[]
  > {
    const items = await db
      .select()
      .from(mealPlanItems)
      .where(
        and(
          eq(mealPlanItems.userId, userId),
          gte(mealPlanItems.plannedDate, startDate),
          lte(mealPlanItems.plannedDate, endDate),
        ),
      )
      .orderBy(mealPlanItems.plannedDate, mealPlanItems.createdAt);

    // Batch-fetch related recipes and scanned items
    const recipeIds = [
      ...new Set(items.filter((i) => i.recipeId).map((i) => i.recipeId!)),
    ];
    const scannedItemIds = [
      ...new Set(
        items.filter((i) => i.scannedItemId).map((i) => i.scannedItemId!),
      ),
    ];

    const recipesMap = new Map<number, MealPlanRecipe>();
    const scannedItemsMap = new Map<number, ScannedItem>();

    if (recipeIds.length > 0) {
      const recipes = await db
        .select()
        .from(mealPlanRecipes)
        .where(
          sql`${mealPlanRecipes.id} IN (${sql.join(
            recipeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const r of recipes) recipesMap.set(r.id, r);
    }

    if (scannedItemIds.length > 0) {
      const scanned = await db
        .select()
        .from(scannedItems)
        .where(
          sql`${scannedItems.id} IN (${sql.join(
            scannedItemIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const s of scanned) scannedItemsMap.set(s.id, s);
    }

    return items.map((item) => ({
      ...item,
      recipe: item.recipeId ? recipesMap.get(item.recipeId) || null : null,
      scannedItem: item.scannedItemId
        ? scannedItemsMap.get(item.scannedItemId) || null
        : null,
    }));
  }

  async addMealPlanItem(item: InsertMealPlanItem): Promise<MealPlanItem> {
    const [created] = await db.insert(mealPlanItems).values(item).returning();
    return created;
  }

  async removeMealPlanItem(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)))
      .returning({ id: mealPlanItems.id });
    return result.length > 0;
  }

  // ============================================================================
  // GROCERY LISTS
  // ============================================================================

  async createGroceryList(list: InsertGroceryList): Promise<GroceryList> {
    const [created] = await db.insert(groceryLists).values(list).returning();
    return created;
  }

  async getGroceryLists(userId: string): Promise<GroceryList[]> {
    return db
      .select()
      .from(groceryLists)
      .where(eq(groceryLists.userId, userId))
      .orderBy(desc(groceryLists.createdAt));
  }

  async getGroceryListWithItems(
    id: number,
    userId: string,
  ): Promise<(GroceryList & { items: GroceryListItem[] }) | undefined> {
    const [list] = await db
      .select()
      .from(groceryLists)
      .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)));
    if (!list) return undefined;

    const items = await db
      .select()
      .from(groceryListItems)
      .where(eq(groceryListItems.groceryListId, id))
      .orderBy(groceryListItems.category, groceryListItems.name);

    return { ...list, items };
  }

  async deleteGroceryList(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(groceryLists)
      .where(and(eq(groceryLists.id, id), eq(groceryLists.userId, userId)))
      .returning({ id: groceryLists.id });
    return result.length > 0;
  }

  async addGroceryListItem(
    item: InsertGroceryListItem,
  ): Promise<GroceryListItem> {
    const [created] = await db
      .insert(groceryListItems)
      .values(item)
      .returning();
    return created;
  }

  async updateGroceryListItemChecked(
    id: number,
    groceryListId: number,
    isChecked: boolean,
  ): Promise<GroceryListItem | undefined> {
    const [updated] = await db
      .update(groceryListItems)
      .set({
        isChecked,
        checkedAt: isChecked ? new Date() : null,
      })
      .where(
        and(
          eq(groceryListItems.id, id),
          eq(groceryListItems.groceryListId, groceryListId),
        ),
      )
      .returning();
    return updated || undefined;
  }

  async deleteGroceryListItem(
    id: number,
    groceryListId: number,
  ): Promise<boolean> {
    const result = await db
      .delete(groceryListItems)
      .where(
        and(
          eq(groceryListItems.id, id),
          eq(groceryListItems.groceryListId, groceryListId),
        ),
      )
      .returning({ id: groceryListItems.id });
    return result.length > 0;
  }

  // ============================================================================
  // MEAL SUGGESTION CACHE
  // ============================================================================

  async getMealSuggestionCache(
    cacheKey: string,
  ): Promise<MealSuggestionCacheEntry | undefined> {
    const [cached] = await db
      .select()
      .from(mealSuggestionCache)
      .where(
        and(
          eq(mealSuggestionCache.cacheKey, cacheKey),
          gt(mealSuggestionCache.expiresAt, new Date()),
        ),
      );
    return cached || undefined;
  }

  async createMealSuggestionCache(
    cacheKey: string,
    userId: string,
    suggestions: unknown,
    expiresAt: Date,
  ): Promise<MealSuggestionCacheEntry> {
    const [created] = await db
      .insert(mealSuggestionCache)
      .values({ cacheKey, userId, suggestions, expiresAt })
      .returning();
    return created;
  }

  async incrementMealSuggestionCacheHit(id: number): Promise<void> {
    await db
      .update(mealSuggestionCache)
      .set({ hitCount: sql`${mealSuggestionCache.hitCount} + 1` })
      .where(eq(mealSuggestionCache.id, id));
  }

  async getDailyMealSuggestionCount(
    userId: string,
    date: Date,
  ): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(mealSuggestionCache)
      .where(
        and(
          eq(mealSuggestionCache.userId, userId),
          gte(mealSuggestionCache.createdAt, startOfDay),
          lt(mealSuggestionCache.createdAt, endOfDay),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }

  // ============================================================================
  // AGGREGATION
  // ============================================================================

  async getMealPlanIngredientsForDateRange(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<RecipeIngredient[]> {
    // Get all recipe IDs from meal plan items in the date range
    const items = await db
      .select({ recipeId: mealPlanItems.recipeId })
      .from(mealPlanItems)
      .where(
        and(
          eq(mealPlanItems.userId, userId),
          gte(mealPlanItems.plannedDate, startDate),
          lte(mealPlanItems.plannedDate, endDate),
          sql`${mealPlanItems.recipeId} IS NOT NULL`,
        ),
      );

    const recipeIds = [
      ...new Set(items.filter((i) => i.recipeId).map((i) => i.recipeId!)),
    ];

    if (recipeIds.length === 0) return [];

    return db
      .select()
      .from(recipeIngredients)
      .where(
        sql`${recipeIngredients.recipeId} IN (${sql.join(
          recipeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
  }
}

export const storage = new DatabaseStorage();
