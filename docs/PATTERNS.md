# Development Patterns

This document captures established patterns for the NutriScan codebase. Follow these patterns for consistency across features.

## Table of Contents

- [Security Patterns](#security-patterns)
- [TypeScript Patterns](#typescript-patterns)
  - [Shared Client API Types](#shared-client-api-types-exception-pattern)
- [API Patterns](#api-patterns)
- [External API Patterns](#external-api-patterns)
- [Database Patterns](#database-patterns)
- [Client State Patterns](#client-state-patterns)
  - [Business Logic Errors in Mutations](#business-logic-errors-in-mutations)
- [React Native Patterns](#react-native-patterns)
  - [Route Params for Mode Toggling](#route-params-for-mode-toggling)
  - [CompositeNavigationProp for Cross-Stack Navigation](#compositenavigationprop-for-cross-stack-navigation)
  - [Coordinated Pull-to-Refresh](#coordinated-pull-to-refresh-for-multiple-queries)
  - [Accessibility Props Pattern](#accessibility-props-pattern)
  - [Touch Target Size Pattern](#touch-target-size-pattern)
  - [Accessibility Grouping Pattern](#accessibility-grouping-pattern)
  - [Dynamic Accessibility Announcements](#dynamic-accessibility-announcements)
  - [useAccessibility Hook Pattern](#useaccessibility-hook-pattern)
  - [Accessibility-Aware Haptics Pattern](#accessibility-aware-haptics-pattern)
  - [Reduced Motion Animation Pattern](#reduced-motion-animation-pattern)
  - [Skeleton Loader Pattern](#skeleton-loader-pattern)
  - [Dynamic Loading State Labels](#dynamic-loading-state-labels)
  - [Query Error Retry Pattern](#query-error-retry-pattern)
- [Animation Patterns](#animation-patterns)
- [Performance Patterns](#performance-patterns)
  - [React.memo for FlatList Header/Footer](#reactmemo-for-flatlist-headerfooter-components)
- [Documentation Patterns](#documentation-patterns)

---

## Security Patterns

### IDOR Protection: Auth + Ownership Check

Always verify both authentication AND resource ownership for single-resource endpoints:

```typescript
// Good: Prevents users from accessing other users' items
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid item ID" });
    }

    const item = await storage.getScannedItem(id);

    if (!item || item.userId !== req.userId) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(item);
  },
);
```

```typescript
// Bad: IDOR vulnerability - any authenticated user can access any item
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const item = await storage.getScannedItem(req.params.id);
    res.json(item); // No ownership check!
  },
);
```

### CORS with Pattern Matching

Use origin pattern matching instead of wildcard `*` for CORS:

```typescript
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^exp:\/\/.+$/,
  /^https:\/\/.+\.loca\.lt$/, // localtunnel
  /^https:\/\/.+\.ngrok\.io$/, // ngrok
];

const publicDomain = process.env.EXPO_PUBLIC_DOMAIN;

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Allow requests with no origin (mobile apps)
  if (publicDomain && origin.includes(publicDomain)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  next();
});
```

**Why:** Prevents malicious domains from making authenticated requests to your API.

### Rate Limiting on Auth Endpoints

Apply aggressive rate limiting to prevent brute force attacks:

```typescript
import rateLimit from "express-rate-limit";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  // Login logic
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  // Register logic
});
```

### Rate Limiting on External API Endpoints

Apply rate limiting to endpoints that call expensive external APIs (OpenAI, payment processors, third-party services):

```typescript
import rateLimit from "express-rate-limit";

const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: "Too many photo uploads. Please wait." },
  keyGenerator: (req) => req.userId || req.ip || "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to endpoints calling external APIs
app.post("/api/photos/analyze", requireAuth, photoRateLimit, upload.single("photo"), ...);
app.post("/api/photos/analyze/:sessionId/followup", requireAuth, photoRateLimit, ...);
```

**Why:** Prevents cost explosion from malicious or accidental overuse of paid APIs.

**Key differences from auth rate limiting:**

| Auth Endpoints              | External API Endpoints          |
| --------------------------- | ------------------------------- |
| Prevent brute force attacks | Prevent cost explosion          |
| Longer windows (15min-1hr)  | Shorter windows (1min)          |
| Tighter limits (5-10 total) | Higher limits per minute        |
| IP-based by default         | User ID-based for authenticated |

### Session Ownership Verification

For in-memory session stores, always include `userId` and verify ownership:

```typescript
interface AnalysisSession {
  userId: string; // Always include owner ID
  result: AnalysisResult;
  createdAt: Date;
}

const sessionStore = new Map<string, AnalysisSession>();

// When creating session:
const sessionId = crypto.randomUUID(); // Use cryptographic randomness
sessionStore.set(sessionId, {
  userId: req.userId!, // Store owner
  result,
  createdAt: new Date(),
});

// When accessing session:
const session = sessionStore.get(sessionId);
if (!session || session.userId !== req.userId!) {
  return res.status(403).json({ error: "Not authorized" });
}
```

**Why:** Prevents users from accessing other users' sessions, even if they guess the session ID.

### Session Timeout Cleanup Pattern

Track timeout references to prevent memory leaks from orphaned timers:

```typescript
const sessionStore = new Map<string, AnalysisSession>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Clear session and its associated timeout.
 * Call this whenever a session is deleted to prevent memory leaks.
 */
function clearSession(sessionId: string): void {
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  sessionStore.delete(sessionId);
}

// When creating session:
const timeoutId = setTimeout(() => {
  sessionStore.delete(sessionId);
  sessionTimeouts.delete(sessionId);
}, SESSION_TIMEOUT);
sessionTimeouts.set(sessionId, timeoutId);

// When session is accessed/confirmed (use clearSession):
clearSession(sessionId);
```

**Why:** Orphaned timeouts consume memory and may reference stale data.

### Multer Error Handler Pattern

Add specific error handling for file upload validation to return 400 (not 500):

```typescript
import multer, { MulterError } from "multer";

// Multer config with fileFilter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
    }
  },
});

// Error handler (add before createServer)
app.use(
  (
    err: Error,
    req: Request,
    res: Response,
    next: (err?: Error) => void,
  ): void => {
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    if (err.message?.includes("Invalid file type")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  },
);
```

**Why:** Without this handler, multer validation errors bubble up as 500 Internal Server Error.

### Input Validation with Zod

Validate ALL user input with Zod schemas before processing:

```typescript
import { z, ZodError } from "zod";

// Define schema
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Validation helper
function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

// Usage in route
app.post("/api/auth/register", async (req, res) => {
  try {
    const validated = registerSchema.parse(req.body);
    // Use validated data...
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: formatZodError(error) });
    }
    res.status(500).json({ error: "Internal error" });
  }
});
```

**Why:** Prevents injection attacks, ensures data integrity, provides clear error messages.

---

## TypeScript Patterns

### Shared Types Location

Place types used by both client and server in `shared/types/`:

```
shared/
  types/
    auth.ts      # Authentication types
    user.ts      # User-related types
    api.ts       # API request/response types
```

### Type Guards for Runtime Validation

Use type guards when validating data from external sources (API responses, JWT payloads, storage):

```typescript
// Define the expected shape
export interface AccessTokenPayload {
  sub: string;
}

// Create a type guard
export function isAccessTokenPayload(
  payload: unknown,
): payload is AccessTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as AccessTokenPayload).sub === "string"
  );
}

// Usage
const payload = jwt.verify(token, secret);
if (!isAccessTokenPayload(payload)) {
  throw new Error("Invalid payload");
}
// payload is now typed as AccessTokenPayload
```

### Type Guard for Enum Validation

When validating against a defined set of values (like subscription tiers), use a type guard that checks the source of truth:

```typescript
// Source of truth: array of valid values
export const subscriptionTiers = ["free", "premium"] as const;
export type SubscriptionTier = (typeof subscriptionTiers)[number];

// Type guard validates against the array
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

// Usage: Safe validation with fallback
const tierValue = user.subscriptionTier || "free";
const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";

// Now tier is properly typed as SubscriptionTier
const features = TIER_FEATURES[tier];
```

**Why:** Validates against the actual source of truth, not a duplicated list. If you add a new tier to `subscriptionTiers`, the type guard automatically accepts it.

**When to use:** Validating enum-like values from database, API responses, or user input against a defined set.

### Union Types for Record Keys

Replace `Record<string, T>` with `Record<UnionType, T>` for compile-time safety:

```typescript
// Good: Compile-time typo prevention
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "athlete";
type PrimaryGoal =
  | "lose_weight"
  | "gain_muscle"
  | "maintain"
  | "eat_healthier"
  | "manage_condition";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

// TypeScript error: "sedantary" is not assignable to type "ActivityLevel"
const multiplier = ACTIVITY_MULTIPLIERS["sedantary"]; // Typo caught!
```

```typescript
// Bad: No compile-time protection
const ACTIVITY_MULTIPLIERS: Record<string, number> = { ... };

// No error - runtime undefined
const multiplier = ACTIVITY_MULTIPLIERS["sedantary"];
```

**Why:** Catches typos at compile time, enables autocomplete, removes need for defensive fallbacks.

**When to use:** Any constant object with a fixed set of keys (config maps, feature flags, tier definitions).

### Zod safeParse with Fallback for Database Values

When reading enum or constrained values from database/storage, use `safeParse()` with a fallback instead of unsafe type assertions:

```typescript
import { z } from "zod";

// Define the schema for valid values
const subscriptionTierSchema = z.enum(["free", "premium", "enterprise"]);
type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

// Good: Safe parsing with fallback
function getSubscriptionTier(dbValue: unknown): SubscriptionTier {
  const result = subscriptionTierSchema.safeParse(dbValue);
  return result.success ? result.data : "free";
}

// Usage in storage layer
async getUser(id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) return null;

  return {
    ...row,
    subscriptionTier: getSubscriptionTier(row.subscriptionTier),
  };
}
```

```typescript
// Bad: Unsafe type assertion
async getUser(id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) return null;

  return {
    ...row,
    // DANGER: If database has invalid value (e.g., "premium_trial"),
    // TypeScript thinks it's valid but runtime behavior is undefined
    subscriptionTier: row.subscriptionTier as SubscriptionTier,
  };
}
```

**Why:** Database values can become invalid due to:

- Schema migrations leaving stale data
- Direct database edits bypassing application logic
- Enum values being removed from code but not cleaned from database

**When to use:**

- Reading enum fields from database
- Parsing stored JSON with expected structure
- Any database field with constrained values (status, role, tier, type)

**Fallback strategy:**

- Use the most restrictive/safe default (e.g., "free" tier, "pending" status)
- Consider logging unexpected values for monitoring
- The application continues working even with corrupted data

### Extend Express Types Properly

When adding properties to Express Request:

```typescript
// In the file where you need it (not a global .d.ts)
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
```

### Inline Response Types

Define API response types inline where they're consumed, not in shared files:

```typescript
// Good: Type defined where used (client/screens/HistoryScreen.tsx)
type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  calories?: string | null;
  imageUrl?: string | null;
  scannedAt: string; // Dates come as strings over JSON
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};

const { data } = useInfiniteQuery<PaginatedResponse>({
  queryKey: ["api", "scanned-items"],
  // ...
});
```

```typescript
// Bad: Shared types in separate file
// shared/types/models.ts
export interface ScannedItemResponse { ... }

// Multiple import locations become tightly coupled
import { ScannedItemResponse } from '@shared/types/models';
```

**When to use shared types:**

- Auth types (User, AuthResponse) - used in multiple places
- Database schema types - shared by ORM
- API response types used by 3+ screens with identical shape (see below)

**When NOT to use shared types:**

- API response shapes used by only 1-2 components
- One-off request/response types

### Shared Client API Types (Exception Pattern)

When the same API response shape is used by multiple screens (3+), create a shared types file to eliminate duplication:

```typescript
// client/types/api.ts - Good: Single source of truth for widely-used types
export type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  calories?: string | null;
  protein?: string | null;
  carbs?: string | null;
  fat?: string | null;
  imageUrl?: string | null;
  scannedAt: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
};

export type DailySummaryResponse = {
  totalCalories: number;
  itemCount: number;
};
```

```typescript
// Usage in multiple screens
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

// HistoryScreen.tsx
const { data } = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({...});

// ItemDetailScreen.tsx
const { data } = useQuery<ScannedItemResponse>({...});
```

**When to use:**

- Same type used in 3+ components
- Type represents a core domain entity (ScannedItem, User, DailySummary)
- Changes to the API shape should update all consumers

**Why generic `PaginatedResponse<T>`:** Enables reuse across different paginated endpoints while maintaining type safety.

---

## API Patterns

### Error Response Structure

All API errors should follow this structure:

```typescript
interface ApiError {
  error: string; // Human-readable message
  code?: string; // Machine-readable code for client logic
  details?: Record<string, string>; // Field-specific errors (validation)
}
```

Example error codes:

- `TOKEN_EXPIRED` - JWT token has expired
- `TOKEN_INVALID` - JWT token is malformed or invalid
- `NO_TOKEN` - No authentication token provided
- `VALIDATION_ERROR` - Request body validation failed
- `NOT_FOUND` - Resource not found
- `CONFLICT` - Resource already exists (e.g., duplicate username)
- `LIMIT_REACHED` - User has reached a resource limit (e.g., max saved items)

### Auth Response Structure

Authentication endpoints return user data plus token:

```typescript
interface AuthResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    dailyCalorieGoal?: number;
    onboardingCompleted?: boolean;
  };
  token: string;
}
```

### Fail-Fast Environment Validation

Validate required environment variables at module load time, not at request time:

```typescript
// Good: Fails immediately on server start
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export function requireAuth(req, res, next) {
  // JWT_SECRET is guaranteed to exist here
  jwt.verify(token, JWT_SECRET);
}
```

```typescript
// Bad: Fails on first request, harder to debug
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }
}
```

### Startup Warning for Optional Environment Variables

For optional env vars with rate-limited fallbacks, log a warning at module load time:

```typescript
// Good: Warn at startup when using rate-limited fallback
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  console.warn(
    "⚠️  USDA_API_KEY not set - using DEMO_KEY with 40 requests/hour limit",
  );
}

async function lookupUSDA(query: string): Promise<NutritionData | null> {
  // Use USDA_API_KEY here - no runtime check needed
}
```

```typescript
// Bad: Silent fallback - production surprises
const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
// No warning - developers don't know they're using a rate-limited key
```

**When to use:**

- External API keys with free tier/demo key fallbacks
- Rate-limited fallback values
- Any optional config where the fallback has significant limitations

**Why:** Silent fallbacks cause unexpected failures in production. A startup warning ensures developers are aware of the limitation.

### Pagination with useInfiniteQuery

Use TanStack Query's `useInfiniteQuery` for paginated lists:

```typescript
const PAGE_SIZE = 50;

async function fetchScannedItems({
  pageParam = 0,
}): Promise<PaginatedResponse> {
  const token = await tokenStorage.get();
  const baseUrl = getApiUrl();
  const url = new URL("/api/scanned-items", baseUrl);
  url.searchParams.set("limit", PAGE_SIZE.toString());
  url.searchParams.set("offset", pageParam.toString());

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return await res.json();
}

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  refetch,
} = useInfiniteQuery<PaginatedResponse>({
  queryKey: ["api", "scanned-items"],
  queryFn: fetchScannedItems,
  getNextPageParam: (lastPage, allPages) => {
    const totalFetched = allPages.reduce(
      (sum, page) => sum + page.items.length,
      0,
    );
    return totalFetched < lastPage.total ? totalFetched : undefined;
  },
  initialPageParam: 0,
});

// Flatten pages for FlatList
const allItems = data?.pages.flatMap((page) => page.items) ?? [];
```

**Server-side:** Validate and cap pagination parameters:

```typescript
app.get("/api/scanned-items", requireAuth, async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit as string) || 50, 1),
    100, // Maximum 100 items per page
  );
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const result = await storage.getScannedItems(req.userId!, limit, offset);
  res.json(result);
});
```

---

## External API Patterns

### Per-Field Fallback for Partial Data

When consuming external APIs that may return partial data, use nullish coalescing (`??`) per-field rather than all-or-nothing fallback:

```typescript
// Good: Each field falls back independently
const nutriments = apiResponse.nutriments || {};

setNutrition({
  calories: nutriments["energy-kcal_serving"] ?? nutriments["energy-kcal_100g"],
  protein: nutriments.proteins_serving ?? nutriments.proteins_100g,
  carbs: nutriments.carbohydrates_serving ?? nutriments.carbohydrates_100g,
  fat: nutriments.fat_serving ?? nutriments.fat_100g,
  fiber: nutriments.fiber_serving ?? nutriments.fiber_100g,
});
```

```typescript
// Bad: All-or-nothing fallback loses partial data
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;

setNutrition({
  calories: hasServingData
    ? nutriments["energy-kcal_serving"]
    : nutriments["energy-kcal_100g"],
  protein: hasServingData
    ? nutriments.proteins_serving // Could be undefined even when hasServingData is true!
    : nutriments.proteins_100g,
  // ...
});
```

**When to use:** External APIs (OpenFoodFacts, nutrition databases, third-party services) where different fields may have different data availability.

**Why:** External APIs often have inconsistent data coverage. A product might have per-serving calories but only per-100g fiber data. Per-field fallback ensures you get the best available data for each field.

### Indicate Data Source to Users

When falling back to different data formats, inform users what they're seeing:

```typescript
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;
setIsPer100g(!hasServingData);

// In UI:
<ThemedText>
  Calories{isPer100g ? " (per 100g)" : ""}
</ThemedText>

{isPer100g && (
  <InfoMessage>
    Values shown per 100g. Check package for actual serving size.
  </InfoMessage>
)}
```

**Why:** Prevents user confusion when displayed values don't match package labels.

---

## Database Patterns

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

---

## Client State Patterns

### In-Memory Caching for Frequent Reads

When a value is read frequently but changes rarely, cache in memory with lazy initialization:

```typescript
let cachedValue: string | null = null;
let cacheInitialized = false;

export const storage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      try {
        cachedValue = await AsyncStorage.getItem(KEY);
      } catch (error) {
        console.error("Storage read failed:", error);
        cachedValue = null;
      }
      cacheInitialized = true;
    }
    return cachedValue;
  },

  async set(value: string): Promise<void> {
    cachedValue = value;
    cacheInitialized = true;
    await AsyncStorage.setItem(KEY, value);
  },

  async clear(): Promise<void> {
    cachedValue = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(KEY);
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedValue = null;
  },
};
```

**When to use:** Token storage, user preferences, feature flags.

**When NOT to use:** Data that changes frequently or needs real-time accuracy.

### Authorization Header Pattern

Include auth token via Authorization header, not cookies:

```typescript
const token = await tokenStorage.get();

const headers: HeadersInit = {};
if (data) {
  headers["Content-Type"] = "application/json";
}
if (token) {
  headers["Authorization"] = `Bearer ${token}`;
}

const response = await fetch(url, { method, headers, body });
```

**Why:** React Native/Expo Go does not reliably persist HTTP cookies. Authorization headers work consistently across all platforms.

### Handle 401 Globally

Clear auth state on any 401 response:

```typescript
if (response.status === 401) {
  await tokenStorage.clear();
  // Trigger re-authentication flow
}
```

### Business Logic Errors in Mutations

When an API returns a business logic error (like `LIMIT_REACHED`) that should not trigger error states, use custom fetch logic in the mutation to return a discriminated union instead of throwing:

```typescript
// Good: Return discriminated union for business logic errors
export function useCreateSavedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: CreateSavedItemInput) => {
      const baseUrl = getApiUrl();
      const token = await tokenStorage.get();

      const response = await fetch(`${baseUrl}/api/saved-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(item),
      });

      // Handle business logic error (403 with specific code)
      if (response.status === 403) {
        const data = await response.json();
        if (data.error === "LIMIT_REACHED") {
          return { limitReached: true as const };
        }
        throw new Error(data.message || "Forbidden");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      const savedItem = (await response.json()) as SavedItem;
      return { limitReached: false as const, item: savedItem };
    },
    onSuccess: (data) => {
      // Only invalidate cache if operation succeeded
      if (!data.limitReached) {
        queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
      }
    },
  });
}

// Usage in component
const createMutation = useCreateSavedItem();

const handleSave = async () => {
  const result = await createMutation.mutateAsync(item);

  if (result.limitReached) {
    // Show upgrade prompt or limit warning
    setShowLimitReachedModal(true);
  } else {
    // Success path
    haptics.notification(NotificationFeedbackType.Success);
  }
};
```

```typescript
// Bad: Using apiRequest which throws on all non-2xx responses
export function useCreateSavedItem() {
  return useMutation({
    mutationFn: async (item: CreateSavedItemInput) => {
      // apiRequest throws on 403, triggering error state
      return await apiRequest<SavedItem>("POST", "/api/saved-items", item);
    },
    onError: (error) => {
      // Can't distinguish LIMIT_REACHED from other 403 errors
      // Must parse error message string - fragile!
    },
  });
}
```

**When to use:**

- Resource limits (max items, storage quota)
- Soft validation failures (duplicate name, conflicting schedule)
- Any 4xx error that represents a recoverable business condition

**When NOT to use:**

- Authentication errors (401) - use global handler
- Server errors (5xx) - let TanStack Query handle retry/error state
- Validation errors on form fields - use form validation library

**Why discriminated union:** TypeScript can narrow `result` based on `limitReached`, ensuring you handle both cases. The `as const` assertion makes the literal type precise.

---

## React Native Patterns

### Conditional Pressable Rendering

When building reusable wrapper components that may or may not be interactive, conditionally render as `View` or `Pressable` based on whether `onPress` is provided:

```typescript
// Good: Renders as View when not interactive
export function Card({ children, onPress, style }: CardProps) {
  const content = <>{children}</>;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.card, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{content}</View>;
}

// Usage - Card passes through touch events to parent
<Pressable onPress={handleNavigate}>
  <Card>  {/* Renders as View, doesn't block touches */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

```typescript
// Bad: Always renders as Pressable
export function Card({ children, onPress, style }: CardProps) {
  return (
    <Pressable onPress={onPress} style={[styles.card, style]}>
      {children}
    </Pressable>
  );
}

// Problem - nested Pressables block touch events
<Pressable onPress={handleNavigate}>  {/* This onPress never fires! */}
  <Card>  {/* Inner Pressable captures and swallows the touch */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

**Why:** In React Native, nested `Pressable` components cause the inner one to capture touch events. If the inner `Pressable` has no `onPress` handler, the touch is swallowed and the parent never receives it.

**When to use:** Any reusable component (Card, ListItem, Container) that wraps content and may optionally be tappable.

### Route Params for Mode Toggling

Use route params to toggle between screen modes instead of creating separate screens:

```typescript
// Good: Single screen with mode param (HistoryScreen.tsx)
type HistoryScreenRouteProp = RouteProp<
  { History: { showAll?: boolean } },
  "History"
>;

export default function HistoryScreen() {
  const route = useRoute<HistoryScreenRouteProp>();
  const showAll = route.params?.showAll ?? false;

  // Conditional rendering based on mode
  if (showAll) {
    return <FullHistoryView onBack={() => navigation.setParams({ showAll: false })} />;
  }

  return <DashboardView onViewAll={() => navigation.setParams({ showAll: true })} />;
}
```

```typescript
// Bad: Separate screens for each mode
// HistoryDashboardScreen.tsx
// FullHistoryScreen.tsx
// Duplicates shared logic, state management, and navigation setup
```

**When to use:**

- Dashboard + expanded view (Today dashboard vs full history)
- List view + detail view in same context
- Compact + expanded modes of same data

**Benefits:**

- Shared state and queries (no refetch when switching modes)
- Cleaner navigation stack (back button works naturally)
- Single source of truth for the data

### CompositeNavigationProp for Cross-Stack Navigation

When navigating from one tab stack to a screen in another tab stack, use `CompositeNavigationProp`:

```typescript
import {
  CompositeNavigationProp,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Define the composite type for cross-tab navigation
type HistoryScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;

export default function HistoryScreen() {
  const navigation = useNavigation<HistoryScreenNavigationProp>();

  const handleScanPress = () => {
    // Navigate to ScanTab (different tab stack)
    navigation.navigate("ScanTab");
  };

  const handleItemPress = (itemId: number) => {
    // Navigate within current stack
    navigation.navigate("ItemDetail", { itemId });
  };
}
```

**When to use:**

- Dashboard with "Scan" CTA that navigates to camera tab
- Profile screen navigating to history or settings in other tabs
- Any cross-tab navigation from within a stack

**Why:** Standard `NativeStackNavigationProp` only knows about screens in its own stack. `CompositeNavigationProp` combines the stack navigator's type with the tab navigator's type, enabling type-safe navigation across both.

### Coordinated Pull-to-Refresh for Multiple Queries

When a screen fetches data from multiple endpoints, coordinate refresh with `Promise.all`:

```typescript
const {
  data: summaryData,
  refetch: refetchSummary,
} = useQuery<DailySummaryResponse>({
  queryKey: ["/api/daily-summary"],
});

const {
  data: itemsData,
  refetch: refetchItems,
} = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({
  queryKey: ["/api/scanned-items"],
});

const [refreshing, setRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // Refresh all queries in parallel
    await Promise.all([refetchSummary(), refetchItems()]);
  } finally {
    setRefreshing(false);
  }
}, [refetchSummary, refetchItems]);

return (
  <FlatList
    refreshing={refreshing}
    onRefresh={handleRefresh}
    // ...
  />
);
```

**When to use:**

- Dashboard screens with stats + list data
- Profile screens with user info + activity data
- Any screen combining data from multiple API calls

**Why:** Individual `refetch()` calls would cause jarring partial updates. Coordinated refresh ensures the UI updates atomically when all data is ready.

### Safe Area Handling

Always use `useSafeAreaInsets()` for screen layouts:

```typescript
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      }}
    >
      {/* Content */}
    </ScrollView>
  );
}
```

**Why:** Handles iOS notch, Dynamic Island, and home indicator. Adding theme spacing (`Spacing.lg`, `Spacing.xl`) provides visual breathing room beyond the safe area.

### useRef for Synchronous Checks in Callbacks

When a callback needs to check mutable state synchronously (e.g., debouncing, rate limiting), use `useRef` instead of state. State values captured in closures become stale:

```typescript
// Good: useRef for synchronous checks
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    // Use ref for synchronous check - always has current value
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    // Process barcode...

    // Debounce: reset after delay
    debounceTimeoutRef.current = setTimeout(() => {
      isScanningRef.current = false;
      setIsScanning(false);
    }, 2000);
  }, []); // Empty deps - refs don't need to be dependencies

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return { isScanning, handleBarcodeScanned };
}
```

```typescript
// Bad: State check in callback - always stale!
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);

  const handleBarcodeScanned = useCallback(
    (barcode: string) => {
      // BUG: isScanning is captured at callback creation time
      // It will always be the initial value (false)
      if (isScanning) return; // This never blocks!

      setIsScanning(true);
      // Process barcode... but rapid scans all get through
    },
    [isScanning],
  ); // Adding dependency recreates callback but doesn't fix the issue
}
```

**Why this happens:** `useCallback` creates a closure that captures state values at creation time. Even with dependencies, the check happens against a potentially outdated snapshot.

**When to use:**

- Debouncing rapid events (barcode scans, button clicks)
- Rate limiting (API calls, animations)
- Any callback that needs to check "am I already processing?"

**Pattern:** Keep both `useState` (for UI rendering) and `useRef` (for synchronous logic) when you need both reactive UI updates and reliable synchronous checks.

---

### Haptic Feedback on User Actions

Provide haptic feedback for meaningful interactions:

```typescript
import * as Haptics from "expo-haptics";

// Light impact for navigation/selection
const handleItemPress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  navigation.navigate("Detail");
};

// Success notification for completed actions
const handleSave = async () => {
  await saveData();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

// Error notification for failures
const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
```

**When to use:** Navigation, successful saves, errors, toggle switches, barcode scan success.

**When NOT to use:** Every tap, scrolling, or high-frequency interactions.

### Accessibility Props Pattern

Provide semantic accessibility information for screen readers (VoiceOver on iOS, TalkBack on Android). This is essential for WCAG 2.1 Level AA compliance.

#### Core Accessibility Props

```typescript
// accessibilityLabel: Descriptive text read by screen readers
// accessibilityRole: Semantic role (button, checkbox, radio, text, header, etc.)
// accessibilityState: Current state (selected, checked, disabled, expanded)
// accessibilityHint: Optional hint about what happens when activated

<Pressable
  accessibilityLabel="Add to favorites"
  accessibilityRole="button"
  accessibilityHint="Saves this item to your favorites list"
  onPress={handleAddToFavorites}
>
  <Feather name="heart" size={24} />
</Pressable>
```

#### Checkbox Pattern (Multi-Select Lists)

Use for lists where users can select multiple items (allergies, health conditions):

```typescript
// Good: Combines title and description for context
<Pressable
  onPress={() => toggleSelection(item.id)}
  accessibilityLabel={`${item.name}: ${item.description}`}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedIds.includes(item.id) }}
>
  <Text>{item.name}</Text>
  <Text>{item.description}</Text>
  <Feather name={isSelected ? "check-square" : "square"} />
</Pressable>
```

**Why combine title and description:** Screen reader users hear the full context in one announcement, rather than having to navigate to separate elements.

#### Radio Pattern (Single-Select Lists)

Use for lists where users select exactly one option (diet type, goals):

```typescript
// Good: Uses radio role with selected state
<Pressable
  onPress={() => setSelectedOption(option.id)}
  accessibilityLabel={`${option.name}: ${option.description}`}
  accessibilityRole="radio"
  accessibilityState={{ selected: selectedOption === option.id }}
>
  <Text>{option.name}</Text>
  <Text>{option.description}</Text>
  <View style={[styles.radioOuter, isSelected && styles.radioSelected]}>
    {isSelected && <View style={styles.radioInner} />}
  </View>
</Pressable>
```

**Difference from checkbox:** Use `accessibilityRole="radio"` with `selected` state (not `checked`). This tells screen readers the selection is mutually exclusive.

#### Icon-Only Button Pattern

Icon buttons without visible text MUST have an `accessibilityLabel`:

```typescript
// Good: Descriptive label for icon button
<Pressable
  onPress={() => navigation.goBack()}
  accessibilityLabel="Go back"
  accessibilityRole="button"
>
  <Feather name="arrow-left" size={24} color={colors.text} />
</Pressable>

// Good: Toggle button with state-aware label
<Pressable
  onPress={() => setTorch(!torch)}
  accessibilityLabel={torch ? "Turn off flashlight" : "Turn on flashlight"}
  accessibilityRole="button"
  accessibilityState={{ checked: torch }}
>
  <Feather name={torch ? "zap" : "zap-off"} size={24} />
</Pressable>
```

**Why state-aware labels:** Users know both the current state AND what will happen when they activate the button.

#### Password Visibility Toggle Pattern

```typescript
<Pressable
  onPress={() => setShowPassword(!showPassword)}
  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
  accessibilityRole="button"
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
>
  <Feather name={showPassword ? "eye-off" : "eye"} size={20} />
</Pressable>
```

#### Text Input Pattern

```typescript
<TextInput
  value={username}
  onChangeText={setUsername}
  placeholder="Username"
  accessibilityLabel="Username"
  accessibilityHint="Enter your username to sign in"
  autoCapitalize="none"
  autoCorrect={false}
/>
```

**When to add `accessibilityHint`:** When the purpose isn't obvious from the label alone, or when there are specific requirements (format, length, etc.).

#### List Item Navigation Pattern

For items that navigate to detail screens:

```typescript
// Good: Comprehensive label with action hint
const HistoryItem = React.memo(function HistoryItem({
  item,
  onPress,
}: HistoryItemProps) {
  const calorieText = item.calories ? `${item.calories} calories` : "Calories unknown";

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
      accessibilityRole="button"
    >
      <Text>{item.productName}</Text>
      <Text>{item.brandName}</Text>
      <Text>{item.calories} cal</Text>
    </Pressable>
  );
});
```

**Why include "Tap to view details":** Informs users that activation will navigate somewhere, not perform an immediate action.

### Touch Target Size Pattern

Ensure interactive elements meet the minimum touch target size of 44x44 points (WCAG 2.1 Level AA requirement):

```typescript
// Good: Element meets minimum size naturally
<Pressable
  style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
  onPress={handlePress}
>
  <Feather name="settings" size={24} />
</Pressable>

// Good: Small visual element with expanded touch area using hitSlop
<Pressable
  onPress={handlePress}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  accessibilityLabel="Show password"
>
  <Feather name="eye" size={20} />
</Pressable>
```

**When to use `hitSlop`:**

- Icon buttons smaller than 44pt
- Inline interactive elements (password toggle inside input)
- Dense UIs where visual spacing is constrained

**Calculating hitSlop:** If your touchable is 24pt, add hitSlop of 10pt on each side to reach 44pt total: `(24 + 10 + 10) = 44pt`.

### Accessibility Grouping Pattern

Group related elements so screen readers announce them together:

```typescript
// Good: Card announced as single unit
<View
  accessible={true}
  accessibilityLabel={`${productName}, ${brandName}, ${calories} calories. Scanned ${relativeTime}`}
>
  <Text>{productName}</Text>
  <Text>{brandName}</Text>
  <Text>{calories} cal</Text>
  <Text>{relativeTime}</Text>
</View>
```

**When to use `accessible={true}`:**

- Cards or list items with multiple text elements
- Complex components that should be announced as one unit
- When navigating element-by-element would be tedious

**When NOT to use:** When child elements are independently interactive (buttons, links within the group).

### Radio/Checkbox Group Container Pattern

When rendering lists of radio buttons or checkboxes, wrap them in a container with the appropriate group role:

```typescript
// Good: Radio group with accessibilityRole
<View accessibilityRole="radiogroup">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => setSelected(option.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === option.id }}
    >
      {/* Radio button content */}
    </Pressable>
  ))}
</View>

// Good: Checkbox group (no special container role needed, but can use "list")
<View accessibilityRole="list">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => toggleOption(option.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selectedIds.includes(option.id) }}
    >
      {/* Checkbox content */}
    </Pressable>
  ))}
</View>
```

**Why:** Screen readers use the `radiogroup` role to understand that only one option can be selected. This provides proper context and navigation behavior for assistive technology users.

**When to use:**

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

### Dynamic Accessibility Announcements

Announce important state changes that aren't reflected in focus:

```typescript
import { AccessibilityInfo } from "react-native";

// Announce scan success
const handleBarcodeScanned = async (barcode: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility("Barcode scanned successfully");
  // Process barcode...
};

// Announce errors
const handleError = (message: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility(`Error: ${message}`);
};
```

**When to use:**

- Success/error states after async operations
- Content updates not caused by user navigation
- Timer-based notifications

### useAccessibility Hook Pattern

Centralize accessibility detection with a custom hook that provides reduced motion and screen reader status:

```typescript
// client/hooks/useAccessibility.ts
import { useReducedMotion } from "react-native-reanimated";
import { AccessibilityInfo } from "react-native";
import { useState, useEffect } from "react";

export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return {
    reducedMotion: reducedMotion ?? false,
    screenReaderEnabled,
  };
}
```

**Why:** Provides a single source of truth for accessibility settings across the app.

**When to use:**

- Components with animations that should respect reduced motion
- Features that behave differently with screen readers
- Any component needing accessibility context

### Accessibility-Aware Haptics Pattern

Wrap haptic feedback to automatically disable when reduced motion is preferred:

```typescript
// client/hooks/useHaptics.ts
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { useAccessibility } from "./useAccessibility";

