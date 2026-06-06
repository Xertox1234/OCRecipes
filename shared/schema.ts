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
  check,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { DEFAULT_NUTRITION_GOALS } from "./constants/nutrition";
import type { DerivedRecipeAllergen } from "./constants/allergens";
import type { MealSuggestion } from "./types/meal-suggestions";
import type { CarouselRecipeCard } from "./types/carousel";
import type { ReminderMutes, ReminderType } from "./types/reminders";
import type { MeasurementUnit } from "./lib/units";

export const users = pgTable(
  "users",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    dailyCalorieGoal: integer("daily_calorie_goal").default(
      DEFAULT_NUTRITION_GOALS.calories,
    ),
    dailyProteinGoal: integer("daily_protein_goal"),
    dailyCarbsGoal: integer("daily_carbs_goal"),
    dailyFatGoal: integer("daily_fat_goal"),
    weight: decimal("weight", { precision: 5, scale: 2 }),
    height: decimal("height", { precision: 5, scale: 2 }),
    age: integer("age"),
    gender: text("gender"),
    goalWeight: decimal("goal_weight", { precision: 6, scale: 2 }),
    goalsCalculatedAt: timestamp("goals_calculated_at", { withTimezone: true }),
    adaptiveGoalsEnabled: boolean("adaptive_goals_enabled").default(false),
    lastGoalAdjustmentAt: timestamp("last_goal_adjustment_at", {
      withTimezone: true,
    }),
    onboardingCompleted: boolean("onboarding_completed").default(false),
    measurementUnit: text("measurement_unit")
      .$type<MeasurementUnit>()
      .default("metric")
      .notNull(),
    tokenVersion: integer("token_version").default(0).notNull(),
    subscriptionTier: text("subscription_tier").default("free"),
    subscriptionExpiresAt: timestamp("subscription_expires_at", {
      withTimezone: true,
    }),
    /** IANA timezone string e.g. "America/Los_Angeles". NULL = not yet captured (treated as UTC). */
    timezone: text("timezone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => ({
    dailyCalorieGoalNonNeg: check(
      "users_daily_calorie_goal_gte0",
      sql`${table.dailyCalorieGoal} >= 0`,
    ),
    dailyProteinGoalNonNeg: check(
      "users_daily_protein_goal_gte0",
      sql`${table.dailyProteinGoal} >= 0`,
    ),
    dailyCarbsGoalNonNeg: check(
      "users_daily_carbs_goal_gte0",
      sql`${table.dailyCarbsGoal} >= 0`,
    ),
    dailyFatGoalNonNeg: check(
      "users_daily_fat_goal_gte0",
      sql`${table.dailyFatGoal} >= 0`,
    ),
  }),
);

export const allergySchema = z.object({
  name: z.string().max(100),
  severity: z.enum(["mild", "moderate", "severe"]),
});

export type Allergy = z.infer<typeof allergySchema>;

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  allergies: jsonb("allergies").$type<Allergy[]>().default([]).notNull(),
  healthConditions: jsonb("health_conditions")
    .$type<string[]>()
    .default([])
    .notNull(),
  dietType: text("diet_type"),
  foodDislikes: jsonb("food_dislikes").$type<string[]>().default([]).notNull(),
  primaryGoal: text("primary_goal"),
  activityLevel: text("activity_level"),
  householdSize: integer("household_size").default(1),
  cuisinePreferences: jsonb("cuisine_preferences")
    .$type<string[]>()
    .default([])
    .notNull(),
  cookingSkillLevel: text("cooking_skill_level"),
  cookingTimeAvailable: text("cooking_time_available"),
  glp1Mode: boolean("glp1_mode").default(false),
  glp1Medication: text("glp1_medication"),
  glp1StartDate: timestamp("glp1_start_date", { withTimezone: true }),
  healthDataConsentAt: timestamp("health_data_consent_at", {
    withTimezone: true,
  }),
  reminderMutes: jsonb("reminder_mutes")
    .$type<ReminderMutes>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const pendingReminders = pgTable(
  "pending_reminders",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").$type<ReminderType>().notNull(),
    context: jsonb("context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("pending_reminders_user_pending_idx").on(
      table.userId,
      table.acknowledgedAt,
    ),
    // Partial index mirrors hasPendingReminderToday() semantics: one unacknowledged reminder per user+type per calendar day.
    uniqueIndex("pending_reminders_user_type_day_idx")
      .on(
        table.userId,
        table.type,
        sql`DATE(${table.scheduledFor} AT TIME ZONE 'UTC')`,
      )
      .where(sql`${table.acknowledgedAt} IS NULL`),
  ],
);

