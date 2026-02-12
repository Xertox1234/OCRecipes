import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  serial,
  integer,
  timestamp,
  decimal,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  unique,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  dailyCalorieGoal: integer("daily_calorie_goal").default(2000),
  dailyProteinGoal: integer("daily_protein_goal"),
  dailyCarbsGoal: integer("daily_carbs_goal"),
  dailyFatGoal: integer("daily_fat_goal"),
  weight: decimal("weight", { precision: 5, scale: 2 }),
  height: decimal("height", { precision: 5, scale: 2 }),
  age: integer("age"),
  gender: text("gender"),
  goalsCalculatedAt: timestamp("goals_calculated_at"),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  subscriptionTier: text("subscription_tier").default("free"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const allergySchema = z.object({
  name: z.string(),
  severity: z.enum(["mild", "moderate", "severe"]),
});

export type Allergy = z.infer<typeof allergySchema>;

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  allergies: jsonb("allergies").$type<Allergy[]>().default([]),
  healthConditions: jsonb("health_conditions").$type<string[]>().default([]),
  dietType: text("diet_type"),
  foodDislikes: jsonb("food_dislikes").$type<string[]>().default([]),
  primaryGoal: text("primary_goal"),
  activityLevel: text("activity_level"),
  householdSize: integer("household_size").default(1),
  cuisinePreferences: jsonb("cuisine_preferences")
    .$type<string[]>()
    .default([]),
  cookingSkillLevel: text("cooking_skill_level"),
  cookingTimeAvailable: text("cooking_time_available"),
  createdAt: timestamp("created_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const scannedItems = pgTable(
  "scanned_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, {
        onDelete: "cascade",
      })
      .notNull(),
    barcode: text("barcode"),
    productName: text("product_name").notNull(),
    brandName: text("brand_name"),
    servingSize: text("serving_size"),
    calories: decimal("calories", { precision: 10, scale: 2 }),
    protein: decimal("protein", { precision: 10, scale: 2 }),
    carbs: decimal("carbs", { precision: 10, scale: 2 }),
    fat: decimal("fat", { precision: 10, scale: 2 }),
    fiber: decimal("fiber", { precision: 10, scale: 2 }),
    sugar: decimal("sugar", { precision: 10, scale: 2 }),
    sodium: decimal("sodium", { precision: 10, scale: 2 }),
    imageUrl: text("image_url"),
    sourceType: text("source_type").default("barcode"),
    photoUrl: text("photo_url"),
    aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
    preparationMethods: jsonb("preparation_methods").$type<
      { name: string; method: string }[]
    >(),
    analysisIntent: text("analysis_intent"),
    scannedAt: timestamp("scanned_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    discardedAt: timestamp("discarded_at"),
  },
  (table) => ({
    userIdIdx: index("scanned_items_user_id_idx").on(table.userId),
    scannedAtIdx: index("scanned_items_scanned_at_idx").on(table.scannedAt),
  }),
);

export const dailyLogs = pgTable(
  "daily_logs",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, {
        onDelete: "cascade",
      })
      .notNull(),
    scannedItemId: integer("scanned_item_id").references(
      () => scannedItems.id,
      { onDelete: "cascade" },
    ),
    recipeId: integer("recipe_id").references(() => mealPlanRecipes.id, {
      onDelete: "set null",
    }),
    mealPlanItemId: integer("meal_plan_item_id").references(
      () => mealPlanItems.id,
      { onDelete: "set null" },
    ),
    source: text("source").default("scan"),
    servings: decimal("servings", { precision: 5, scale: 2 }).default("1"),
    mealType: text("meal_type"),
    loggedAt: timestamp("logged_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("daily_logs_user_id_idx").on(table.userId),
    loggedAtIdx: index("daily_logs_logged_at_idx").on(table.loggedAt),
  }),
);

export const nutritionCache = pgTable(
  "nutrition_cache",
  {
    id: serial("id").primaryKey(),
    queryKey: varchar("query_key", { length: 255 }).notNull().unique(),
    normalizedName: varchar("normalized_name", { length: 255 }).notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    data: jsonb("data").notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    queryKeyIdx: index("nutrition_cache_query_key_idx").on(table.queryKey),
    expiresAtIdx: index("nutrition_cache_expires_at_idx").on(table.expiresAt),
  }),
);

