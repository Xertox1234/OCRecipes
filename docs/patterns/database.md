# Database Patterns

### `text()` Over `pgEnum` for Enum-Like Columns

Use `text()` with application-level validation instead of `pgEnum` for columns with a fixed set of values:

```typescript
// Good: text() with Zod validation at the application boundary
export const transactions = pgTable("transactions", {
  status: text("status").default("pending").notNull(),
  platform: text("platform").notNull(),
});

// Validate at API boundary with Zod
const PlatformSchema = z.enum(["ios", "android"]);
const StatusSchema = z.enum(["pending", "approved", "rejected"]);

// Validate from database with safeParse + fallback
const tier = subscriptionTierSchema.safeParse(row.subscriptionTier);
return tier.success ? tier.data : "free";
```

```typescript
// Avoid: pgEnum creates a database-level type requiring migrations to change
import { pgEnum } from "drizzle-orm/pg-core";

const statusEnum = pgEnum("transaction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const transactions = pgTable("transactions", {
  status: statusEnum("status").default("pending").notNull(),
});
// Adding "refunded" later requires ALTER TYPE ... ADD VALUE migration
```

**Why:**

- Adding/removing values requires a database migration with `pgEnum` but only a code change with `text()`
- Drizzle ORM push (`npm run db:push`) handles `text()` columns cleanly; `pgEnum` changes can cause push conflicts
- Validation belongs at the application boundary (Zod schemas), not the database layer
- All existing tables in this project use `text()` for enum-like fields (subscriptionTier, sourceType, status, platform, mealType, category)

**When to use:** Any column with a constrained set of values (status, type, tier, platform, role).

**Pair with:** "Zod safeParse with Fallback for Database Values" pattern (above) for safe reads, and shared Zod schemas for safe writes.

### Cache-First Pattern for Expensive Operations

When an endpoint performs expensive operations (OpenAI API calls, external service requests, complex computations), check for cached results first:

```typescript
// Route handler with cache-first pattern
app.get("/api/items/:id/suggestions", requireAuth, async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const userProfile = await storage.getUserProfile(req.userId!);
  const profileHash = calculateProfileHash(userProfile);

  // 1. Check cache first
  const cached = await storage.getSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
  );
  if (cached) {
    // Increment hit count in background (fire-and-forget)
    storage.incrementCacheHit(cached.id).catch(console.error);
    return res.json({ suggestions: cached.suggestions, cacheId: cached.id });
  }

  // 2. Cache miss: perform expensive operation
  const suggestions = await openai.generateSuggestions(itemId, userProfile);

  // 3. Cache result for future requests
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const cacheEntry = await storage.createSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
    suggestions,
    expiresAt,
  );

  res.json({ suggestions, cacheId: cacheEntry.id });
});
```

**Storage layer - check expiry inline:**

```typescript
async getSuggestionCache(
  scannedItemId: number,
  userId: string,
  profileHash: string,
): Promise<{ id: number; suggestions: SuggestionData[] } | undefined> {
  const [cached] = await db
    .select({ id: suggestionCache.id, suggestions: suggestionCache.suggestions })
    .from(suggestionCache)
    .where(
      and(
        eq(suggestionCache.scannedItemId, scannedItemId),
        eq(suggestionCache.userId, userId),
        eq(suggestionCache.profileHash, profileHash),
        gt(suggestionCache.expiresAt, new Date()), // Check expiry inline
      ),
    );
  return cached || undefined;
}
```

**When to use:**

- AI-generated content (suggestions, summaries, instructions)
- External API calls with per-request costs
- Complex computations with deterministic outputs
- Any operation taking >500ms that produces cacheable results

**Key elements:**

- Composite cache key (itemId + userId + contextHash)
- TTL-based expiration checked in query
- Return cacheId to enable child cache lookups
- Fire-and-forget hit count tracking

### Fire-and-Forget for Non-Critical Background Operations

When an operation shouldn't block the response but failure should be logged, use the fire-and-forget pattern:

```typescript
// Good: Fire-and-forget with error logging
storage.incrementCacheHit(cached.id).catch(console.error);
storage.invalidateCacheForUser(userId).catch(console.error);
storage.createCacheEntry(data).catch(console.error);

// Response sent immediately, background operation continues
return res.json({ data });
```

```typescript
// Bad: Awaiting non-critical operations delays response
await storage.incrementCacheHit(cached.id);
await storage.invalidateCacheForUser(userId);
return res.json({ data }); // User waited for analytics
```

**When to use:**

- Analytics and hit count tracking
- Cache writes after generating response
- Eager cache invalidation
- Audit logging
- Any operation where:
  - Failure doesn't affect the current request's correctness
  - The user shouldn't wait for completion

**Why `.catch(console.error)`:** Without the catch, unhandled promise rejections can crash Node.js in strict mode. The console.error ensures failures are logged for debugging while not blocking the response.

**When NOT to use:**

- Operations that must succeed before responding (auth, critical writes)
- Operations where failure affects response correctness
- Multi-step transactions where rollback is needed

### Content Hash Invalidation Pattern

When cached content depends on user preferences that can change, use a content hash to detect when cache should be invalidated:

```typescript
// server/utils/profile-hash.ts
import crypto from "crypto";
import type { UserProfile } from "@shared/schema";

/**
 * Calculate hash of profile fields that affect cached content.
 * Cache is invalidated when hash changes.
 */
export function calculateProfileHash(profile: UserProfile | undefined): string {
  const hashInput = JSON.stringify({
    allergies: profile?.allergies ?? [],
    dietType: profile?.dietType ?? null,
    cookingSkillLevel: profile?.cookingSkillLevel ?? null,
    cookingTimeAvailable: profile?.cookingTimeAvailable ?? null,
  });
  return crypto.createHash("sha256").update(hashInput).digest("hex");
}
```

**Store hash with cache entry:**

```typescript
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id)
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id)
    .notNull(),
  profileHash: varchar("profile_hash", { length: 64 }).notNull(), // Store hash
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
```

**Cache lookup includes hash in WHERE clause:**

```typescript
// Cache hit only if profileHash matches current profile state
const cached = await storage.getSuggestionCache(itemId, userId, profileHash);
```

**Eager invalidation on profile update:**

```typescript
app.patch("/api/profile", requireAuth, async (req, res) => {
  const fieldsAffectingCache = [
    "allergies",
    "dietType",
    "cookingSkillLevel",
    "cookingTimeAvailable",
  ];
  const changedCacheFields = fieldsAffectingCache.some(
    (field) => field in req.body,
  );

  const profile = await storage.updateUserProfile(req.userId!, req.body);

  // Eagerly invalidate cache if relevant fields changed
  if (changedCacheFields) {
    storage.invalidateCacheForUser(req.userId!).catch(console.error);
  }

  res.json(profile);
});
```

**When to use:**

- AI-generated content personalized to user preferences
- Computed results that depend on user settings
- Any cache where content correctness depends on user profile state

**Why hash instead of timestamp:** Hash provides content-based invalidation. A user could update their profile (changing timestamp) without changing relevant fields, so timestamp-based invalidation would over-invalidate.

### Parent-Child Cache with Cascade Delete

When caching hierarchical data (parent suggestions with child instructions), use foreign key cascade delete for automatic cleanup:

```typescript
// Schema: Parent cache
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Schema: Child cache with cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  id: serial("id").primaryKey(),
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" }) // Auto-delete when parent deleted
    .notNull(),
  suggestionIndex: integer("suggestion_index").notNull(),
  instructions: text("instructions").notNull(),
});
```

**Pass parent cacheId to enable child lookups:**

```typescript
// Parent response includes cacheId
res.json({ suggestions: cached.suggestions, cacheId: cached.id });

// Client passes cacheId when requesting child data
const { data } = useQuery({
  queryKey: [`/api/items/${itemId}/suggestions/${index}/instructions`],
  queryFn: () => apiRequest("POST", url, { cacheId, ... }),
  enabled: !!cacheId,
});
```

**When to use:**

- Suggestions with expandable instructions
- Search results with cached detail views
- Any parent-child content relationship where child validity depends on parent