export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (
      style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
    ) => {
      if (!reducedMotion) {
        Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) {
        Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (!reducedMotion) {
      Haptics.selectionAsync();
    }
  }, [reducedMotion]);

  return { impact, notification, selection, disabled: reducedMotion };
}
```

**Usage:**

```typescript
const haptics = useHaptics();

const handlePress = () => {
  haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  // ... action
};
```

**Why:** Users who enable reduced motion often want reduced sensory feedback overall. This respects that preference while keeping haptic code unchanged.

### Reduced Motion Animation Pattern

Skip or simplify animations when the user has reduced motion enabled:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";
import Animated, { FadeInDown } from "react-native-reanimated";

function ListItem({ item, index }: { item: Item; index: number }) {
  const { reducedMotion } = useAccessibility();

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      {/* content */}
    </Animated.View>
  );
}
```

**For press animations:**

```typescript
const handlePressIn = () => {
  if (!reducedMotion) {
    scale.value = withSpring(0.98, pressSpringConfig);
  }
};

const handlePressOut = () => {
  if (!reducedMotion) {
    scale.value = withSpring(1, pressSpringConfig);
  }
};
```

**Why:** WCAG 2.1 requires respecting the "prefers-reduced-motion" setting. This prevents motion sickness and cognitive overload for users who need it.