// Type for suggestions JSONB
export interface SuggestionData {
  type: "recipe" | "craft" | "pairing";
  title: string;
  description: string;
  difficulty?: string;
  timeEstimate?: string;
}

// Suggestion cache - stores the 4 suggestions per item per user
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id")
      .references(() => scannedItems.id, { onDelete: "cascade" })
      .notNull(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    profileHash: varchar("profile_hash", { length: 64 }).notNull(),
    suggestions: jsonb("suggestions").$type<SuggestionData[]>().notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserIdx: index("suggestion_cache_item_user_idx").on(
      table.scannedItemId,
      table.userId,
    ),
    expiresAtIdx: index("suggestion_cache_expires_at_idx").on(table.expiresAt),
  }),
);

// Instruction cache - stores individual instruction per suggestion
export const instructionCache = pgTable(
  "instruction_cache",
  {
    id: serial("id").primaryKey(),
    suggestionCacheId: integer("suggestion_cache_id")
      .references(() => suggestionCache.id, { onDelete: "cascade" })
      .notNull(),
    suggestionIndex: integer("suggestion_index").notNull(),
    suggestionTitle: text("suggestion_title").notNull(),
    suggestionType: text("suggestion_type").notNull(),
    instructions: text("instructions").notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    cacheIndexIdx: index("instruction_cache_suggestion_idx").on(
      table.suggestionCacheId,
      table.suggestionIndex,
    ),
  }),
);

// Saved items types (recipes and activities from suggestions)
export const savedItemTypes = ["recipe", "activity"] as const;
export type SavedItemType = (typeof savedItemTypes)[number];

export const savedItems = pgTable(
  "saved_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // Content type - text with Zod validation (matches existing patterns)
    type: text("type").notNull(),

    // Saved content (frozen at save time - GPT output is non-deterministic)
    title: text("title").notNull(),
    description: text("description"),
    difficulty: text("difficulty"),
    timeEstimate: text("time_estimate"),
    instructions: text("instructions"),

    // Source reference
    sourceItemId: integer("source_item_id").references(() => scannedItems.id, {
      onDelete: "set null",
    }),
    sourceProductName: text("source_product_name"),

    // Metadata
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdCreatedAtIdx: index("saved_items_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export const usersRelations = relations(users, ({ one, many }) => ({
  scannedItems: many(scannedItems),
  dailyLogs: many(dailyLogs),
  savedItems: many(savedItems),
  favouriteScannedItems: many(favouriteScannedItems),
  mealPlanRecipes: many(mealPlanRecipes),
  mealPlanItems: many(mealPlanItems),
  transactions: many(transactions),
  groceryLists: many(groceryLists),
  pantryItems: many(pantryItems),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const scannedItemsRelations = relations(
  scannedItems,
  ({ one, many }) => ({
    user: one(users, {
      fields: [scannedItems.userId],
      references: [users.id],
    }),
    dailyLogs: many(dailyLogs),
    savedItems: many(savedItems),
    favourites: many(favouriteScannedItems),
  }),
);

export const dailyLogsRelations = relations(dailyLogs, ({ one }) => ({
  user: one(users, {
    fields: [dailyLogs.userId],
    references: [users.id],
  }),
  scannedItem: one(scannedItems, {
    fields: [dailyLogs.scannedItemId],
    references: [scannedItems.id],
  }),
  recipe: one(mealPlanRecipes, {
    fields: [dailyLogs.recipeId],
    references: [mealPlanRecipes.id],
  }),
  mealPlanItem: one(mealPlanItems, {
    fields: [dailyLogs.mealPlanItemId],
    references: [mealPlanItems.id],
  }),
}));

export const savedItemsRelations = relations(savedItems, ({ one }) => ({
  user: one(users, {
    fields: [savedItems.userId],
    references: [users.id],
  }),
  sourceItem: one(scannedItems, {
    fields: [savedItems.sourceItemId],
    references: [scannedItems.id],
  }),
}));

// Favourite scanned items - bookmarked foods for quick access
export const favouriteScannedItems = pgTable(
  "favourite_scanned_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    scannedItemId: integer("scanned_item_id")
      .references(() => scannedItems.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    uniqueUserItem: unique().on(table.userId, table.scannedItemId),
    userIdIdx: index("favourite_scanned_items_user_id_idx").on(table.userId),
  }),
);

export const favouriteScannedItemsRelations = relations(
  favouriteScannedItems,
  ({ one }) => ({
    user: one(users, {
      fields: [favouriteScannedItems.userId],
      references: [users.id],
    }),
    scannedItem: one(scannedItems, {
      fields: [favouriteScannedItems.scannedItemId],
      references: [scannedItems.id],
    }),
  }),
);

// Community recipes - shared recipes created by premium users
export const communityRecipes = pgTable(
  "community_recipes",
  {
    id: serial("id").primaryKey(),
    authorId: varchar("author_id", { length: 255 }).references(() => users.id, {
      onDelete: "set null",
    }),
    barcode: text("barcode"),
    normalizedProductName: text("normalized_product_name").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    difficulty: text("difficulty"),
    timeEstimate: text("time_estimate"),
    servings: integer("servings").default(2),
    dietTags: jsonb("diet_tags").$type<string[]>().default([]),
    instructions: text("instructions").notNull(),
    imageUrl: text("image_url"),
    isPublic: boolean("is_public").default(true),
    likeCount: integer("like_count").default(0),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    barcodeIdx: index("community_recipes_barcode_idx").on(table.barcode),
    normalizedNameIdx: index("community_recipes_normalized_name_idx").on(
      table.normalizedProductName,
    ),
    authorIdx: index("community_recipes_author_idx").on(table.authorId),
  }),
);

