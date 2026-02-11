# NutriScan Database Schema

## Overview

NutriScan uses PostgreSQL with Drizzle ORM for database operations. The schema is defined in `shared/schema.ts` and is shared between the frontend and backend.

## Schema Definition

### Users Table

Primary table for user accounts.

```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  display_name TEXT,
  daily_calorie_goal INTEGER DEFAULT 2000,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  subscription_tier TEXT DEFAULT 'free',
  subscription_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column                  | Type      | Constraints             | Description                          |
| ----------------------- | --------- | ----------------------- | ------------------------------------ |
| id                      | VARCHAR   | PK, auto-generated UUID | Unique identifier                    |
| username                | TEXT      | NOT NULL, UNIQUE        | Login username                       |
| password                | TEXT      | NOT NULL                | Bcrypt-hashed password               |
| display_name            | TEXT      | nullable                | User's display name                  |
| daily_calorie_goal      | INTEGER   | DEFAULT 2000            | Target daily calories                |
| daily_protein_goal      | INTEGER   | nullable                | Target daily protein (grams)         |
| daily_carbs_goal        | INTEGER   | nullable                | Target daily carbs (grams)           |
| daily_fat_goal          | INTEGER   | nullable                | Target daily fat (grams)             |
| weight                  | DECIMAL   | nullable, precision 5,2 | User weight in kg                    |
| height                  | DECIMAL   | nullable, precision 5,2 | User height in cm                    |
| age                     | INTEGER   | nullable                | User age in years                    |
| gender                  | TEXT      | nullable                | `"male"`, `"female"`, or `"other"`   |
| goals_calculated_at     | TIMESTAMP | nullable                | When goals were last auto-calculated |
| onboarding_completed    | BOOLEAN   | DEFAULT FALSE           | Onboarding status                    |
| subscription_tier       | TEXT      | DEFAULT 'free'          | `"free"` or `"premium"`              |
| subscription_expires_at | TIMESTAMP | nullable                | Premium expiry (null = no expiry)    |
| created_at              | TIMESTAMP | NOT NULL, auto          | Account creation time                |

### User Profiles Table

Stores dietary preferences and restrictions collected during onboarding.

```sql
CREATE TABLE user_profiles (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  allergies JSONB DEFAULT '[]',
  health_conditions JSONB DEFAULT '[]',
  diet_type TEXT,
  food_dislikes JSONB DEFAULT '[]',
  primary_goal TEXT,
  activity_level TEXT,
  household_size INTEGER DEFAULT 1,
  cuisine_preferences JSONB DEFAULT '[]',
  cooking_skill_level TEXT,
  cooking_time_available TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column                 | Type      | Constraints        | Description                       |
| ---------------------- | --------- | ------------------ | --------------------------------- |
| id                     | SERIAL    | PK                 | Auto-incrementing ID              |
| user_id                | VARCHAR   | FK → users, UNIQUE | User reference                    |
| allergies              | JSONB     | DEFAULT '[]'       | Array of {name, severity} objects |
| health_conditions      | JSONB     | DEFAULT '[]'       | Array of condition strings        |
| diet_type              | TEXT      | nullable           | Diet preference                   |
| food_dislikes          | JSONB     | DEFAULT '[]'       | Foods to avoid                    |
| primary_goal           | TEXT      | nullable           | Health/fitness goal               |
| activity_level         | TEXT      | nullable           | Exercise frequency                |
| household_size         | INTEGER   | DEFAULT 1          | Number in household               |
| cuisine_preferences    | JSONB     | DEFAULT '[]'       | Preferred cuisines                |
| cooking_skill_level    | TEXT      | nullable           | Cooking experience                |
| cooking_time_available | TEXT      | nullable           | Time for cooking                  |
| created_at             | TIMESTAMP | NOT NULL           | Profile creation time             |
| updated_at             | TIMESTAMP | NOT NULL           | Last update time                  |

#### Allergy Schema

```typescript
interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}
```

Example:

```json
[
  { "name": "peanuts", "severity": "severe" },
  { "name": "dairy", "severity": "mild" }
]
```

#### Enum Values

**diet_type**:

- `omnivore`
- `vegetarian`
- `vegan`
- `pescatarian`
- `keto`
- `paleo`
- `gluten_free`

**primary_goal**:

- `lose_weight`
- `gain_muscle`
- `maintain`
- `eat_healthier`

**activity_level**:

- `sedentary`
- `light`
- `moderate`
- `active`
- `athlete`

**cooking_skill_level**:

- `beginner`
- `intermediate`
- `advanced`

**cooking_time_available**:

- `quick` (< 15 min)
- `moderate` (15-30 min)
- `extended` (30-60 min)
- `leisurely` (> 60 min)

### Scanned Items Table

Stores nutritional information for scanned food products.

```sql
CREATE TABLE scanned_items (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  barcode TEXT,
  product_name TEXT NOT NULL,
  brand_name TEXT,
  serving_size TEXT,
  calories DECIMAL(10, 2),
  protein DECIMAL(10, 2),
  carbs DECIMAL(10, 2),
  fat DECIMAL(10, 2),
  fiber DECIMAL(10, 2),
  sugar DECIMAL(10, 2),
  sodium DECIMAL(10, 2),
  image_url TEXT,
  source_type TEXT DEFAULT 'barcode',
  photo_url TEXT,
  ai_confidence DECIMAL(3, 2),
  preparation_methods JSONB,
  analysis_intent TEXT,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column              | Type          | Constraints       | Description                                                   |
| ------------------- | ------------- | ----------------- | ------------------------------------------------------------- |
| id                  | SERIAL        | PK                | Auto-incrementing ID                                          |
| user_id             | VARCHAR       | FK → users        | User who scanned                                              |
| barcode             | TEXT          | nullable          | Product barcode (EAN/UPC)                                     |
| product_name        | TEXT          | NOT NULL          | Product name                                                  |
| brand_name          | TEXT          | nullable          | Manufacturer/brand                                            |
| serving_size        | TEXT          | nullable          | Serving description                                           |
| calories            | DECIMAL(10,2) | nullable          | Calories per serving                                          |
| protein             | DECIMAL(10,2) | nullable          | Protein in grams                                              |
| carbs               | DECIMAL(10,2) | nullable          | Carbohydrates in grams                                        |
| fat                 | DECIMAL(10,2) | nullable          | Fat in grams                                                  |
| fiber               | DECIMAL(10,2) | nullable          | Fiber in grams                                                |
| sugar               | DECIMAL(10,2) | nullable          | Sugar in grams                                                |
| sodium              | DECIMAL(10,2) | nullable          | Sodium in mg                                                  |
| image_url           | TEXT          | nullable          | Product image URL (barcode source)                            |
| source_type         | TEXT          | DEFAULT 'barcode' | `"barcode"` or `"photo"`                                      |
| photo_url           | TEXT          | nullable          | User's uploaded photo URL (reserved for future use)           |
| ai_confidence       | DECIMAL(3,2)  | nullable          | Vision AI confidence score 0.00–1.00                          |
| preparation_methods | JSONB         | nullable          | Per-food prep methods: `[{ name, method }]`                   |
| analysis_intent     | TEXT          | nullable          | Photo intent: `"log"`, `"calories"`, `"recipe"`, `"identify"` |
| scanned_at          | TIMESTAMP     | NOT NULL          | When item was scanned                                         |

### Daily Logs Table

Tracks daily food intake by linking scanned items to specific days.

```sql
CREATE TABLE daily_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
  scanned_item_id INTEGER REFERENCES scanned_items(id) ON DELETE CASCADE,
  servings DECIMAL(5, 2) DEFAULT '1',
  meal_type TEXT,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column          | Type         | Constraints        | Description          |
| --------------- | ------------ | ------------------ | -------------------- |
| id              | SERIAL       | PK                 | Auto-incrementing ID |
| user_id         | VARCHAR      | FK → users         | User who logged      |
| scanned_item_id | INTEGER      | FK → scanned_items | Reference to food    |
| servings        | DECIMAL(5,2) | DEFAULT '1'        | Number of servings   |
| meal_type       | TEXT         | nullable           | Meal category        |
| logged_at       | TIMESTAMP    | NOT NULL           | When food was logged |

### Nutrition Cache Table

Caches nutrition lookup results from external APIs (CNF, USDA, API Ninjas) to avoid redundant requests. Uses a normalized query key for deduplication and a 7-day TTL with hit counting for observability.

```sql
CREATE TABLE nutrition_cache (
  id SERIAL PRIMARY KEY,
  query_key VARCHAR(255) NOT NULL UNIQUE,
  normalized_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  data JSONB NOT NULL,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX nutrition_cache_query_key_idx ON nutrition_cache (query_key);
CREATE INDEX nutrition_cache_expires_at_idx ON nutrition_cache (expires_at);
```

| Column          | Type         | Constraints      | Description                                          |
| --------------- | ------------ | ---------------- | ---------------------------------------------------- |
| id              | SERIAL       | PK               | Auto-incrementing ID                                 |
| query_key       | VARCHAR(255) | NOT NULL, UNIQUE | Normalized lowercase query (e.g. `"chicken breast"`) |
| normalized_name | VARCHAR(255) | NOT NULL         | Canonical food name from the source                  |
| source          | VARCHAR(50)  | NOT NULL         | `"cnf"`, `"usda"`, or `"api-ninjas"`                 |
| data            | JSONB        | NOT NULL         | Full `NutritionData` object (calories, macros, etc.) |
| hit_count       | INTEGER      | DEFAULT 0        | Number of cache hits                                 |
| created_at      | TIMESTAMP    | NOT NULL, auto   | When entry was cached                                |
| expires_at      | TIMESTAMP    | NOT NULL         | TTL expiry (7 days from creation)                    |

**Key normalization:** `query.toLowerCase().trim().replace(/\s+/g, " ")` — see `normalizeForCache()` in `server/services/nutrition-lookup.ts`.

**Upsert on conflict:** If a query key already exists, the data and expiry are updated (not duplicated).

### Suggestion Cache Table

Caches the 4 AI-generated suggestions (2 recipes, 1 craft, 1 pairing) per scanned item per user. Uses a profile hash to invalidate when dietary preferences change. 30-day TTL.

```sql
CREATE TABLE suggestion_cache (
  id SERIAL PRIMARY KEY,
  scanned_item_id INTEGER REFERENCES scanned_items(id) ON DELETE CASCADE NOT NULL,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  profile_hash VARCHAR(64) NOT NULL,
  suggestions JSONB NOT NULL,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX suggestion_cache_item_user_idx ON suggestion_cache (scanned_item_id, user_id);
CREATE INDEX suggestion_cache_expires_at_idx ON suggestion_cache (expires_at);
```

| Column          | Type        | Constraints        | Description                                     |
| --------------- | ----------- | ------------------ | ----------------------------------------------- |
| id              | SERIAL      | PK                 | Auto-incrementing ID                            |
| scanned_item_id | INTEGER     | FK → scanned_items | The food item these suggestions are for         |
| user_id         | VARCHAR     | FK → users         | The user who requested suggestions              |
| profile_hash    | VARCHAR(64) | NOT NULL           | SHA-256 of dietary profile fields (see below)   |
| suggestions     | JSONB       | NOT NULL           | Array of `SuggestionData[]` (type, title, desc) |
| hit_count       | INTEGER     | DEFAULT 0          | Number of cache hits                            |
| created_at      | TIMESTAMP   | NOT NULL, auto     | When suggestions were cached                    |
| expires_at      | TIMESTAMP   | NOT NULL           | TTL expiry (30 days from creation)              |

**Profile hash fields:** SHA-256 of `{ allergies, dietType, cookingSkillLevel, cookingTimeAvailable }` — see `server/utils/profile-hash.ts`.

**Cache invalidation:** When a user updates any of these dietary profile fields, `invalidateSuggestionCacheForUser()` deletes all their cached suggestions (fire-and-forget in profile update route).

### Instruction Cache Table

Caches individual instruction text for a specific suggestion (drill-down from suggestion → full instructions). Linked to the parent suggestion cache entry. No TTL — instructions are deleted when the parent suggestion cache entry is deleted.

```sql
CREATE TABLE instruction_cache (
  id SERIAL PRIMARY KEY,
  suggestion_cache_id INTEGER REFERENCES suggestion_cache(id) ON DELETE CASCADE NOT NULL,
  suggestion_index INTEGER NOT NULL,
  suggestion_title TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  instructions TEXT NOT NULL,
  hit_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX instruction_cache_suggestion_idx ON instruction_cache (suggestion_cache_id, suggestion_index);
```

| Column              | Type      | Constraints           | Description                              |
| ------------------- | --------- | --------------------- | ---------------------------------------- |
| id                  | SERIAL    | PK                    | Auto-incrementing ID                     |
| suggestion_cache_id | INTEGER   | FK → suggestion_cache | Parent suggestion set                    |
| suggestion_index    | INTEGER   | NOT NULL              | Index (0–3) within the suggestions array |
| suggestion_title    | TEXT      | NOT NULL              | Title of the suggestion                  |
| suggestion_type     | TEXT      | NOT NULL              | `"recipe"`, `"craft"`, or `"pairing"`    |
| instructions        | TEXT      | NOT NULL              | Full generated instruction text          |
| hit_count           | INTEGER   | DEFAULT 0             | Number of cache hits                     |
| created_at          | TIMESTAMP | NOT NULL, auto        | When instructions were cached            |

### Recipe Generation Log Table

Tracks daily AI recipe generation usage per user for premium limit enforcement.

```sql
CREATE TABLE recipe_generation_log (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  recipe_id INTEGER REFERENCES community_recipes(id) ON DELETE SET NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX recipe_gen_log_user_date_idx ON recipe_generation_log (user_id, generated_at);
```

| Column       | Type      | Constraints               | Description                   |
| ------------ | --------- | ------------------------- | ----------------------------- |
| id           | SERIAL    | PK                        | Auto-incrementing ID          |
| user_id      | VARCHAR   | FK → users, NOT NULL      | User who generated the recipe |
| recipe_id    | INTEGER   | FK → community_recipes    | Generated recipe (nullable)   |
| generated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | When generation occurred      |

The compound index on `(user_id, generated_at)` supports the daily counting query used by `GET /api/recipes/generation-status`.

---

## Relationships

### Drizzle ORM Relations

```typescript
// Users → Profile (1:1)
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  scannedItems: many(scannedItems),
  dailyLogs: many(dailyLogs),
}));

// Profile → User (1:1)
export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

// ScannedItem → User (N:1), ScannedItem → DailyLogs (1:N)
export const scannedItemsRelations = relations(
  scannedItems,
  ({ one, many }) => ({
    user: one(users, {
      fields: [scannedItems.userId],
      references: [users.id],
    }),
    dailyLogs: many(dailyLogs),
  }),
);

// DailyLog → User (N:1), DailyLog → ScannedItem (N:1)
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
```

### Cascade Deletes

All foreign keys use `ON DELETE CASCADE` unless noted:

- Deleting a user removes all their profiles, scanned items, daily logs, saved items, suggestion cache entries, and transactions
- Deleting a scanned item removes all related daily logs and suggestion cache entries
- Deleting a suggestion cache entry removes all related instruction cache entries
- `saved_items.source_item_id` uses `ON DELETE SET NULL` (saved item preserved if source deleted)
- `meal_plan_items.recipe_id` and `meal_plan_items.scanned_item_id` use `ON DELETE SET NULL`

---

## Insert Schemas (Zod Validation)

### User Insert

```typescript
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Validates: { username: string, password: string }
```

### Scanned Item Insert

```typescript
export const insertScannedItemSchema = createInsertSchema(scannedItems).omit({
  id: true,
  scannedAt: true,
});

// Auto-generated: id, scannedAt
// Required: productName
// Optional: all other fields
```

### Daily Log Insert

```typescript
export const insertDailyLogSchema = createInsertSchema(dailyLogs).omit({
  id: true,
  loggedAt: true,
});

// Auto-generated: id, loggedAt
// Optional: userId, scannedItemId, servings, mealType
```

### User Profile Insert

```typescript
export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Required: userId
// Optional: all dietary preference fields
```

---

## Type Exports

```typescript
// Insert types (for creating records)
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertScannedItem = z.infer<typeof insertScannedItemSchema>;
export type InsertDailyLog = z.infer<typeof insertDailyLogSchema>;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;

// Select types (for reading records)
export type User = typeof users.$inferSelect;
export type ScannedItem = typeof scannedItems.$inferSelect;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
```

---

## Common Queries

### Get User with Profile

```typescript
const user = await db.query.users.findFirst({
  where: eq(users.id, userId),
  with: {
    profile: true,
  },
});
```

### Get All Scanned Items (Most Recent First)

```typescript
const items = await db
  .select()
  .from(scannedItems)
  .where(eq(scannedItems.userId, userId))
  .orderBy(desc(scannedItems.scannedAt));
```

### Daily Summary Aggregation

```typescript
const summary = await db
  .select({
    totalCalories: sql<number>`COALESCE(SUM(${scannedItems.calories} * ${dailyLogs.servings}), 0)`,
    totalProtein: sql<number>`COALESCE(SUM(${scannedItems.protein} * ${dailyLogs.servings}), 0)`,
    totalCarbs: sql<number>`COALESCE(SUM(${scannedItems.carbs} * ${dailyLogs.servings}), 0)`,
    totalFat: sql<number>`COALESCE(SUM(${scannedItems.fat} * ${dailyLogs.servings}), 0)`,
    itemCount: sql<number>`COUNT(*)`,
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
```

---

## Database Commands

### Push Schema to Database

```bash
npm run db:push
```

This uses Drizzle Kit to synchronize the schema with PostgreSQL.

### Configuration

`drizzle.config.ts`:

```typescript
export default {
  schema: "./shared/schema.ts",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
};
```

### Environment Variable

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/nutriscan
```

---

## Migration Strategy

Currently using **push** mode (schema synchronization) rather than formal migrations. For production, consider switching to migration files:

```bash
# Generate migration
npx drizzle-kit generate:pg

# Apply migrations
npx drizzle-kit push:pg
```

---

## Indexes (Recommended)

For production performance, consider adding:

```sql
-- Speed up user lookups by username
CREATE INDEX idx_users_username ON users(username);

-- Speed up scanned items queries
CREATE INDEX idx_scanned_items_user_id ON scanned_items(user_id);
CREATE INDEX idx_scanned_items_scanned_at ON scanned_items(scanned_at DESC);

-- Speed up daily log queries
CREATE INDEX idx_daily_logs_user_id_logged_at ON daily_logs(user_id, logged_at);

-- Speed up profile lookups
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
```
