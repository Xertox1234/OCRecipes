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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | VARCHAR | PK, auto-generated UUID | Unique identifier |
| username | TEXT | NOT NULL, UNIQUE | Login username |
| password | TEXT | NOT NULL | Bcrypt-hashed password |
| display_name | TEXT | nullable | User's display name |
| daily_calorie_goal | INTEGER | DEFAULT 2000 | Target daily calories |
| onboarding_completed | BOOLEAN | DEFAULT FALSE | Onboarding status |
| created_at | TIMESTAMP | NOT NULL, auto | Account creation time |

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

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PK | Auto-incrementing ID |
| user_id | VARCHAR | FK → users, UNIQUE | User reference |
| allergies | JSONB | DEFAULT '[]' | Array of {name, severity} objects |
| health_conditions | JSONB | DEFAULT '[]' | Array of condition strings |
| diet_type | TEXT | nullable | Diet preference |
| food_dislikes | JSONB | DEFAULT '[]' | Foods to avoid |
| primary_goal | TEXT | nullable | Health/fitness goal |
| activity_level | TEXT | nullable | Exercise frequency |
| household_size | INTEGER | DEFAULT 1 | Number in household |
| cuisine_preferences | JSONB | DEFAULT '[]' | Preferred cuisines |
| cooking_skill_level | TEXT | nullable | Cooking experience |
| cooking_time_available | TEXT | nullable | Time for cooking |
| created_at | TIMESTAMP | NOT NULL | Profile creation time |
| updated_at | TIMESTAMP | NOT NULL | Last update time |

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
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PK | Auto-incrementing ID |
| user_id | VARCHAR | FK → users | User who scanned |
| barcode | TEXT | nullable | Product barcode (EAN/UPC) |
| product_name | TEXT | NOT NULL | Product name |
| brand_name | TEXT | nullable | Manufacturer/brand |
| serving_size | TEXT | nullable | Serving description |
| calories | DECIMAL(10,2) | nullable | Calories per serving |
| protein | DECIMAL(10,2) | nullable | Protein in grams |
| carbs | DECIMAL(10,2) | nullable | Carbohydrates in grams |
| fat | DECIMAL(10,2) | nullable | Fat in grams |
| fiber | DECIMAL(10,2) | nullable | Fiber in grams |
| sugar | DECIMAL(10,2) | nullable | Sugar in grams |
| sodium | DECIMAL(10,2) | nullable | Sodium in mg |
| image_url | TEXT | nullable | Product image URL |
| scanned_at | TIMESTAMP | NOT NULL | When item was scanned |

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

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | SERIAL | PK | Auto-incrementing ID |
| user_id | VARCHAR | FK → users | User who logged |
| scanned_item_id | INTEGER | FK → scanned_items | Reference to food |
| servings | DECIMAL(5,2) | DEFAULT '1' | Number of servings |
| meal_type | TEXT | nullable | Meal category |
| logged_at | TIMESTAMP | NOT NULL | When food was logged |

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
export const scannedItemsRelations = relations(scannedItems, ({ one, many }) => ({
  user: one(users, {
    fields: [scannedItems.userId],
    references: [users.id],
  }),
  dailyLogs: many(dailyLogs),
}));

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

All foreign keys use `ON DELETE CASCADE`:
- Deleting a user removes all their profiles, scanned items, and daily logs
- Deleting a scanned item removes all related daily logs

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
      lt(dailyLogs.loggedAt, endOfDay)
    )
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