export type PendingReminder = typeof pendingReminders.$inferSelect;
export type InsertPendingReminder = typeof pendingReminders.$inferInsert;

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
    sourceType: text("source_type").notNull().default("barcode"),
    photoUrl: text("photo_url"),
    aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
    preparationMethods: jsonb("preparation_methods").$type<
      { name: string; method: string }[]
    >(),
    analysisIntent: text("analysis_intent"),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
  },
  (table) => [
    index("scanned_items_user_active_idx")
      .on(table.userId, table.scannedAt)
      .where(sql`discarded_at IS NULL`),
    index("scanned_items_scanned_at_idx").on(table.scannedAt),
    check("scanned_items_calories_gte0", sql`${table.calories} >= 0`),
    check("scanned_items_protein_gte0", sql`${table.protein} >= 0`),
    check("scanned_items_carbs_gte0", sql`${table.carbs} >= 0`),
    check("scanned_items_fat_gte0", sql`${table.fat} >= 0`),
  ],
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
      onDelete: "cascade",
    }),
    mealPlanItemId: integer("meal_plan_item_id").references(
      () => mealPlanItems.id,
      { onDelete: "set null" },
    ),
    source: text("source").notNull().default("scan"),
    servings: decimal("servings", { precision: 5, scale: 2 }).default("1"),
    mealType: text("meal_type"),
    loggedAt: timestamp("logged_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("daily_logs_user_logged_at_idx").on(table.userId, table.loggedAt),
    index("daily_logs_logged_at_idx").on(table.loggedAt),
    index("daily_logs_meal_plan_item_id_idx").on(table.mealPlanItemId),
    // Prevent duplicate meal plan confirmations
    uniqueIndex("daily_logs_unique_meal_plan_confirm")
      .on(table.userId, table.mealPlanItemId)
      .where(sql`meal_plan_item_id IS NOT NULL`),
    // Prevent ghost rows with no nutrition source
    check(
      "daily_logs_has_source",
      sql`scanned_item_id IS NOT NULL OR recipe_id IS NOT NULL`,
    ),
    check("daily_logs_servings_gt0", sql`${table.servings} > 0`),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("nutrition_cache_query_key_idx").on(table.queryKey),
    index("nutrition_cache_expires_at_idx").on(table.expiresAt),
  ],
);