**Benefits:**

- Single delete operation cleans up all related cache entries
- No orphaned child cache entries
- Database enforces consistency

### Indexes for Foreign Keys and Sort Columns

Add indexes to columns used in WHERE clauses and ORDER BY:

```typescript
export const scannedItems = pgTable(
  "scanned_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    productName: text("product_name").notNull(),
    scannedAt: timestamp("scanned_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    // ... other columns
  },
  (table) => ({
    userIdIdx: index("scanned_items_user_id_idx").on(table.userId),
    scannedAtIdx: index("scanned_items_scanned_at_idx").on(table.scannedAt),
  }),
);
```

**Why:**

- `userId` index: Fast filtering by user (every query filters by user)
- `scannedAt` index: Fast sorting for history screen (ORDER BY scannedAt DESC)

### NOT NULL on Foreign Keys

Always mark foreign key columns as NOT NULL unless nulls are explicitly needed:

```typescript
export const dailyLogs = pgTable("daily_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must have a user
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must reference an item
  // ...
});
```

**Why:** Prevents orphaned records and enforces referential integrity at the database level.

### Inline Transactions for Multi-Table Operations

Use `db.transaction()` directly when operations must be atomic:

```typescript
// Good: Inline transaction
const profile = await db.transaction(async (tx) => {
  const [existing] = await tx
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, req.userId!));

  let result;
  if (existing) {
    [result] = await tx
      .update(userProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(userProfiles.userId, req.userId!))
      .returning();
  } else {
    [result] = await tx
      .insert(userProfiles)
      .values({ ...profileData, userId: req.userId! })
      .returning();
  }

  await tx
    .update(users)
    .set({ onboardingCompleted: true })
    .where(eq(users.id, req.userId!));

  return result;
});
```

```typescript
// Bad: Over-abstracted transaction helper
async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}

// Adds indirection with no benefit
const profile = await withTransaction(async (tx) => {
  // Same logic as above
});
```

**Why:** Inline transactions are clearer, easier to debug, and avoid unnecessary abstraction layers.

### LEFT JOIN with COALESCE for Nullable Foreign Keys

When a table has nullable foreign keys that can reference different source tables (e.g., `dailyLogs` can have nutrition from `scannedItems` OR `mealPlanRecipes`), use LEFT JOINs with nested COALESCE to pull values from whichever source is present.

```typescript
const result = await db
  .select({
    totalCalories: sql<number>`COALESCE(SUM(
      COALESCE(
        CAST(${scannedItems.calories} AS DECIMAL),
        CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL),
        0
      ) * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
    // ... repeat for protein, carbs, fat
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
    ),
  );
