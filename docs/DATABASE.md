# OCRecipes Database Schema

## Overview

OCRecipes uses PostgreSQL with Drizzle ORM for database operations. The schema is defined in `shared/schema.ts` (42 tables) and is shared between the frontend and backend.

## Schema Definition

### Users Table

Primary table for user accounts.

```sql
CREATE TABLE users (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  daily_calorie_goal INTEGER DEFAULT 2000,
  daily_protein_goal INTEGER,
  daily_carbs_goal INTEGER,
  daily_fat_goal INTEGER,
  weight DECIMAL(5,2),
  height DECIMAL(5,2),
  age INTEGER,
  gender TEXT,
  goal_weight DECIMAL(6,2),
  goals_calculated_at TIMESTAMP,
  adaptive_goals_enabled BOOLEAN DEFAULT FALSE,
  last_goal_adjustment_at TIMESTAMP,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  subscription_tier TEXT DEFAULT 'free',
  subscription_expires_at TIMESTAMP,
  token_version INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column                  | Type         | Constraints             | Description                                          |
| ----------------------- | ------------ | ----------------------- | ---------------------------------------------------- |
| id                      | VARCHAR      | PK, auto-generated UUID | Unique identifier                                    |
| username                | TEXT         | NOT NULL, UNIQUE        | Login username                                       |
| password                | TEXT         | NOT NULL                | Bcrypt-hashed password                               |
| display_name            | TEXT         | nullable                | User's display name                                  |
| avatar_url              | TEXT         | nullable                | User avatar image URL                                |
| daily_calorie_goal      | INTEGER      | DEFAULT 2000            | Target daily calories                                |
| daily_protein_goal      | INTEGER      | nullable                | Target daily protein (grams)                         |
| daily_carbs_goal        | INTEGER      | nullable                | Target daily carbs (grams)                           |
| daily_fat_goal          | INTEGER      | nullable                | Target daily fat (grams)                             |
| weight                  | DECIMAL(5,2) | nullable                | User weight in kg                                    |
| height                  | DECIMAL(5,2) | nullable                | User height in cm                                    |
| age                     | INTEGER      | nullable                | User age in years                                    |
| gender                  | TEXT         | nullable                | `"male"`, `"female"`, or `"other"`                   |
| goal_weight             | DECIMAL(6,2) | nullable                | Target weight in kg                                  |
| goals_calculated_at     | TIMESTAMP    | nullable                | When goals were last auto-calculated                 |
| adaptive_goals_enabled  | BOOLEAN      | DEFAULT FALSE           | Whether adaptive goal adjustment is enabled          |
| last_goal_adjustment_at | TIMESTAMP    | nullable                | When goals were last adjusted by the system          |
| onboarding_completed    | BOOLEAN      | DEFAULT FALSE           | Onboarding status                                    |
| subscription_tier       | TEXT         | DEFAULT 'free'          | `"free"` or `"premium"`                              |
| subscription_expires_at | TIMESTAMP    | nullable                | Premium expiry (null = no expiry)                    |
| token_version           | INTEGER      | DEFAULT 0, NOT NULL     | JWT invalidation counter (incremented on pwd change) |
| created_at              | TIMESTAMP    | NOT NULL, auto          | Account creation time                                |

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
  glp1_mode BOOLEAN DEFAULT FALSE,
  glp1_medication TEXT,
  glp1_start_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

| Column                 | Type      | Constraints        | Description                                  |
| ---------------------- | --------- | ------------------ | -------------------------------------------- |
| id                     | SERIAL    | PK                 | Auto-incrementing ID                         |
| user_id                | VARCHAR   | FK → users, UNIQUE | User reference                               |
| allergies              | JSONB     | DEFAULT '[]'       | Array of {name, severity} objects            |
| health_conditions      | JSONB     | DEFAULT '[]'       | Array of condition strings                   |
| diet_type              | TEXT      | nullable           | Diet preference                              |
| food_dislikes          | JSONB     | DEFAULT '[]'       | Foods to avoid                               |
| primary_goal           | TEXT      | nullable           | Health/fitness goal                          |
| activity_level         | TEXT      | nullable           | Exercise frequency                           |
| household_size         | INTEGER   | DEFAULT 1          | Number in household                          |
| cuisine_preferences    | JSONB     | DEFAULT '[]'       | Preferred cuisines                           |
| cooking_skill_level    | TEXT      | nullable           | Cooking experience                           |
| cooking_time_available | TEXT      | nullable           | Time for cooking                             |
| glp1_mode              | BOOLEAN   | DEFAULT FALSE      | GLP-1 medication mode enabled                |
| glp1_medication        | TEXT      | nullable           | GLP-1 medication name (e.g. `"semaglutide"`) |
| glp1_start_date        | TIMESTAMP | nullable           | When GLP-1 medication was started            |
| created_at             | TIMESTAMP | NOT NULL           | Profile creation time                        |
| updated_at             | TIMESTAMP | NOT NULL           | Last update time                             |

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
- `manage_condition`

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
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE NOT NULL,
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
  source_type TEXT NOT NULL DEFAULT 'barcode',
  photo_url TEXT,
  ai_confidence DECIMAL(3, 2),
  preparation_methods JSONB,
  analysis_intent TEXT,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  discarded_at TIMESTAMP
);

CREATE INDEX scanned_items_user_active_idx ON scanned_items (user_id, scanned_at) WHERE discarded_at IS NULL;
CREATE INDEX scanned_items_scanned_at_idx ON scanned_items (scanned_at);
-- CHECK: calories >= 0, protein >= 0, carbs >= 0, fat >= 0
```