**For continuous/looping animations:**

Animations that run indefinitely (pulse, shimmer, breathing effects) need a different approach - set a static fallback value instead:

```typescript
const cornerOpacity = useSharedValue(0.6);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cornerOpacity.value = 0.8; // Static fallback value
    return; // Skip animation setup entirely
  }

  // Only start continuous animation if reduced motion is disabled
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1, // Infinite repeat
    true, // Reverse direction
  );
}, [reducedMotion]); // Re-run if preference changes
```

**Key differences from entrance/press animations:**

| Animation Type              | Reduced Motion Approach         |
| --------------------------- | ------------------------------- |
| Entrance (`entering` prop)  | Set to `undefined`              |
| Press (scale on tap)        | Skip `withSpring` call          |
| Continuous (pulse, shimmer) | Set static value + early return |

**When to use:** Pulse effects, shimmer loaders, breathing animations, any `withRepeat` with `-1` (infinite).

### Skeleton Loader Pattern

Create reusable skeleton components with shimmer animation and reduced motion support:

```typescript
// client/components/SkeletonLoader.tsx
export function SkeletonBox({ width, height, borderRadius, style }: SkeletonBoxProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      shimmerValue.value = 0.5; // Static opacity for reduced motion
      return;
    }

    shimmerValue.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false,
    );

    return () => cancelAnimation(shimmerValue);
  }, [reducedMotion]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmerValue.value, [0, 0.5, 1], [0.3, 0.7, 0.3]),
  }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: theme.backgroundSecondary }, shimmerStyle, style]}
    />
  );
}
```