```

**When to use:**

- Aggregation queries where the main table has multiple nullable FKs pointing to different source tables
- Summary queries that must include rows regardless of which source provided the data

**When NOT to use:**

- Simple queries where the FK is always non-null (use INNER JOIN)
- Queries that should exclude rows with no match (use INNER JOIN intentionally)

**Key pitfalls:**

1. **INNER JOIN breaks on NULL FK** — if `scannedItemId` is null, INNER JOIN drops the row entirely, making confirmed meal plan items invisible in summaries
2. **Double COALESCE** — outer COALESCE handles the SUM being null (no rows), inner COALESCE handles per-row fallback between multiple source columns
3. **CAST is required** — Drizzle's `text()` columns storing numbers need explicit CAST to DECIMAL for arithmetic

**References:**

- `server/storage.ts` — `getDailySummary()` method
- Related learning: "getDailySummary LEFT JOIN Rewrite" in LEARNINGS.md

### Pre-Fetched IDs to Avoid Redundant Queries

When a route handler needs data that is also needed by a called function, fetch it once and pass it in rather than letting the function query it again.

```typescript
// Bad: daily-summary route fetches confirmedIds, then getPlannedNutritionSummary
// fetches them again internally
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const summary = await storage.getDailySummary(req.userId!, date);
  const confirmedIds = await storage.getConfirmedMealPlanItemIds(req.userId!, date);
  const planned = await storage.getPlannedNutritionSummary(req.userId!, date);
  //                                          ^ internally calls getConfirmedMealPlanItemIds AGAIN
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Good: Fetch once, pass to dependent function via optional parameter
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const [summary, confirmedIds] = await Promise.all([
    storage.getDailySummary(req.userId!, date),
    storage.getConfirmedMealPlanItemIds(req.userId!, date),
  ]);
  const planned = await storage.getPlannedNutritionSummary(
    req.userId!, date, confirmedIds, // Pass pre-fetched IDs
  );
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Storage method accepts optional pre-fetched data
async getPlannedNutritionSummary(
  userId: string,
  date: Date,
  confirmedIds?: number[], // Optional — falls back to internal query
): Promise<PlannedSummary> {
  const excludeIds = confirmedIds ?? (await this.getConfirmedMealPlanItemIds(userId, date));
  // ... use excludeIds
}
```

**When to use:**

- A route handler and a called function both need the same data
- The data involves a database query that would otherwise run twice
- The function is also called from other contexts where pre-fetching is not available (hence optional parameter)

**When NOT to use:**

- The shared data is trivial to compute (no DB call)
- Only one caller exists — just inline the query

**References:**

- `server/routes.ts` — daily-summary endpoint
- `server/storage.ts` — `getPlannedNutritionSummary(userId, date, confirmedIds?)`

### Soft Delete with Aggregation Guard

When implementing soft delete (setting a `discardedAt` timestamp instead of removing rows), every query that reads from or joins against the soft-deleted table must explicitly exclude discarded rows. This is especially dangerous for aggregation queries through nullable foreign keys, because they return plausible-looking numbers rather than obviously wrong results.

**Key insight -- compound WHERE for LEFT JOIN + soft delete:**

```typescript
// Simple filter would also exclude rows where the FK itself is NULL:
//   where(isNull(scannedItems.discardedAt))  // WRONG: drops meal plan rows too
// Correct: exclude discarded items but keep null-FK rows
sql`(${scannedItems.discardedAt} IS NULL OR ${dailyLogs.scannedItemId} IS NULL)`;
```

**Key pitfalls:**

1. **Every query must add `isNull(discardedAt)`** -- missing this in list queries shows "deleted" items; missing it in aggregations inflates totals
2. **LEFT JOIN + soft delete needs a compound WHERE** -- `discardedAt IS NULL` alone also excludes rows where the FK is NULL (not discarded, just unlinked). Use `(discardedAt IS NULL OR FK IS NULL)`.
3. **Related features must respect soft delete** -- e.g., favouriting a discarded item should return 404

**References:**

- `shared/schema.ts:119` -- `discardedAt` column on `scannedItems`
- `server/storage/nutrition.ts:125` -- `softDeleteScannedItem()`
- `server/storage/nutrition.ts:249` -- `getDailySummary()` with compound WHERE
- Related learning: "Soft Delete Breaks Aggregation Queries Silently" in LEARNINGS.md

### Cross-User Aggregation with Self-Exclusion

When surfacing community-level data (e.g., "popular picks", "trending recipes") derived from other users' actions, exclude the requesting user's own records and aggregate by distinct users rather than raw row count. This prevents self-reinforcement and ensures the data reflects genuine community signal.

**Key elements:**

1. **Self-exclusion** — `ne(table.userId, currentUserId)` so users don't see their own picks reflected back
2. **Distinct user count** — `count(distinct userId)` measures adoption breadth, not one power-user's repetition
3. **Server-side deduplication** — filter out aggregated results that overlap with the primary response (e.g., AI suggestions) using case-insensitive title matching before sending to the client

```typescript
// server/storage/meal-plans.ts — getPopularPicksByMealType
const rows = await db
  .select({
    title: mealPlanRecipes.title,
    // ... other fields
    pickCount: sql<number>`count(distinct ${mealPlanRecipes.userId})`.as(
      "pick_count",
    ),
  })
  .from(mealPlanItems)
  .innerJoin(mealPlanRecipes, eq(mealPlanItems.recipeId, mealPlanRecipes.id))
  .where(
    and(
      eq(mealPlanItems.mealType, mealType),
      eq(mealPlanRecipes.sourceType, "ai_suggestion"),
      ne(mealPlanRecipes.userId, userId), // self-exclusion
    ),
  )
  .groupBy(mealPlanRecipes.title /* ... */)
  .orderBy(sql`count(distinct ${mealPlanRecipes.userId}) DESC`)
  .limit(limit);