| Column              | Type          | Constraints                 | Description                                                            |
| ------------------- | ------------- | --------------------------- | ---------------------------------------------------------------------- |
| id                  | SERIAL        | PK                          | Auto-incrementing ID                                                   |
| user_id             | VARCHAR       | FK → users, NOT NULL        | User who scanned                                                       |
| barcode             | TEXT          | nullable                    | Product barcode (EAN/UPC)                                              |
| product_name        | TEXT          | NOT NULL                    | Product name                                                           |
| brand_name          | TEXT          | nullable                    | Manufacturer/brand                                                     |
| serving_size        | TEXT          | nullable                    | Serving description                                                    |
| calories            | DECIMAL(10,2) | nullable, CHECK >= 0        | Calories per serving                                                   |
| protein             | DECIMAL(10,2) | nullable, CHECK >= 0        | Protein in grams                                                       |
| carbs               | DECIMAL(10,2) | nullable, CHECK >= 0        | Carbohydrates in grams                                                 |
| fat                 | DECIMAL(10,2) | nullable, CHECK >= 0        | Fat in grams                                                           |
| fiber               | DECIMAL(10,2) | nullable                    | Fiber in grams                                                         |
| sugar               | DECIMAL(10,2) | nullable                    | Sugar in grams                                                         |
| sodium              | DECIMAL(10,2) | nullable                    | Sodium in mg                                                           |
| image_url           | TEXT          | nullable                    | Product image URL (barcode source)                                     |
| source_type         | TEXT          | NOT NULL, DEFAULT 'barcode' | `"barcode"` or `"photo"`                                               |
| photo_url           | TEXT          | nullable                    | User's uploaded photo URL (reserved for future use)                    |
| ai_confidence       | DECIMAL(3,2)  | nullable                    | Vision AI confidence score 0.00–1.00                                   |
| preparation_methods | JSONB         | nullable                    | Per-food prep methods: `[{ name, method }]`                            |
| analysis_intent     | TEXT          | nullable                    | Photo intent: `"log"`, `"calories"`, `"recipe"`, `"identify"`          |
| scanned_at          | TIMESTAMP     | NOT NULL, auto              | When item was scanned                                                  |
| discarded_at        | TIMESTAMP     | nullable                    | Soft-delete timestamp (filtered from active queries via partial index) |

### Daily Logs Table

Tracks daily food intake by linking scanned items to specific days.

```sql
CREATE TABLE daily_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  scanned_item_id INTEGER REFERENCES scanned_items(id) ON DELETE CASCADE,
  recipe_id INTEGER REFERENCES meal_plan_recipes(id) ON DELETE CASCADE,
  meal_plan_item_id INTEGER REFERENCES meal_plan_items(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'scan',
  servings DECIMAL(5, 2) DEFAULT '1',
  meal_type TEXT,
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (scanned_item_id IS NOT NULL OR recipe_id IS NOT NULL),
  CHECK (servings > 0)
);

CREATE INDEX daily_logs_user_logged_at_idx ON daily_logs (user_id, logged_at);
CREATE INDEX daily_logs_logged_at_idx ON daily_logs (logged_at);
CREATE INDEX daily_logs_meal_plan_item_id_idx ON daily_logs (meal_plan_item_id);
CREATE UNIQUE INDEX daily_logs_unique_meal_plan_confirm ON daily_logs (user_id, meal_plan_item_id) WHERE meal_plan_item_id IS NOT NULL;
```