**Hide skeletons from screen readers:**

```typescript
<FlatList
  ListEmptyComponent={
    isLoading ? (
      <View accessibilityElementsHidden>
        <SkeletonList count={5} />
      </View>
    ) : (
      <EmptyState />
    )
  }
/>
```

**Why:** Screen readers shouldn't announce loading placeholders. `accessibilityElementsHidden` hides the entire subtree from assistive technologies.

### Dynamic Loading State Labels

Update `accessibilityLabel` to reflect loading state for buttons and actions:

```typescript
<Button
  onPress={handleSubmit}
  disabled={isLoading}
  accessibilityLabel={
    isLoading
      ? mode === "login" ? "Signing in" : "Creating account"
      : mode === "login" ? "Sign In" : "Create Account"
  }
>
  {isLoading ? <ActivityIndicator /> : mode === "login" ? "Sign In" : "Create Account"}
</Button>
```

**For loading indicators:**

```typescript
function LoadingFooter() {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading more items"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}
```

**Why:** Screen reader users need to know when an action is in progress. `accessibilityLiveRegion="polite"` announces the content when it appears without interrupting current speech.

### Query Error Retry Pattern

Provide retry functionality for failed data fetching with accessible controls:

```typescript
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ["/api/dietary-profile"],
  // ...
});

// In error UI
{isError && (
  <View style={styles.errorContainer}>
    <ThemedText>Failed to load preferences</ThemedText>
    <Pressable
      onPress={() => refetch()}
      accessibilityLabel="Retry loading dietary preferences"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.retryButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="refresh-cw" size={14} />
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
)}
```