// Recipe generation log - tracks daily generation limits
export const recipeGenerationLog = pgTable(
  "recipe_generation_log",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").references(() => communityRecipes.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userGeneratedAtIdx: index("recipe_gen_log_user_date_idx").on(
      table.userId,
      table.generatedAt,
    ),
  }),
);

export const communityRecipesRelations = relations(
  communityRecipes,
  ({ one }) => ({
    author: one(users, {
      fields: [communityRecipes.authorId],
      references: [users.id],
    }),
  }),
);

export const recipeGenerationLogRelations = relations(
  recipeGenerationLog,
  ({ one }) => ({
    user: one(users, {
      fields: [recipeGenerationLog.userId],
      references: [users.id],
    }),
    recipe: one(communityRecipes, {
      fields: [recipeGenerationLog.recipeId],
      references: [communityRecipes.id],
    }),
  }),
);

// ============================================================================
// MEAL PLANNING TABLES
// ============================================================================

export const mealPlanRecipes = pgTable(
  "meal_plan_recipes",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),
    title: text("title").notNull(),
    description: text("description"),
    sourceType: text("source_type").notNull().default("user_created"),
    sourceUrl: text("source_url"),
    externalId: text("external_id"),
    cuisine: text("cuisine"),
    difficulty: text("difficulty"),
    servings: integer("servings").default(2),
    prepTimeMinutes: integer("prep_time_minutes"),
    cookTimeMinutes: integer("cook_time_minutes"),
    imageUrl: text("image_url"),
    instructions: text("instructions"),
    dietTags: jsonb("diet_tags").$type<string[]>().default([]),
    caloriesPerServing: decimal("calories_per_serving", {
      precision: 10,
      scale: 2,
    }),
    proteinPerServing: decimal("protein_per_serving", {
      precision: 10,
      scale: 2,
    }),
    carbsPerServing: decimal("carbs_per_serving", {
      precision: 10,
      scale: 2,
    }),
    fatPerServing: decimal("fat_per_serving", { precision: 10, scale: 2 }),
    fiberPerServing: decimal("fiber_per_serving", {
      precision: 10,
      scale: 2,
    }),
    sugarPerServing: decimal("sugar_per_serving", {
      precision: 10,
      scale: 2,
    }),
    sodiumPerServing: decimal("sodium_per_serving", {
      precision: 10,
      scale: 2,
    }),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("meal_plan_recipes_user_id_idx").on(table.userId),
    userExternalIdIdx: uniqueIndex("meal_plan_recipes_user_external_id_idx").on(
      table.userId,
      table.externalId,
    ),
  }),
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: serial("id").primaryKey(),
    recipeId: integer("recipe_id")
      .references(() => mealPlanRecipes.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }),
    unit: text("unit"),
    category: text("category").default("other"),
    displayOrder: integer("display_order").default(0),
  },
  (table) => ({
    recipeIdIdx: index("recipe_ingredients_recipe_id_idx").on(table.recipeId),
  }),
);