export const micronutrientCache = pgTable(
  "micronutrient_cache",
  {
    id: serial("id").primaryKey(),
    queryKey: varchar("query_key", { length: 255 }).notNull().unique(),
    data: jsonb("data").notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("micronutrient_cache_query_key_idx").on(table.queryKey),
    index("micronutrient_cache_expires_at_idx").on(table.expiresAt),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("suggestion_cache_item_user_profile_idx").on(
      table.scannedItemId,
      table.userId,
      table.profileHash,
    ),
    index("suggestion_cache_expires_at_idx").on(table.expiresAt),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("instruction_cache_suggestion_idx").on(
      table.suggestionCacheId,
      table.suggestionIndex,
    ),
  ],
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
  (table) => [
    index("saved_items_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  scannedItems: many(scannedItems),
  dailyLogs: many(dailyLogs),
  savedItems: many(savedItems),
  favouriteScannedItems: many(favouriteScannedItems),
  favouriteRecipes: many(favouriteRecipes),
  mealPlanRecipes: many(mealPlanRecipes),
  mealPlanItems: many(mealPlanItems),
  transactions: many(transactions),
  groceryLists: many(groceryLists),
  pantryItems: many(pantryItems),
  chatConversations: many(chatConversations),
  fastingSchedules: many(fastingSchedules),
  fastingLogs: many(fastingLogs),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    unique().on(table.userId, table.scannedItemId),
    index("favourite_scanned_items_user_id_idx").on(table.userId),
    index("favourite_scanned_items_scanned_item_id_idx").on(
      table.scannedItemId,
    ),
  ],
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

export const favouriteRecipes = pgTable(
  "favourite_recipes",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").notNull(),
    recipeType: text("recipe_type").notNull(), // "mealPlan" | "community"
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    unique().on(table.userId, table.recipeId, table.recipeType),
    index("favourite_recipes_user_id_idx").on(table.userId),
  ],
);

export const favouriteRecipesRelations = relations(
  favouriteRecipes,
  ({ one }) => ({
    user: one(users, {
      fields: [favouriteRecipes.userId],
      references: [users.id],
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
    dietTags: jsonb("diet_tags").$type<string[]>().default([]).notNull(),
    mealTypes: jsonb("meal_types").$type<string[]>().default([]).notNull(),
    // Denormalized allergen cache derived from ingredient names via
    // `deriveRecipeAllergens` (shared/constants/allergens.ts). Type-only import
    // — erased at compile time, so no schema↔allergens runtime import cycle.
    // Nullable: `null` means "not yet derived" and is conservatively treated as
    // unsafe by `isRecipeSafeForAllergies`; `[]` means "derived, genuinely no
    // allergens" = safe. Write paths always store a concrete array — `null`
    // only ever appears for rows predating the backfill.
    allergens: jsonb("allergens").$type<DerivedRecipeAllergen[] | null>(),
    instructions: jsonb("instructions").$type<string[]>().notNull(),
    ingredients: jsonb("ingredients")
      .$type<{ name: string; quantity: string; unit: string }[]>()
      .default([])
      .notNull(),
    caloriesPerServing: decimal("calories_per_serving", {
      precision: 10,
      scale: 2,
    }),
    proteinPerServing: decimal("protein_per_serving", {
      precision: 10,
      scale: 2,
    }),
    carbsPerServing: decimal("carbs_per_serving", { precision: 10, scale: 2 }),
    fatPerServing: decimal("fat_per_serving", { precision: 10, scale: 2 }),
    imageUrl: text("image_url"),
    isPublic: boolean("is_public").default(true),
    remixedFromId: integer("remixed_from_id").references(
      (): AnyPgColumn => communityRecipes.id,
      { onDelete: "set null" },
    ),
    remixedFromTitle: text("remixed_from_title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    sourceMessageId: integer("source_message_id"),

    // Popularity tracking
    popularityFavorites: integer("popularity_favorites").default(0).notNull(),
    popularityMealPlans: integer("popularity_meal_plans").default(0).notNull(),
    popularityCookSessions: integer("popularity_cook_sessions")
      .default(0)
      .notNull(),
    popularityScore: integer("popularity_score").default(0).notNull(),

    // Promotion state
    isCanonical: boolean("is_canonical").default(false).notNull(),
    canonicalizedAt: timestamp("canonicalized_at", { withTimezone: true }),
    canonicalEnrichedAt: timestamp("canonical_enriched_at", {
      withTimezone: true,
    }),

    // Canonical content (only populated after enrichment)
    canonicalImages: jsonb("canonical_images")
      .$type<string[]>()
      .default([])
      .notNull(),
    instructionDetails: jsonb("instruction_details")
      .$type<(string | null)[]>()
      .default([])
      .notNull(),
    toolsRequired: jsonb("tools_required")
      .$type<{ name: string; affiliateUrl?: string }[]>()
      .default([])
      .notNull(),
    chefTips: jsonb("chef_tips").$type<string[]>().default([]).notNull(),
    cuisineOrigin: text("cuisine_origin"),
    videoUrl: text("video_url"),
  },
  (table) => [
    index("community_recipes_barcode_idx").on(table.barcode),
    index("community_recipes_normalized_name_trgm_idx").using(
      "gin",
      table.normalizedProductName.op("gin_trgm_ops"),
    ),
    index("community_recipes_title_trgm_idx").using(
      "gin",
      table.title.op("gin_trgm_ops"),
    ),
    index("community_recipes_description_trgm_idx").using(
      "gin",
      table.description.op("gin_trgm_ops"),
    ),
    index("community_recipes_author_idx").on(table.authorId),
    index("community_recipes_diet_tags_gin_idx").using("gin", table.dietTags),
    index("community_recipes_meal_types_gin_idx").using("gin", table.mealTypes),
    index("community_recipes_is_public_created_at_idx").on(
      table.isPublic,
      table.createdAt,
    ),
    check("cr_calories_gte0", sql`${table.caloriesPerServing} >= 0`),
    check("cr_protein_gte0", sql`${table.proteinPerServing} >= 0`),
    check("cr_carbs_gte0", sql`${table.carbsPerServing} >= 0`),
    check("cr_fat_gte0", sql`${table.fatPerServing} >= 0`),
    uniqueIndex("community_recipes_source_msg_idx")
      .on(table.sourceMessageId)
      .where(sql`${table.sourceMessageId} IS NOT NULL`),
    index("community_recipes_is_canonical_idx").on(table.isCanonical),
    index("community_recipes_popularity_score_idx").on(table.popularityScore),
  ],
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
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("recipe_gen_log_user_date_idx").on(table.userId, table.generatedAt),
  ],
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

// Preference elicitation picks — recipe-level taste signal
export const tastePicks = pgTable(
  "taste_picks",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => communityRecipes.id, { onDelete: "cascade" }),
    pickedAt: timestamp("picked_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    unique("taste_picks_user_recipe_uniq").on(table.userId, table.recipeId),
    index("taste_picks_user_idx").on(table.userId),
  ],
);

export type TastePick = typeof tastePicks.$inferSelect;
export type InsertTastePick = typeof tastePicks.$inferInsert;

export const tastePicksRelations = relations(tastePicks, ({ one }) => ({
  user: one(users, {
    fields: [tastePicks.userId],
    references: [users.id],
  }),
  recipe: one(communityRecipes, {
    fields: [tastePicks.recipeId],
    references: [communityRecipes.id],
  }),
}));

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
    instructions: jsonb("instructions")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    dietTags: jsonb("diet_tags").$type<string[]>().default([]).notNull(),
    mealTypes: jsonb("meal_types").$type<string[]>().default([]).notNull(),
    // Denormalized allergen cache derived from ingredient names via
    // `deriveRecipeAllergens` (shared/constants/allergens.ts). Type-only import
    // — erased at compile time, so no schema↔allergens runtime import cycle.
    // Nullable: `null` means "not yet derived" and is conservatively treated as
    // unsafe by `isRecipeSafeForAllergies`; `[]` means "derived, genuinely no
    // allergens" = safe. Write paths always store a concrete array — `null`
    // only ever appears for rows predating the backfill.
    allergens: jsonb("allergens").$type<DerivedRecipeAllergen[] | null>(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("meal_plan_recipes_user_id_idx").on(table.userId),
    uniqueIndex("meal_plan_recipes_user_external_id_idx").on(
      table.userId,
      table.externalId,
    ),
    index("meal_plan_recipes_title_trgm_idx").using(
      "gin",
      table.title.op("gin_trgm_ops"),
    ),
    index("meal_plan_recipes_description_trgm_idx").using(
      "gin",
      table.description.op("gin_trgm_ops"),
    ),
    check("mpr_calories_gte0", sql`${table.caloriesPerServing} >= 0`),
    check("mpr_protein_gte0", sql`${table.proteinPerServing} >= 0`),
    check("mpr_carbs_gte0", sql`${table.carbsPerServing} >= 0`),
    check("mpr_fat_gte0", sql`${table.fatPerServing} >= 0`),
    check("mpr_servings_gt0", sql`${table.servings} > 0`),
    index("meal_plan_recipes_diet_tags_gin_idx").using("gin", table.dietTags),
    index("meal_plan_recipes_meal_types_gin_idx").using("gin", table.mealTypes),
  ],
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
  (table) => [index("recipe_ingredients_recipe_id_idx").on(table.recipeId)],
);

export const mealPlanItems = pgTable(
  "meal_plan_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").references(() => mealPlanRecipes.id, {
      onDelete: "cascade",
    }),
    scannedItemId: integer("scanned_item_id").references(
      () => scannedItems.id,
      { onDelete: "cascade" },
    ),
    plannedDate: date("planned_date").notNull(),
    mealType: text("meal_type").notNull(),
    servings: decimal("servings", { precision: 5, scale: 2 }).default("1"),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("meal_plan_items_user_date_idx").on(table.userId, table.plannedDate),
    index("meal_plan_items_meal_type_created_idx").on(
      table.mealType,
      table.createdAt,
    ),
    // Exactly one nutrition source — recipe XOR scanned item
    check(
      "meal_plan_items_source_xor",
      sql`num_nonnulls(recipe_id, scanned_item_id) = 1`,
    ),
    check("meal_plan_items_servings_gt0", sql`${table.servings} > 0`),
  ],
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

// ============================================================================
// CHAT CONVERSATIONS
// ============================================================================

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("coach"), // 'coach' | 'recipe' | 'remix'
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("chat_conversations_user_id_idx").on(table.userId),
    index("chat_conversations_user_type_idx").on(table.userId, table.type),
    // M14 (2026-04-18): getChatConversations filters by userId and sorts by
    // updatedAt DESC — composite index eliminates the sort+filter scan.
    index("chat_conversations_user_updated_at_idx").on(
      table.userId,
      table.updatedAt,
    ),
    index("chat_conversations_title_trgm_idx").using(
      "gin",
      table.title.op("gin_trgm_ops"),
    ),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .references(() => chatConversations.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(), // "user" | "assistant" | "system"
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    turnKey: text("turn_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("chat_messages_conversation_id_idx").on(table.conversationId),
    index("chat_messages_conv_role_created_idx").on(
      table.conversationId,
      table.role,
      table.createdAt,
    ),
    uniqueIndex("chat_messages_turn_key_idx")
      .on(table.conversationId, table.turnKey)
      .where(sql`${table.turnKey} IS NOT NULL`),
  ],
);

export const chatConversationsRelations = relations(
  chatConversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [chatConversations.userId],
      references: [users.id],
    }),
    messages: many(chatMessages),
  }),
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, {
    fields: [chatMessages.conversationId],
    references: [chatConversations.id],
  }),
}));

