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
    scannedAt: timestamp("scanned_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
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
    scannedItemId: integer("scanned_item_id")
      .references(() => scannedItems.id, {
        onDelete: "cascade",
      })
      .notNull(),
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
export type SavedItem = typeof savedItems.$inferSelect;
export type InsertSavedItem = typeof savedItems.$inferInsert;