| Column            | Type         | Constraints                               | Description                                                                    |
| ----------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------ |
| id                | SERIAL       | PK                                        | Auto-incrementing ID                                                           |
| user_id           | VARCHAR      | FK → users, NOT NULL                      | User who logged                                                                |
| scanned_item_id   | INTEGER      | FK → scanned_items, ON DELETE CASCADE     | Reference to food item (nullable)                                              |
| recipe_id         | INTEGER      | FK → meal_plan_recipes, ON DELETE CASCADE | Reference to a meal plan recipe (nullable)                                     |
| meal_plan_item_id | INTEGER      | FK → meal_plan_items, ON DELETE SET NULL  | Reference to a meal plan item (nullable)                                       |
| source            | TEXT         | NOT NULL, DEFAULT 'scan'                  | How the log was created: `"scan"`, `"photo"`, `"recipe"`, `"quick"`, `"voice"` |
| servings          | DECIMAL(5,2) | DEFAULT '1', CHECK > 0                    | Number of servings                                                             |
| meal_type         | TEXT         | nullable                                  | Meal category                                                                  |
| logged_at         | TIMESTAMP    | NOT NULL, auto                            | When food was logged                                                           |

**Check constraints:** At least one of `scanned_item_id` or `recipe_id` must be non-null (prevents ghost rows with no nutrition source). `servings` must be > 0.

**Unique constraint:** `(user_id, meal_plan_item_id)` WHERE `meal_plan_item_id IS NOT NULL` — prevents duplicate meal plan confirmations.

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

CREATE UNIQUE INDEX suggestion_cache_item_user_profile_idx ON suggestion_cache (scanned_item_id, user_id, profile_hash);
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

### Favourite Scanned Items Table

Allows users to mark scanned items as favourites for quick re-logging.

| Column          | Type      | Constraints                  | Description          |
| --------------- | --------- | ---------------------------- | -------------------- |
| id              | SERIAL    | PK                           | Auto-incrementing ID |
| user_id         | VARCHAR   | FK → users, NOT NULL         | User who favourited  |
| scanned_item_id | INTEGER   | FK → scanned_items, NOT NULL | Favourited item      |
| created_at      | TIMESTAMP | NOT NULL, auto               | When favourited      |

**Constraints:** Unique on `(user_id, scanned_item_id)`. Index on `user_id`.

### Micronutrient Cache Table

Caches micronutrient data (vitamins, minerals) for nutrition items. 7-day TTL.

| Column     | Type         | Constraints      | Description                    |
| ---------- | ------------ | ---------------- | ------------------------------ |
| id         | SERIAL       | PK               | Auto-incrementing ID           |
| query_key  | VARCHAR(255) | NOT NULL, UNIQUE | Normalized food name           |
| data       | JSONB        | NOT NULL         | Full micronutrient data object |
| hit_count  | INTEGER      | DEFAULT 0        | Number of cache hits           |
| created_at | TIMESTAMP    | NOT NULL, auto   | When entry was cached          |
| expires_at | TIMESTAMP    | NOT NULL         | TTL expiry                     |

### Meal Suggestion Cache Table

Caches AI-generated meal suggestions per user. Keyed by a combination of user dietary context.

| Column      | Type         | Constraints      | Description          |
| ----------- | ------------ | ---------------- | -------------------- |
| id          | SERIAL       | PK               | Auto-incrementing ID |
| user_id     | VARCHAR      | FK → users       | User who requested   |
| cache_key   | VARCHAR(255) | NOT NULL, UNIQUE | Context-based key    |
| suggestions | JSONB        | NOT NULL         | Array of suggestions |
| hit_count   | INTEGER      | DEFAULT 0        | Number of cache hits |
| created_at  | TIMESTAMP    | NOT NULL, auto   | When cached          |
| expires_at  | TIMESTAMP    | NOT NULL         | TTL expiry           |

### Weight Logs Table

Tracks weight measurements over time for trend analysis.

| Column    | Type         | Constraints      | Description                 |
| --------- | ------------ | ---------------- | --------------------------- |
| id        | SERIAL       | PK               | Auto-incrementing ID        |
| user_id   | VARCHAR      | FK → users       | User tracking weight        |
| weight    | DECIMAL(6,2) | NOT NULL         | Weight in kg                |
| source    | TEXT         | DEFAULT 'manual' | `"manual"` or `"healthkit"` |
| note      | TEXT         | nullable         | Optional note               |
| logged_at | TIMESTAMP    | NOT NULL, auto   | When weight was logged      |

### HealthKit Sync Table

Tracks Apple HealthKit sync preferences per data type per user.

| Column         | Type      | Constraints    | Description                                         |
| -------------- | --------- | -------------- | --------------------------------------------------- |
| id             | SERIAL    | PK             | Auto-incrementing ID                                |
| user_id        | VARCHAR   | FK → users     | User with HealthKit sync                            |
| data_type      | TEXT      | NOT NULL       | HealthKit data type (e.g. `"weight"`, `"exercise"`) |
| enabled        | BOOLEAN   | DEFAULT FALSE  | Whether sync is enabled                             |
| last_sync_at   | TIMESTAMP | nullable       | Last successful sync time                           |
| sync_direction | TEXT      | DEFAULT 'read' | `"read"` or `"write"`                               |

**Constraints:** Unique on `(user_id, data_type)`.