// ============================================================================
// FASTING
// ============================================================================

export const fastingSchedules = pgTable(
  "fasting_schedules",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    protocol: text("protocol").notNull(), // "16:8", "18:6", "20:4", "5:2", "custom"
    fastingHours: integer("fasting_hours").notNull(),
    eatingHours: integer("eating_hours").notNull(),
    eatingWindowStart: text("eating_window_start"), // "12:00"
    eatingWindowEnd: text("eating_window_end"), // "20:00"
    isActive: boolean("is_active").default(true).notNull(),
    notifyEatingWindow: boolean("notify_eating_window").default(true).notNull(),
    notifyMilestones: boolean("notify_milestones").default(true).notNull(),
    notifyCheckIns: boolean("notify_check_ins").default(true).notNull(),
  },
  (table) => [uniqueIndex("fasting_schedules_user_idx").on(table.userId)],
);

export const fastingLogs = pgTable(
  "fasting_logs",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    targetDurationHours: integer("target_duration_hours").notNull(),
    actualDurationMinutes: integer("actual_duration_minutes"),
    completed: boolean("completed"),
    note: text("note"),
  },
  (table) => [
    index("fasting_logs_user_date_idx").on(table.userId, table.startedAt),
    uniqueIndex("fasting_logs_one_active_idx")
      .on(table.userId)
      .where(sql`ended_at IS NULL`),
  ],
);

