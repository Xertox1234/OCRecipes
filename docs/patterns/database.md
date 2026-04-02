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
    fireAndForget("suggestion-cache-hit", storage.incrementCacheHit(cached.id));
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

When an operation shouldn't block the response but failure should be logged, use the `fireAndForget` helper from `server/lib/fire-and-forget.ts`:

```typescript
import { fireAndForget } from "../lib/fire-and-forget";

// Good: Fire-and-forget with labeled error logging
fireAndForget("cache-hit-increment", storage.incrementCacheHit(cached.id));
fireAndForget(
  "suggestion-cache-invalidation",
  storage.invalidateCacheForUser(userId),
);
fireAndForget("instruction-cache-write", storage.createCacheEntry(data));

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

**Why `fireAndForget`:** Without a catch, unhandled promise rejections can crash Node.js in strict mode. The helper logs failures with a context label for easier debugging while not blocking the response.

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
    fireAndForget(
      "suggestion-cache-invalidation",
      storage.invalidateCacheForUser(req.userId!),
    );
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

### Transactions in the Storage Layer

All `db.transaction()` calls belong in **storage modules** (`server/storage/*.ts`), never in routes. Routes call named storage functions that encapsulate the transaction internally.

```typescript
// ✅ Good: Named storage function with transaction inside
// server/storage/nutrition.ts
export async function createScannedItemWithLog(
  item: InsertScannedItem,
  logOverrides?: Partial<Pick<InsertDailyLog, "mealType" | "source">>,
): Promise<ScannedItem> {
  return db.transaction(async (tx) => {
    const [scannedItem] = await tx.insert(scannedItems).values(item).returning();
    await tx.insert(dailyLogs).values({
      userId: item.userId,
      scannedItemId: scannedItem.id,
      servings: "1",
      mealType: logOverrides?.mealType ?? null,
      source: logOverrides?.source ?? "scan",
    });
    return scannedItem;
  });
}

// Route calls it cleanly:
const item = await storage.createScannedItemWithLog(
  { userId: req.userId!, productName, calories: calories.toString(), ... },
  { mealType: validated.mealType || null },
);
```

```typescript
// ❌ Bad: Transaction in route — bypasses storage abstraction
import { db } from "../db";
import { scannedItems, dailyLogs } from "@shared/schema";

const item = await db.transaction(async (tx) => {
  const [scannedItem] = await tx.insert(scannedItems).values({...}).returning();
  await tx.insert(dailyLogs).values({ scannedItemId: scannedItem.id, ... });
  return scannedItem;
});
```

```typescript
// ❌ Bad: Generic transaction wrapper — adds indirection with no domain meaning
async function withTransaction<T>(
  cb: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(cb);
}
```

**Why:**

- **Routes must not import `db`** — all database access goes through the storage facade (see architecture pattern)
- **Reuse** — when 5 routes need the same "insert item + log" transaction, a named storage function eliminates duplication
- **Testability** — route tests mock `storage.createScannedItemWithLog()` (one line) instead of building fake transaction objects with nested `insert/values/returning` chains
- **Storage-level tests** can verify the actual transaction logic against a real database

**When to use:** Any multi-table write that must be atomic. Give the function a descriptive domain name (`createScannedItemWithLog`, `upsertProfileWithOnboarding`, `createMealPlanFromSuggestions`).

**When NOT to use:** Don't create generic transaction wrappers (`withTransaction`, `runInTx`) — they add indirection without domain meaning.

**References:**

- `server/storage/nutrition.ts` — `createScannedItemWithLog()` (5 route callers)
- `server/storage/users.ts` — `upsertProfileWithOnboarding()`
- `server/storage/meal-plans.ts` — `createMealPlanFromSuggestions()`
- `server/storage/nutrition.ts` — `softDeleteScannedItem()`, `toggleFavouriteScannedItem()` (existing examples)

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

### Drizzle `sql<T>` Is a Type Hint, Not a Runtime Coercion

Drizzle's `sql<T>` generic parameter is a **compile-time type assertion** — it tells TypeScript what type to expect, but does **not** coerce the value at runtime. The PostgreSQL driver (node-postgres) determines the actual runtime type.

Common gotcha: `sql<Date>` on a `max(timestamp)` or `min(timestamp)` expression. The PG driver returns timestamp values as **ISO strings**, not `Date` objects. Calling `.toISOString()` on the result will throw `TypeError: .toISOString is not a function`.

```typescript
// BAD: sql<Date> lies — PG driver returns a string
const rows = await db.select({
  lastLogged: sql<Date>`max(${dailyLogs.loggedAt})`,
});
rows[0].lastLogged.toISOString(); // 💥 TypeError at runtime

// GOOD: Match the type to what the driver actually returns
const rows = await db.select({
  lastLogged: sql<string>`max(${dailyLogs.loggedAt})`,
});
// Already a string — use directly or wrap in new Date() if needed
```

**Safe types for common SQL expressions:**

| Expression                         | `sql<T>` type | Why                                    |
| ---------------------------------- | ------------- | -------------------------------------- |
| `count(*)`, `cast(... as int)`     | `sql<number>` | PG returns numeric types as JS numbers |
| `max(timestamp)`, `min(timestamp)` | `sql<string>` | PG returns timestamps as ISO strings   |
| `COALESCE(SUM(...), 0)`            | `sql<number>` | Numeric aggregation with fallback      |
| `DATE(... AT TIME ZONE ...)`       | `sql<string>` | Date formatting returns strings        |

**References:**

- `server/storage/nutrition.ts` — `getFrequentItems()` uses `sql<string>` for `max(loggedAt)`
- `server/storage/nutrition.ts` — `getDailySummary()` uses `sql<number>` for aggregations

### Drizzle `sql` Template Treats `${column}` as Bound Parameters

Drizzle's `sql` template tag parameterizes **all** `${}` interpolations as bound values (`$1`, `$2`). This is safe for user input but **breaks column references** in correlated subqueries:

```typescript
// ❌ BAD: ${cookbooks.id} becomes a bound parameter, not a column reference
sql<number>`(SELECT COUNT(*) FROM cookbook_recipes WHERE cookbook_id = ${cookbooks.id})`;
// Generates: ... WHERE cookbook_id = $1  (always returns 0)

// ✅ GOOD: Use Drizzle's query builder for column-to-column comparisons
import { count } from "drizzle-orm";
db.select({ recipeCount: count(cookbookRecipes.id) })
  .from(cookbooks)
  .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
  .groupBy(cookbooks.id);
```

**Rule:** Never interpolate `table.column` inside `sql` template strings. Use JOINs via the query builder instead.

**References:**

- `server/storage/cookbooks.ts` — `getUserCookbooks()` uses LEFT JOIN + `count()` for recipe counts
- `docs/LEARNINGS.md` — Full post-mortem under "Drizzle sql Template Parameterizes Column Refs"

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

### JSONB Array Length Filtering in Queries

When filtering rows by whether a JSONB array column has content, use `COALESCE(jsonb_array_length(...), 0)` — never bare `jsonb_array_length()`. This handles NULL values safely:

```typescript
// Good: COALESCE guards against NULL → NULL > 0 → excluded silently
const conditions = [
  sql`COALESCE(jsonb_array_length(${table.instructions}), 0) > 0`,
];

// Bad: If column is NULL, jsonb_array_length returns NULL, and NULL > 0 is NULL (falsy)
const conditions = [sql`jsonb_array_length(${table.instructions}) > 0`];
```

For tables where content could be in a **related table** (e.g., ingredients in a separate `recipeIngredients` table), combine with an `EXISTS` subquery:

```typescript
sql`(
  COALESCE(jsonb_array_length(${mealPlanRecipes.instructions}), 0) > 0
  OR EXISTS (
    SELECT 1 FROM ${recipeIngredients}
    WHERE ${recipeIngredients.recipeId} = ${mealPlanRecipes.id}
  )
)`,
```

**When to use:** Any WHERE clause that filters on JSONB array content. Even if the column is currently `NOT NULL`, schema drift or raw SQL inserts could introduce NULLs.

**Reference:** `server/storage/community.ts` — `getFeaturedRecipes()`; `server/storage/meal-plans.ts` — `getUnifiedRecipes()`.

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

### Zod safeParse per JSONB Element

When a JSONB array column has a Zod schema for its element type, validate each element individually with `safeParse()` — skip invalid entries instead of failing the entire request. This is strictly more robust than the `isAllergyArray()` type guard approach because it recovers gracefully from partial corruption.

```typescript
import { allergySchema } from "@shared/schema";
import type { AllergySeverity } from "@shared/constants/allergens";

/** Runtime-safe extraction of allergies from JSONB column. */
function parseAllergies(
  raw: unknown,
): { name: string; severity: AllergySeverity }[] {
  if (!Array.isArray(raw)) return [];
  const result: { name: string; severity: AllergySeverity }[] = [];
  for (const item of raw) {
    const parsed = allergySchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
    // Invalid entries silently skipped — partial corruption doesn't crash
  }
  return result;
}
```

```typescript
// Bad: as cast provides zero runtime safety
const allergies = profile.allergies as { name: string }[];