**Why:** Users should always have a way to recover from transient errors without navigating away. The retry button provides an immediate action rather than requiring a pull-to-refresh or screen reload.

---

## Animation Patterns

### Shared Animation Configuration

Define animation configs in a central location for consistency:

```typescript
// client/constants/animations.ts
import { WithSpringConfig } from "react-native-reanimated";

export const pressSpringConfig: WithSpringConfig = {
  damping: 15,
  stiffness: 150,
};

export const entranceSpringConfig: WithSpringConfig = {
  damping: 20,
  stiffness: 200,
};
```

**Usage:**

```typescript
import { pressSpringConfig } from "@/constants/animations";

const handlePressIn = () => {
  scale.value = withSpring(0.98, pressSpringConfig);
};
```

**Why:** Consistent animation feel across the app. Changing spring parameters in one place updates all press animations.

---

## Performance Patterns

### Memoize FlatList Components

Use `React.memo` and `useCallback` to prevent unnecessary re-renders in lists:

```typescript
// Memoized list item component
const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  onPress,
}: {
  item: ScannedItemResponse;
  index: number;
  onPress: (item: ScannedItemResponse) => void;
}) {
  // Component implementation
});

// Parent component
export default function HistoryScreen() {
  const navigation = useNavigation();

  // Memoize handler to prevent recreating on every render
  const handleItemPress = useCallback(
    (item: ScannedItemResponse) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("ItemDetail", { itemId: item.id });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ScannedItemResponse; index: number }) => (
      <HistoryItem item={item} index={index} onPress={handleItemPress} />
    ),
    [handleItemPress]
  );

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id.toString()}
    />
  );
}
```