export const fastingSchedulesRelations = relations(
  fastingSchedules,
  ({ one }) => ({
    user: one(users, {
      fields: [fastingSchedules.userId],
      references: [users.id],
    }),
  }),
);

export const fastingLogsRelations = relations(fastingLogs, ({ one }) => ({
  user: one(users, {
    fields: [fastingLogs.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// MENU SCANS
// ============================================================================

export const menuScans = pgTable(
  "menu_scans",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    restaurantName: text("restaurant_name"),
    cuisine: text("cuisine"),
    menuItems: jsonb("menu_items")
      .$type<
        {
          name: string;
          description?: string;
          price?: string;
          calories?: number;
          protein?: number;
          carbs?: number;
          fat?: number;
        }[]
      >()
      .default([])
      .notNull(),
    imageUrl: text("image_url"),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("menu_scans_user_scanned_at_idx").on(table.userId, table.scannedAt),
  ],
);

export const menuScansRelations = relations(menuScans, ({ one }) => ({
  user: one(users, {
    fields: [menuScans.userId],
    references: [users.id],
  }),
}));

export type MenuScan = typeof menuScans.$inferSelect;
export type InsertMenuScan = typeof menuScans.$inferInsert;

// ============================================================================
// RECEIPT SCANS (Receipt Scanner for Pantry)
// ============================================================================

export const receiptScans = pgTable(
  "receipt_scans",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    itemCount: integer("item_count").default(0),
    photoCount: integer("photo_count").default(1),
    status: text("status").notNull().default("completed"),
    scannedAt: timestamp("scanned_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("receipt_scans_user_id_idx").on(table.userId),
    index("receipt_scans_scanned_at_idx").on(table.scannedAt),
  ],
);

export const receiptScansRelations = relations(receiptScans, ({ one }) => ({
  user: one(users, {
    fields: [receiptScans.userId],
    references: [users.id],
  }),
}));

export type ReceiptScan = typeof receiptScans.$inferSelect;
export type InsertReceiptScan = typeof receiptScans.$inferInsert;

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
export type MicronutrientCache = typeof micronutrientCache.$inferSelect;
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("transactions_user_id_idx").on(table.userId),
    index("transactions_status_idx").on(table.status),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("grocery_lists_user_date_idx").on(table.userId, table.dateRangeStart),
  ],
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
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => [index("grocery_list_items_list_id_idx").on(table.groceryListId)],
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
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("pantry_items_user_id_idx").on(table.userId),
    index("pantry_items_user_expires_idx").on(table.userId, table.expiresAt),
  ],
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
    suggestions: jsonb("suggestions").$type<MealSuggestion[]>().notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("meal_suggestion_cache_key_idx").on(table.cacheKey),
    index("meal_suggestion_cache_expires_idx").on(table.expiresAt),
  ],
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

// Coach response cache — per-user cache for predefined coach questions
// Only used for questions WITHOUT screenContext; keyed by userId + question hash
export const coachResponseCache = pgTable(
  "coach_response_cache",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    questionHash: varchar("question_hash", { length: 64 }).notNull(),
    question: text("question").notNull(),
    response: text("response").notNull(),
    hitCount: integer("hit_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Composite unique index matching semantic intent: one cache entry per
    // (user, question). The questionHash already embeds userId (see
    // hashCoachCacheKey), so this makes the DB constraint align with intent.
    uniqueIndex("coach_response_cache_hash_idx").on(
      table.userId,
      table.questionHash,
    ),
    index("coach_response_cache_expires_idx").on(table.expiresAt),
    index("coach_response_cache_user_idx").on(table.userId),
  ],
);

export const coachResponseCacheRelations = relations(
  coachResponseCache,
  ({ one }) => ({
    user: one(users, {
      fields: [coachResponseCache.userId],
      references: [users.id],
    }),
  }),
);

// ============================================================================
// COACH NOTEBOOK
// ============================================================================

export const coachNotebook = pgTable(
  "coach_notebook",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(), // "insight" | "commitment" | "preference" | "goal" | "motivation" | "emotional_context" | "conversation_summary" | "coaching_strategy"
    content: text("content").notNull(),
    status: text("status").default("active").notNull(), // "active" | "completed" | "expired" | "archived"
    followUpDate: timestamp("follow_up_date", { withTimezone: true }),
    sourceConversationId: integer("source_conversation_id").references(
      () => chatConversations.id,
      { onDelete: "set null" },
    ),
    /**
     * Deduplication fingerprint for a conversation-turn write. SHA-256 hex of
     * `${userId}:${sourceConversationId}:${entry.type}:${entry.content}:${lastUser}:${lastAssistant}`
     * (or a weekly bucket for `coaching_strategy`).
     * Nullable for historical rows. A unique index on this column (when not
     * null) makes `createNotebookEntries` idempotent when the SSE stream is
     * retried.
     *
     * Mapped to the pre-existing `turn_fingerprint` column in Postgres.
     */
    dedupeKey: text("turn_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("coach_notebook_user_type_status_idx").on(
      table.userId,
      table.type,
      table.status,
      table.followUpDate,
    ),
    index("coach_notebook_user_follow_up_idx").on(
      table.userId,
      table.followUpDate,
    ),
    index("coach_notebook_source_conv_idx").on(table.sourceConversationId),
    // M16 (2026-04-18): Partial index — only enforce uniqueness when dedupeKey
    // IS NOT NULL so NULL-keyed rows (old entries) don't block each other and
    // onConflictDoNothing correctly skips duplicate keyed inserts.
    uniqueIndex("coach_notebook_turn_fingerprint_idx")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    index("coach_notebook_due_commitments_idx")
      .on(table.followUpDate)
      .where(sql`${table.type} = 'commitment' AND ${table.status} = 'active'`),
    index("coach_notebook_user_status_idx").on(table.userId, table.status),
    check(
      "coach_notebook_type_check",
      sql`${table.type} IN ('insight', 'commitment', 'preference', 'goal', 'motivation', 'emotional_context', 'conversation_summary', 'coaching_strategy')`,
    ),
    check(
      "coach_notebook_status_check",
      sql`${table.status} IN ('active', 'completed', 'expired', 'archived')`,
    ),
  ],
);

export const coachNotebookRelations = relations(coachNotebook, ({ one }) => ({
  user: one(users, {
    fields: [coachNotebook.userId],
    references: [users.id],
  }),
  sourceConversation: one(chatConversations, {
    fields: [coachNotebook.sourceConversationId],
    references: [chatConversations.id],
  }),
}));

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
export type CoachResponseCacheEntry = typeof coachResponseCache.$inferSelect;

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
// Use Drizzle's native insert inference (mirrors `InsertCommunityRecipe`) so
// the `.$type<DerivedRecipeAllergen[] | null>()` hint on the nullable
// `allergens` jsonb column is preserved — `createInsertSchema` (drizzle-zod
// 0.7.x) loosens a nullable typed jsonb column to a generic `Json` union.
export type InsertMealPlanRecipe = typeof mealPlanRecipes.$inferInsert;
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

export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = typeof chatConversations.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

export type FastingSchedule = typeof fastingSchedules.$inferSelect;
export type InsertFastingSchedule = typeof fastingSchedules.$inferInsert;
export type FastingLog = typeof fastingLogs.$inferSelect;
export type InsertFastingLog = typeof fastingLogs.$inferInsert;

// ============================================================================
// COOKBOOKS
// ============================================================================

export const cookbooks = pgTable(
  "cookbooks",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [index("cookbooks_user_id_idx").on(table.userId)],
);

export const cookbookRecipes = pgTable(
  "cookbook_recipes",
  {
    id: serial("id").primaryKey(),
    cookbookId: integer("cookbook_id")
      .references(() => cookbooks.id, { onDelete: "cascade" })
      .notNull(),
    recipeId: integer("recipe_id").notNull(),
    recipeType: text("recipe_type").notNull().default("mealPlan"), // 'mealPlan' | 'community'
    addedAt: timestamp("added_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("cookbook_recipes_unique_idx").on(
      table.cookbookId,
      table.recipeId,
      table.recipeType,
    ),
  ],
);

export const cookbooksRelations = relations(cookbooks, ({ one, many }) => ({
  user: one(users, {
    fields: [cookbooks.userId],
    references: [users.id],
  }),
  recipes: many(cookbookRecipes),
}));

export const cookbookRecipesRelations = relations(
  cookbookRecipes,
  ({ one }) => ({
    cookbook: one(cookbooks, {
      fields: [cookbookRecipes.cookbookId],
      references: [cookbooks.id],
    }),
  }),
);

export const insertCookbookSchema = createInsertSchema(cookbooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Cookbook = typeof cookbooks.$inferSelect;
export type InsertCookbook = z.infer<typeof insertCookbookSchema>;
export type CookbookRecipe = typeof cookbookRecipes.$inferSelect;
export type InsertCookbookRecipe = typeof cookbookRecipes.$inferInsert;

/** Cookbook with recipe count for list views */
export type CookbookWithCount = Cookbook & { recipeCount: number };

/** Resolved recipe data for cookbook detail — normalized from mealPlanRecipes or communityRecipes */
export interface ResolvedCookbookRecipe {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  description: string | null;
  imageUrl: string | null;
  servings: number | null;
  difficulty: string | null;
  addedAt: string;
}

export type FavouriteRecipe = typeof favouriteRecipes.$inferSelect;

export interface ResolvedFavouriteRecipe {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  description: string | null;
  imageUrl: string | null;
  servings: number | null;
  difficulty: string | null;
  favouritedAt: string;
}

// ============================================================================
// Barcode Verification (Community-Verified Product Data)
// ============================================================================

export const barcodeVerifications = pgTable(
  "barcode_verifications",
  {
    id: serial("id").primaryKey(),
    barcode: text("barcode").notNull().unique(),
    verificationLevel: text("verification_level")
      .default("unverified")
      .notNull(),
    consensusNutritionData: jsonb("consensus_nutrition_data"),
    verificationCount: integer("verification_count").default(0).notNull(),
    frontLabelData: jsonb("front_label_data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("barcode_verifications_level_idx").on(table.verificationLevel),
    check(
      "barcode_verifications_count_gte0",
      sql`${table.verificationCount} >= 0`,
    ),
  ],
);

export const verificationHistory = pgTable(
  "verification_history",
  {
    id: serial("id").primaryKey(),
    barcode: text("barcode")
      .references(() => barcodeVerifications.barcode, { onDelete: "cascade" })
      .notNull(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    extractedNutrition: jsonb("extracted_nutrition").notNull(),
    ocrConfidence: decimal("ocr_confidence", {
      precision: 3,
      scale: 2,
    }).notNull(),
    isMatch: boolean("is_match"),
    frontLabelScanned: boolean("front_label_scanned").default(false).notNull(),
    frontLabelScannedAt: timestamp("front_label_scanned_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("verification_history_barcode_idx").on(table.barcode),
    index("verification_history_user_id_idx").on(table.userId),
    unique("verification_history_user_barcode").on(table.barcode, table.userId),
  ],
);

export type BarcodeVerification = typeof barcodeVerifications.$inferSelect;
export type InsertBarcodeVerification =
  typeof barcodeVerifications.$inferInsert;
export type VerificationHistoryEntry = typeof verificationHistory.$inferSelect;
export type InsertVerificationHistory = typeof verificationHistory.$inferInsert;

// ── Reformulation Detection ─────────────────────────────────────────

export const reformulationFlags = pgTable(
  "reformulation_flags",
  {
    id: serial("id").primaryKey(),
    barcode: text("barcode")
      .references(() => barcodeVerifications.barcode, { onDelete: "cascade" })
      .notNull(),
    status: text("status").default("flagged").notNull(), // flagged | resolved
    divergentScanCount: integer("divergent_scan_count").default(0).notNull(),
    previousConsensus: jsonb("previous_consensus"), // snapshot of old consensus for audit
    previousVerificationLevel: text("previous_verification_level"),
    previousVerificationCount: integer("previous_verification_count"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("reformulation_flags_barcode_idx").on(table.barcode),
    index("reformulation_flags_status_idx").on(table.status),
    uniqueIndex("reformulation_flags_active_unique")
      .on(table.barcode)
      .where(sql`status = 'flagged'`),
  ],
);

export type ReformulationFlag = typeof reformulationFlags.$inferSelect;
export type InsertReformulationFlag = typeof reformulationFlags.$inferInsert;

// ── Public API ──────────────────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    keyHash: text("key_hash").notNull(),
    name: text("name").notNull(),
    tier: text("tier").default("free").notNull(),
    status: text("status").default("active").notNull(),
    ownerId: varchar("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_prefix_idx").on(table.keyPrefix),
    index("api_keys_status_idx").on(table.status),
  ],
);

export const apiKeyUsage = pgTable(
  "api_key_usage",
  {
    id: serial("id").primaryKey(),
    apiKeyId: integer("api_key_id")
      .references(() => apiKeys.id, { onDelete: "cascade" })
      .notNull(),
    yearMonth: varchar("year_month", { length: 7 }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_key_usage_unique_idx").on(table.apiKeyId, table.yearMonth),
  ],
);

export const barcodeNutrition = pgTable(
  "barcode_nutrition",
  {
    id: serial("id").primaryKey(),
    barcode: text("barcode").notNull().unique(),
    productName: text("product_name"),
    brandName: text("brand_name"),
    servingSize: text("serving_size"),
    calories: decimal("calories", { precision: 10, scale: 2 }),
    protein: decimal("protein", { precision: 10, scale: 2 }),
    carbs: decimal("carbs", { precision: 10, scale: 2 }),
    fat: decimal("fat", { precision: 10, scale: 2 }),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    check("bn_calories_gte0", sql`${table.calories} >= 0`),
    check("bn_protein_gte0", sql`${table.protein} >= 0`),
    check("bn_carbs_gte0", sql`${table.carbs} >= 0`),
    check("bn_fat_gte0", sql`${table.fat} >= 0`),
  ],
);

// ── Carousel (recipe discovery) ──────────────────────────────────────

export const recipeDismissals = pgTable(
  "recipe_dismissals",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    recipeIdentifier: text("recipe_identifier").notNull(),
    source: text("source").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("recipe_dismissals_user_recipe_idx").on(
      table.userId,
      table.recipeIdentifier,
    ),
  ],
);

export const carouselSuggestionCache = pgTable(
  "carousel_suggestion_cache",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    profileHash: text("profile_hash").notNull(),
    mealType: text("meal_type").notNull(),
    suggestions: jsonb("suggestions").$type<CarouselRecipeCard[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("carousel_cache_user_profile_meal_idx").on(
      table.userId,
      table.profileHash,
      table.mealType,
    ),
  ],
);

export type RecipeDismissal = typeof recipeDismissals.$inferSelect;
export type InsertRecipeDismissal = typeof recipeDismissals.$inferInsert;
export type CarouselSuggestionCacheEntry =
  typeof carouselSuggestionCache.$inferSelect;

// ── Type exports ─────────────────────────────────────────────────────

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyUsage = typeof apiKeyUsage.$inferSelect;
export type InsertApiKeyUsage = typeof apiKeyUsage.$inferInsert;
export type BarcodeNutrition = typeof barcodeNutrition.$inferSelect;
export type InsertBarcodeNutrition = typeof barcodeNutrition.$inferInsert;

export type CoachNotebookEntry = typeof coachNotebook.$inferSelect;
export type InsertCoachNotebookEntry = typeof coachNotebook.$inferInsert;

// ============================================================================
// PUSH TOKENS
// ============================================================================

/**
 * Stores Expo push tokens for server-driven push notification delivery.
 * One row per (userId, token) pair. Tokens are upserted on login so token
 * rotation is handled automatically — a new token replaces the old one for
 * the same (userId, platform) combination.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    token: text("token").notNull(),
    platform: text("platform").notNull(), // "ios" | "android"
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("push_tokens_user_platform_idx").on(
      table.userId,
      table.platform,
    ),
  ],
);

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;