```

```typescript
// server/routes/meal-suggestions.ts — deduplication before response
const suggestionTitles = new Set(suggestions.map((s) => s.title.toLowerCase()));
return picks.filter((p) => !suggestionTitles.has(p.title.toLowerCase()));
```

**When to use:** Any feature that surfaces aggregated behavior from other users — popular items, trending content, "users also picked" recommendations.

**When NOT to use:** Per-user analytics (e.g., "your most-used recipes") where self-inclusion is the point.

**References:**

- `server/storage/meal-plans.ts` — `getPopularPicksByMealType()`
- `server/routes/meal-suggestions.ts` — `fetchDeduplicatedPopularPicks()`

### Cross-User Product-Level Queries

Some data is inherently product-level rather than user-specific. In these cases, queries should intentionally span all users without `userId` filtering or self-exclusion. The key distinction from "Cross-User Aggregation with Self-Exclusion" is that the data describes a product, not user behavior — so any user's contribution benefits everyone equally.

**Key elements:**

1. **No `userId` filter** — the query checks a global property of a product (e.g., "has this barcode been verified?"), not user-specific activity
2. **Explicit documentation** — add a comment explaining why the query is cross-user, since the default expectation is per-user scoping
3. **Still require authentication** — the route uses `requireAuth` to prevent unauthenticated access, even though the query isn't user-scoped

```typescript
// server/storage/nutrition.ts — getBarcodeVerification
// Cross-user by design: barcode verification is product-level data, not
// user-specific. If any user has verified a barcode with a label photo,
// all users benefit from that verification.
export async function getBarcodeVerification(
  barcode: string,
): Promise<{ verified: boolean; verifiedAt: Date | null }> {
  const cutoff = new Date(Date.now() - VERIFICATION_WINDOW_MS);

  const [row] = await db
    .select({ scannedAt: scannedItems.scannedAt })
    .from(scannedItems)
    .where(
      and(
        eq(scannedItems.barcode, barcode),
        eq(scannedItems.sourceType, "label"),
        isNull(scannedItems.discardedAt),
        gte(scannedItems.scannedAt, cutoff),
      ),
    )
    .orderBy(desc(scannedItems.scannedAt))
    .limit(1);

  return row
    ? { verified: true, verifiedAt: row.scannedAt }
    : { verified: false, verifiedAt: null };
}
```

**When to use:** Queries that check a global property of a product, resource, or entity — barcode verification, product ratings, content moderation status.

**When NOT to use:** User-specific data (daily logs, favourites, preferences), or community aggregations where self-exclusion matters (use "Cross-User Aggregation with Self-Exclusion" instead).

**References:**

- `server/storage/nutrition.ts` — `getBarcodeVerification()`
- `server/routes/nutrition.ts` — `GET /api/nutrition/barcode/:code/verification`

### Toggle via Transaction to Prevent Duplicate Inserts

When implementing a toggle on a join table (favourite/unfavourite, follow/unfollow, like/unlike), wrap the check-then-write in `db.transaction()`. Without a transaction, two rapid taps can both see "not exists" and both insert, creating a duplicate row. The pattern is: select inside `tx`, if exists delete and return false, otherwise insert and return true.

**Defense in depth:** Combine with a unique constraint on the join table (`unique().on(table.userId, table.scannedItemId)`) so the database rejects duplicates even if transaction isolation allows a race.

**When NOT to use:** Idempotent operations where duplicates are harmless, or single-row updates that don't depend on a prior read.

**References:**

- `server/storage/nutrition.ts:143` -- `toggleFavouriteScannedItem()`
- `shared/schema.ts:467` -- `favouriteScannedItems` table with `uniqueUserItem` constraint
- Related learning: "Toggle Favourite Race Condition" in LEARNINGS.md

### Upsert with onConflictDoUpdate

When a resource should have exactly one row per user (or per unique key) and the client sends either a "create" or "update" without knowing which, use Drizzle's `onConflictDoUpdate` to atomically insert-or-update in a single query.

```typescript
// server/routes/fasting.ts — one schedule per user
const [result] = await db
  .insert(fastingSchedules)
  .values({ userId: req.userId!, ...parsed.data })
  .onConflictDoUpdate({
    target: [fastingSchedules.userId], // unique constraint column(s)
    set: parsed.data, // columns to update on conflict
  })
  .returning();