### Fasting Schedules Table

Stores the user's active intermittent fasting schedule (one per user).

| Column              | Type    | Constraints  | Description                                       |
| ------------------- | ------- | ------------ | ------------------------------------------------- |
| id                  | SERIAL  | PK           | Auto-incrementing ID                              |
| user_id             | VARCHAR | FK → users   | User with fasting schedule                        |
| protocol            | TEXT    | NOT NULL     | `"16:8"`, `"18:6"`, `"20:4"`, `"5:2"`, `"custom"` |
| fasting_hours       | INTEGER | NOT NULL     | Hours of fasting per cycle                        |
| eating_hours        | INTEGER | NOT NULL     | Hours of eating window                            |
| eating_window_start | TEXT    | nullable     | Start time (e.g. `"12:00"`)                       |
| eating_window_end   | TEXT    | nullable     | End time (e.g. `"20:00"`)                         |
| is_active           | BOOLEAN | DEFAULT TRUE | Whether this schedule is active                   |

**Constraints:** Unique on `user_id` (one active schedule per user).

### Fasting Logs Table

Records individual fasting sessions.

| Column                  | Type      | Constraints    | Description                          |
| ----------------------- | --------- | -------------- | ------------------------------------ |
| id                      | SERIAL    | PK             | Auto-incrementing ID                 |
| user_id                 | VARCHAR   | FK → users     | User who fasted                      |
| started_at              | TIMESTAMP | NOT NULL, auto | When the fast began                  |
| ended_at                | TIMESTAMP | nullable       | When the fast ended (null = ongoing) |
| target_duration_hours   | INTEGER   | NOT NULL       | Target fast length                   |
| actual_duration_minutes | INTEGER   | nullable       | Actual duration when completed       |
| completed               | BOOLEAN   | nullable       | Whether the target was met           |
| note                    | TEXT      | nullable       | User notes                           |

### Medication Logs Table

Tracks GLP-1 medication doses and side effects.

| Column          | Type      | Constraints    | Description                          |
| --------------- | --------- | -------------- | ------------------------------------ |
| id              | SERIAL    | PK             | Auto-incrementing ID                 |
| user_id         | VARCHAR   | FK → users     | User taking medication               |
| medication_name | TEXT      | NOT NULL       | Medication (e.g. `"semaglutide"`)    |
| brand_name      | TEXT      | nullable       | Brand (e.g. `"Ozempic"`, `"Wegovy"`) |
| dosage          | TEXT      | NOT NULL       | Dose (e.g. `"0.25mg"`)               |
| taken_at        | TIMESTAMP | NOT NULL, auto | When medication was taken            |
| side_effects    | JSONB     | DEFAULT '[]'   | Array of side effect strings         |
| appetite_level  | INTEGER   | nullable       | Appetite score 1–5                   |
| notes           | TEXT      | nullable       | User notes                           |

### Goal Adjustment Logs Table

Records adaptive goal adjustments made by the system based on weight trends.

| Column            | Type         | Constraints    | Description                          |
| ----------------- | ------------ | -------------- | ------------------------------------ |
| id                | SERIAL       | PK             | Auto-incrementing ID                 |
| user_id           | VARCHAR      | FK → users     | User whose goals were adjusted       |
| previous_calories | INTEGER      | NOT NULL       | Calorie goal before adjustment       |
| new_calories      | INTEGER      | NOT NULL       | Calorie goal after adjustment        |
| previous_protein  | INTEGER      | NOT NULL       | Protein goal before adjustment       |
| new_protein       | INTEGER      | NOT NULL       | Protein goal after adjustment        |
| previous_carbs    | INTEGER      | NOT NULL       | Carbs goal before adjustment         |
| new_carbs         | INTEGER      | NOT NULL       | Carbs goal after adjustment          |
| previous_fat      | INTEGER      | NOT NULL       | Fat goal before adjustment           |
| new_fat           | INTEGER      | NOT NULL       | Fat goal after adjustment            |
| reason            | TEXT         | NOT NULL       | Explanation for the adjustment       |
| weight_trend_rate | DECIMAL(5,2) | nullable       | Weight change rate (kg/week)         |
| applied_at        | TIMESTAMP    | NOT NULL, auto | When adjustment was applied          |
| accepted_by_user  | BOOLEAN      | DEFAULT FALSE  | Whether user accepted the adjustment |

### Chat Conversations Table

Stores AI nutrition coaching chat sessions.

| Column     | Type      | Constraints | Description                |
| ---------- | --------- | ----------- | -------------------------- |
| id         | SERIAL    | PK          | Auto-incrementing ID       |
| user_id    | VARCHAR   | FK → users  | User who owns conversation |
| title      | TEXT      | NOT NULL    | Conversation title         |
| created_at | TIMESTAMP | NOT NULL    | When conversation started  |
| updated_at | TIMESTAMP | NOT NULL    | When last updated          |

