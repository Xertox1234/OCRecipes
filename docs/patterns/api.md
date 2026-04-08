# API Patterns

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
- `PREMIUM_REQUIRED` - Feature requires a premium subscription
- `DAILY_LIMIT_REACHED` - User has exhausted a daily usage quota
- `DATE_RANGE_LIMIT` - Requested date range exceeds tier allowance
- `LIST_LIMIT_REACHED` - Per-user resource count ceiling hit (e.g., max grocery lists)

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

### Stub Service with Production Safety Gate

When integrating third-party services that require credentials not available in development (app store APIs, payment processors, push notification services), create a stub that auto-approves in dev but rejects in production. Use a **three-layer defense**: explicit opt-in env var + credential absence + NODE_ENV check.

```typescript
// server/services/receipt-validation.ts

const HAS_APPLE_CREDENTIALS = !!(
  process.env.APPLE_ISSUER_ID &&
  process.env.APPLE_KEY_ID &&
  process.env.APPLE_PRIVATE_KEY
);

const HAS_GOOGLE_CREDENTIALS = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY
);

/**
 * Layer 1: Explicit opt-in via RECEIPT_VALIDATION_STUB=true
 * Layer 2: No platform credentials configured
 * Layer 3: NODE_ENV check inside the handler (reject in production)
 */
const STUB_MODE =
  process.env.RECEIPT_VALIDATION_STUB === "true" &&
  !HAS_APPLE_CREDENTIALS &&
  !HAS_GOOGLE_CREDENTIALS;

export async function validateReceipt(
  receipt: string,
  platform: Platform,
): Promise<ReceiptValidationResult> {
  if (STUB_MODE) {
    // Layer 3: Even if STUB_MODE, reject in production
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Receipt validation is stubbed in production — rejecting. " +
          "Configure Apple/Google credentials to enable.",
      );
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation is stubbed — auto-approving in dev.");
    return { valid: true, expiresAt: oneYearFromNow() };
  }

  // Real implementation when credentials are available
  return platform === "ios"
    ? validateAppleReceipt(receipt)
    : validateGoogleReceipt(receipt);
}
```

```typescript
// Bad: Auto-activates from credential absence — silent auto-approve in dev
const STUB_MODE = !process.env.APPLE_SHARED_SECRET;

// Bad: Boolean flag with no production protection
const USE_STUB = true; // Developer forgets to change before deploy
export async function validateReceipt(...) {
  if (USE_STUB) return { valid: true }; // Auto-approves in production!
}
```

**Key elements:**

1. **Require explicit opt-in** (`RECEIPT_VALIDATION_STUB=true`), not just credential absence — prevents accidental auto-approve when credentials are simply missing
2. **Three-layer defense**: explicit env var + credential absence + production NODE_ENV rejection
3. **Log loudly**: `console.error` in production, `console.warn` in dev
4. **Return failure, not success** when stubbed in production

**When to use:**

- Payment/receipt validation (App Store, Google Play)
- Push notification services (APNs, FCM)
- SMS/email verification services
- Any third-party service requiring production-only credentials

**Reference:** `server/services/receipt-validation.ts`

### Tier-Gated Route Guards

When a route's behavior varies by subscription tier (premium-only access, different limits for free vs premium), check `TIER_FEATURES[tier]` early in the handler and return a typed error code:

```typescript
// Premium-only feature gate
const subscription = await storage.getSubscriptionStatus(req.userId!);
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier];

if (!features.aiMealSuggestions) {
  res.status(403).json({
    error: "AI meal suggestions require a premium subscription",
    code: "PREMIUM_REQUIRED",
  });
  return;
}

// Tier-dependent limit gate
const dailyCount = await storage.getDailyMealSuggestionCount(
  req.userId!,
  new Date(),
);
if (dailyCount >= features.dailyAiSuggestions) {
  res.status(429).json({
    error: "Daily AI suggestion limit reached",
    code: "DAILY_LIMIT_REACHED",
    remainingToday: 0,
  });
  return;
}

// Tier-dependent parameter constraint
const maxDays = features.extendedPlanRange ? 90 : 7;
if (daysDiff > maxDays) {
  res.status(403).json({
    error: `Date range limited to ${maxDays} days on ${tier} plan`,
    code: "DATE_RANGE_LIMIT",
  });
  return;
}
```

**Key elements:**

1. **Fail-fast order**: validation -> auth -> tier gate -> business logic. Tier checks go after auth but before expensive operations
2. **Return typed `code`** strings that the client `ApiError` class can match on (see Client State Patterns > Typed ApiError Class)
3. **Use 403 for feature locks**, 429 for usage limits, 400 for hard resource ceilings
4. **Default to `"free"`** when subscription data is missing — never grant premium by default
5. **All numeric limits must come from `TIER_FEATURES`** — never hardcode a number (like `6` for max saved items). Hardcoded values silently drift from the config when tier limits change. The flow is: add to `PremiumFeatures` interface -> set in `TIER_FEATURES` per tier -> read via `features.X` at the call site

**When to use:**

- Premium-only features (AI suggestions, extended date ranges)
- Tiered usage limits (daily quotas, resource counts)
- Any route where free and premium users have different capabilities

**When NOT to use:**

- Auth-only gates (use `requireAuth` middleware)
- Rate limiting for abuse prevention (use `express-rate-limit` middleware)

**References:**

- `server/routes.ts` — meal suggestion, grocery list creation routes
- `shared/types/premium.ts` — `TIER_FEATURES` config object, `PremiumFeatures` interface
- Client-side: see "Typed ApiError Class" and "Premium Feature Gating UI" patterns

### checkPremiumFeature Helper for Tier Gates

When multiple routes need the same premium-gating logic (fetch subscription, resolve tier, check feature flag, send 403), extract a shared `checkPremiumFeature()` helper instead of duplicating the block in every handler. The helper returns the full `PremiumFeatures` object on success (so the caller can check additional tier-dependent limits) or sends a 403 and returns `null` on failure.

```typescript
/**
 * Check if the user has a premium feature. Returns the features object if granted,
 * or sends a 403 response and returns null if not.
 */
async function checkPremiumFeature(
  req: Request,
  res: Response,
  featureKey: keyof PremiumFeatures,
  featureLabel: string,
): Promise<PremiumFeatures | null> {
  const subscription = await storage.getSubscriptionStatus(req.userId!);
  const tier = subscription?.tier || "free";
  const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
  if (!features[featureKey]) {
    res.status(403).json({
      error: `${featureLabel} requires a premium subscription`,
      code: "PREMIUM_REQUIRED",
    });
    return null;
  }
  return features;
}

// Usage in route handler — early return on null
app.get("/api/pantry", requireAuth, async (req, res) => {
  const features = await checkPremiumFeature(
    req,
    res,
    "pantryTracking",
    "Pantry tracking",
  );
  if (!features) return; // 403 already sent

  // features is PremiumFeatures — can check additional limits
  const items = await storage.getPantryItems(req.userId!);
  res.json(items);
});
```

**When to use:** Any route with a simple boolean premium feature gate. If 3+ routes check the same pattern (fetch subscription -> resolve tier -> check flag -> send 403), use this helper.

**When NOT to use:**

- Routes that need tier-dependent **limits** (daily quotas, range limits) — those need custom logic after the feature check. You can still use `checkPremiumFeature` for the initial boolean gate and then use the returned `features` object for limit checks.
- Single-use gates where the overhead of a helper isn't justified.

**Key design choices:**

1. Returns `PremiumFeatures | null` rather than `boolean` so callers can use tier-dependent limits from the same object
2. Uses `isValidSubscriptionTier()` type guard internally — never `as SubscriptionTier`
3. Sends the 403 response itself — caller just checks for `null` and returns

**References:**

- `server/routes.ts` — pantry, grocery, meal confirmation routes all use this
- See also: "Tier-Gated Route Guards" (above) for the inline pattern this replaces
- See also: "Type Guard Over `as` Cast" in Testing Patterns

### `sendError` -- Standardized Error Response Helper