// Bad: crashes if any element is invalid
const allergies = allergyArraySchema.parse(profile.allergies);

// Good: per-element validation with graceful skip
const allergies = parseAllergies(profile.allergies);
```

**When to use:** JSONB array columns where a Zod schema exists for the element type and partial corruption should not fail the request (allergies, preferences, tags, side effects).

**When NOT to use:** When the entire array must be valid-or-nothing (use full array schema validation). When no Zod schema exists for the element type (use `Array.isArray()` + inline guard).

**Why:** JSONB columns can contain unexpected data from schema evolution, manual DB edits, or migration bugs. Per-element validation means a single corrupt entry doesn't prevent the other 8 valid allergies from being used. This was caught as a high-severity code review finding — the original `as` cast hid runtime type mismatches.

**References:**

- `shared/constants/allergens.ts` -- `parseUserAllergies()` canonical shared implementation (used by 5+ files)
- `shared/schema.ts` -- `allergySchema` Zod definition
- See also: [Shared Type Guards for JSONB Columns](#shared-type-guards-for-jsonb-columns) (the type guard approach, suitable when no Zod schema exists)

### Defensive Cache Writes with `onConflictDoNothing`

Use `onConflictDoNothing` (not `onConflictDoUpdate`) when seeding a cache from user-provided data to prevent cache poisoning:

```typescript
// GOOD: only insert if no entry exists — never overwrite trusted data
await db
  .insert(nutritionCache)
  .values({ queryKey: key, data, expiresAt })
  .onConflictDoNothing({ target: nutritionCache.queryKey });