### Chat Messages Table

Individual messages within a chat conversation.

| Column          | Type      | Constraints             | Description                              |
| --------------- | --------- | ----------------------- | ---------------------------------------- |
| id              | SERIAL    | PK                      | Auto-incrementing ID                     |
| conversation_id | INTEGER   | FK → chat_conversations | Parent conversation                      |
| role            | TEXT      | NOT NULL                | `"user"`, `"assistant"`, or `"system"`   |
| content         | TEXT      | NOT NULL                | Message text                             |
| metadata        | JSONB     | nullable                | Extra metadata (e.g. function call data) |
| created_at      | TIMESTAMP | NOT NULL                | When message was sent                    |

### Menu Scans Table

Stores restaurant menu scan results from the AI vision pipeline.

| Column          | Type      | Constraints    | Description                                                                |
| --------------- | --------- | -------------- | -------------------------------------------------------------------------- |
| id              | SERIAL    | PK             | Auto-incrementing ID                                                       |
| user_id         | VARCHAR   | FK → users     | User who scanned                                                           |
| restaurant_name | TEXT      | nullable       | Restaurant name (AI-detected)                                              |
| cuisine         | TEXT      | nullable       | Cuisine type                                                               |
| menu_items      | JSONB     | DEFAULT '[]'   | Array of `{name, description?, price?, calories?, protein?, carbs?, fat?}` |
| image_url       | TEXT      | nullable       | Image URL of the menu photo                                                |
| scanned_at      | TIMESTAMP | NOT NULL, auto | When menu was scanned                                                      |

### Grocery Lists Table

Stores grocery lists generated from meal plans or manually created.

| Column           | Type      | Constraints | Description               |
| ---------------- | --------- | ----------- | ------------------------- |
| id               | SERIAL    | PK          | Auto-incrementing ID      |
| user_id          | VARCHAR   | FK → users  | User who created the list |
| title            | TEXT      | NOT NULL    | List title                |
| date_range_start | DATE      | NOT NULL    | Meal plan start date      |
| date_range_end   | DATE      | NOT NULL    | Meal plan end date        |
| created_at       | TIMESTAMP | NOT NULL    | When list was created     |
| updated_at       | TIMESTAMP | NOT NULL    | When last updated         |

### Grocery List Items Table

Individual items within a grocery list.

| Column          | Type          | Constraints        | Description                                 |
| --------------- | ------------- | ------------------ | ------------------------------------------- |
| id              | SERIAL        | PK                 | Auto-incrementing ID                        |
| grocery_list_id | INTEGER       | FK → grocery_lists | Parent grocery list                         |
| name            | TEXT          | NOT NULL           | Ingredient name                             |
| quantity        | DECIMAL(10,2) | nullable           | Amount needed                               |
| unit            | TEXT          | nullable           | Unit of measure                             |
| category        | TEXT          | DEFAULT 'other'    | Grocery category (produce, dairy, etc.)     |
| is_checked      | BOOLEAN       | DEFAULT FALSE      | Whether item has been purchased             |
| is_manual       | BOOLEAN       | DEFAULT FALSE      | Whether manually added (not auto-generated) |
| added_to_pantry | BOOLEAN       | DEFAULT FALSE      | Whether moved to pantry on checkout         |
| checked_at      | TIMESTAMP     | nullable           | When item was checked off                   |

### Pantry Items Table

Tracks items in the user's pantry for recipe matching and deduction.

| Column     | Type          | Constraints     | Description              |
| ---------- | ------------- | --------------- | ------------------------ |
| id         | SERIAL        | PK              | Auto-incrementing ID     |
| user_id    | VARCHAR       | FK → users      | User who owns the pantry |
| name       | TEXT          | NOT NULL        | Item name                |
| quantity   | DECIMAL(10,2) | nullable        | Amount available         |
| unit       | TEXT          | nullable        | Unit of measure          |
| category   | TEXT          | DEFAULT 'other' | Pantry category          |
| expires_at | TIMESTAMP     | nullable        | Expiration date          |
| added_at   | TIMESTAMP     | NOT NULL, auto  | When item was added      |
| updated_at | TIMESTAMP     | NOT NULL, auto  | When last updated        |

### Cookbooks Table

User-created cookbook collections for organizing recipes.

| Column          | Type      | Constraints          | Description                   |
| --------------- | --------- | -------------------- | ----------------------------- |
| id              | SERIAL    | PK                   | Auto-incrementing ID          |
| user_id         | VARCHAR   | FK → users, NOT NULL | User who created the cookbook |
| name            | TEXT      | NOT NULL             | Cookbook name                 |
| description     | TEXT      | nullable             | Cookbook description          |
| cover_image_url | TEXT      | nullable             | Cover image URL               |
| created_at      | TIMESTAMP | NOT NULL, auto       | When cookbook was created     |
| updated_at      | TIMESTAMP | NOT NULL, auto       | When last updated             |