export const mealPlanItems = pgTable(
  "meal_plan_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").references(() => mealPlanRecipes.id, {
      onDelete: "set null",
    }),
    scannedItemId: integer("scanned_item_id").references(
      () => scannedItems.id,
      { onDelete: "set null" },
    ),
    plannedDate: date("planned_date").notNull(),
    mealType: text("meal_type").notNull(),
    servings: decimal("servings", { precision: 5, scale: 2 }).default("1"),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userDateIdx: index("meal_plan_items_user_date_idx").on(
      table.userId,
      table.plannedDate,
    ),
  }),
);

// Meal planning relations
export const mealPlanRecipesRelations = relations(
  mealPlanRecipes,
  ({ one, many }) => ({
    user: one(users, {
      fields: [mealPlanRecipes.userId],
      references: [users.id],
    }),
    ingredients: many(recipeIngredients),
    mealPlanItems: many(mealPlanItems),
  }),
);

export const recipeIngredientsRelations = relations(
  recipeIngredients,
  ({ one }) => ({
    recipe: one(mealPlanRecipes, {
      fields: [recipeIngredients.recipeId],
      references: [mealPlanRecipes.id],
    }),
  }),
);

export const mealPlanItemsRelations = relations(mealPlanItems, ({ one }) => ({
  user: one(users, {
    fields: [mealPlanItems.userId],
    references: [users.id],
  }),
  recipe: one(mealPlanRecipes, {
    fields: [mealPlanItems.recipeId],
    references: [mealPlanRecipes.id],
  }),
  scannedItem: one(scannedItems, {
    fields: [mealPlanItems.scannedItemId],
    references: [scannedItems.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertScannedItemSchema = createInsertSchema(scannedItems).omit({
  id: true,
  scannedAt: true,
});

export const insertDailyLogSchema = createInsertSchema(dailyLogs).omit({
  id: true,
  loggedAt: true,
});

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertScannedItem = z.infer<typeof insertScannedItemSchema>;
export type ScannedItem = typeof scannedItems.$inferSelect;
export type InsertDailyLog = z.infer<typeof insertDailyLogSchema>;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NutritionCache = typeof nutritionCache.$inferSelect;
export type SuggestionCache = typeof suggestionCache.$inferSelect;
export type InstructionCache = typeof instructionCache.$inferSelect;
export type SavedItem = typeof savedItems.$inferSelect;
export type InsertSavedItem = typeof savedItems.$inferInsert;
export type CommunityRecipe = typeof communityRecipes.$inferSelect;
export type InsertCommunityRecipe = typeof communityRecipes.$inferInsert;
export type RecipeGenerationLog = typeof recipeGenerationLog.$inferSelect;

// ============================================================================
// TRANSACTIONS (subscription purchases)
// ============================================================================

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    transactionId: text("transaction_id").notNull().unique(),
    receipt: text("receipt").notNull(),
    platform: text("platform").notNull(),
    productId: text("product_id").notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("transactions_user_id_idx").on(table.userId),
    statusIdx: index("transactions_status_idx").on(table.status),
  }),
);

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, {
    fields: [transactions.userId],
    references: [users.id],
  }),
}));

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

// ============================================================================
// GROCERY LISTS
// ============================================================================

export const groceryLists = pgTable(
  "grocery_lists",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    dateRangeStart: date("date_range_start").notNull(),
    dateRangeEnd: date("date_range_end").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userDateIdx: index("grocery_lists_user_date_idx").on(
      table.userId,
      table.dateRangeStart,
    ),
  }),
);