// BAD: overwrites existing data — any user can poison the cache
await db
  .insert(nutritionCache)
  .values({ queryKey: key, data, expiresAt })
  .onConflictDoUpdate({
    target: nutritionCache.queryKey,
    set: { data, expiresAt },
  });
```

**When to use:** When user-submitted data (e.g., label scans with arbitrary barcode strings) could overwrite authoritative cached data. The user provides the cache key (barcode), which they can set to anything.

**When NOT to use:** When the system is the sole writer and updates are intentional (e.g., refreshing expired cache from a trusted API).

**References:**

- `server/services/nutrition-lookup.ts` -- `cacheNutritionIfAbsent()` guards label-confirm cache seeding
- Security finding from PR #14 code review

### Unique Index + `onConflictDoUpdate` for AI Cache Dedup

When an AI cache table stores generated content keyed by `(scannedItemId, userId, profileHash)` (or similar composite key), the table **must** have a unique index on that composite key and the insert **must** use `onConflictDoUpdate`. Without this, concurrent requests that miss the cache simultaneously each insert a new row, leaving the table with duplicate entries for the same logical key.

```typescript
// shared/schema.ts -- unique index declaration
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").notNull(),
    userId: text("user_id").notNull(),
    profileHash: text("profile_hash").notNull(),
    suggestions: jsonb("suggestions").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserProfileIdx: uniqueIndex(
      "suggestion_cache_item_user_profile_idx",
    ).on(table.scannedItemId, table.userId, table.profileHash),
  }),
);

// server/storage/cache.ts -- insert uses onConflictDoUpdate
await db
  .insert(suggestionCache)
  .values({ scannedItemId, userId, profileHash, suggestions, expiresAt })
  .onConflictDoUpdate({
    target: [
      suggestionCache.scannedItemId,
      suggestionCache.userId,
      suggestionCache.profileHash,
    ],
    set: { suggestions, expiresAt },
  });
```

**Contrast with `onConflictDoNothing`** (see "Defensive Cache Writes" pattern above):

- **`onConflictDoUpdate`** — correct for AI-generated cache where a concurrent race should refresh the entry rather than silently drop the newer result.
- **`onConflictDoNothing`** — correct for user-seeded cache (e.g., label scan data) where the first insert wins and later inserts must not overwrite it (anti-poisoning defense).

**When to use:** Any cache table whose key is a composite of system-generated identifiers (item ID + user ID + content hash) and where a concurrent duplicate should refresh the entry.

**References:**

- `shared/schema.ts` -- `suggestion_cache_item_user_profile_idx` unique index
- `server/storage/cache.ts` -- `createSuggestionCache()` with `onConflictDoUpdate`

---

### Streak Calculation from Time-Series Data

Calculate activity streaks by querying distinct UTC dates and walking backwards:

```typescript
// Get distinct dates ordered most recent first
const dates = await db
  .select({
    day: sql<string>`DATE(${table.createdAt} AT TIME ZONE 'UTC')`,
  })
  .from(table)
  .where(eq(table.userId, userId))
  .groupBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`)
  .orderBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC') DESC`);