**Why:** FlatList re-renders items when renderItem function changes. Memoization ensures renders only happen when data changes.

### React.memo for FlatList Header/Footer Components

Extract `ListHeaderComponent` and `ListFooterComponent` as `React.memo` components with typed props instead of inline functions or `useCallback`:

```typescript
// Good: Extract as React.memo with typed props
type DashboardHeaderProps = {
  userName: string;
  currentCalories: number;
  calorieGoal: number;
  onScanPress: () => void;
};

const DashboardHeader = React.memo(function DashboardHeader({
  userName,
  currentCalories,
  calorieGoal,
  onScanPress,
}: DashboardHeaderProps) {
  const { theme } = useTheme();

  return (
    <View>
      <ThemedText>Hello, {userName}</ThemedText>
      <CalorieProgress current={currentCalories} goal={calorieGoal} />
      <Pressable onPress={onScanPress}>
        <ThemedText>Scan Food</ThemedText>
      </Pressable>
    </View>
  );
});

// Usage in parent
<FlatList
  ListHeaderComponent={
    <DashboardHeader
      userName={user?.username ?? ""}
      currentCalories={summary?.totalCalories ?? 0}
      calorieGoal={user?.dailyCalorieGoal ?? 2000}
      onScanPress={handleScanPress}
    />
  }
/>
```

