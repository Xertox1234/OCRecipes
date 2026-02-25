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
  type PantryItem,
  type InsertPantryItem,
  type WeightLog,
  type InsertWeightLog,
  type ExerciseLog,
  type InsertExerciseLog,
  type ExerciseLibraryEntry,
  type InsertExerciseLibraryEntry,
  type HealthKitSyncEntry,
  type ChatConversation,
  type ChatMessage,
  type MedicationLog,
  type InsertMedicationLog,
  type GoalAdjustmentLog,
  type InsertGoalAdjustmentLog,
  type FastingSchedule,
  type InsertFastingSchedule,
  type FastingLog,
  type InsertFastingLog,
  type MenuScan,
  type InsertMenuScan,
  fastingSchedules,
  fastingLogs,
  menuScans,
  healthKitSync,
  chatConversations,
  chatMessages,
  weightLogs,
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
  pantryItems,
  mealSuggestionCache,
  favouriteScannedItems,
  exerciseLogs,
  exerciseLibrary,
  medicationLogs,
  goalAdjustmentLogs,
  micronutrientCache,
} from "@shared/schema";
import { type CreateSavedItemInput } from "@shared/schemas/saved-items";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { db } from "./db";
import {
  eq,
  desc,
  and,
  gte,
  lte,
  lt,
  gt,
  sql,
  or,
  ilike,
  isNull,
  inArray,
} from "drizzle-orm";
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
  ): Promise<{
    items: (ScannedItem & { isFavourited: boolean })[];
    total: number;
  }>;
  getScannedItem(id: number): Promise<ScannedItem | undefined>;
  getScannedItemsByIds(ids: number[], userId?: string): Promise<ScannedItem[]>;
  getScannedItemWithFavourite(
    id: number,
    userId: string,
  ): Promise<(ScannedItem & { isFavourited: boolean }) | undefined>;
  createScannedItem(item: InsertScannedItem): Promise<ScannedItem>;
  softDeleteScannedItem(id: number, userId: string): Promise<boolean>;
  toggleFavouriteScannedItem(
    scannedItemId: number,
    userId: string,
  ): Promise<boolean>;
  getFavouriteScannedItems(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    items: (ScannedItem & { isFavourited: boolean })[];
    total: number;
  }>;

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
  getSavedItems(userId: string, limit?: number): Promise<SavedItem[]>;
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
  getFeaturedRecipes(
    limit?: number,
    offset?: number,
  ): Promise<CommunityRecipe[]>;
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
  getUnifiedRecipes(params: {
    userId: string;
    query?: string;
    cuisine?: string;
    diet?: string;
    limit?: number;
  }): Promise<{ community: CommunityRecipe[]; personal: MealPlanRecipe[] }>;

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
  getMealPlanItemById(
    id: number,
    userId: string,
  ): Promise<
    | (MealPlanItem & {
        recipe: MealPlanRecipe | null;
        scannedItem: ScannedItem | null;
      })
    | undefined
  >;
  addMealPlanItem(item: InsertMealPlanItem): Promise<MealPlanItem>;
  removeMealPlanItem(id: number, userId: string): Promise<boolean>;

  // Grocery lists
  createGroceryList(list: InsertGroceryList): Promise<GroceryList>;
  getGroceryLists(userId: string, limit?: number): Promise<GroceryList[]>;
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
    suggestions: MealSuggestion[],
    expiresAt: Date,
  ): Promise<MealSuggestionCacheEntry>;
  incrementMealSuggestionCacheHit(id: number): Promise<void>;
  getDailyMealSuggestionCount(userId: string, date: Date): Promise<number>;

  // Pantry items
  getPantryItems(userId: string, limit?: number): Promise<PantryItem[]>;
  getPantryItem(id: number, userId: string): Promise<PantryItem | undefined>;
  createPantryItem(item: InsertPantryItem): Promise<PantryItem>;
  updatePantryItem(
    id: number,
    userId: string,
    updates: Partial<InsertPantryItem>,
  ): Promise<PantryItem | undefined>;
  deletePantryItem(id: number, userId: string): Promise<boolean>;
  getExpiringPantryItems(
    userId: string,
    withinDays: number,
  ): Promise<PantryItem[]>;

  // Grocery item pantry flag
  updateGroceryListItemPantryFlag(
    id: number,
    groceryListId: number,
    addedToPantry: boolean,
  ): Promise<GroceryListItem | undefined>;

  // Meal confirmation helpers
  getConfirmedMealPlanItemIds(userId: string, date: Date): Promise<number[]>;
  getPlannedNutritionSummary(
    userId: string,
    date: Date,
    confirmedIds?: number[],
  ): Promise<{
    plannedCalories: number;
    plannedProtein: number;
    plannedCarbs: number;
    plannedFat: number;
    plannedItemCount: number;
  }>;

  // Aggregation
  getMealPlanIngredientsForDateRange(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<RecipeIngredient[]>;

  // Weight logs
  getWeightLogs(
    userId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<WeightLog[]>;
  createWeightLog(log: InsertWeightLog): Promise<WeightLog>;
  deleteWeightLog(id: number, userId: string): Promise<boolean>;
  getLatestWeight(userId: string): Promise<WeightLog | undefined>;

  // Exercise logs
  getExerciseLogs(
    userId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<ExerciseLog[]>;
  createExerciseLog(log: InsertExerciseLog): Promise<ExerciseLog>;
  updateExerciseLog(
    id: number,
    userId: string,
    updates: Partial<InsertExerciseLog>,
  ): Promise<ExerciseLog | undefined>;
  deleteExerciseLog(id: number, userId: string): Promise<boolean>;
  getExerciseDailySummary(
    userId: string,
    date: Date,
  ): Promise<{
    totalCaloriesBurned: number;
    totalMinutes: number;
    exerciseCount: number;
  }>;

  // Exercise library
  searchExerciseLibrary(
    query: string,
    userId?: string,
  ): Promise<ExerciseLibraryEntry[]>;
  createExerciseLibraryEntry(
    entry: InsertExerciseLibraryEntry,
  ): Promise<ExerciseLibraryEntry>;

  // Chat conversations
  getChatConversation(
    id: number,
    userId: string,
  ): Promise<ChatConversation | undefined>;
  getChatConversations(
    userId: string,
    limit?: number,
  ): Promise<ChatConversation[]>;
  createChatConversation(
    userId: string,
    title: string,
  ): Promise<ChatConversation>;
  getChatMessages(
    conversationId: number,
    limit?: number,
  ): Promise<ChatMessage[]>;
  createChatMessage(
    conversationId: number,
    role: string,
    content: string,
    metadata?: unknown,
  ): Promise<ChatMessage>;
  deleteChatConversation(id: number, userId: string): Promise<boolean>;
  updateChatConversationTitle(
    id: number,
    userId: string,
    title: string,
  ): Promise<ChatConversation | undefined>;
  getDailyChatMessageCount(userId: string, date: Date): Promise<number>;

  // HealthKit sync
  getHealthKitSyncSettings(userId: string): Promise<HealthKitSyncEntry[]>;
  upsertHealthKitSyncSetting(
    userId: string,
    dataType: string,
    enabled: boolean,
    syncDirection?: string,
  ): Promise<HealthKitSyncEntry>;
  updateHealthKitLastSync(userId: string, dataType: string): Promise<void>;

  // Medication logs (GLP-1)
  getMedicationLogs(
    userId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<MedicationLog[]>;
  createMedicationLog(log: InsertMedicationLog): Promise<MedicationLog>;
  updateMedicationLog(
    id: number,
    userId: string,
    updates: Partial<InsertMedicationLog>,
  ): Promise<MedicationLog | undefined>;
  deleteMedicationLog(id: number, userId: string): Promise<boolean>;

  // Goal adjustment logs (Adaptive Goals)
  createGoalAdjustmentLog(
    log: InsertGoalAdjustmentLog,
  ): Promise<GoalAdjustmentLog>;
  getGoalAdjustmentLogs(
    userId: string,
    limit?: number,
  ): Promise<GoalAdjustmentLog[]>;

  // Menu scans
  getMenuScans(userId: string, limit?: number): Promise<MenuScan[]>;
  createMenuScan(scan: InsertMenuScan): Promise<MenuScan>;
  deleteMenuScan(id: number, userId: string): Promise<boolean>;

  // Fasting
  getFastingSchedule(userId: string): Promise<FastingSchedule | undefined>;
  upsertFastingSchedule(
    userId: string,
    schedule: Omit<InsertFastingSchedule, "userId">,
  ): Promise<FastingSchedule>;
  getActiveFastingLog(userId: string): Promise<FastingLog | undefined>;
  getFastingLogs(userId: string, limit?: number): Promise<FastingLog[]>;
  createFastingLog(log: InsertFastingLog): Promise<FastingLog>;
  endFastingLog(
    id: number,
    userId: string,
    endedAt: Date,
    actualDurationMinutes: number,
    completed: boolean,
    note?: string,
  ): Promise<FastingLog | undefined>;

  // Micronutrient cache
  getMicronutrientCache(queryKey: string): Promise<unknown[] | undefined>;
  setMicronutrientCache(
    queryKey: string,
    data: unknown[],
    ttlMs: number,
  ): Promise<void>;
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
  ): Promise<{
    items: (ScannedItem & { isFavourited: boolean })[];
    total: number;
  }> {
    const activeFilter = and(
      eq(scannedItems.userId, userId),
      isNull(scannedItems.discardedAt),
    );

    const [rows, countResult] = await Promise.all([
      db
        .select({
          item: scannedItems,
          favouriteId: favouriteScannedItems.id,
        })
        .from(scannedItems)
        .leftJoin(
          favouriteScannedItems,
          and(
            eq(favouriteScannedItems.scannedItemId, scannedItems.id),
            eq(favouriteScannedItems.userId, userId),
          ),
        )
        .where(activeFilter)
        .orderBy(desc(scannedItems.scannedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(scannedItems)
        .where(activeFilter),
    ]);

    const items = rows.map((row) => ({
      ...row.item,
      isFavourited: row.favouriteId !== null,
    }));

    return { items, total: Number(countResult[0]?.count ?? 0) };
  }

  async getScannedItem(id: number): Promise<ScannedItem | undefined> {
    const [item] = await db
      .select()
      .from(scannedItems)
      .where(and(eq(scannedItems.id, id), isNull(scannedItems.discardedAt)));
    return item || undefined;
  }

  async getScannedItemsByIds(
    ids: number[],
    userId?: string,
  ): Promise<ScannedItem[]> {
    if (ids.length === 0) return [];
    const conditions = [
      inArray(scannedItems.id, ids),
      isNull(scannedItems.discardedAt),
    ];
    if (userId) conditions.push(eq(scannedItems.userId, userId));
    return db
      .select()
      .from(scannedItems)
      .where(and(...conditions));
  }

  async getScannedItemWithFavourite(
    id: number,
    userId: string,
  ): Promise<(ScannedItem & { isFavourited: boolean }) | undefined> {
    const [row] = await db
      .select({
        item: scannedItems,
        favouriteId: favouriteScannedItems.id,
      })
      .from(scannedItems)
      .leftJoin(
        favouriteScannedItems,
        and(
          eq(favouriteScannedItems.scannedItemId, scannedItems.id),
          eq(favouriteScannedItems.userId, userId),
        ),
      )
      .where(and(eq(scannedItems.id, id), isNull(scannedItems.discardedAt)));

    if (!row) return undefined;
    return { ...row.item, isFavourited: row.favouriteId !== null };
  }

  async createScannedItem(item: InsertScannedItem): Promise<ScannedItem> {
    const [scannedItem] = await db
      .insert(scannedItems)
      .values(item)
      .returning();
    return scannedItem;
  }

  async softDeleteScannedItem(id: number, userId: string): Promise<boolean> {
    const [updated] = await db
      .update(scannedItems)
      .set({ discardedAt: new Date() })
      .where(
        and(
          eq(scannedItems.id, id),
          eq(scannedItems.userId, userId),
          isNull(scannedItems.discardedAt),
        ),
      )
      .returning({ id: scannedItems.id });
    return !!updated;
  }

  async toggleFavouriteScannedItem(
    scannedItemId: number,
    userId: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(favouriteScannedItems)
        .where(
          and(
            eq(favouriteScannedItems.scannedItemId, scannedItemId),
            eq(favouriteScannedItems.userId, userId),
          ),
        );

      if (existing) {
        await tx
          .delete(favouriteScannedItems)
          .where(eq(favouriteScannedItems.id, existing.id));
        return false; // un-favourited
      }

      await tx.insert(favouriteScannedItems).values({ userId, scannedItemId });
      return true; // favourited
    });
  }

  async getFavouriteScannedItems(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    items: (ScannedItem & { isFavourited: boolean })[];
    total: number;
  }> {
    const [rows, countResult] = await Promise.all([
      db
        .select({
          item: scannedItems,
          favouriteId: favouriteScannedItems.id,
        })
        .from(favouriteScannedItems)
        .innerJoin(
          scannedItems,
          eq(favouriteScannedItems.scannedItemId, scannedItems.id),
        )
        .where(
          and(
            eq(favouriteScannedItems.userId, userId),
            isNull(scannedItems.discardedAt),
          ),
        )
        .orderBy(desc(favouriteScannedItems.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(favouriteScannedItems)
        .innerJoin(
          scannedItems,
          eq(favouriteScannedItems.scannedItemId, scannedItems.id),
        )
        .where(
          and(
            eq(favouriteScannedItems.userId, userId),
            isNull(scannedItems.discardedAt),
          ),
        ),
    ]);

    const items = rows.map((row) => ({
      ...row.item,
      isFavourited: true,
    }));

    return { items, total: Number(countResult[0]?.count ?? 0) };
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
        totalCalories: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${scannedItems.calories} AS DECIMAL), CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
          * CAST(${dailyLogs.servings} AS DECIMAL)
        ), 0)`,
        totalProtein: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${scannedItems.protein} AS DECIMAL), CAST(${mealPlanRecipes.proteinPerServing} AS DECIMAL), 0)
          * CAST(${dailyLogs.servings} AS DECIMAL)
        ), 0)`,
        totalCarbs: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${scannedItems.carbs} AS DECIMAL), CAST(${mealPlanRecipes.carbsPerServing} AS DECIMAL), 0)
          * CAST(${dailyLogs.servings} AS DECIMAL)
        ), 0)`,
        totalFat: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${scannedItems.fat} AS DECIMAL), CAST(${mealPlanRecipes.fatPerServing} AS DECIMAL), 0)
          * CAST(${dailyLogs.servings} AS DECIMAL)
        ), 0)`,
        itemCount: sql<number>`COUNT(${dailyLogs.id})`,
      })
      .from(dailyLogs)
      .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
      .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id))
      .where(
        and(
          eq(dailyLogs.userId, userId),
          gte(dailyLogs.loggedAt, startOfDay),
          lt(dailyLogs.loggedAt, endOfDay),
          // Exclude discarded scanned items from daily totals
          sql`(${scannedItems.discardedAt} IS NULL OR ${dailyLogs.scannedItemId} IS NULL)`,
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

  async getSavedItems(userId: string, limit = 100): Promise<SavedItem[]> {
    return db
      .select()
      .from(savedItems)
      .where(eq(savedItems.userId, userId))
      .orderBy(desc(savedItems.createdAt))
      .limit(limit);
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
    const count = await this.getSavedItemCount(userId);
    const subscription = await this.getSubscriptionStatus(userId);
    const tierValue = subscription?.tier || "free";
    const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
    const limit = TIER_FEATURES[tier].maxSavedItems;

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

  async getFeaturedRecipes(limit = 12, offset = 0): Promise<CommunityRecipe[]> {
    return db
      .select()
      .from(communityRecipes)
      .where(eq(communityRecipes.isPublic, true))
      .orderBy(desc(communityRecipes.createdAt))
      .limit(limit)
      .offset(offset);
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

  async getUnifiedRecipes(params: {
    userId: string;
    query?: string;
    cuisine?: string;
    diet?: string;
    limit?: number;
  }): Promise<{ community: CommunityRecipe[]; personal: MealPlanRecipe[] }> {
    const { userId, query, cuisine, diet } = params;
    // Limit is applied independently to each source, so the total result
    // set may contain up to 2× this value (community + personal).
    const resultLimit = Math.min(params.limit ?? 50, 100);

    const communityConditions = [eq(communityRecipes.isPublic, true)];
    const personalConditions = [eq(mealPlanRecipes.userId, userId)];

    if (query) {
      const pattern = `%${escapeLike(query)}%`;
      communityConditions.push(
        or(
          ilike(communityRecipes.title, pattern),
          ilike(communityRecipes.description, pattern),
        )!,
      );
      personalConditions.push(
        or(
          ilike(mealPlanRecipes.title, pattern),
          ilike(mealPlanRecipes.description, pattern),
        )!,
      );
    }

    if (cuisine) {
      // Community recipes have no cuisine column — filter by dietTags which
      // contain the lowercase cuisine name (e.g. "italian", "mexican").
      communityConditions.push(
        sql`${communityRecipes.dietTags}::jsonb @> ${JSON.stringify([cuisine.toLowerCase()])}::jsonb`,
      );
      personalConditions.push(
        ilike(mealPlanRecipes.cuisine, `%${escapeLike(cuisine)}%`),
      );
    }

    if (diet) {
      const dietLower = diet.toLowerCase();
      communityConditions.push(
        sql`${communityRecipes.dietTags}::jsonb @> ${JSON.stringify([dietLower])}::jsonb`,
      );
      personalConditions.push(
        sql`${mealPlanRecipes.dietTags}::jsonb @> ${JSON.stringify([dietLower])}::jsonb`,
      );
    }

    const [community, personal] = await Promise.all([
      db
        .select()
        .from(communityRecipes)
        .where(and(...communityConditions))
        .orderBy(desc(communityRecipes.createdAt))
        .limit(resultLimit),
      db
        .select()
        .from(mealPlanRecipes)
        .where(and(...personalConditions))
        .orderBy(desc(mealPlanRecipes.createdAt))
        .limit(resultLimit),
    ]);

    return { community, personal };
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

  async getMealPlanItemById(
    id: number,
    userId: string,
  ): Promise<
    | (MealPlanItem & {
        recipe: MealPlanRecipe | null;
        scannedItem: ScannedItem | null;
      })
    | undefined
  > {
    const [item] = await db
      .select()
      .from(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.userId, userId)));
    if (!item) return undefined;

    let recipe: MealPlanRecipe | null = null;
    let scannedItem: ScannedItem | null = null;

    if (item.recipeId) {
      const [r] = await db
        .select()
        .from(mealPlanRecipes)
        .where(eq(mealPlanRecipes.id, item.recipeId));
      recipe = r || null;
    }
    if (item.scannedItemId) {
      const [s] = await db
        .select()
        .from(scannedItems)
        .where(eq(scannedItems.id, item.scannedItemId));
      scannedItem = s || null;
    }

    return { ...item, recipe, scannedItem };
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

  async getGroceryLists(userId: string, limit = 100): Promise<GroceryList[]> {
    return db
      .select()
      .from(groceryLists)
      .where(eq(groceryLists.userId, userId))
      .orderBy(desc(groceryLists.createdAt))
      .limit(limit);
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
    suggestions: MealSuggestion[],
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
  // PANTRY ITEMS
  // ============================================================================

  async getPantryItems(userId: string, limit = 200): Promise<PantryItem[]> {
    return db
      .select()
      .from(pantryItems)
      .where(eq(pantryItems.userId, userId))
      .orderBy(pantryItems.category, pantryItems.name)
      .limit(limit);
  }

  async getPantryItem(
    id: number,
    userId: string,
  ): Promise<PantryItem | undefined> {
    const [item] = await db
      .select()
      .from(pantryItems)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)));
    return item || undefined;
  }

  async createPantryItem(item: InsertPantryItem): Promise<PantryItem> {
    const [created] = await db.insert(pantryItems).values(item).returning();
    return created;
  }

  async updatePantryItem(
    id: number,
    userId: string,
    updates: Partial<InsertPantryItem>,
  ): Promise<PantryItem | undefined> {
    const [updated] = await db
      .update(pantryItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async deletePantryItem(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(pantryItems)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
      .returning({ id: pantryItems.id });
    return result.length > 0;
  }

  async getExpiringPantryItems(
    userId: string,
    withinDays: number,
  ): Promise<PantryItem[]> {
    const now = new Date();
    const deadline = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    return db
      .select()
      .from(pantryItems)
      .where(
        and(
          eq(pantryItems.userId, userId),
          sql`${pantryItems.expiresAt} IS NOT NULL`,
          lte(pantryItems.expiresAt, deadline),
          gte(pantryItems.expiresAt, now),
        ),
      )
      .orderBy(pantryItems.expiresAt);
  }

  async updateGroceryListItemPantryFlag(
    id: number,
    groceryListId: number,
    addedToPantry: boolean,
  ): Promise<GroceryListItem | undefined> {
    const [updated] = await db
      .update(groceryListItems)
      .set({ addedToPantry })
      .where(
        and(
          eq(groceryListItems.id, id),
          eq(groceryListItems.groceryListId, groceryListId),
        ),
      )
      .returning();
    return updated || undefined;
  }

  async getConfirmedMealPlanItemIds(
    userId: string,
    date: Date,
  ): Promise<number[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const rows = await db
      .select({ mealPlanItemId: dailyLogs.mealPlanItemId })
      .from(dailyLogs)
      .where(
        and(
          eq(dailyLogs.userId, userId),
          eq(dailyLogs.source, "meal_plan_confirm"),
          gte(dailyLogs.loggedAt, startOfDay),
          lt(dailyLogs.loggedAt, endOfDay),
          sql`${dailyLogs.mealPlanItemId} IS NOT NULL`,
        ),
      );

    return rows.map((r) => r.mealPlanItemId!);
  }

  async getPlannedNutritionSummary(
    userId: string,
    date: Date,
    confirmedIds?: number[],
  ): Promise<{
    plannedCalories: number;
    plannedProtein: number;
    plannedCarbs: number;
    plannedFat: number;
    plannedItemCount: number;
  }> {
    const dateStr = date.toISOString().split("T")[0];

    // Exclude items already confirmed (logged) for this date
    // Use provided confirmedIds if available to avoid redundant DB query
    const excludeIds =
      confirmedIds ?? (await this.getConfirmedMealPlanItemIds(userId, date));

    const conditions = [
      eq(mealPlanItems.userId, userId),
      eq(mealPlanItems.plannedDate, dateStr),
    ];
    if (excludeIds.length > 0) {
      conditions.push(
        sql`${mealPlanItems.id} NOT IN (${sql.join(
          excludeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }

    const result = await db
      .select({
        plannedCalories: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
          * CAST(${mealPlanItems.servings} AS DECIMAL)
        ), 0)`,
        plannedProtein: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${mealPlanRecipes.proteinPerServing} AS DECIMAL), 0)
          * CAST(${mealPlanItems.servings} AS DECIMAL)
        ), 0)`,
        plannedCarbs: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${mealPlanRecipes.carbsPerServing} AS DECIMAL), 0)
          * CAST(${mealPlanItems.servings} AS DECIMAL)
        ), 0)`,
        plannedFat: sql<number>`COALESCE(SUM(
          COALESCE(CAST(${mealPlanRecipes.fatPerServing} AS DECIMAL), 0)
          * CAST(${mealPlanItems.servings} AS DECIMAL)
        ), 0)`,
        plannedItemCount: sql<number>`COUNT(${mealPlanItems.id})`,
      })
      .from(mealPlanItems)
      .leftJoin(mealPlanRecipes, eq(mealPlanItems.recipeId, mealPlanRecipes.id))
      .where(and(...conditions));

    return (
      result[0] || {
        plannedCalories: 0,
        plannedProtein: 0,
        plannedCarbs: 0,
        plannedFat: 0,
        plannedItemCount: 0,
      }
    );
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
  // ============================================================================
  // WEIGHT LOGS
  // ============================================================================

  async getWeightLogs(
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

  async createWeightLog(log: InsertWeightLog): Promise<WeightLog> {
    const [created] = await db.insert(weightLogs).values(log).returning();
    return created;
  }

  async deleteWeightLog(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(weightLogs)
      .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)))
      .returning({ id: weightLogs.id });
    return result.length > 0;
  }

  async getLatestWeight(userId: string): Promise<WeightLog | undefined> {
    const [latest] = await db
      .select()
      .from(weightLogs)
      .where(eq(weightLogs.userId, userId))
      .orderBy(desc(weightLogs.loggedAt))
      .limit(1);
    return latest;
  }

  // ============================================================================
  // EXERCISE LOGS
  // ============================================================================

  async getExerciseLogs(
    userId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<ExerciseLog[]> {
    const conditions = [eq(exerciseLogs.userId, userId)];
    if (options?.from)
      conditions.push(gte(exerciseLogs.loggedAt, options.from));
    if (options?.to) conditions.push(lte(exerciseLogs.loggedAt, options.to));
    const effectiveLimit = options?.limit ?? 100;
    return db
      .select()
      .from(exerciseLogs)
      .where(and(...conditions))
      .orderBy(desc(exerciseLogs.loggedAt))
      .limit(effectiveLimit);
  }

  async createExerciseLog(log: InsertExerciseLog): Promise<ExerciseLog> {
    const [created] = await db.insert(exerciseLogs).values(log).returning();
    return created;
  }

  async updateExerciseLog(
    id: number,
    userId: string,
    updates: Partial<InsertExerciseLog>,
  ): Promise<ExerciseLog | undefined> {
    const [updated] = await db
      .update(exerciseLogs)
      .set(updates)
      .where(and(eq(exerciseLogs.id, id), eq(exerciseLogs.userId, userId)))
      .returning();
    return updated;
  }

  async deleteExerciseLog(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(exerciseLogs)
      .where(and(eq(exerciseLogs.id, id), eq(exerciseLogs.userId, userId)))
      .returning({ id: exerciseLogs.id });
    return result.length > 0;
  }

  async getExerciseDailySummary(
    userId: string,
    date: Date,
  ): Promise<{
    totalCaloriesBurned: number;
    totalMinutes: number;
    exerciseCount: number;
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    const logs = await db
      .select()
      .from(exerciseLogs)
      .where(
        and(
          eq(exerciseLogs.userId, userId),
          gte(exerciseLogs.loggedAt, startOfDay),
          lte(exerciseLogs.loggedAt, endOfDay),
        ),
      );
    return {
      totalCaloriesBurned: logs.reduce(
        (sum, l) => sum + (l.caloriesBurned ? parseFloat(l.caloriesBurned) : 0),
        0,
      ),
      totalMinutes: logs.reduce((sum, l) => sum + l.durationMinutes, 0),
      exerciseCount: logs.length,
    };
  }

  // ============================================================================
  // EXERCISE LIBRARY
  // ============================================================================

  async searchExerciseLibrary(
    query: string,
    userId?: string,
  ): Promise<ExerciseLibraryEntry[]> {
    const searchTerm = `%${escapeLike(query)}%`;
    return db
      .select()
      .from(exerciseLibrary)
      .where(
        and(
          ilike(exerciseLibrary.name, searchTerm),
          or(
            eq(exerciseLibrary.isCustom, false),
            userId ? eq(exerciseLibrary.userId, userId) : undefined,
          ),
        ),
      )
      .limit(20);
  }

  async createExerciseLibraryEntry(
    entry: InsertExerciseLibraryEntry,
  ): Promise<ExerciseLibraryEntry> {
    const [created] = await db
      .insert(exerciseLibrary)
      .values(entry)
      .returning();
    return created;
  }

  // ============================================================================
  // HEALTHKIT SYNC
  // ============================================================================

  async getHealthKitSyncSettings(
    userId: string,
  ): Promise<HealthKitSyncEntry[]> {
    return db
      .select()
      .from(healthKitSync)
      .where(eq(healthKitSync.userId, userId));
  }

  async upsertHealthKitSyncSetting(
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

  async updateHealthKitLastSync(
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

  // ============================================================================
  // MEDICATION LOGS (GLP-1)
  // ============================================================================

  async getMedicationLogs(
    userId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<MedicationLog[]> {
    const conditions = [eq(medicationLogs.userId, userId)];
    if (options?.from)
      conditions.push(gte(medicationLogs.takenAt, options.from));
    if (options?.to) conditions.push(lte(medicationLogs.takenAt, options.to));
    return db
      .select()
      .from(medicationLogs)
      .where(and(...conditions))
      .orderBy(desc(medicationLogs.takenAt))
      .limit(options?.limit || 50);
  }

  async createMedicationLog(log: InsertMedicationLog): Promise<MedicationLog> {
    const [result] = await db.insert(medicationLogs).values(log).returning();
    return result;
  }

  async updateMedicationLog(
    id: number,
    userId: string,
    updates: Partial<InsertMedicationLog>,
  ): Promise<MedicationLog | undefined> {
    const [result] = await db
      .update(medicationLogs)
      .set(updates)
      .where(and(eq(medicationLogs.id, id), eq(medicationLogs.userId, userId)))
      .returning();
    return result || undefined;
  }

  async deleteMedicationLog(id: number, userId: string): Promise<boolean> {
    const [deleted] = await db
      .delete(medicationLogs)
      .where(and(eq(medicationLogs.id, id), eq(medicationLogs.userId, userId)))
      .returning({ id: medicationLogs.id });
    return !!deleted;
  }

  // ============================================================================
  // CHAT CONVERSATIONS
  // ============================================================================

  async getChatConversation(
    id: number,
    userId: string,
  ): Promise<ChatConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(
        and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
      );
    return conversation || undefined;
  }

  async getChatConversations(
    userId: string,
    limit = 50,
  ): Promise<ChatConversation[]> {
    return db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.userId, userId))
      .orderBy(desc(chatConversations.updatedAt))
      .limit(limit);
  }

  async createChatConversation(
    userId: string,
    title: string,
  ): Promise<ChatConversation> {
    const [conversation] = await db
      .insert(chatConversations)
      .values({ userId, title })
      .returning();
    return conversation;
  }

  async getChatMessages(
    conversationId: number,
    limit = 100,
  ): Promise<ChatMessage[]> {
    return db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversationId))
      .orderBy(chatMessages.createdAt)
      .limit(limit);
  }

  async createChatMessage(
    conversationId: number,
    role: string,
    content: string,
    metadata?: unknown,
  ): Promise<ChatMessage> {
    const [message] = await db
      .insert(chatMessages)
      .values({
        conversationId,
        role,
        content,
        metadata: metadata ?? null,
      })
      .returning();

    // Update conversation timestamp
    await db
      .update(chatConversations)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversations.id, conversationId));

    return message;
  }

  async deleteChatConversation(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(chatConversations)
      .where(
        and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
      )
      .returning({ id: chatConversations.id });
    return result.length > 0;
  }

  async updateChatConversationTitle(
    id: number,
    userId: string,
    title: string,
  ): Promise<ChatConversation | undefined> {
    const [updated] = await db
      .update(chatConversations)
      .set({ title, updatedAt: new Date() })
      .where(
        and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)),
      )
      .returning();
    return updated || undefined;
  }

  async getDailyChatMessageCount(userId: string, date: Date): Promise<number> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(
        and(
          eq(chatConversations.userId, userId),
          eq(chatMessages.role, "user"),
          gte(chatMessages.createdAt, startOfDay),
          lt(chatMessages.createdAt, endOfDay),
        ),
      );

    return Number(result[0]?.count ?? 0);
  }

  // ============================================================================
  // GOAL ADJUSTMENT LOGS
  // ============================================================================

  async createGoalAdjustmentLog(
    log: InsertGoalAdjustmentLog,
  ): Promise<GoalAdjustmentLog> {
    const [result] = await db
      .insert(goalAdjustmentLogs)
      .values(log)
      .returning();
    return result;
  }

  async getGoalAdjustmentLogs(
    userId: string,
    limit = 100,
  ): Promise<GoalAdjustmentLog[]> {
    return db
      .select()
      .from(goalAdjustmentLogs)
      .where(eq(goalAdjustmentLogs.userId, userId))
      .orderBy(desc(goalAdjustmentLogs.appliedAt))
      .limit(limit);
  }

  // ============================================================================
  // MENU SCANS
  // ============================================================================

  async getMenuScans(userId: string, limit = 20): Promise<MenuScan[]> {
    return db
      .select()
      .from(menuScans)
      .where(eq(menuScans.userId, userId))
      .orderBy(desc(menuScans.scannedAt))
      .limit(limit);
  }

  async createMenuScan(scan: InsertMenuScan): Promise<MenuScan> {
    const [created] = await db.insert(menuScans).values(scan).returning();
    return created;
  }

  async deleteMenuScan(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(menuScans)
      .where(and(eq(menuScans.id, id), eq(menuScans.userId, userId)))
      .returning({ id: menuScans.id });
    return result.length > 0;
  }

  // ============================================================================
  // FASTING
  // ============================================================================

  async getFastingSchedule(
    userId: string,
  ): Promise<FastingSchedule | undefined> {
    const [schedule] = await db
      .select()
      .from(fastingSchedules)
      .where(eq(fastingSchedules.userId, userId));
    return schedule || undefined;
  }

  async upsertFastingSchedule(
    userId: string,
    schedule: Omit<InsertFastingSchedule, "userId">,
  ): Promise<FastingSchedule> {
    const [result] = await db
      .insert(fastingSchedules)
      .values({ userId, ...schedule })
      .onConflictDoUpdate({
        target: [fastingSchedules.userId],
        set: schedule,
      })
      .returning();
    return result;
  }

  async getActiveFastingLog(userId: string): Promise<FastingLog | undefined> {
    const [active] = await db
      .select()
      .from(fastingLogs)
      .where(and(eq(fastingLogs.userId, userId), isNull(fastingLogs.endedAt)));
    return active || undefined;
  }

  async getFastingLogs(userId: string, limit = 30): Promise<FastingLog[]> {
    return db
      .select()
      .from(fastingLogs)
      .where(eq(fastingLogs.userId, userId))
      .orderBy(desc(fastingLogs.startedAt))
      .limit(limit);
  }

  async createFastingLog(log: InsertFastingLog): Promise<FastingLog> {
    const [created] = await db.insert(fastingLogs).values(log).returning();
    return created;
  }

  async endFastingLog(
    id: number,
    userId: string,
    endedAt: Date,
    actualDurationMinutes: number,
    completed: boolean,
    note?: string,
  ): Promise<FastingLog | undefined> {
    const [updated] = await db
      .update(fastingLogs)
      .set({ endedAt, actualDurationMinutes, completed, note })
      .where(and(eq(fastingLogs.id, id), eq(fastingLogs.userId, userId)))
      .returning();
    return updated || undefined;
  }

  async getMicronutrientCache(
    queryKey: string,
  ): Promise<unknown[] | undefined> {
    const [row] = await db
      .select()
      .from(micronutrientCache)
      .where(
        and(
          eq(micronutrientCache.queryKey, queryKey),
          gt(micronutrientCache.expiresAt, new Date()),
        ),
      );
    if (!row) return undefined;
    db.update(micronutrientCache)
      .set({ hitCount: sql`${micronutrientCache.hitCount} + 1` })
      .where(eq(micronutrientCache.id, row.id))
      .catch(console.error);
    return row.data as unknown[];
  }

  async setMicronutrientCache(
    queryKey: string,
    data: unknown[],
    ttlMs: number,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await db
      .insert(micronutrientCache)
      .values({ queryKey, data, expiresAt })
      .onConflictDoUpdate({
        target: micronutrientCache.queryKey,
        set: { data, expiresAt, hitCount: 0 },
      });
  }
}

export const storage = new DatabaseStorage();