res.json(result);
```

```typescript
// server/storage.ts — one HealthKit sync setting per (userId, dataType)
const [result] = await db
  .insert(healthKitSync)
  .values({ userId, dataType, enabled, syncDirection })
  .onConflictDoUpdate({
    target: [healthKitSync.userId, healthKitSync.dataType],
    set: { enabled, ...(syncDirection ? { syncDirection } : {}) },
  })
  .returning();
```

**When to use:**

- User settings or preferences with a unique constraint per user (fasting schedule, sync settings, notification preferences)
- Cache tables where the cache key is unique and stale entries should be overwritten
- Any "save" endpoint where the client does not distinguish between create and update

**When NOT to use:**

- Resources where multiple rows per user are expected (logs, messages, items)
- Cases where you need to know whether the operation was an insert or update (use a transaction with explicit check instead)

**Key elements:**

1. **`target` must match the unique constraint** — Drizzle generates `ON CONFLICT (col1, col2) DO UPDATE SET ...`
2. **`set` specifies only the columns to update** — do not include the conflict target columns in `set`
3. **`.returning()`** — returns the final row regardless of whether it was inserted or updated
4. **No transaction needed** — the upsert is atomic at the SQL level

**Schema prerequisite:** The target columns must have a unique constraint:

```typescript
export const fastingSchedules = pgTable("fasting_schedules", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id)
    .notNull()
    .unique(), // unique per user
  // ...
});
```

**References:**

- `server/routes/fasting.ts` — `PUT /api/fasting/schedule`
- `server/storage.ts` — `upsertHealthKitSyncSetting()`
- `server/services/nutrition-lookup.ts` — nutrition cache upsert

### Active Record Guard Before Insert

When a table tracks resources with a lifecycle (start -> active -> end), prevent duplicate active records by checking for an existing row where the "ended" column is NULL before inserting a new one. Return 409 Conflict if an active record already exists.

```typescript
// server/routes/fasting.ts — prevent starting a second fast
app.post(
  "/api/fasting/start",
  requireAuth,
  fastingRateLimit,
  async (req, res) => {
    // Check for active fast (endedAt IS NULL = still in progress)
    const [active] = await db
      .select()
      .from(fastingLogs)
      .where(
        and(
          eq(fastingLogs.userId, req.userId!),
          isNull(fastingLogs.endedAt), // Only active (unfinished) records
        ),
      );

    if (active) {
      return res.status(409).json({ error: "A fast is already in progress" });
    }

    // Safe to insert new active record
    const [log] = await db
      .insert(fastingLogs)
      .values({ userId: req.userId!, targetDurationHours: 16 })
      .returning();
    res.status(201).json(log);
  },
);
```

**When to use:**

- Fasting timers (only one active fast at a time)
- Workout sessions (only one in-progress workout)
- Any resource where "active" means a nullable end timestamp is NULL

**When NOT to use:**

- Resources where multiple active records are valid (e.g., multiple active subscriptions on different products)
- Simple CRUD where lifecycle tracking is not needed

**Key elements:**

1. **`isNull(endedAt)`** is the active record filter — not a boolean `isActive` column
2. **Return 409 Conflict** — semantically correct for "resource already exists in this state"
3. **No transaction needed** for the read-then-insert if the unique constraint enforces at most one NULL `endedAt` per user (though a transaction adds safety for concurrent requests)

**References:**

- `server/routes/fasting.ts` — `POST /api/fasting/start`

### Filter Object for Storage Query Methods

When a storage method supports optional filtering by date range, pagination, or other criteria, accept a single options object with optional fields instead of positional parameters. This avoids long parameter lists and makes call sites self-documenting.

```typescript
// server/storage.ts — shared filter pattern used by 6+ methods
async getWeightLogs(
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<WeightLog[]> {
  const conditions = [eq(weightLogs.userId, userId)];
  if (options?.from) conditions.push(gte(weightLogs.loggedAt, options.from));
  if (options?.to) conditions.push(lt(weightLogs.loggedAt, options.to));

  let query = db
    .select()
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(desc(weightLogs.loggedAt));

  if (options?.limit) query = query.limit(options.limit);
  return query;
}

// Call sites are self-documenting:
const logs = await storage.getWeightLogs(userId, { from: fourWeeksAgo });
const recent = await storage.getWeightLogs(userId, { limit: 7 });
const range = await storage.getWeightLogs(userId, { from: start, to: end });
const all = await storage.getWeightLogs(userId); // no filters
```

**When to use:**

- Any storage method that accepts 2+ optional filter parameters
- Date-range queries (weight logs, exercise logs, fasting logs, daily summaries)
- List endpoints that support optional pagination and filtering

**When NOT to use:**

- Methods with a single required parameter beyond userId (use positional)
- Methods where the filter is always the same shape (use dedicated parameters)

**Key elements:**

1. **Optional object parameter** — `options?: { from?: Date; to?: Date; limit?: number }` with `?` on every field
2. **Build conditions array** — push to `conditions` array conditionally, then spread into `and()`
3. **Consistent field names** — use `from`/`to`/`limit` across all methods for predictability
4. **Default to no filter** — when options is undefined, return all records for the user

**References:**

- `server/storage.ts` — `getWeightLogs()`, `getExerciseLogs()`, `getScannedItems()`, `getFastingLogs()`, `getMedicationLogs()`, `getChatMessages()`

### Batch Fetch with `inArray` to Fix N+1 Queries

When a route handler loops over a list of records and makes individual DB queries or API calls for each one, replace the loop with a single batch query using Drizzle's `inArray` operator. Deduplicate IDs before the batch to avoid redundant work.

**Before (N+1 problem):**

```typescript
// Bad: N individual DB queries + N API calls inside a loop
const logs = await storage.getDailyLogs(userId, date);
const results = [];
for (const log of logs) {
  if (!log.scannedItemId) continue;
  const item = await storage.getScannedItem(log.scannedItemId); // N queries
  const nutrients = await lookupMicronutrients(item.productName); // N API calls
  results.push(nutrients);
}
```

**After (batch + deduplicate):**

```typescript
// Good: 1 DB query + M cached API calls (M = unique food names ≤ N)
const logs = await storage.getDailyLogs(userId, date);

// 1. Deduplicate IDs before batch query
const scannedItemIds = [
  ...new Set(
    logs
      .map((log) => log.scannedItemId)
      .filter((id): id is number => id !== null),
  ),
];

// 2. Single batch query with inArray
const items = await storage.getScannedItemsByIds(scannedItemIds, userId);

// 3. Parallel cached lookups for unique food names
const foodNames = items.map((item) => item.productName);
const nutrientArrays = await batchLookupMicronutrients(foodNames);
```

**Storage method using `inArray`:**

```typescript
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
```

**When to use:**

- Route handlers that iterate over a list and query individually per item
- Any endpoint where you have a list of IDs and need the corresponding records
- Aggregation endpoints that combine data from multiple related records

**When NOT to use:**

- Single-item lookups (just use `eq()`)
- Cases where the list is always exactly 1 item
- When you need different columns per item (batch queries return uniform shape)

**Key elements:**

1. **Deduplicate with `new Set()`** — IDs from logs may repeat; dedup before the query avoids fetching the same row twice and reduces result set size
2. **Early return for empty array** — `if (ids.length === 0) return []` prevents Drizzle from generating an invalid `IN ()` clause
3. **Optional `userId` for defense-in-depth** — batch methods on user-owned tables should accept optional userId to filter, following the [Storage-Layer Defense-in-Depth](#storage-layer-defense-in-depth) pattern
4. **Type-narrowing filter** — `.filter((id): id is number => id !== null)` removes nulls and narrows the type in one step

**References:**

- `server/storage.ts` — `getScannedItemsByIds(ids, userId?)`
- `server/routes/micronutrients.ts` — daily micronutrient endpoint
- Related: [Pre-Fetched IDs to Avoid Redundant Queries](#pre-fetched-ids-to-avoid-redundant-queries) (for passing pre-fetched data to callees)

## Database Safety Patterns

### Safe JSONB Array Access with Array.isArray Guard

JSONB columns in PostgreSQL can contain any JSON value. When the application expects an array, always guard with `Array.isArray()` before iterating. Drizzle ORM types JSONB columns as `unknown`, so TypeScript provides no protection against non-array values.

```typescript
// Good: Guard before iterating JSONB data
const effects = log.sideEffects; // JSONB column — could be null, object, string, array, etc.
if (Array.isArray(effects)) {
  for (const effect of effects) {
    if (typeof effect === "string") {
      sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
    }
  }
}
```

```typescript
// Bad: Assume JSONB column is an array
const effects = log.sideEffects as string[]; // Could be null, an object, or a bare string
for (const effect of effects) {
  // TypeError: effects is not iterable
  sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
}
```

**Why this matters:**

- JSONB columns can be `null`, `{}`, `"string"`, `42`, or `[]` — all valid JSON values
- `as string[]` is a compile-time-only assertion that provides zero runtime safety
- Database values may have been written by a different version of the code with a different schema
- Manual database edits or migrations can leave unexpected shapes in JSONB columns

**Two levels of defense:**

1. `Array.isArray(value)` — confirms the value is actually an array
2. `typeof element === "string"` (or similar) — validates each element's type

**When to use:** Every time you read a JSONB column and iterate over its contents. This applies to arrays of strings, arrays of objects, or any nested structure.

**When NOT to use:** When the JSONB value has already been validated by Zod `safeParse()` earlier in the request lifecycle.

**Reference:** `server/services/glp1-insights.ts` — `sideEffects` JSONB column. Also applies to `allergies`, `foodDislikes`, and other JSONB array columns in `userProfiles`.

### Shared Type Guards for JSONB Columns

When multiple services need to safely access the same JSONB column shape (e.g., `userProfiles.allergies` is used by both `recipe-generation.ts` and `ingredient-substitution.ts`), extract the type guard into a shared file rather than duplicating it or using `as` casts.

```typescript
// shared/types/user-profile-guards.ts — single source of truth
export function isAllergyArray(value: unknown): value is { name: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === "string",
    )
  );
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
```

```typescript
// server/services/recipe-generation.ts — consumer
import { isAllergyArray } from "@shared/types/user-profile-guards";

if (isAllergyArray(userProfile.allergies) && userProfile.allergies.length > 0) {
  const allergyNames = userProfile.allergies.map((a) => a.name); // fully typed
}
```

**Key elements:**

1. **Single definition** — guard logic lives in one place, not duplicated across services
2. **`shared/types/`** — importable by both server and client code via `@shared/` alias
3. **Narrows the type** — `value is { name: string }[]` gives full TypeScript autocompletion after the check
4. **Replaces `as` casts** — eliminates `(profile.allergies as { name: string }[])` which provides zero runtime safety

**Naming convention:** `is{ColumnShape}` — `isAllergyArray`, `isStringArray`. Place in `shared/types/{table}-guards.ts` grouped by the table they apply to.

**When to use:** A JSONB column shape is accessed by 2+ services or by both client and server code. Extract on the second usage.

**When NOT to use:** A JSONB column is only accessed in one place — an inline `Array.isArray()` guard is sufficient (see Safe JSONB Array Access pattern above).

**Reference:** `shared/types/user-profile-guards.ts` — guards for `userProfiles.allergies` and `userProfiles.foodDislikes`