```typescript
// Bad: useCallback for complex header components
const ListHeader = useCallback(() => (
  <View>
    {/* Complex JSX with multiple hooks, theme access, etc. */}
  </View>
), [/* many dependencies */]);

// Bad: Inline function (re-creates on every render)
<FlatList
  ListHeaderComponent={() => <ComplexHeader />}
/>
```

**When to use:**

- Headers/footers with their own hooks (`useTheme`, `useAccessibility`)
- Components with 3+ props from parent state
- Headers/footers with interactive elements (buttons, links)

**Why:**

- `React.memo` prevents re-renders when props are unchanged
- Typed props interface documents the component's data requirements
- Named function provides better stack traces and React DevTools identification
- Cleaner than `useCallback` with many dependencies

### Cleanup Side Effects in useEffect

Always clean up timeouts, intervals, and subscriptions:

```typescript
// Good: Cleanup prevents memory leaks
useEffect(() => {
  const timer = setTimeout(() => {
    setShowSomething(true);
  }, 2000);

  return () => clearTimeout(timer);
}, []);
```

```typescript
// Bad: Timer continues after component unmounts
useEffect(() => {
  setTimeout(() => {
    setShowSomething(true); // Error if component unmounted
  }, 2000);
}, []);
```

### Avoid Storage Reads in Hot Paths