### Cookbook Recipes Table

Junction table linking recipes to cookbooks. Uses polymorphic FK (`recipe_id` + `recipe_type`) to reference either `meal_plan_recipes` or `community_recipes` (no DB-level FK on `recipe_id`).

| Column      | Type      | Constraints                  | Description                        |
| ----------- | --------- | ---------------------------- | ---------------------------------- |
| id          | SERIAL    | PK                           | Auto-incrementing ID               |
| cookbook_id | INTEGER   | FK → cookbooks, NOT NULL     | Parent cookbook                    |
| recipe_id   | INTEGER   | NOT NULL                     | Referenced recipe ID (polymorphic) |
| recipe_type | TEXT      | NOT NULL, DEFAULT 'mealPlan' | `"mealPlan"` or `"community"`      |
| added_at    | TIMESTAMP | NOT NULL, auto               | When recipe was added to cookbook  |

**Constraints:** Unique on `(cookbook_id, recipe_id, recipe_type)`.

### Favourite Recipes Table

Allows users to favourite recipes. Uses polymorphic FK (`recipe_id` + `recipe_type`) similar to cookbook recipes.

| Column      | Type      | Constraints          | Description                        |
| ----------- | --------- | -------------------- | ---------------------------------- |
| id          | SERIAL    | PK                   | Auto-incrementing ID               |
| user_id     | VARCHAR   | FK → users, NOT NULL | User who favourited                |
| recipe_id   | INTEGER   | NOT NULL             | Referenced recipe ID (polymorphic) |
| recipe_type | TEXT      | NOT NULL             | `"mealPlan"` or `"community"`      |
| created_at  | TIMESTAMP | NOT NULL, auto       | When favourited                    |

**Constraints:** Unique on `(user_id, recipe_id, recipe_type)`. Index on `user_id`.

### Receipt Scans Table

Stores receipt scan metadata for the pantry receipt scanner feature.

| Column      | Type      | Constraints                   | Description                            |
| ----------- | --------- | ----------------------------- | -------------------------------------- |
| id          | SERIAL    | PK                            | Auto-incrementing ID                   |
| user_id     | VARCHAR   | FK → users, NOT NULL          | User who scanned                       |
| item_count  | INTEGER   | DEFAULT 0                     | Number of items extracted from receipt |
| photo_count | INTEGER   | DEFAULT 1                     | Number of receipt photos processed     |
| status      | TEXT      | NOT NULL, DEFAULT 'completed' | Scan status                            |
| scanned_at  | TIMESTAMP | NOT NULL, auto                | When receipt was scanned               |

### Coach Response Cache Table

Universal cache for predefined coach questions. Only used for questions WITHOUT `screenContext` (universal answers like fasting tips).

| Column        | Type        | Constraints      | Description                       |
| ------------- | ----------- | ---------------- | --------------------------------- |
| id            | SERIAL      | PK               | Auto-incrementing ID              |
| question_hash | VARCHAR(64) | NOT NULL, UNIQUE | SHA-256 hash of the question text |
| question      | TEXT        | NOT NULL         | Original question text            |
| response      | TEXT        | NOT NULL         | Cached AI response                |
| hit_count     | INTEGER     | DEFAULT 0        | Number of cache hits              |
| created_at    | TIMESTAMP   | NOT NULL, auto   | When cached                       |
| expires_at    | TIMESTAMP   | NOT NULL         | TTL expiry                        |

### Barcode Verifications Table

Stores community-verified product nutrition data for the verified product API pipeline.

| Column                   | Type      | Constraints                    | Description                                         |
| ------------------------ | --------- | ------------------------------ | --------------------------------------------------- |
| id                       | SERIAL    | PK                             | Auto-incrementing ID                                |
| barcode                  | TEXT      | NOT NULL, UNIQUE               | Product barcode (EAN/UPC)                           |
| verification_level       | TEXT      | NOT NULL, DEFAULT 'unverified' | `"unverified"`, `"single_scan"`, `"verified"`, etc. |
| consensus_nutrition_data | JSONB     | nullable                       | Consensus nutrition data from multiple scans        |
| verification_count       | INTEGER   | NOT NULL, DEFAULT 0            | Number of verification scans                        |
| front_label_data         | JSONB     | nullable                       | OCR-extracted front label data                      |
| created_at               | TIMESTAMP | NOT NULL, auto                 | When first created                                  |
| updated_at               | TIMESTAMP | NOT NULL, auto                 | When last updated                                   |

### Verification History Table

Records individual user verification scans linked to barcode verifications.