All API error responses must use the `sendError()` utility to ensure a consistent `{ error: string, code?: string }` shape across the entire backend. This complements the Error Response Structure pattern by providing a single function instead of manual `res.status().json()` calls.

```typescript
import { sendError } from "../lib/api-errors";

// Simple error — no machine-readable code
sendError(res, 404, "Item not found");

// Error with code — client can match on `code` for branching logic
sendError(res, 403, "Premium required", "PREMIUM_REQUIRED");
sendError(res, 429, "Daily limit reached", "DAILY_LIMIT_REACHED");
```

**Implementation:**

```typescript
// server/lib/api-errors.ts
export function sendError(
  res: Response,
  status: number,
  error: string,
  code?: string,
): void {
  const body: Record<string, unknown> = { error };
  if (code) body.code = code;
  res.status(status).json(body);
}
```

**When to use:** Every error response in every route handler. No route should construct `res.status(N).json({ error: "..." })` manually.

**When NOT to use:** Success responses (`res.json(data)`) and SSE streams (which use `res.write()`).

**Rationale:** Before this helper, 23 route files each constructed error JSON inline with subtly different shapes -- some used `{ message }`, some `{ error }`, some included `code`, some did not. A single function eliminates drift and makes it easy to add fields (e.g., `requestId`) to all errors in one place.

**References:**