AsyncStorage operations take 2-10ms. For values read on every API request, use in-memory caching (see above).

### Batch Related Storage Operations

When storing multiple related values, use multiSet/multiRemove:

```typescript
// Good: Single storage operation
await AsyncStorage.multiSet([
  [USER_KEY, JSON.stringify(user)],
  [TOKEN_KEY, token],
]);

// Bad: Multiple operations
await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
await AsyncStorage.setItem(TOKEN_KEY, token);
```

---

## Documentation Patterns

### Todo Structure

All todos in `todos/` follow the template in `todos/TEMPLATE.md`:

```yaml
---
title: "Brief descriptive title"
status: backlog | planned | in-progress | blocked | review | done
priority: critical | high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
---
```

### Design Decisions Table

Document key architectural choices with rationale:

```markdown
## Design Decisions

| Decision     | Choice              | Rationale                   |
| ------------ | ------------------- | --------------------------- |
| Token type   | Single access token | No refresh token complexity |
| Token expiry | 30 days             | Balances security with UX   |
```

### Files to Modify Table

List all files affected by a change:

```markdown
## Files to Modify

| File                   | Action                      |
| ---------------------- | --------------------------- |
| `shared/types/auth.ts` | Create - type definitions   |
| `server/routes.ts`     | Modify - use new middleware |
```

### Implementation Patterns in Todos

Include copy-paste ready code examples in todos for complex changes. This ensures:

- Consistent implementation
- Faster development
- Built-in code review

---

## Adding New Patterns

When you establish a new pattern:

1. Use it in your implementation
2. Document it here with:
   - What the pattern is
   - When to use it
   - When NOT to use it
   - Code example
3. Reference this doc in your todo/PR