export const groceryListItems = pgTable(
  "grocery_list_items",
  {
    id: serial("id").primaryKey(),
    groceryListId: integer("grocery_list_id")
      .references(() => groceryLists.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }),
    unit: text("unit"),
    category: text("category").default("other"),
    isChecked: boolean("is_checked").default(false),
    isManual: boolean("is_manual").default(false),
    addedToPantry: boolean("added_to_pantry").default(false),
    checkedAt: timestamp("checked_at"),
  },
  (table) => ({
    groceryListIdIdx: index("grocery_list_items_list_id_idx").on(
      table.groceryListId,
    ),
  }),
);

export const groceryListsRelations = relations(
  groceryLists,
  ({ one, many }) => ({
    user: one(users, {
      fields: [groceryLists.userId],
      references: [users.id],
    }),
    items: many(groceryListItems),
  }),
);

export const groceryListItemsRelations = relations(
  groceryListItems,
  ({ one }) => ({
    groceryList: one(groceryLists, {
      fields: [groceryListItems.groceryListId],
      references: [groceryLists.id],
    }),
  }),
);

// ============================================================================
// PANTRY ITEMS
// ============================================================================

export const pantryItems = pgTable(
  "pantry_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }),
    unit: text("unit"),
    category: text("category").default("other"),
    expiresAt: timestamp("expires_at"),
    addedAt: timestamp("added_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index("pantry_items_user_id_idx").on(table.userId),
    userExpiresIdx: index("pantry_items_user_expires_idx").on(
      table.userId,
      table.expiresAt,
    ),
  }),
);

export const pantryItemsRelations = relations(pantryItems, ({ one }) => ({
  user: one(users, {
    fields: [pantryItems.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// MEAL SUGGESTION CACHE
// ============================================================================

export const mealSuggestionCache = pgTable(
  "meal_suggestion_cache",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    cacheKey: varchar("cache_key", { length: 255 }).notNull().unique(),
    suggestions: jsonb("suggestions").notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    cacheKeyIdx: index("meal_suggestion_cache_key_idx").on(table.cacheKey),
    expiresAtIdx: index("meal_suggestion_cache_expires_idx").on(
      table.expiresAt,
    ),
  }),
);

export const mealSuggestionCacheRelations = relations(
  mealSuggestionCache,
  ({ one }) => ({
    user: one(users, {
      fields: [mealSuggestionCache.userId],
      references: [users.id],
    }),
  }),
);

// Meal planning types
export const insertGroceryListSchema = createInsertSchema(groceryLists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertGroceryListItemSchema = createInsertSchema(
  groceryListItems,
).omit({
  id: true,
});

export type GroceryList = typeof groceryLists.$inferSelect;
export type InsertGroceryList = z.infer<typeof insertGroceryListSchema>;
export type GroceryListItem = typeof groceryListItems.$inferSelect;
export type InsertGroceryListItem = z.infer<typeof insertGroceryListItemSchema>;
export type MealSuggestionCacheEntry = typeof mealSuggestionCache.$inferSelect;

export const insertMealPlanRecipeSchema = createInsertSchema(
  mealPlanRecipes,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertRecipeIngredientSchema = createInsertSchema(
  recipeIngredients,
).omit({
  id: true,
});
export const insertMealPlanItemSchema = createInsertSchema(mealPlanItems).omit({
  id: true,
  createdAt: true,
});

export type MealPlanRecipe = typeof mealPlanRecipes.$inferSelect;
export type InsertMealPlanRecipe = z.infer<typeof insertMealPlanRecipeSchema>;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;
export type InsertRecipeIngredient = z.infer<
  typeof insertRecipeIngredientSchema
>;
export type MealPlanItem = typeof mealPlanItems.$inferSelect;
export type InsertMealPlanItem = z.infer<typeof insertMealPlanItemSchema>;

export const insertPantryItemSchema = createInsertSchema(pantryItems).omit({
  id: true,
  addedAt: true,
  updatedAt: true,
});

export type PantryItem = typeof pantryItems.$inferSelect;
export type InsertPantryItem = z.infer<typeof insertPantryItemSchema>;

export type FavouriteScannedItem = typeof favouriteScannedItems.$inferSelect;