| Column                 | Type         | Constraints                                   | Description                             |
| ---------------------- | ------------ | --------------------------------------------- | --------------------------------------- |
| id                     | SERIAL       | PK                                            | Auto-incrementing ID                    |
| barcode                | TEXT         | FK → barcode_verifications(barcode), NOT NULL | Referenced barcode                      |
| user_id                | VARCHAR      | FK → users, NOT NULL                          | User who submitted the scan             |
| extracted_nutrition    | JSONB        | NOT NULL                                      | Nutrition data extracted from this scan |
| ocr_confidence         | DECIMAL(3,2) | NOT NULL                                      | OCR confidence score 0.00–1.00          |
| is_match               | BOOLEAN      | nullable                                      | Whether extraction matches consensus    |
| front_label_scanned    | BOOLEAN      | NOT NULL, DEFAULT FALSE                       | Whether front label was also scanned    |
| front_label_scanned_at | TIMESTAMP    | nullable                                      | When front label was scanned            |
| created_at             | TIMESTAMP    | NOT NULL, auto                                | When scan was submitted                 |

**Constraints:** Unique on `(barcode, user_id)` — one verification per user per barcode.

### Reformulation Flags Table

Detects product reformulations when new scans diverge significantly from consensus data.

| Column                      | Type      | Constraints                                   | Description                                      |
| --------------------------- | --------- | --------------------------------------------- | ------------------------------------------------ |
| id                          | SERIAL    | PK                                            | Auto-incrementing ID                             |
| barcode                     | TEXT      | FK → barcode_verifications(barcode), NOT NULL | Referenced barcode                               |
| status                      | TEXT      | NOT NULL, DEFAULT 'flagged'                   | `"flagged"` or `"resolved"`                      |
| divergent_scan_count        | INTEGER   | NOT NULL, DEFAULT 0                           | Number of divergent scans that triggered flag    |
| previous_consensus          | JSONB     | nullable                                      | Snapshot of old consensus data for audit         |
| previous_verification_level | TEXT      | nullable                                      | Verification level before reformulation detected |
| previous_verification_count | INTEGER   | nullable                                      | Verification count before reset                  |
| detected_at                 | TIMESTAMP | NOT NULL, auto                                | When reformulation was detected                  |
| resolved_at                 | TIMESTAMP | nullable                                      | When the flag was resolved                       |

**Constraints:** Unique partial index on `barcode` WHERE `status = 'flagged'` — only one active flag per barcode at a time.

### API Keys Table

API keys for the public barcode nutrition API.

| Column     | Type        | Constraints                | Description                           |
| ---------- | ----------- | -------------------------- | ------------------------------------- |
| id         | SERIAL      | PK                         | Auto-incrementing ID                  |
| key_prefix | VARCHAR(16) | NOT NULL, UNIQUE           | First 16 chars for key lookup         |
| key_hash   | TEXT        | NOT NULL                   | SHA-256 hash of the full API key      |
| name       | TEXT        | NOT NULL                   | Descriptive name for the key          |
| tier       | TEXT        | NOT NULL, DEFAULT 'free'   | `"free"` or `"paid"`                  |
| status     | TEXT        | NOT NULL, DEFAULT 'active' | `"active"` or `"revoked"`             |
| owner_id   | VARCHAR     | FK → users                 | Owner user (nullable for system keys) |
| created_at | TIMESTAMP   | NOT NULL, auto             | When key was created                  |
| revoked_at | TIMESTAMP   | nullable                   | When key was revoked                  |

### API Key Usage Table

Monthly usage tracking per API key.

| Column          | Type       | Constraints             | Description                     |
| --------------- | ---------- | ----------------------- | ------------------------------- |
| id              | SERIAL     | PK                      | Auto-incrementing ID            |
| api_key_id      | INTEGER    | FK → api_keys, NOT NULL | Parent API key                  |
| year_month      | VARCHAR(7) | NOT NULL                | Month bucket (e.g. `"2026-04"`) |
| request_count   | INTEGER    | NOT NULL, DEFAULT 0     | Number of requests this month   |
| last_request_at | TIMESTAMP  | nullable                | When last request was made      |

**Constraints:** Unique on `(api_key_id, year_month)`.

### Barcode Nutrition Table

Cached barcode nutrition lookup results for the public API. Separate from the user-facing `nutrition_cache` which is keyed by query string.