// Walk backwards counting consecutive days
let streak = 0;
let expectedDate = new Date(today);
for (const row of dates) {
  const d = new Date(row.day);
  const diffDays = Math.round(
    (expectedDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) {
    streak++;
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
  } else if (diffDays === 1 && streak === 0) {
    // Yesterday counts as start (user hasn't acted today yet)
    streak++;
    expectedDate = new Date(d);
    expectedDate.setUTCDate(expectedDate.getUTCDate() - 1);
  } else {
    break;
  }
}
```

**Key details:**

- Use `AT TIME ZONE 'UTC'` to normalize across server timezones
- Allow yesterday as streak start (grace period for users who haven't acted today yet)
- `GROUP BY DATE(...)` collapses multiple same-day entries into one row
- More efficient than fetching all rows — only fetches distinct dates

**References:**

- `server/storage/verification.ts` -- `getUserVerificationStats()` for verification streaks

### Multi-Source Streak Dates (UNION, Not GREATEST)

When streak calculations need to consider multiple date sources from the same row (e.g., a `createdAt` date and a separate `frontLabelScannedAt` date), **do not use `GREATEST()`**. `GREATEST` picks one date and discards the other, which can erase an activity day from the distinct dates and retroactively break streaks.

Instead, query each date source separately and merge in JS:

```typescript
// BAD: GREATEST collapses two dates into one, losing Monday if front-label was Wednesday
const dates = await db.select({
  day: sql`DATE(GREATEST(created_at, front_label_scanned_at) AT TIME ZONE 'UTC')`,
})...

// GOOD: Query both date sources, merge with Set for distinct days
const backLabelDates = await db.select({
  day: sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`,
}).from(table).where(eq(table.userId, userId))
  .groupBy(sql`DATE(${table.createdAt} AT TIME ZONE 'UTC')`);

const frontLabelDates = await db.select({
  day: sql`DATE(${table.frontLabelScannedAt} AT TIME ZONE 'UTC')`,
}).from(table).where(and(eq(table.userId, userId), sql`${table.frontLabelScannedAt} IS NOT NULL`))
  .groupBy(sql`DATE(${table.frontLabelScannedAt} AT TIME ZONE 'UTC')`);

const dateSet = new Set<string>();
for (const row of backLabelDates) dateSet.add(row.day);
for (const row of frontLabelDates) dateSet.add(row.day);
const dates = [...dateSet].sort((a, b) => b.localeCompare(a)).map(day => ({ day }));
```

**Why not GREATEST:** A user verifies product A on Monday (`createdAt` = Monday). On Wednesday they front-label scan it (`frontLabelScannedAt` = Wednesday). `GREATEST` returns Wednesday — Monday vanishes. If Monday was the only activity that day, the streak breaks retroactively.

**References:**

- `server/storage/verification.ts` -- `getUserVerificationStats()` streak query

### Enrichment JSONB on Shared Records

When adding optional enrichment data to shared (product-level) records that doesn't affect the primary data model's integrity:

```typescript
// Schema: nullable JSONB column, default null
frontLabelData: (jsonb("front_label_data"),
  // Storage: overwrite with latest scan
  await tx
    .update(barcodeVerifications)
    .set({
      frontLabelData: data as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(barcodeVerifications.barcode, barcode)));
```

**Key principles:**

- **Separate from consensus/verification** — enrichment data doesn't gate or affect the primary data model
- **Latest-wins overwrite** — no audit trail needed, any authorized user can contribute
- **Track contributor in JSONB** — include `scannedByUserId` and `scannedAt` inside the JSONB since the parent row has no `userId` column (it's product-level)
- **Validate with Zod before storing** — `frontLabelDataSchema.safeParse(data)` before write
- **Always validate on read** — JSONB shape can't be trusted; use `safeParse` when reading back
- **Wrap multi-table writes in transaction** — if enrichment also marks a per-user tracking boolean, use `db.transaction()` for atomicity

**References:**

- `server/storage/verification.ts` -- `confirmFrontLabelData()` for transactional enrichment storage
- `shared/types/front-label.ts` -- `frontLabelDataSchema` Zod schema for JSONB shape

### `.returning()` to Detect Missing Resources on UPDATE

When an UPDATE targets a specific row by ID (resolve, approve, archive operations), the query silently succeeds with 0 affected rows if the ID doesn't exist. Use `.returning()` and check the result length to distinguish "updated" from "not found."

```typescript
// ✅ GOOD: Detect missing resource
export async function resolveReformulationFlag(
  id: number,
  resolution: string,
  resolvedBy: string,
): Promise<ReformulationFlag | undefined> {
  const [updated] = await db
    .update(reformulationFlags)
    .set({ status: "resolved", resolution, resolvedBy, resolvedAt: new Date() })
    .where(eq(reformulationFlags.id, id))
    .returning();
  return updated; // undefined if id doesn't exist
}

// Route handler:
const flag = await storage.resolveReformulationFlag(
  id,
  resolution,
  req.userId!,
);
if (!flag) {
  return sendError(res, 404, "Reformulation flag not found", "NOT_FOUND");
}
res.json(flag);
```

```typescript
// ❌ BAD: Silent success on missing resource
export async function resolveReformulationFlag(id: number, ...): Promise<void> {
  await db
    .update(reformulationFlags)
    .set({ status: "resolved", ... })
    .where(eq(reformulationFlags.id, id));
  // No .returning() — caller has no way to know if the row existed
}

// Route handler returns 200 even when id=999999 doesn't exist:
await storage.resolveReformulationFlag(id, resolution, req.userId!);
res.json({ message: "Resolved" }); // misleading
```

**When to use:**

- Any storage method that updates a specific row by primary key (resolve, archive, approve, reject)
- Admin operations on resources that may have been deleted concurrently
- Any endpoint where returning 200 for a nonexistent resource would be misleading

**When NOT to use:**

- Bulk updates where 0 affected rows is a valid outcome (e.g., "mark all as read")
- Updates that include `userId` in the WHERE clause and already use the "return undefined for IDOR" pattern

**Key insight:** Drizzle's `.update().where()` never throws on 0 matches — it silently succeeds. Without `.returning()`, the only way to detect this is a separate SELECT, which adds a round-trip and a TOCTOU window.

**References:**

- `server/storage/reformulation.ts` — `resolveReformulationFlag()`
- See also: [Storage-Layer Defense-in-Depth](../patterns/security.md#storage-layer-defense-in-depth) in security patterns

### Pagination Count Must Match List Query Filters

When a paginated endpoint returns both `items` and `total`, the count query must apply the same WHERE conditions as the list query. A mismatch causes the client to show incorrect page counts or request pages that return empty.

```typescript
// ✅ GOOD: Count and list share the same filter conditions
const conditions = [eq(flags.barcode, barcode)];
if (status) {
  conditions.push(eq(flags.status, status));
}
const where = and(...conditions);

const [items, [{ count }]] = await Promise.all([
  db.select().from(flags).where(where).limit(limit).offset(offset),
  db
    .select({ count: sql<number>`count(*)` })
    .from(flags)
    .where(where),
]);

res.json({ items, total: Number(count), page, limit });
```

```typescript
// ❌ BAD: Count ignores the status filter
const items = await db
  .select()
  .from(flags)
  .where(and(eq(flags.barcode, barcode), eq(flags.status, status)))
  .limit(limit)
  .offset(offset);

// Count query doesn't include status filter — total is wrong
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(flags)
  .where(eq(flags.barcode, barcode));

res.json({ items, total: Number(count), page, limit });
```

**When to use:** Every paginated list endpoint that returns a `total` count alongside `items`.

**Why:** Extract the shared `where` clause into a variable and pass it to both queries. This makes it impossible for the filters to diverge.

**References:**

- `server/routes/verification.ts` — reformulation flag list endpoint

### Transaction-Wrapped Count-Then-Insert to Prevent TOCTOU

When a storage method enforces a per-user limit (max saved items, max sessions, max grocery lists), wrap the count query and the insert in a single `db.transaction()`. Without this, two concurrent requests can both pass the count check and both insert, exceeding the limit.

```typescript
// ✅ GOOD: Count + insert in one transaction — second request sees the first's insert
export async function createSavedItem(
  userId: string,
  itemData: CreateSavedItemInput,
): Promise<SavedItem | null> {
  return db.transaction(async (tx) => {
    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(savedItems)
      .where(eq(savedItems.userId, userId));
    const count = countResult[0]?.count ?? 0;

    // Read tier inside the same transaction for consistency
    const [subRow] = await tx
      .select({ tier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, userId));
    const tier = isValidSubscriptionTier(subRow?.tier) ? subRow.tier : "free";
    const limit = TIER_FEATURES[tier].maxSavedItems;

    if (count >= limit) return null; // Signal limit reached

    const [item] = await tx
      .insert(savedItems)
      .values({ ...itemData, userId })
      .returning();
    return item;
  });
}

// ❌ BAD: Separate count and insert — race condition on concurrent requests
export async function createSavedItem(userId: string, itemData: CreateSavedItemInput) {
  const count = await getSavedItemCount(userId); // Not in a transaction
  if (count >= limit) return null;
  const [item] = await db.insert(savedItems).values({ ... }).returning(); // Another request may have inserted between count and here
  return item;
}
```

**When to use:**

- Any storage method that checks a count/existence before inserting (saved items, grocery lists, meal plan items, API keys)
- Any "check then act" pattern where concurrent requests could both pass the check

**When NOT to use:**

- Operations where over-limit insertion is harmless and can be cleaned up later
- Unique constraints that already prevent duplicates (use `onConflictDoNothing` instead)

**References:**

- `server/storage/nutrition.ts` — `createSavedItem()` with tier-limit check
- `server/storage/users.ts` — `createTransactionAndUpgrade()` (atomic transaction + tier update)
- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()` (limit check + message insert + conversation timestamp)
- `server/storage/community.ts` — `createRecipeWithLimitCheck()` (limit check + recipe + generation log)
- `server/storage/meal-plans.ts` — `createGroceryListWithLimitCheck()` (limit check + list + items)
- `server/storage/medication.ts` — `applyAdaptiveGoalsAtomically()`, `dismissAdaptiveGoalsAtomically()`
- `server/storage/users.ts` — `createWeightLogAndUpdateUser()` (weight log + user weight update)
- See also: [Early Non-Transactional Check + Authoritative Transactional Check](#early-non-transactional-check--authoritative-transactional-check) for the two-phase variant

### Unique Constraint as TOCTOU Safety Net

When the "check-then-insert" race window is narrow (no expensive work between check and insert) and the uniqueness is inherent to the data model, use a database unique constraint as the safety net instead of a full transaction. Keep the application-level check for a fast, friendly response, and catch the constraint violation in the error handler.

```typescript
// ✅ GOOD: App-level check for fast 409 + unique constraint catches the race
// Route: POST /api/auth/register
const existingUser = await storage.getUserByUsername(username);
if (existingUser) {
  return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
}

let user;
try {
  user = await storage.createUser({ username, password: hashedPassword });
} catch (err) {
  const msg = toError(err).message;
  if (msg.includes("23505") || msg.includes("unique")) {
    return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
  }
  throw err; // Re-throw non-constraint errors
}
```

**When to use:**

- Uniqueness is already enforced by a DB constraint (username, email, one-confirmation-per-item)
- The insert is the only write operation (no multi-table atomicity needed)
- The race window is narrow (no AI calls or external APIs between check and insert)

**When NOT to use:**

- Multi-table mutations that must be atomic (use a transaction instead)
- Count-based limits (e.g., "max 5 per day") where there's no single unique key

**Key:** PostgreSQL error code `23505` is the unique violation. Drizzle surfaces it in the error message. Always re-throw non-23505 errors.

**References:**

- `server/routes/auth.ts` — registration username uniqueness
- `server/routes/meal-plan.ts` — meal plan confirmation dedup (partial unique index on `userId, mealPlanItemId` where not null)
- `shared/schema.ts` — `daily_logs_unique_meal_plan_confirm` partial unique index

### Early Non-Transactional Check + Authoritative Transactional Check

When an expensive operation (AI generation, external API call) sits between the limit check and the insert, use a two-phase approach: a fast non-transactional check before the expensive work, and an authoritative transactional check-then-insert after it. This avoids holding a database transaction open during a multi-second AI call while still preventing TOCTOU races.

```typescript
// server/routes/recipes.ts — recipe generation with AI call

// Phase 1: Fast non-transactional check (avoids expensive AI call for clearly over-limit users)
const generationsToday = await storage.getDailyRecipeGenerationCount(userId, new Date());
if (generationsToday >= features.dailyRecipeGenerations) {
  return sendError(res, 429, "Daily recipe generation limit reached");
}

// Phase 2: Expensive AI call (NOT inside a transaction)
const generatedRecipe = await generateFullRecipe({ productName, ... });

// Phase 3: Authoritative transactional check + insert (prevents TOCTOU race)
const recipe = await storage.createRecipeWithLimitCheck(
  userId,
  features.dailyRecipeGenerations,
  { title: generatedRecipe.title, ... },
);

if (!recipe) {
  // Another request snuck in while we were generating
  return sendError(res, 429, "Daily recipe generation limit reached");
}
```

```typescript
// server/storage/community.ts — atomic storage method
export async function createRecipeWithLimitCheck(
  userId: string,
  dailyLimit: number,
  data: InsertCommunityRecipe,
): Promise<CommunityRecipe | null> {
  return db.transaction(async (tx) => {
    const { startOfDay, endOfDay } = getDayBounds(new Date());
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );
    if (Number(result[0]?.count ?? 0) >= dailyLimit) return null;

    const [recipe] = await tx.insert(communityRecipes).values(data).returning();
    await tx
      .insert(recipeGenerationLog)
      .values({ userId, recipeId: recipe.id });
    return recipe;
  });
}
```

**Key elements:**

1. **Phase 1 (fast path):** Non-transactional count check rejects obviously over-limit requests immediately, saving the cost of the AI call
2. **Phase 2 (expensive work):** AI generation runs outside any transaction so the DB connection is not held open
3. **Phase 3 (authoritative):** Re-checks the limit inside `db.transaction()` and inserts atomically, preventing the race
4. **Return `null` for limit-reached:** Caller checks the return value and sends the appropriate error response

**When to use:**

- Any endpoint where an expensive operation (AI, external API, image processing) precedes a rate-limited insert
- Used in: recipe generation, meal suggestions, chat messages, grocery list creation

**When NOT to use:**

- When there is no expensive work between the check and the insert (use the simpler single-transaction pattern above)
- When the non-transactional fast-path check is not worth the code complexity (low-traffic endpoints)

**References:**

- `server/routes/recipes.ts` — `createRecipeWithLimitCheck()` (AI recipe generation)
- `server/routes/meal-suggestions.ts` — `createMealSuggestionCacheWithLimitCheck()` (AI meal suggestions)
- `server/routes/chat.ts` — `createChatMessageWithLimitCheck()` (chat daily limit)
- `server/routes/grocery.ts` — `createGroceryListWithLimitCheck()` (grocery list count)

### CASE/WHEN Batch Update for Reordering

When updating a sort order or position for multiple rows, use a single `UPDATE ... SET sortOrder = CASE WHEN id = X THEN Y ... END` instead of N sequential UPDATEs. This reduces round-trips from O(N) to O(1).

```typescript
// ✅ GOOD: Single UPDATE with CASE expression
export async function reorderMealPlanItems(
  userId: string,
  items: { id: number; sortOrder: number }[],
): Promise<void> {
  if (items.length === 0) return;

  const ids = items.map((i) => i.id);
  const caseFragments = items.map(
    (i) => sql`WHEN ${mealPlanItems.id} = ${i.id} THEN ${i.sortOrder}`,
  );

  await db
    .update(mealPlanItems)
    .set({
      sortOrder: sql`CASE ${sql.join(caseFragments, sql` `)} ELSE ${mealPlanItems.sortOrder} END`,
    })
    .where(
      and(eq(mealPlanItems.userId, userId), inArray(mealPlanItems.id, ids)),
    );
}

// ❌ BAD: N sequential UPDATEs in a transaction — N round-trips to the database
await db.transaction(async (tx) => {
  for (const item of items) {
    await tx
      .update(mealPlanItems)
      .set({ sortOrder: item.sortOrder })
      .where(
        and(eq(mealPlanItems.id, item.id), eq(mealPlanItems.userId, userId)),
      );
  }
});
```

**Key elements:**

1. **`sql.join(caseFragments, sql` `)`** — Drizzle helper to safely join SQL fragments with a separator
2. **`inArray(mealPlanItems.id, ids)`** — limits the UPDATE to only the rows being reordered (+ userId for IDOR protection)
3. **`ELSE ${mealPlanItems.sortOrder} END`** — keeps untouched rows at their current position
4. **Early return on empty** — avoids generating an invalid `CASE END` with no WHEN clauses

**When to use:** Any drag-and-drop reorder, bulk priority update, or batch position assignment where the caller sends `{ id, newPosition }[]`.

**When NOT to use:** Single-row updates, or cases where each row needs different SET columns (not just different values for the same column).

**References:**

- `server/storage/meal-plans.ts` — `reorderMealPlanItems()`

### CHECK Constraint for Mutually-Optional FK Pairs

When a table has two nullable foreign keys where at least one must be non-null (e.g., `dailyLogs` must reference either a `scannedItem` or a `recipe`), add a PostgreSQL CHECK constraint via Drizzle's `check()` to prevent ghost rows at the schema level.

```typescript
export const dailyLogs = pgTable(
  "daily_logs",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").references(() => scannedItems.id),
    recipeId: integer("recipe_id").references(() => mealPlanRecipes.id),
    // ... other columns
  },
  (table) => ({
    hasNutritionSource: check(
      "daily_logs_has_source",
      sql`scanned_item_id IS NOT NULL OR recipe_id IS NOT NULL`,
    ),
  }),
);
```

**When to use:** Any table where a row must reference one of several possible parent tables via nullable FKs (polymorphic references without a discriminator column).

**Why:** Application-level validation can be bypassed by direct DB access, bulk imports, or future code paths. The CHECK constraint is an immutable database-level invariant that prevents data corruption regardless of how the row is inserted.

**References:**

- `shared/schema.ts` — `dailyLogs` table with `daily_logs_has_source` check

---

### Atomic Counter / Version Increments via SQL

When incrementing a counter or version column (e.g. `tokenVersion`, `hitCount`, `viewCount`), use a SQL expression instead of a read-then-write pattern. This avoids race conditions where two concurrent requests read the same value and both write `value + 1`, losing one increment.

```typescript
// ❌ BAD: read-then-write race condition
const user = await db.select().from(users).where(eq(users.id, userId));
await db
  .update(users)
  .set({ tokenVersion: user.tokenVersion + 1 })
  .where(eq(users.id, userId));

// ✅ GOOD: atomic SQL increment
import { sql } from "drizzle-orm";

await db
  .update(users)
  .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
  .where(eq(users.id, userId));
```

**When to use:** Any integer column that is incremented from its current value — counters, versions, sequence numbers.

**Why:** Even single-server deployments can have concurrent requests. The SQL approach delegates atomicity to the database, making it correct regardless of concurrency model.

**References:**

- `server/storage/users.ts` — `incrementTokenVersion()`

### Advisory Lock for Per-User Rate Limiting

When a transaction checks a count and then inserts (TOCTOU pattern), two concurrent transactions can both see the same count and both pass the limit check. PostgreSQL's `READ COMMITTED` isolation doesn't prevent this because each transaction sees its own snapshot.

Use `pg_advisory_xact_lock` to serialize concurrent requests per user within the transaction:

```typescript
export async function createChatMessageWithLimitCheck(
  conversationId: number,
  userId: string,
  content: string,
  dailyLimit: number,
  conversationType?: "coach" | "recipe",
): Promise<ChatMessage | null> {
  return db.transaction(async (tx) => {
    // Serialize all generation attempts for this user
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const countResult = await tx
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatMessages.conversationId, chatConversations.id))
      .where(and(
        eq(chatConversations.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfDay),
        lt(chatMessages.createdAt, endOfDay),
      ));

    if (Number(countResult[0]?.count ?? 0) >= dailyLimit) return null;

    // Safe to insert — no other transaction for this user can be between count and insert
    const [message] = await tx.insert(chatMessages).values({ ... }).returning();
    return message;
  });
}
```

The lock is **transaction-scoped** (`pg_advisory_xact_lock`, not `pg_advisory_lock`) — it releases automatically when the transaction commits or rolls back. The `hashtext()` function converts the userId string to an integer lock key.

**When to use:** Any count-then-insert pattern where the count must be accurate under concurrent requests (daily limits, rate limiting, inventory checks).

**Why not just `SERIALIZABLE` isolation?** Serializable would also work but requires retry logic for serialization failures. Advisory locks are simpler — they block rather than abort.

**References:**

- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()`

### JSONB Metadata Versioning

When storing structured data in a JSONB column that may evolve over time, include a `metadataVersion` field and validate with Zod at write time:

```typescript
// Define the schema with a version literal
const recipeChatMetadataSchema = z.object({
  metadataVersion: z.literal(1),
  recipe: z.object({
    title: z.string(),
    ingredients: z.array(z.object({ name: z.string(), quantity: z.string(), unit: z.string() })),
    instructions: z.array(z.string()),
    // ... other fields
  }),
  allergenWarning: z.string().nullable(),
  imageUrl: z.string().nullable(),
  savedRecipeId: z.number().optional(),
});

// Validate at write time — never store unvalidated JSONB
const metadata = { metadataVersion: 1, recipe: validatedRecipe, ... };
await storage.createChatMessage(id, "assistant", content, metadata);

// Validate at read time — use safeParse, not `as` casts
const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);
if (!parsed.success) return null; // Handle legacy/invalid data gracefully
const { recipe } = parsed.data;
```

When the schema evolves, bump the version and add a normalizer:

```typescript
function normalizeRecipeMetadata(raw: unknown): NormalizedRecipe {
  const version = (raw as any)?.metadataVersion ?? 1;
  switch (version) {
    case 1:
      return transformV1(raw);
    case 2:
      return transformV2(raw);
    default:
      throw new Error(`Unknown metadata version: ${version}`);
  }
}
```

**When to use:** Any JSONB column that stores structured data which may change shape over time (chat metadata, cached AI responses, user preferences).

**Why:** JSONB has no schema enforcement at the database level. Without versioning, old rows silently break when code expects new fields.

**References:**

- `server/services/recipe-chat.ts` — `recipeChatMetadataSchema`
- `server/storage/chat.ts` — `saveRecipeFromChat()` uses `safeParse` on metadata

### Type Discriminator Column for Shared Tables

When two features share the same data model (e.g., coach chat and recipe chat both use conversations + messages), add a `type` text column with a default value instead of creating parallel tables:

```typescript
// Schema — add type with a default so existing rows are backward-compatible
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id)
      .notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("coach"), // 'coach' | 'recipe'
    // ...
  },
  (table) => ({
    userTypeIdx: index("chat_conversations_user_type_idx").on(
      table.userId,
      table.type,
    ),
  }),
);

// Storage — filter by type
export async function getChatConversations(
  userId: string,
  limit = 50,
  type?: "coach" | "recipe",
) {
  const conditions = [eq(chatConversations.userId, userId)];
  if (type) conditions.push(eq(chatConversations.type, type));
  return db
    .select()
    .from(chatConversations)
    .where(and(...conditions))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);
}

// Route — dispatch to different services based on type
if (conversation.type === "recipe") {
  // Recipe chat path — different AI service, different context building
} else {
  // Coach chat path — existing behavior
}
```

**When to use:** Two features that share the same entity structure (same columns, same relationships) but have different behavior. Classic examples: chat types, notification types, log categories.

**When NOT to use:** When the data models diverge significantly (different columns, different relationships). In that case, separate tables are cleaner.

**Why:** Avoids duplicating CRUD operations, storage functions, hooks, and route handlers. The shared infrastructure handles the common case; only the behavior-specific logic (AI service, context building) is branched.

**References:**

- `shared/schema.ts` — `chatConversations.type` column
- `server/routes/chat.ts` — type-aware dispatch in message endpoint
- `client/hooks/useChat.ts` — `useChatConversations(type?)` with type in query key