- `server/lib/api-errors.ts` -- implementation
- All 24 route files under `server/routes/` -- consumers
- See also: [Error Response Structure](#error-response-structure) for the shape definition

### `parseQueryInt` -- Typed Query Parameter Parsing

Replace boilerplate `Math.min(parseInt(req.query.limit as string) || default, max)` with a single call that handles Express 5's `unknown` query types, NaN fallback, and min/max clamping.

```typescript
import { parseQueryInt } from "./_helpers";

// Before (repeated in 12+ routes):
const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
const offset = parseInt(req.query.offset as string) || 0;

// After:
const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function parseQueryInt(
  value: unknown,
  options: { default: number; min?: number; max?: number },
): number {
  const num = typeof value === "string" ? parseInt(value, 10) : NaN;
  let result = isNaN(num) ? options.default : num;
  if (options.min !== undefined) result = Math.max(result, options.min);
  if (options.max !== undefined) result = Math.min(result, options.max);
  return result;
}
```

**When to use:**

- Any route that reads `limit`, `offset`, `page`, `days`, or other numeric query parameters
- Always pair with explicit `max` to prevent unbounded queries (e.g., `?limit=999999`)

**When NOT to use:**

- Route params (use `parsePositiveIntParam` instead)
- Query params that are not integers (parse manually)

**Rationale:** Express 5 types `req.query.*` as `unknown`, forcing every handler to cast and validate. This helper encapsulates the cast, NaN fallback, and clamping in one place. The `max` option prevents clients from requesting unbounded result sets that could overload the database.

**References:**

- `server/routes/_helpers.ts` -- implementation
- 12 route files: `adaptive-goals`, `fasting`, `exercises`, `weight`, `pantry`, `chat`, `menu`, `saved-items`, `medication`, `grocery`, `nutrition` -- consumers

### `parsePositiveIntParam` -- Express 5 Route Param Parsing

Parse route parameters (`req.params.id`) as positive integers without `as string` casts. Accepts Express 5's `string | string[]` param type and returns `number | null`, rejecting NaN, zero, and negative values.

```typescript
import { parsePositiveIntParam } from "./_helpers";
import { sendError } from "../lib/api-errors";

// Before (repeated in 15+ routes, 35+ call sites):
const id = parseInt(req.params.id as string, 10);
if (isNaN(id) || id <= 0) {
  return res.status(400).json({ error: "Invalid item ID" });
}

// After:
const id = parsePositiveIntParam(req.params.id);
if (!id) return sendError(res, 400, "Invalid item ID");
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function parsePositiveIntParam(value: string | string[]): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}
```

**When to use:**

- Every route that reads a numeric `:id`, `:itemId`, `:logId`, etc. from `req.params`
- Combine with `sendError` for the error response

**When NOT to use:**

- Query parameters (use `parseQueryInt` instead)
- Params that can be zero or negative (parse manually)
- String params like `:slug` or `:uuid` (no parsing needed)

**Rationale:** Express 5 changed `req.params.*` from `string` to `string | string[]`. Every `as string` cast is a type lie that hides a potential runtime bug. This helper handles the union type correctly and rejects non-positive values in a single call, eliminating 35+ identical validation blocks across the codebase.

**References:**

- `server/routes/_helpers.ts` -- implementation
- 14 route files: `suggestions`, `exercises`, `weight`, `pantry`, `chat`, `menu`, `saved-items`, `medication`, `grocery`, `nutrition`, `micronutrients`, `meal-plan`, `recipes` -- consumers

### `parseQueryString` -- Typed String Query Parameter Parsing

Parse a query string parameter as a string without `as string` casts. Handles Express 5's `unknown` query type safely, returning `string | undefined`.

```typescript
import { parseQueryString } from "./_helpers";

// Before (unsafe):
const name = req.query.name as string;

// After (type-safe):
const name = parseQueryString(req.query.name);
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function parseQueryString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value;
}
```

**When to use:**

- Any route that reads a string query parameter (`?name=...`, `?date=...`, `?q=...`)
- Replaces every `req.query.x as string` cast in route handlers

**When NOT to use:**

- Numeric query params (use `parseQueryInt`)
- Date query params (use `parseQueryDate` for automatic parsing)
- Route params (use `parseStringParam`)

**Enforcement:** The `ocrecipes/no-as-string-req` ESLint rule flags `as string` casts on `req.query` in `server/routes/**/*.ts`.

**References:**

- `server/routes/_helpers.ts` -- implementation
- Route files: `micronutrients`, `nutrition`, `meal-plan`, `recipes`, `exercises` -- consumers

### `parseStringParam` -- Express 5 String Route Param Parsing

Parse a string route parameter without `as string` casts. Handles Express 5's `string | string[]` param type, returning `string | undefined`.

```typescript
import { parseStringParam } from "./_helpers";

// Before (unsafe):
const sessionId = req.params.sessionId as string;

// After (type-safe):
const sessionId = parseStringParam(req.params.sessionId);
if (!sessionId) return sendError(res, 400, "Session ID is required");
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function parseStringParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
```

**When to use:**

- Routes with string params like `:sessionId`, `:slug`, `:uuid`
- Combine with a null check and `sendError` for the error response

**When NOT to use:**

- Numeric params like `:id` (use `parsePositiveIntParam`)

**Enforcement:** The `ocrecipes/no-as-string-req` ESLint rule flags `as string` casts on `req.params` in `server/routes/**/*.ts`.

**References:**

- `server/routes/_helpers.ts` -- implementation
- `server/routes/photos.ts` -- consumer

### `handleRouteError` -- Centralized Route Error Handler

All route handler `catch` blocks must use the `handleRouteError` helper from `server/routes/_helpers.ts` instead of duplicating `ZodError` branching inline. The helper maps `ZodError` → 400 and anything else → 500 with structured logging.

```typescript
import { handleRouteError } from "./_helpers";

// Good: uniform catch with context label
app.post("/api/items", requireAuth, async (req, res) => {
  try {
    const parsed = ItemSchema.parse(req.body);
    const item = await storage.createItem(req.userId!, parsed);
    res.status(201).json(item);
  } catch (err) {
    handleRouteError(res, err, "create item");
  }
});

// Bad: manual ZodError check duplicated in every catch block
} catch (err) {
  if (err instanceof ZodError) {
    sendError(res, 400, formatZodError(err), "VALIDATION_ERROR");
    return;
  }
  logger.error({ err }, "create item error");
  sendError(res, 500, "Failed to create item", "INTERNAL_ERROR");
}
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function handleRouteError(
  res: Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof ZodError) {
    sendError(res, 400, formatZodError(error), ErrorCode.VALIDATION_ERROR);
    return;
  }
  logger.error({ err: toError(error) }, `${context} error`);
  sendError(res, 500, `Failed to ${context}`, ErrorCode.INTERNAL_ERROR);
}
```

**When to use:** Every `catch` block in every route handler — no route should contain inline `ZodError` branching.

**Context label:** Pass a lowercase verb phrase: `"create item"`, `"fetch daily log"`, `"update profile"`. It appears in both the logged error and the 500 response body.

**When NOT to use:** Handlers that need to catch specific domain errors (e.g., a 409 for a known conflict) should handle those cases before calling `handleRouteError`, or use a custom catch block.

**References:**

- `server/routes/_helpers.ts` -- implementation
- All 13 route files that replaced inline `ZodError` catch blocks with `handleRouteError`

---

### `numericStringField` / `nullableNumericStringField` -- Zod Numeric String Coercion

When a request body field accepts both string and number representations of a numeric value (common with `multipart/form-data` and form submissions), use the shared Zod schema helpers instead of repeating the union transform inline.

```typescript
import { numericStringField, nullableNumericStringField } from "./_helpers";

// Good: reusable helpers
const ItemSchema = z.object({
  calories: numericStringField, // string | number → string | undefined
  fat: nullableNumericStringField, // string | number → string | null
  protein: numericStringField,
});

// Bad: 15 repetitions of the same union transform
const ItemSchema = z.object({
  calories: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  fat: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  // ...repeated for every numeric field
});
```

**Implementation:**

```typescript
// server/routes/_helpers.ts

/** Accepts string or number, coerces to string. Returns undefined if absent. */
export const numericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => v?.toString());

/** Accepts string or number, coerces to string. Returns null if absent. */
export const nullableNumericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => v?.toString() ?? null);
```

**When to use:**

- Route body schemas for nutrition values, quantities, measurements — any numeric field that arrives as a string from `multipart/form-data`
- Use `numericStringField` when the field is fully optional and absent means "not provided"
- Use `nullableNumericStringField` when absent or null should be stored as `null` in the DB

**When NOT to use:**

- Fields that must be validated as actual numbers (use `z.number()`)
- Fields that are always strings (use `z.string()`)

**References:**

- `server/routes/_helpers.ts` -- implementation
- `server/routes/nutrition.ts` (7x), `meal-plan.ts` (6x), `pantry.ts`, `grocery.ts` -- consumers

---

### `ErrorCode` Constants -- Machine-Readable Error Codes

All `sendError()` calls must pass an `ErrorCode` constant from `@shared/constants/error-codes.ts` instead of an ad-hoc string literal. This ensures a stable, searchable set of error codes that clients can match on.

```typescript
import { ErrorCode } from "@shared/constants/error-codes";

// Good: constant from shared file
sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
sendError(res, 429, "Daily limit reached", ErrorCode.DAILY_LIMIT_REACHED);
sendError(res, 409, "Username already taken", ErrorCode.CONFLICT);

// Bad: ad-hoc string literals
sendError(res, 404, "Item not found", "ITEM_NOT_FOUND"); // not in ErrorCode
sendError(res, 429, "Daily limit reached", "DAILY_LIMIT"); // inconsistent spelling
```

**Adding a new code:** Add it to `shared/constants/error-codes.ts` first, then use `ErrorCode.NEW_CODE` at the call site. Never introduce a string literal that belongs in the constant.

**When NOT to use `ErrorCode`:** Highly domain-specific codes that will never be used elsewhere (e.g., `CATALOG_QUOTA_EXCEEDED`) may remain as string literals directly in `sendError()`, but these are the exception, not the rule.

**References:**

- `shared/constants/error-codes.ts` -- the constant definition + `ErrorCode` type
- All route files under `server/routes/` -- consumers

---

### Response Serializer Functions

When multiple route handlers in the same file return the same object shape (auth endpoints returning user objects, admin endpoints returning sanitized records), extract a `serializeX()` function to avoid repeating the field list and normalization logic.

```typescript
// Good: single serializer used across register/login/refresh/me handlers
function serializeUser(user: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
  };
}

// Usage in route handler
res.status(201).json({ user: serializeUser(user), token });
res.json({ user: serializeUser(user), token });
```

```typescript
// Bad: field list + normalization logic duplicated across 4 handlers
res.json({
  user: {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free", // normalization silently diverges
  },
  token,
});
```

**When to use:** 2+ handlers in the same route file that return an object with the same shape. The serializer is file-local (not exported) unless the shape is needed across multiple route files.

**Key benefit:** Normalizations (e.g., `|| "free"` fallback for `subscriptionTier`) are applied consistently. When the response shape changes, there is one place to update.

**When NOT to use:** One-off responses unique to a single handler.

**References:**

- `server/routes/auth.ts` -- `serializeUser()` used by register, login, refresh, and getMe handlers

---

### `createRateLimiter` -- Rate Limiter Factory

Factory function that creates `express-rate-limit` middleware with consistent defaults. Eliminates the 6-line boilerplate that was previously duplicated in every rate limiter definition. Supports a `keyByUser` option (defaults to `true`) that uses `req.userId` for authenticated routes, falling back to IP.

```typescript
import { createRateLimiter } from "./_helpers";

// Authenticated route — keyed by userId (default)
export const photoRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many photo uploads. Please wait.",
});

// Unauthenticated route — keyed by IP
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again later",
  keyByUser: false,
});
```

**Implementation:**

```typescript
// server/routes/_helpers.ts
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyByUser?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(options.keyByUser !== false && {
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
  });
}
```

**When to use:**

- Every new rate limiter in the project (all 19 existing rate limiters use this factory)
- All rate limiters should be defined in `server/routes/_helpers.ts` so they are centralized and reusable across route modules

**When NOT to use:**

- Rate limiters that need custom `keyGenerator` logic beyond userId/IP (define those inline)
- Third-party middleware that provides its own rate limiting

**Rationale:** Before the factory, each rate limiter was 6+ lines of identical boilerplate (`standardHeaders: true`, `legacyHeaders: false`, `message: { error: ... }`, `keyGenerator: ...`). The factory ensures every limiter uses the correct error shape (`{ error: string }` matching `sendError`), always sends standard headers, and correctly falls back from `userId` to IP. Adding a new rate limiter is now a single function call.

**References:**

- `server/routes/_helpers.ts` -- factory implementation and all 19 limiter instances
- See also: [Rate Limiting on Auth Endpoints](#rate-limiting-on-auth-endpoints) and [Rate Limiting on External API Endpoints](#rate-limiting-on-external-api-endpoints) for the policy rationale (the factory implements those patterns)

### Atomic Server Endpoints Over Multi-Request Flows

When a client action requires multiple related mutations (e.g., create a record + update a flag on another record), create a single server endpoint that performs both operations atomically rather than having the client make multiple sequential requests.

```typescript
// Bad: Client makes 2 requests that can leave data inconsistent if one fails
const addToPantry = async (item: GroceryItem) => {
  await apiRequest("POST", "/api/pantry", { name: item.name, ... });        // Step 1
  await apiRequest("PUT", `/api/grocery-items/${item.id}`, { addedToPantry: true }); // Step 2 - what if this fails?
};

// Good: Single atomic endpoint handles both operations
const addToPantry = async (listId: number, itemId: number) => {
  await apiRequest("POST", `/api/meal-plan/grocery-lists/${listId}/items/${itemId}/add-to-pantry`);
};

// Server handler — both operations succeed or fail together
app.post("/api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry",
  requireAuth,
  async (req, res) => {
    // Verify ownership, create pantry item, flag grocery item — all in one handler
    const pantryItem = await storage.createPantryItem({ ... });
    await storage.updateGroceryItemFlag(listId, itemId, { addedToPantry: true });
    res.status(201).json(pantryItem);
  },
);
```

**When to use:**

- Two or more writes that are logically one user action (check off + add to pantry, confirm meal + create daily log)
- When partial failure would leave the UI in an inconsistent state
- When the client would need to coordinate rollback logic

**When NOT to use:**

- Independent operations that the user performs separately
- Read-then-write patterns where the read result determines the write (use optimistic updates instead)

**Key benefits:**

1. **Atomicity** — both operations succeed or fail together (use `db.transaction()` if strict DB atomicity is needed)
2. **Fewer round trips** — one HTTP request instead of two
3. **Simpler client code** — single mutation hook with single invalidation
4. **No partial state** — UI never shows "added to pantry" without the grocery flag being set

**References:**

- `server/routes.ts` — `POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry`
- `client/hooks/useGroceryList.ts` — `useAddGroceryItemToPantry` mutation

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

### External Data Ingestion Quality Gate

When saving data from external APIs (Spoonacular, recipe URLs, third-party catalogs), validate that the record meets a **minimum content threshold** before persisting. Apply this as defense-in-depth across three layers:

```typescript
// Layer 1: API parameters — ask the source to pre-filter
url.searchParams.set("instructionsRequired", "true");

// Layer 2: Route-level validation — reject before saving
const hasInstructions =
  detail.recipe.instructions &&
  Array.isArray(detail.recipe.instructions) &&
  detail.recipe.instructions.length > 0;
const hasIngredients = detail.ingredients && detail.ingredients.length > 0;
if (!hasInstructions && !hasIngredients) {
  sendError(
    res,
    422,
    "This recipe has no instructions or ingredients",
    ErrorCode.VALIDATION_ERROR,
  );
  return;
}

// Layer 3: Query-level filtering — hide existing bad data
const conditions = [
  sql`COALESCE(jsonb_array_length(${table.instructions}), 0) > 0`,
];
```

**When to use:** Any endpoint that persists third-party data which will be displayed to users. Recipes from Spoonacular, products from OpenFoodFacts, or any external catalog where data completeness varies.

**Why three layers:**

- **Layer 1** reduces API quota waste on unusable records
- **Layer 2** gives the client an actionable error (422) instead of silently saving empty data
- **Layer 3** catches records that were saved before the gate existed (retroactive safety net)

**Reference:** `server/routes/recipes.ts` — catalog save and URL import endpoints; `server/storage/community.ts` and `server/storage/meal-plans.ts` — query filters.

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

### External Resource Dedup on Save

When saving resources from external catalogs or imports, check for an existing record by `externalId + userId` before fetching full details and inserting. This prevents duplicate DB entries and unnecessary API calls:

```typescript
// In route handler — check for existing record before expensive API call
const existing = await storage.findMealPlanRecipeByExternalId(
  req.userId!,
  externalId,
);
if (existing) {
  return res.json(existing); // Already saved, return existing
}

// Only now fetch full details from external API
const detail = await getCatalogRecipeDetail(externalId);
const saved = await storage.createMealPlanRecipe(detail);
res.status(201).json(saved);
```

```typescript
// In storage layer — composite lookup by userId + externalId
async findMealPlanRecipeByExternalId(
  userId: number,
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
  return recipe;
}
```

**When to use:** Any feature that saves external resources into local DB (catalog imports, bookmark/save flows, third-party sync).

**Why:** Users may tap "save" multiple times or revisit a catalog item. Without dedup, you get duplicate rows and wasted API quota. The userId scope ensures different users can independently save the same external resource.

**Reference:** `POST /api/meal-plan/catalog/:id/save` in `server/routes.ts`, `server/storage.ts`

### Multi-Source Nutrition Lookup Chain

When a single API cannot reliably provide accurate data, use a priority chain of
sources with cross-validation:

```typescript
// server/services/nutrition-lookup.ts
// Priority: CNF → USDA → API Ninjas
export async function lookupNutrition(
  query: string,
): Promise<NutritionData | null> {
  // 1. Try Canadian Nutrient File (bilingual, high accuracy)
  const cnfResult = await lookupCNF(query);
  if (cnfResult) return { ...cnfResult, source: "cnf" };

  // 2. Try USDA FoodData Central
  const usdaResult = await lookupUSDA(query);
  if (usdaResult) return { ...usdaResult, source: "usda" };

  // 3. Last resort: API Ninjas
  const ninjasResult = await lookupAPINinjas(query);
  if (ninjasResult) return { ...ninjasResult, source: "api-ninjas" };

  return null;
}
```

**When to use:** Any feature requiring reliable data from external sources where
no single API has complete coverage (nutrition, product catalogs, geocoding, etc.).

**Why:** Individual APIs have gaps. OFF may have French names that confuse USDA.
CNF is authoritative for Canadian products. The chain ensures best available data.

**Reference:** `server/services/nutrition-lookup.ts`

### Barcode Padding Normalization

Barcodes can be encoded in different formats (UPC-A 12-digit, EAN-13 13-digit).
Generate all plausible variants and try each one:

```typescript
function barcodeVariants(raw: string): string[] {
  const variants = new Set<string>();
  variants.add(raw);

  // Zero-pad to 12 or 13 digits
  const padded12 = raw.padStart(12, "0");
  const padded13 = raw.padStart(13, "0");
  variants.add(padded12);
  variants.add(padded13);

  // Compute check digits for UPC-A and EAN-13
  variants.add(computeUPCA(raw));
  variants.add(computeEAN13(raw));

  return [...variants].filter((v) => /^\d{8,14}$/.test(v));
}
```

**When to use:** Any barcode lookup where the scanned code may differ in
format from what the database stores (leading zeros, check digits, padding).

**Why:** A scanner may return `"60731142363"` (11 digits) while the database
stores `"060731142363"` (12-digit UPC-A with leading zero). Without
normalization, valid products appear as "not found."

**Reference:** `barcodeVariants()`, `computeUPCA()`, `computeEAN13()` in `server/services/nutrition-lookup.ts`

### Cross-Validation Between Data Sources

When primary data is suspect, compare against a secondary source and prefer
the more plausible result:

```typescript
// If OFF reports >2× the calories of the secondary source, prefer secondary
const offCalories = offData.calories;
const secondaryCalories = secondaryData.calories;

if (offCalories > secondaryCalories * 2) {
  // OFF likely has a full-box serving size; prefer secondary
  return { ...secondaryData, productName: offData.productName };
}

// Sources agree: use OFF but fill gaps from secondary
return {
  ...offData,
  fiber: offData.fiber ?? secondaryData.fiber,
  sugar: offData.sugar ?? secondaryData.sugar,
};
```

**When to use:** Any integration where the primary source may have inaccurate
data (e.g., community-contributed databases like Open Food Facts).

**Why:** OFF sometimes reports nutrition for the full box instead of one serving
(e.g., 944 kcal for a Keurig pod box instead of 60 kcal for one pod).
Cross-validation catches these errors automatically.

**Reference:** Cross-validation logic in `lookupBarcode()`, `server/services/nutrition-lookup.ts`

### Graceful 404 Handling with Raw Fetch

When a 404 is an expected outcome (not an error), bypass `apiRequest()` and use
raw `fetch` to inspect the response body:

```typescript
// apiRequest() calls throwIfResNotOk() which throws on 404
// For barcode lookup, 404 means "product not in database" — not an error

const baseUrl = getApiUrl();
const token = await tokenStorage.getToken();
const response = await fetch(`${baseUrl}/api/nutrition/barcode/${barcode}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const data = await response.json();

if (data.notInDatabase) {
  setShowManualSearch(true); // Expected path, not an error
}
```

**When to use:** Any endpoint where specific non-2xx status codes represent valid
application states rather than errors (404 = "not found, try manual search",
409 = "already exists", etc.).

**Why:** A shared `apiRequest()` helper that throws on all non-2xx responses is
a good default, but it prevents handling expected non-2xx responses gracefully.

**Reference:** `fetchBarcodeData()` in `client/screens/NutritionDetailScreen.tsx`

### Fetch Timeout with AbortSignal for External APIs

Every outbound `fetch()` to an external API must include `AbortSignal.timeout()` to prevent hung connections from blocking server resources indefinitely. Node.js `fetch` has no default timeout — a slow or unresponsive upstream will hold the connection open until the OS-level TCP timeout (often 2+ minutes).

```typescript
/** Timeout for outbound API requests (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

// Good: Explicit timeout prevents hung connections
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});

// Bad: No timeout — connection hangs if upstream is slow
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
});
```

**When to use:** Every `fetch()` call to an external API (payment processors, nutrition databases, OAuth endpoints, third-party services). Define the timeout as a named constant at module level.

**When NOT to use:** Internal service calls where you control both endpoints and have other timeout mechanisms (e.g., Express request timeout middleware).

**Recommended timeouts:**

- Payment/auth APIs (Google OAuth, Apple receipt): `10_000` (10s)
- Data APIs (USDA, nutrition lookup): `10_000` (10s)
- Large content fetches (recipe import, URL scraping): `15_000`-`30_000` (15-30s)

**Rationale:** The receipt-validation code review found that both Google OAuth token exchange and subscription verification calls had no timeouts. In production, a hung Google API call would block the subscription upgrade endpoint indefinitely. `AbortSignal.timeout()` is the modern Node.js approach (available since Node 18) and is cleaner than manual `AbortController` + `setTimeout` patterns.

**References:**

- `server/services/receipt-validation.ts` — Google OAuth and subscription API calls
- `server/services/recipe-import.ts` — `safeFetch` already uses `AbortSignal.timeout()`
- Related learning: "Fetch Without Timeout Hangs Indefinitely" in LEARNINGS.md

### OpenAI SDK Timeout and Error Handling

The OpenAI SDK uses a different timeout mechanism than `fetch()`. Instead of `AbortSignal.timeout()`, pass `{ timeout: ms }` as the second argument to API calls. Timeouts are tiered by call complexity, with named constants centralized in `server/lib/openai.ts`:

```typescript
// server/lib/openai.ts — centralized timeout constants
const OPENAI_DEFAULT_TIMEOUT_MS = 45_000; // client-level default

export const OPENAI_TIMEOUT_FAST_MS = 15_000; // simple text parsing (food-nlp)
export const OPENAI_TIMEOUT_STREAM_MS = 30_000; // streaming chat (nutrition-coach)
export const OPENAI_TIMEOUT_HEAVY_MS = 60_000; // large token budgets (recipes, meal suggestions)
export const OPENAI_TIMEOUT_IMAGE_MS = 120_000; // DALL-E image generation

export const openai = new OpenAI({
  apiKey: apiKey ?? "",
  timeout: OPENAI_DEFAULT_TIMEOUT_MS, // client-level default
});
```

Per-request overrides use the second argument:

```typescript
import { openai, OPENAI_TIMEOUT_FAST_MS } from "../lib/openai";

const response = await openai.chat.completions.create(
  { model: "gpt-4o-mini", messages, max_completion_tokens: 500 },
  { timeout: OPENAI_TIMEOUT_FAST_MS }, // override client default
);
```

**Error handling strategy varies by service role:**

| Service role                               | Strategy                                       | Example                                                           |
| ------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------- |
| Required data (recipe, menu, meals)        | `try/catch` → re-throw user-friendly message   | `throw new Error("Failed to generate recipe. Please try again.")` |
| Optional/degradable data (food-nlp, photo) | `try/catch` → return fallback                  | `return []` or return previous result                             |
| Streaming (coach)                          | `try/catch` → `yield` error message + `return` | `yield "Sorry, I'm having trouble responding right now."`         |

```typescript
// Required data — re-throw with user-friendly message
let response;
try {
  response = await openai.chat.completions.create(params, { timeout });
} catch (error) {
  console.error("Recipe generation API error:", error);
  throw new Error("Failed to generate recipe. Please try again.");
}

// Degradable data — return fallback
try {
  response = await openai.chat.completions.create(params, { timeout });
} catch (error) {
  console.error("Food NLP parsing error:", error);
  return []; // caller can handle empty result
}
```

**When to use:** Every `openai.chat.completions.create()` or `dalleClient.images.generate()` call.

**References:**

- `server/lib/openai.ts` — client configuration and timeout constants
- `server/services/food-nlp.ts` — degradable fallback pattern
- `server/services/nutrition-coach.ts` — streaming error handling pattern
- `server/services/recipe-generation.ts` — required data + DALL-E timeout pattern

### Always Guard JSON.parse on LLM Output

LLM responses can contain malformed JSON (truncated output hitting token limits, hallucinated syntax, partial responses from timeouts). Every `JSON.parse()` on AI-returned content must be wrapped in try/catch, even when using `response_format: { type: "json_object" }`:

```typescript
// ❌ BAD — unguarded JSON.parse on LLM output
const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");

// ✅ GOOD — guarded with appropriate fallback
let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  // For required data: throw user-friendly error
  throw new Error("Menu analysis returned invalid data. Please try again.");
  // For optional data: return fallback
  // console.error("Food NLP: AI returned invalid JSON");
  // return [];
}
```

**Why this differs from traditional APIs:** External REST APIs return malformed JSON extremely rarely (usually only on server errors). LLMs produce malformed JSON more frequently because `response_format: { type: "json_object" }` only guarantees _attempted_ JSON — the output can still be truncated if it hits `max_completion_tokens`, or the model may produce syntactically broken JSON in edge cases.

**When to use:** Every `JSON.parse()` on content from `response.choices[0]?.message?.content`. This applies even after checking `if (!content) return` — non-null content can still be invalid JSON.

**References:**

- `server/services/menu-analysis.ts` — guarded JSON.parse with user-friendly error
- `server/services/food-nlp.ts` — guarded JSON.parse with empty-array fallback
- `server/services/meal-suggestions.ts` — guarded JSON.parse (already correct before audit)
- `server/services/recipe-generation.ts` — guarded JSON.parse (already correct before audit)

### Zod safeParse for External API Responses

When consuming JSON from external APIs (payment providers, third-party services, OAuth endpoints), validate the response shape with a Zod schema using `safeParse()` instead of casting with `as`. External APIs can change their response format without warning, and `as` casts provide zero runtime protection.

```typescript
import { z } from "zod";

// Define a schema for the expected response shape
const googleOAuthResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

// Good: safeParse validates the shape at runtime
const raw = await response.json();
const parsed = googleOAuthResponseSchema.safeParse(raw);
if (!parsed.success) {
  console.error("Unexpected API response shape:", parsed.error);
  return { valid: false, errorCode: "STORE_API_ERROR" };
}
// parsed.data is now typed and validated
const token = parsed.data.access_token;
```

```typescript
// Bad: as cast trusts the API response blindly
const data = (await response.json()) as {
  access_token: string;
  expires_in: number;
};
// If Google changes the response, `data.access_token` is undefined
// and the error surfaces far from where the data was received
```

**When to use:**

- Any `response.json()` from an external API (Google Play, Apple App Store, Spoonacular, USDA, etc.)
- Decoded payloads from JWS/JWT tokens
- Webhook payloads from third-party services

**When NOT to use:**

- Internal API responses where you control the server (use shared types instead)
- Responses already validated by a client SDK that provides typed results

**Pattern:** Define the schema next to the function that consumes the response. Use `safeParse()` (not `parse()`) so you can return a structured error instead of throwing. Keep schemas minimal — only validate fields you actually use.

**Rationale:** During the receipt-validation code review, three `as` casts on Google API and Apple JWS payloads were replaced with Zod schemas. This catches API-breaking changes at the validation boundary rather than letting invalid data propagate into business logic.

**References:**

- `server/services/receipt-validation.ts` — `appleTransactionSchema`, `googleOAuthResponseSchema`, `googleSubscriptionResponseSchema`
- `server/services/recipe-catalog.ts` — `catalogSearchResponseSchema`, `recipeDetailSchema`
- `server/services/nutrition-lookup.ts` — `apiNinjasResponseSchema`, `usdaResponseSchema`
- Related pattern: "Zod safeParse with Fallback for Database Values" (for internal data)

## External API Parsing Patterns

### ISO 8601 Duration Parsing

Parse ISO 8601 duration strings (from schema.org recipes, calendar events, etc.) into numeric minutes for storage and display. Return `null` for missing or unparseable values instead of throwing.

**When to use:** Importing data from schema.org structured data, iCal/ICS feeds, or any external source using ISO 8601 durations (e.g., `PT1H30M`, `PT15M`).

**When NOT to use:** Internal data that already stores durations as numbers.

```typescript
// server/services/recipe-import.ts

export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return hours * 60 + minutes;
}

// Usage
parseIsoDuration("PT1H30M"); // → 90
parseIsoDuration("PT15M"); // → 15
parseIsoDuration("PT2H"); // → 120
parseIsoDuration(undefined); // → null
parseIsoDuration("invalid"); // → null
```

**Key details:**

- Case-insensitive (`/i` flag) to handle mixed-case from external sources
- Seconds component is parsed but not added to the result (recipes don't need second-level precision)
- Returns `null` (not 0 or throws) for graceful handling in optional fields

### Intent-Driven Config Object

Place a shared config record in `shared/constants/` keyed by intent/mode union type. Both client and server import the same object to drive branching behavior:

```typescript
// shared/constants/preparation.ts
export const INTENT_CONFIG: Record<
  PhotoIntent,
  {
    needsNutrition: boolean;
    needsSession: boolean;
    canLog: boolean;
    label: string;
  }
> = {
  log: { needsNutrition: true, needsSession: true, canLog: true, label: "Log this meal" },
  identify: { needsNutrition: false, needsSession: false, canLog: false, label: "Just identify" },
  // ...
};

// Server usage — drives which steps to execute
const intentConfig = INTENT_CONFIG[intent];
if (intentConfig.needsNutrition) {
  foods = await batchNutritionLookup(result.foods);
}
if (intentConfig.needsSession) {
  sessionStore.set(sessionId, { userId, result, createdAt: new Date() });
}

// Client usage — drives which UI to render
const config = INTENT_CONFIG[intent];
{config.canLog && <LogButton onPress={handleConfirm} />}
```

**When to use:** Multiple code paths share the same feature with mode-dependent behavior (photo intents, notification types, export formats).

**When NOT to use:** Only 2 simple modes with a boolean flag — a simple `if` is clearer.

**Why:** Eliminates scattered `if (intent === "log")` checks across client and server. Adding a new intent means adding one config entry instead of hunting for conditionals.

### Centralized Domain Defaults

When multiple files use the same fallback value (e.g., `|| 2000` for calories), extract into a single `as const` object in `shared/constants/`. This prevents silent drift where the same default diverges across services.

```typescript
// shared/constants/nutrition.ts — single source of truth
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 67,
} as const;

// ✅ GOOD: All consumers reference the constant
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
const calories = user.dailyCalorieGoal || DEFAULT_NUTRITION_GOALS.calories;

// ❌ BAD: Hardcoded fallbacks that can drift independently
const calories = user.dailyCalorieGoal || 2000;
const protein = user.dailyProteinGoal || 100; // was it 100 or 150?
```

**When to use:** 2+ files share the same fallback/default value for a domain concept.

**When NOT to use:** A value is used in only one place, or the "defaults" are intentionally different per context (document the deviation with a comment).

**Why:** Before centralization, meal suggestions used protein=100 while adaptive goals used protein=150 — a 50% discrepancy for the same concept. `as const` gives literal types, and a unit test locks down the values against accidental changes.

### Compress-Upload-Cleanup for Image Uploads

When uploading user images, always compress before upload and clean up the temporary file afterward using `try/finally`:

```typescript
// client/lib/photo-upload.ts
import { compressImage, cleanupImage } from "./image-compression";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";

export async function uploadPhotoForAnalysis(
  uri: string,
  intent: PhotoIntent = "log",
): Promise<PhotoAnalysisResponse> {
  const compressed = await compressImage(uri);

  try {
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters: { intent },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return JSON.parse(uploadResult.body) as PhotoAnalysisResponse;
  } finally {
    await cleanupImage(compressed.uri); // Always runs, even on error
  }
}
```

The compression step (`client/lib/image-compression.ts`) uses adaptive quality reduction — if the first pass exceeds the target size, it recalculates quality proportionally:

```typescript
if (sizeKB > targetSizeKB && quality > 0.3) {
  const newQuality = Math.max(0.3, quality * (targetSizeKB / sizeKB));
  result = await manipulateAsync(uri, [{ resize }], { compress: newQuality });
}
```

**When to use:** Any image upload from the client (photo analysis, profile avatars).

**When NOT to use:** Small files like icons or thumbnails that don't need compression.

**Why:** Reduces upload payload (1024px max, JPEG quality 0.7, <1MB target), prevents temp file buildup on device, and `finally` guarantees cleanup even if the upload fails.

### Confidence-Based Follow-Up Refinement

When AI analysis produces low-confidence results, prompt the user for clarification and re-analyze with the additional context:

```typescript
// Server: check if follow-up is needed
const CONFIDENCE_THRESHOLD = 0.7;

export function needsFollowUp(result: AnalysisResult): boolean {
  return (
    result.overallConfidence < CONFIDENCE_THRESHOLD ||
    result.followUpQuestions.length > 0 ||
    result.foods.some((f) => f.needsClarification)
  );
}

// Server: refine with user's answer (text-only, no image re-send)
export async function refineAnalysis(
  previousResult: AnalysisResult,
  question: string,
  answer: string,
): Promise<AnalysisResult> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Previous analysis: ${JSON.stringify(previousResult)}\nRefine based on user answer.`,
      },
      { role: "user", content: `Q: ${question}\nA: ${answer}` },
    ],
    response_format: { type: "json_object" },
  });
  return analysisResultSchema.parse(
    JSON.parse(response.choices[0]?.message?.content || "{}"),
  );
}

// Client: show follow-up UI conditionally
if (analysisResult.needsFollowUp) {
  setShowFollowUp(true); // Renders question + answer input
}
```

**When to use:** Any AI analysis where confidence scoring is available and user clarification can improve accuracy.

**When NOT to use:** Deterministic lookups (barcode scans, database queries) where results are either correct or not found.

**Why:** Low-confidence results displayed without refinement erode user trust. The follow-up is text-only (no image re-send), so it's cheap and fast. The threshold (0.7) is tunable — lower values reduce prompts but risk showing inaccurate data.

### Zod Union + Transform for LLM Output Flexibility

LLMs may return a field as either a string or an array of strings depending on prompt interpretation. Use `z.union` with `.transform` to normalize the shape, then `.pipe` to validate the final type.

```typescript
// server/services/recipe-generation.ts

const recipeContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  // LLMs sometimes return instructions as ["Step 1...", "Step 2..."]
  // instead of a single string. Accept both, normalize to string.
  instructions: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join("\n") : v))
    .pipe(z.string().min(1)),
  dietTags: z.array(z.string()).default([]),
});

// Usage with safeParse
const content = response.choices[0]?.message?.content || "{}";
const parsed = recipeContentSchema.safeParse(JSON.parse(content));

if (!parsed.success) {
  console.error("Recipe generation validation failed:", parsed.error);
  throw new Error("Failed to generate valid recipe content");
}

return parsed.data; // instructions is always a string
```

**When to use:** Parsing LLM JSON responses where the prompt asks for a specific type but the model sometimes returns a different-but-coercible type (string vs array, number vs string-encoded number).

**When NOT to use:** Deterministic APIs with stable schemas. Use plain Zod schemas or `z.coerce` for simple type coercion (e.g., `z.coerce.number()` for string-to-number).

**Why:** LLM output is inherently unpredictable — even with `response_format: { type: "json_object" }`, the structure of individual fields can vary between calls. The `union` + `transform` + `pipe` chain handles this at the validation layer without requiring prompt engineering workarounds. The `.pipe()` step ensures the transformed value still passes final validation (e.g., `min(1)` catches empty arrays that would transform to `""`).

### `apiRequest` Never Returns Non-OK — Don't Re-Check `res.ok`

`apiRequest()` in `client/lib/query-client.ts` internally calls `throwIfResNotOk(res)` before returning. This means it **always throws** on non-OK responses and **never** returns a response where `res.ok` is `false`. Do not add redundant `if (!res.ok)` checks in mutation hooks — they are dead code.

```typescript
// ❌ Bad: Dead code — apiRequest already threw before reaching this check
mutationFn: async (input) => {
  const res = await apiRequest("POST", "/api/example", input);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed: ${res.status}`);
  }
  return res.json();
},

// ✅ Good: apiRequest handles errors, just parse the response
mutationFn: async (input) => {
  const res = await apiRequest("POST", "/api/example", input);
  return res.json();
},
```

**Why this matters:**

1. **Dead code** — the `if (!res.ok)` branch can never execute
2. **Wrong error messages** — `throwIfResNotOk` throws with format `"${status}: ${responseBody}"`, so custom messages like `"Request failed"` are never shown; users see the raw format instead
3. **Double body consumption** — `throwIfResNotOk` reads the body via `res.text()`; if somehow bypassed, a subsequent `res.json()` would fail because the stream is already consumed

**When to use:** Every `mutationFn` or `queryFn` that calls `apiRequest()`.

**When NOT to use:** When using raw `fetch()` directly (e.g., FormData uploads, graceful 404 handling) — those calls do NOT go through `throwIfResNotOk`.

**References:**

- Implementation: `client/lib/query-client.ts` (`throwIfResNotOk` at line 29, `apiRequest` at line 55)
- See also: [FormData Upload Mutation](#formdata-upload-mutation) (uses raw `fetch`, so `res.ok` check IS needed)
- See also: [Graceful 404 Handling with Raw Fetch](#graceful-404-handling-with-raw-fetch)

### Promise.allSettled with Cap for External API Fan-Out

When calling a rate-limited external API for a list of inputs, use `Promise.allSettled()` (not `Promise.all()`) with a cap on parallel calls. Failed items degrade to the next tier instead of losing all results.

```typescript
const MAX_CALLS = 5;
const batch = ingredients.slice(0, MAX_CALLS);
const overflow = ingredients.slice(MAX_CALLS); // goes straight to fallback

const outcomes = await Promise.allSettled(
  batch.map(async (ingredient) => {
    const subs = await getSpoonacularSubstitutes(ingredient.name);
    return { ingredient, subs };
  }),
);

const results: Suggestion[] = [];
const needsFallback: Ingredient[] = [...overflow];

for (let i = 0; i < outcomes.length; i++) {
  const outcome = outcomes[i];
  if (outcome.status === "fulfilled" && outcome.value.subs.length > 0) {
    results.push(...formatSuggestions(outcome.value));
  } else {
    needsFallback.push(batch[i]); // degrade to AI tier
  }
}
```

```typescript
// Bad: sequential calls — 5 items × 10s timeout = 50s worst case
for (const item of items) {
  const result = await externalApi(item); // sequential
}

// Bad: Promise.all — one failure rejects everything
await Promise.all(items.map((item) => externalApi(item)));

// Good: parallel + partial failure recovery + quota protection
await Promise.allSettled(items.slice(0, MAX).map(...));
```

**When to use:** Fan-out calls to paid/rate-limited external APIs (Spoonacular, USDA, API Ninjas) with a list of inputs where partial results are acceptable.

**When NOT to use:** Internal database queries where all-or-nothing semantics are correct. APIs with no rate limits where `Promise.all` is simpler.

**Why:** (1) `Promise.all` rejects on the first failure, discarding successful results. (2) Sequential calls multiply latency linearly. (3) Uncapped parallelism can exhaust API quotas (Spoonacular free tier: 150 points/day). The cap + `allSettled` gives parallel speed with quota protection and partial failure recovery.

**References:**

- `server/services/ingredient-substitution.ts` -- 3-tier substitution pipeline (Static -> Spoonacular -> AI)
- See also: [Static-First with AI Fallback](#static-first-with-ai-fallback) in Architecture Patterns

### Static Routes Before Parameterized Routes

In Express, register static path routes BEFORE parameterized routes that share the same prefix. Otherwise the static path matches as a parameter value:

```typescript
// CORRECT order: static first, then parameterized
app.get("/api/verification/user-count", requireAuth, handler); // ← static
app.get("/api/verification/:barcode", requireAuth, handler); // ← parameterized

// WRONG order: "user-count" matches as barcode param
app.get("/api/verification/:barcode", requireAuth, handler); // ← matches first
app.get("/api/verification/user-count", requireAuth, handler); // ← never reached
```

**When to use:** Any time a route file has both `/path/static-segment` and `/path/:param` routes under the same prefix.

**Why:** Express matches routes in registration order. `/:barcode` matches any string — including `user-count`. Add a comment documenting the ordering requirement to prevent future reordering.

**References:**

- `server/routes/verification.ts` -- `user-count` registered before `/:barcode`

### Persistent Monthly Rate Limiting

For billing-period rate limits (monthly quotas per API key), use custom middleware with persistent DB counters instead of `express-rate-limit` (which uses in-memory sliding windows that reset on server restart).

```typescript
// Atomic upsert: INSERT or increment existing counter
await db
  .insert(apiKeyUsage)
  .values({ apiKeyId, yearMonth, requestCount: 1, lastRequestAt: now })
  .onConflictDoUpdate({
    target: [apiKeyUsage.apiKeyId, apiKeyUsage.yearMonth],
    set: {
      requestCount: sql`${apiKeyUsage.requestCount} + 1`,
      lastRequestAt: now,
    },
  });
```

**Middleware flow:**

1. Read current usage from DB (or in-memory cache with 60s TTL)
2. Compare against `TIER_FEATURES[tier].requestsPerMonth`
3. Set headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
4. If over → 429 with `TIER_LIMIT_EXCEEDED`
5. If under → increment counter (fire-and-forget), call `next()`

**Key differences from `express-rate-limit`:**

| Aspect   | `express-rate-limit`          | Persistent monthly limiter   |
| -------- | ----------------------------- | ---------------------------- |
| Window   | Short (60s–15min)             | Monthly billing period       |
| Storage  | In-memory (resets on restart) | Database (survives restarts) |
| Key      | `req.userId` or IP            | `req.apiKeyId`               |
| Use case | Abuse prevention              | Billing enforcement          |

**Fail-open policy:** If the DB is unreachable, let the request through. A few extra requests during an outage are better than blocking all API consumers. Log the error for investigation.

**References:**

- `server/middleware/api-rate-limit.ts` — `apiRateLimiter` middleware
- `server/storage/api-keys.ts` — `incrementUsage`, `getUsage`
- `shared/constants/api-tiers.ts` — `TIER_FEATURES` config

### Process-Level Error Handlers

Register `uncaughtException` and `unhandledRejection` handlers at the top of `server/index.ts` (after imports, before app setup) to catch fatal errors that bypass Express middleware:

```typescript
process.on("uncaughtException", (error) => {
  logger.fatal({ err: toError(error) }, "uncaught exception");
  rootLogger.flush();
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: toError(reason) }, "unhandled rejection");
});
```

**Key details:**

- `uncaughtException` MUST exit — after an uncaught exception the process is in an undefined state. Call `rootLogger.flush()` then `setTimeout(() => process.exit(1), 500)` to give async transports time to drain
- `unhandledRejection` logs but does NOT exit — these are often recoverable (e.g., a forgotten `.catch()` on a fire-and-forget promise)
- No restart logic in the handlers — that's the process manager's job
- These catch errors from outside Express: database connection drops, timer callbacks, event emitter errors, `setTimeout` throws

**When to use:** Every production Node.js server. These are a baseline for observability — without them, crashes produce no log output.

**References:**

- `server/index.ts` — lines 18-30

### AsyncLocalStorage for Request-Scoped Context

Use `AsyncLocalStorage` to propagate per-request state (requestId, userId) through the entire async call chain without passing parameters through function signatures.

```typescript
// server/lib/request-context.ts
const als = new AsyncLocalStorage<RequestContext>();

// Middleware creates the store
export function requestContextMiddleware(req, res, next) {
  const requestId = req.id; // from pino-http
  res.setHeader("X-Request-Id", requestId);
  als.run({ requestId, userId: null }, () => next());
}

// Any code can read it — no parameter threading needed
export function getRequestContext() {
  return als.getStore(); // undefined outside a request
}
```

**Key details:**

- ALS context propagates through `Promise` chains, `setTimeout`, and `process.nextTick` in Node 18+
- Returns `undefined` outside a request (startup, shutdown, background jobs) — callers must handle this gracefully
- The store object is mutable — `setRequestUserId()` updates it in-place after auth middleware runs, which is safe because Node.js is single-threaded (one request never shares a store with another)
- When middleware B needs data that middleware A produced, B should **read A's output** (e.g., `req.id`) rather than re-derive from the same source (e.g., re-parsing `X-Request-Id`). This prevents divergence bugs.

**When to use:** Request ID propagation, user context in services, audit trails, distributed tracing headers — anywhere you need per-request state without threading it through every function call.

**When NOT to use:** Short-lived scripts, single-function handlers where passing a parameter is simpler than setting up ALS.

**References:**

- `server/lib/request-context.ts` — ALS store, middleware, `getRequestContext()`, `setRequestUserId()`
- `server/lib/logger.ts` — pino `mixin` reads ALS to inject `requestId`/`userId` into every log call
- `server/middleware/auth.ts` — calls `setRequestUserId()` after token verification

### Centralized Environment Validation with Zod Schema

Instead of scattered `if (!process.env.X) throw` checks across modules, define a single Zod schema for all environment variables and validate it once at server startup. This surfaces all missing variables at once (not one at a time) and provides typed access to validated values.

```typescript
// server/lib/env.ts
import { z } from "zod";

const envSchema = z.object({
  // Required — server will not start without these
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

  // Optional with defaults
  PORT: z.string().default("3000"),
  NODE_ENV: z.string().default("development"),

  // Optional — features degrade gracefully
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().optional(),
  SPOONACULAR_API_KEY: z.string().optional(),
  // ... other optional vars
});

type Env = z.infer<typeof envSchema>;
let validated: Env | null = null;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  validated = result.data;

  // Warn about missing optional vars
  if (!validated.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.warn(
      "[env] AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features disabled",
    );
  }
  return validated;
}

export function getEnv(): Env {
  if (!validated)
    throw new Error("validateEnv() must be called before getEnv()");
  return validated;
}
```

```typescript
// server/index.ts — call as the very first thing
import { validateEnv } from "./lib/env";
validateEnv();
```

**Key elements:**

1. **Required vs optional** — required vars use `.min(1)` (not just `.string()`) to reject empty strings
2. **Defaults** — `PORT` and `NODE_ENV` get sensible defaults via `.default()`
3. **All-at-once errors** — `safeParse` collects all failures, not just the first
4. **Warning for degraded features** — optional vars log warnings so operators know what is disabled
5. **Typed access** — `getEnv()` returns a fully typed object, no more `process.env.X!` assertions

**When to use:** Every Express server startup. Call `validateEnv()` before any other module initialization.

**Relation to existing pattern:** This supersedes the simpler "Fail-Fast Environment Validation" pattern above for projects with many env vars. Small projects with 1-2 required vars can still use inline checks.

**References:**

- `server/lib/env.ts` — full schema and validation
- `server/index.ts` — `validateEnv()` called at top of main IIFE

### Service Availability Guard (`checkAiConfigured`)

When a route depends on an optional external service (OpenAI, Spoonacular, etc.), use a guard function that returns `false` and sends a 503 response when the service is not configured. This prevents cryptic errors deep in service code.

```typescript
// server/routes/_helpers.ts
import { isAiConfigured } from "../lib/openai";

export function checkAiConfigured(res: Response): boolean {
  if (!isAiConfigured) {
    sendError(
      res,
      503,
      "AI features are not available. Please try again later.",
      "AI_NOT_CONFIGURED",
    );
    return false;
  }
  return true;
}

// Usage in route handler — early return before any AI work
app.post(
  "/api/photos/analyze",
  requireAuth,
  photoRateLimit,
  upload.single("photo"),
  async (req: Request, res: Response) => {
    if (!checkAiConfigured(res)) return;
    // ... proceed with AI analysis
  },
);
```

**Key elements:**

1. **503 (Service Unavailable)**, not 500 — signals the feature is temporarily unavailable, not a bug
2. **Boolean return** — allows clean `if (!check) return;` pattern in handlers
3. **Machine-readable code** — `"AI_NOT_CONFIGURED"` for client-side handling
4. **Module-level boolean** — `isAiConfigured` is evaluated once at import time, not per-request

**When to use:** Any route that calls OpenAI or another optional external service. Check before doing any expensive work (file processing, Zod validation of large payloads).

**When NOT to use:** Required services (database, auth) — those should fail at startup via `validateEnv()`.

**References:**

- `server/routes/_helpers.ts` — `checkAiConfigured()`
- `server/lib/openai.ts` — `isAiConfigured` export
- `server/routes/photos.ts` — usage example

### Graceful Shutdown with Resource Cleanup

Register `SIGTERM` and `SIGINT` handlers that stop accepting new connections, clear periodic jobs, and close the database pool. Add a forced-exit timeout to prevent hangs.

```typescript
// Start periodic jobs
const cacheCleanupInterval = startCacheCleanupJob();

// Graceful shutdown
function shutdown(signal: string) {
  log(`${signal} received, shutting down gracefully`);
  clearInterval(cacheCleanupInterval); // 1. Stop periodic jobs
  server.close(() => {
    // 2. Stop accepting new connections, finish in-flight
    pool.end().then(() => {
      // 3. Close DB pool after all requests drain
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000); // 4. Force exit if stuck
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

**Shutdown order matters:**

1. **Clear intervals** — prevent new background work from starting
2. **`server.close()`** — stops accepting new TCP connections, waits for in-flight requests to complete
3. **`pool.end()`** — releases all database connections (must be after server.close so in-flight queries finish)
4. **Forced exit** — 10-second safety net for stuck connections (e.g., long-polling, WebSocket keepalive)

**When to use:** Every production Express server. Without graceful shutdown, `SIGTERM` from Docker/Kubernetes kills in-flight requests and can corrupt database state.

**References:**

- `server/index.ts` — shutdown handler with cache cleanup + pool.end

### Per-Conversation Quota (vs Per-Message)

When a feature allows iterative refinement within a session (e.g., remix conversations), use per-conversation quota instead of per-message. Only the first user message in a conversation counts against the daily limit; subsequent messages are free refinements.

```typescript
// In createChatMessageWithLimitCheck, for "remix" type:
if (conversationType === "remix") {
  // Check if this conversation already has a user message
  const existingMsgCount = await tx
    .select({ count: sql`count(*)` })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.conversationId, conversationId),
        eq(chatMessages.role, "user"),
      ),
    );

  if (Number(existingMsgCount[0]?.count ?? 0) > 0) {
    // Not the first message — skip quota check, refinements are free
  } else {
    // First message — check shared quota pool
  }
}
```

**Symmetric counting is critical.** When different conversation types share a quota pool, both paths must count the same way. Recipe messages count per-message; remix conversations count as 1 each. The recipe path must also count remix conversations by distinct ID (not by message count), otherwise the total inflates.

```typescript
// Recipe path: count recipe messages + distinct remix conversations
const recipeMessages = /* count user messages in recipe conversations today */;
const remixConversations = /* count DISTINCT remix conversation IDs with user messages today */;
const totalGenerations = recipeMessages + remixConversations;
```

**When to use:** Features that are session-based (AI conversations with refinement, collaborative editing sessions) rather than action-based (individual API calls, scans).

**References:**

- `server/storage/chat.ts` — `createChatMessageWithLimitCheck()` remix branch
- `shared/types/premium.ts` — `dailyRecipeGenerations` shared between recipe + remix

**Origin:** Recipe Remix feature (2026-04-08)