| Column       | Type          | Constraints          | Description               |
| ------------ | ------------- | -------------------- | ------------------------- |
| id           | SERIAL        | PK                   | Auto-incrementing ID      |
| barcode      | TEXT          | NOT NULL, UNIQUE     | Product barcode (EAN/UPC) |
| product_name | TEXT          | nullable             | Product name              |
| brand_name   | TEXT          | nullable             | Brand/manufacturer        |
| serving_size | TEXT          | nullable             | Serving size description  |
| calories     | DECIMAL(10,2) | nullable, CHECK >= 0 | Calories per serving      |
| protein      | DECIMAL(10,2) | nullable, CHECK >= 0 | Protein in grams          |
| carbs        | DECIMAL(10,2) | nullable, CHECK >= 0 | Carbohydrates in grams    |
| fat          | DECIMAL(10,2) | nullable, CHECK >= 0 | Fat in grams              |
| source       | TEXT          | NOT NULL             | Data source identifier    |
| created_at   | TIMESTAMP     | NOT NULL, auto       | When entry was created    |
| updated_at   | TIMESTAMP     | NOT NULL, auto       | When last updated         |

### Recipe Dismissals Table

Tracks recipes dismissed by users in the recipe discovery carousel.

| Column            | Type      | Constraints          | Description                         |
| ----------------- | --------- | -------------------- | ----------------------------------- |
| id                | SERIAL    | PK                   | Auto-incrementing ID                |
| user_id           | VARCHAR   | FK → users, NOT NULL | User who dismissed                  |
| recipe_identifier | TEXT      | NOT NULL             | Identifier for the dismissed recipe |
| source            | TEXT      | NOT NULL             | Source of the recipe                |
| dismissed_at      | TIMESTAMP | NOT NULL, auto       | When recipe was dismissed           |

**Constraints:** Unique on `(user_id, recipe_identifier)`.

### Carousel Suggestion Cache Table

Caches AI-generated meal suggestions for the home screen recipe carousel. Keyed by user, profile hash, and meal type.

| Column       | Type      | Constraints          | Description                               |
| ------------ | --------- | -------------------- | ----------------------------------------- |
| id           | SERIAL    | PK                   | Auto-incrementing ID                      |
| user_id      | VARCHAR   | FK → users, NOT NULL | User these suggestions are for            |
| profile_hash | TEXT      | NOT NULL             | Hash of dietary profile for invalidation  |
| meal_type    | TEXT      | NOT NULL             | Meal type (e.g. `"breakfast"`, `"lunch"`) |
| suggestions  | JSONB     | NOT NULL             | Array of carousel suggestion objects      |
| expires_at   | TIMESTAMP | NOT NULL             | TTL expiry                                |
| created_at   | TIMESTAMP | NOT NULL, auto       | When cached                               |

**Constraints:** Unique on `(user_id, profile_hash, meal_type)`.

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

- Deleting a user removes all their profiles, scanned items, daily logs, saved items, suggestion cache entries, weight logs, fasting schedules/logs, medication logs, goal adjustment logs, chat conversations, menu scans, receipt scans, grocery lists, pantry items, transactions, cookbooks, favourite recipes, favourite scanned items, api keys, and recipe dismissals
- Deleting a scanned item removes all related daily logs and suggestion cache entries
- Deleting a suggestion cache entry removes all related instruction cache entries
- Deleting a chat conversation removes all its messages
- Deleting a grocery list removes all its items
- Deleting a cookbook removes all its cookbook recipe entries
- Deleting a barcode verification removes all related verification history and reformulation flags
- `saved_items.source_item_id` uses `ON DELETE SET NULL` (saved item preserved if source deleted)
- `community_recipes.author_id` uses `ON DELETE SET NULL` (recipe preserved if author deleted)
- `community_recipes.remixed_from_id` uses `ON DELETE SET NULL`
- `daily_logs.recipe_id` uses `ON DELETE CASCADE`
- `daily_logs.meal_plan_item_id` uses `ON DELETE SET NULL`
- `recipe_generation_log.recipe_id` uses `ON DELETE SET NULL`

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
DATABASE_URL=postgresql://user:password@localhost:5432/ocrecipes
```

---

## Migration Strategy

Currently using **push** mode (schema synchronization) rather than formal migrations:

```bash
npm run db:push    # Drizzle Kit pushes shared/schema.ts to PostgreSQL
```

### Required Extensions

The schema depends on PostgreSQL extensions that `db:push` cannot create automatically. Run these **before** pushing the schema (one-time per database):

```bash
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

A migration script is also provided at `migrations/0001_enable_pg_trgm.sql`.

| Extension | Purpose                                         | Used By                               |
| --------- | ----------------------------------------------- | ------------------------------------- |
| `pg_trgm` | GIN trigram indexes for `ILIKE '%term%'` search | Recipe search (community + meal plan) |

### Indexes

All indexes are declared in `shared/schema.ts` and managed by `db:push`. Notable performance indexes:

- **GIN trigram indexes** (`gin_trgm_ops`) on `community_recipes.normalized_product_name`, `.title`, `.description` and `meal_plan_recipes.title`, `.description` — enable efficient substring search via `ILIKE`
- **B-tree indexes** on foreign keys, timestamps, and lookup columns across all tables
- **Unique indexes** for deduplication (e.g., `meal_plan_recipes(user_id, external_id)`)
