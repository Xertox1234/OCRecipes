# Learnings from Code Reviews

This document captures key learnings, gotchas, and architectural decisions discovered during code reviews and refactoring sessions.

## Table of Contents

- [Architecture Decisions](#architecture-decisions)
- [React Native / Expo Go Gotchas](#react-native--expo-go-gotchas)
- [Security Learnings](#security-learnings)
- [Simplification Principles](#simplification-principles)
- [Performance Learnings](#performance-learnings)
- [Caching Learnings](#caching-learnings)
- [Subscription & Payment Learnings](#subscription--payment-learnings)
- [Data Processing Gotchas](#data-processing-gotchas)
- [Testing & Tooling Learnings](#testing--tooling-learnings)
- [Database Migration Gotchas](#database-migration-gotchas)
- [TypeScript Safety Learnings](#typescript-safety-learnings)

---

## Architecture Decisions

### JWT Auth Migration: Why We Left Session-Based Auth

**Problem:** Session-based authentication with `express-session` and HTTP cookies does not work reliably in React Native/Expo Go.

**Root Cause:**

- Expo Go runs in a sandboxed JavaScript environment
- HTTP cookies are not reliably persisted across app restarts
- Cookie storage is inconsistent between iOS and Android in development mode
- Set-Cookie headers from server may be ignored by the native networking layer

**Solution:** Migrate to JWT tokens stored in AsyncStorage with Authorization Bearer headers.

**Implementation:**

1. Server generates JWT tokens on login/register
2. Client stores token in AsyncStorage with in-memory caching
3. Client includes token via `Authorization: Bearer <token>` header on every request
4. Server validates token with middleware, attaches `userId` to `req`

**Key Files:**

- `/Users/williamtower/projects/Nutri-Cam/server/middleware/auth.ts` - JWT generation and validation
- `/Users/williamtower/projects/Nutri-Cam/client/lib/token-storage.ts` - Token persistence with caching
- `/Users/williamtower/projects/Nutri-Cam/shared/types/auth.ts` - Shared auth types

**Commit:** `8e53d96 - Migrate from session-based auth to JWT for Expo Go compatibility`

**Lesson:** When building React Native apps with Expo Go, always use stateless authentication (JWT, OAuth tokens) instead of session cookies. Cookies work in production standalone apps but fail unpredictably in development.

---

### Transaction Simplification: Inline Over Abstraction

**Before:** Created reusable `withTransaction()` helper function:

```typescript
// Over-abstracted
async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}

const result = await withTransaction(async (tx) => {
  // Multi-step operation
});
```

**After:** Inline `db.transaction()` at call site:

```typescript
// Simple and clear
const result = await db.transaction(async (tx) => {
  // Multi-step operation
});
```

**Why the change?**

- The helper added zero value (just wrapped `db.transaction()`)
- Made stack traces harder to read
- Added unnecessary indirection
- No consistency benefit since transactions vary significantly

**Lesson:** Don't create abstractions unless they provide clear value:

- ✅ Reduce duplication (3+ uses)
- ✅ Encapsulate complex logic
- ✅ Enforce invariants
- ❌ "Might need it later"
- ❌ "Looks cleaner"
- ❌ One-line wrappers with no additional logic

**Commit:** `390c6d9 - Resolve code review findings: security, performance, and cleanup`

---

### Response Type Location: Inline vs Shared

**Decision:** Keep API response types inline at the call site, not in shared type files.

**Bad pattern:**

```typescript
// shared/types/models.ts
export interface ScannedItemResponse { ... }
export interface PaginatedResponse<T> { ... }
export interface DailySummaryResponse { ... }

// Becomes a dumping ground for all response shapes
```

**Good pattern:**

```typescript
// client/screens/HistoryScreen.tsx
type ScannedItemResponse = {
  id: number;
  productName: string;
  scannedAt: string;
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};
```

**Why?**

- Response shapes are implementation details of the consuming component
- Tight coupling between client screen and shared type file makes refactoring harder
- When response shape changes, you update it where it's used
- Easier to understand without jumping between files

**Exception:** Auth types used in multiple places (User, AuthResponse) live in `shared/types/auth.ts`.

**Commit:** `390c6d9 - Resolve code review findings` (removed `shared/types/models.ts`)

---

## React Native / Expo Go Gotchas

### React 19 useRef Requires Explicit Initial Value

**Problem:** In React 19, `useRef<T>()` without an initial value argument causes a TypeScript error. This broke during the Phase 4 snackbar timer implementation:

```typescript
// React 18: Works fine
const timerRef = useRef<ReturnType<typeof setTimeout>>();

// React 19: TypeScript error — Argument of type 'undefined' is not assignable
// Fix: Pass undefined explicitly
const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
```

**Root Cause:** React 19 changed the `useRef` type signatures. In React 18, `useRef<T>()` with no argument was typed as `MutableRefObject<T | undefined>`. React 19 made the no-argument overload stricter, requiring `useRef()` to be called as `useRef<T>(undefined)` or `useRef<T>(null)` depending on intent.

**Lesson:** When upgrading to React 19 (or starting a project on React 19), always pass an explicit initial value to `useRef`. For timer refs, `undefined` is the correct initial value (not `null`) since `clearTimeout(undefined)` is a safe no-op.

**Pattern Reference:** See "Auto-Dismiss Snackbar with useRef Timer" in PATTERNS.md

---

### Authorization Headers Must Be Included Everywhere

**Problem:** Initial implementation of `useAuth()` sent credentials on login/register but forgot to include Authorization header in `checkAuth()` call.

```typescript
// Bug: checkAuth() missing Authorization header
async function checkAuth() {
  const response = await fetch(`${apiUrl}/api/auth/me`);
  // Server returns 401, user gets logged out unexpectedly
}
```

**Fix:**

```typescript
async function checkAuth() {
  const response = await apiRequest("GET", "/api/auth/me");
  // apiRequest() includes Authorization header automatically
}
```

**Lesson:** Use a centralized API request helper (`apiRequest()`) that ALWAYS includes the Authorization header. Don't use raw `fetch()` for authenticated endpoints.

**Related Pattern:** Authorization Header Pattern in PATTERNS.md

---

### AsyncStorage is Slow: Cache in Memory

**Observation:** Every API request in initial implementation read token from AsyncStorage (2-10ms per read).

**Impact:**

- 10 API calls = 20-100ms wasted on storage reads
- Stuttering UI when making rapid requests
- Poor user experience on slower devices

**Solution:** In-memory cache with lazy initialization:

```typescript
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
      cacheInitialized = true;
    }
    return cachedToken; // Instant return on subsequent calls
  },
  // ...
};
```

**Performance gain:** First call takes 2-10ms, all subsequent calls take <1ms.

**File:** `/Users/williamtower/projects/Nutri-Cam/client/lib/token-storage.ts`

---

### useEffect Cleanup Prevents Memory Leaks

**Problem:** ScanScreen used `setTimeout()` without cleanup, causing state updates on unmounted components.

**Symptom:** "Warning: Can't perform a React state update on an unmounted component"

**Fix:**

```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    setShowCameraPermission(true);
  }, 1000);

  return () => clearTimeout(timer); // Cleanup
}, []);
```

**Lesson:** ALWAYS return cleanup functions from useEffect hooks that set up:

- Timers (setTimeout, setInterval)
- Event listeners
- Subscriptions
- Animation frames

---

### Stale Closures in Callbacks: State vs Refs

**Problem:** During camera migration, `handleBarcodeScanned` callback checked `isScanning` state to debounce rapid scans, but the check always passed (never blocked duplicate scans).

**Root Cause:** The callback was created with `useCallback` and captured the `isScanning` value at creation time. Even when `isScanning` was updated to `true`, the callback still had the old `false` value in its closure.

```typescript
// Bug: isScanning is always the initial false value
const handleBarcodeScanned = useCallback(
  (barcode: string) => {
    if (isScanning) return; // Never true!
    setIsScanning(true);
    // Process barcode...
  },
  [isScanning],
);
```

**Why adding dependency didn't help:** Adding `isScanning` to the dependency array recreates the callback when state changes, but the check still happens against the captured snapshot. The real issue is that state updates are asynchronous - multiple rapid events can all see `isScanning = false` before any update takes effect.

**Solution:** Use `useRef` for synchronous mutable checks:

```typescript
const isScanningRef = useRef(false);
const [isScanning, setIsScanning] = useState(false);

const handleBarcodeScanned = useCallback((barcode: string) => {
  if (isScanningRef.current) return; // Synchronous check works!
  isScanningRef.current = true;
  setIsScanning(true);
  // Process barcode...
}, []); // No dependencies needed for refs
```

**Key insight:** Use both state AND ref:

- `useRef` for synchronous logic (debouncing, rate limiting)
- `useState` for reactive UI updates (showing loading indicator)

**File:** `/Users/williamtower/projects/Nutri-Cam/client/camera/hooks/useCamera.ts`

**Pattern:** See "useRef for Synchronous Checks in Callbacks" in PATTERNS.md

---

### Camera Library Migration: expo-camera to react-native-vision-camera

**Context:** Migrated from expo-camera to react-native-vision-camera for better performance and ML Kit support.

**Key discoveries during migration:**

1. **Stale closure bug** (see above) - The old expo-camera code worked differently; vision-camera's callback pattern exposed the closure issue.

2. **Cleanup is critical** - The debounce timeout for scan cooldown must be cleaned up on unmount to prevent memory leaks and "state update on unmounted component" warnings.

3. **Style prop typing** - Vision camera components need `StyleProp<ViewStyle>` instead of generic `object` type for proper TypeScript support.

4. **Permission handling differs** - Vision camera has its own permission API; don't mix with Expo's permission system.

**Lesson:** When migrating between libraries with similar APIs, don't assume patterns that worked before will work identically. The underlying callback/event model may differ enough to expose latent bugs.

---

## Security Learnings

### IDOR: Authentication ≠ Authorization

**Vulnerability Found:** GET `/api/scanned-items/:id` had authentication but no ownership check.

```typescript
// IDOR vulnerability - user can access ANY item by guessing IDs
app.get("/api/scanned-items/:id", requireAuth, async (req, res) => {
  const item = await storage.getScannedItem(req.params.id);
  res.json(item); // No check if item.userId === req.userId
});
```

**Fix:** Add ownership verification:

```typescript
app.get("/api/scanned-items/:id", requireAuth, async (req, res) => {
  const item = await storage.getScannedItem(req.params.id);

  if (!item || item.userId !== req.userId) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json(item);
});
```

**Lesson:** For single-resource endpoints (GET /resource/:id), always check:

1. Resource exists
2. Current user owns the resource

Return 404 (not 403) to avoid information disclosure about what IDs exist.

**Pattern:** IDOR Protection in PATTERNS.md

---

### CORS Wildcard is Dangerous

**Before:** `res.header("Access-Control-Allow-Origin", "*")`

**Problem:**

- Allows ANY website to make authenticated requests to your API
- Credentials can be stolen if user visits malicious site
- No protection against CSRF attacks

**Fix:** Pattern-based origin checking:

```typescript
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^exp:\/\/.+$/,
  /^https:\/\/.+\.loca\.lt$/,
];

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Mobile apps have no origin
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}
```

**Lesson:** Never use `Access-Control-Allow-Origin: *` in production. Whitelist specific origins or patterns.

---

### Input Validation Prevents Multiple Attack Vectors

**Added:** Zod validation to all API endpoints.

**Benefits:**

1. **Injection prevention:** Malformed data caught before DB queries
2. **Type safety:** Numbers are numbers, strings are strings
3. **Business logic:** Username regex, min/max lengths enforced
4. **Clear errors:** Users get actionable feedback

**Example Attack Prevented:**

```typescript
// Without validation:
POST /api/auth/register
{ "username": "admin'--", "password": "x" }
// Could lead to SQL injection or logic errors

// With validation:
const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
});
// Request rejected before reaching database
```

**Commit:** `390c6d9 - Add Zod input validation to all API endpoints`

---

## Simplification Principles

### Delete Code Aggressively

**Removed in code review:**

- ~600 LOC of unused web support (landing page, web-specific hooks)
- Unused Spacer component
- Unused chat schema
- Debug console.log statements
- Commented-out code

**Why delete instead of "keep for later"?**

- Unused code has maintenance cost (must be updated when dependencies change)
- Creates confusion ("Is this used? Should I update it?")
- Git history preserves deleted code if you need it back
- YAGNI: You Aren't Gonna Need It

**Lesson:** If code isn't used NOW, delete it. Git history is your safety net.

**Commit:** `390c6d9 - Code cleanup (~600 LOC removed)`

---

### Replace `any` with Proper Types

**Before:**

```typescript
function handleSubmit(data: any) {
  navigation.navigate("NextScreen", { data });
}
```

**After:**

```typescript
import type { HomeScreenNavigationProp } from "@/types/navigation";

function handleSubmit(data: { username: string; password: string }) {
  navigation.navigate("NextScreen", { data });
}
```

**Benefits:**

- Autocomplete in IDE
- Compile-time error checking
- Refactoring safety
- Self-documenting code

**Lesson:** Using `any` is a code smell. If you don't know the type, use `unknown` and narrow with type guards. If you do know the type, define it properly.

---

## Performance Learnings

### Database Indexes Are Not Optional

**Added indexes to:**

- `scannedItems.userId` - Filtered on every query
- `scannedItems.scannedAt` - Sorted on every history query
- `dailyLogs.userId` - Filtered on every query
- `dailyLogs.loggedAt` - Filtered by date range

**Query performance improvement:**

- Before: Full table scan on 10k+ items = ~500ms
- After: Index scan = ~5ms

**Rule of thumb:** Add indexes to columns used in:

- WHERE clauses (especially foreign keys)
- ORDER BY clauses
- JOIN conditions

**Warning:** Too many indexes slow down writes. Only index columns you actually query on.

**File:** `/Users/williamtower/projects/Nutri-Cam/shared/schema.ts`

---

### Pagination Prevents OOM Crashes

**Before:** Loaded ALL scanned items in one query:

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const items = await storage.getAllScannedItems(req.userId);
  res.json(items); // Could be 10,000+ items
});
```

**Problem:**

- Large JSON responses (>10MB) crash mobile devices
- Slow network transfers
- UI freezes rendering huge lists

**After:** Pagination with useInfiniteQuery:

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const result = await storage.getScannedItems(req.userId, limit, offset);
  res.json(result);
});
```

**Client-side:** FlatList virtualization + infinite scroll prevents rendering all items at once.

**Lesson:** ALWAYS paginate list endpoints. Default page size 20-50, max 100. Let clients request more via offset/cursor.

---

## Caching Learnings

### PostgreSQL Caching for AI-Generated Content

**Context:** Implemented server-side caching for OpenAI-generated suggestions and instructions to reduce API costs.

**Key Decisions:**

| Decision              | Choice                                        | Rationale                                                              |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Cache storage         | PostgreSQL table                              | Persistence across restarts, easy querying, cascade deletes            |
| Cache key             | (itemId, userId, profileHash)                 | Unique per user per item, invalidates on profile change                |
| TTL                   | 30 days                                       | AI content doesn't change; long TTL maximizes hit rate                 |
| Expiry check          | Inline in query (`gt(expiresAt, new Date())`) | Single round-trip, no separate cleanup job needed                      |
| Hit tracking          | Fire-and-forget                               | Doesn't block response, failure is non-critical                        |
| Invalidation strategy | Hash-based + eager delete                     | Hash detects content-affecting changes; eager delete on profile update |

**Schema Design:**

```typescript
// Parent cache: indexed on composite key (itemId + userId)
export const suggestionCache = pgTable(
  "suggestion_cache",
  {
    id: serial("id").primaryKey(),
    scannedItemId: integer("scanned_item_id").notNull(),
    userId: varchar("user_id").notNull(),
    profileHash: varchar("profile_hash", { length: 64 }).notNull(),
    suggestions: jsonb("suggestions").notNull(),
    hitCount: integer("hit_count").default(0),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    itemUserIdx: index().on(table.scannedItemId, table.userId),
    expiresAtIdx: index().on(table.expiresAt),
  }),
);

// Child cache: cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" })
    .notNull(),
  // ...
});
```

**Security Consideration - IDOR in Cache Lookups:**

The initial implementation had an IDOR vulnerability in the instruction cache lookup:

```typescript
// ❌ BAD: No authorization check - any user could access cached instructions
const cachedInstruction = await storage.getInstructionCache(
  cacheId,
  suggestionIndex,
);
if (cachedInstruction) {
  return res.json({ instructions: cachedInstruction.instructions });
}
```

**Fix:** Verify the parent suggestion cache belongs to the requesting user:

```typescript
// ✅ GOOD: Verify ownership through parent cache
if (cacheId) {
  const parentCache = await storage.getSuggestionCacheById(cacheId);
  if (parentCache && parentCache.userId === req.userId!) {
    const cachedInstruction = await storage.getInstructionCache(
      cacheId,
      suggestionIndex,
    );
    if (cachedInstruction) {
      return res.json({ instructions: cachedInstruction.instructions });
    }
  }
}
```

**Lesson:** Cache entries that derive from user-specific data must include authorization checks, not just authentication. The cache key alone (numeric ID) is not sufficient authorization.

**Performance Results:**

- Cache hit: ~5ms (database lookup)
- Cache miss: ~2000-3000ms (OpenAI API call)
- Cache hit rate after 1 week: ~85% for returning users

**File References:**

- `/Users/williamtower/projects/Nutri-Cam/shared/schema.ts` - Cache table definitions
- `/Users/williamtower/projects/Nutri-Cam/server/storage.ts` - Cache storage methods
- `/Users/williamtower/projects/Nutri-Cam/server/utils/profile-hash.ts` - Profile hash utility

---

## Subscription & Payment Learnings

### Stub Services Must Fail-Safe in Production

**Vulnerability Found:** Receipt validation stub was initially implemented to auto-approve all receipts unconditionally:

```typescript
// DANGEROUS: Auto-approves in all environments including production
export async function validateReceipt(receipt: string): Promise<Result> {
  // TODO: implement real validation
  return { valid: true, expiresAt: oneYearFromNow() };
}
```

**Impact:** If deployed, any user could upgrade to premium for free by sending any string as a receipt.

**Fix:** Two-layer environment gating:

```typescript
const STUB_MODE = !process.env.APPLE_SHARED_SECRET;

export async function validateReceipt(receipt: string, platform: Platform) {
  if (STUB_MODE) {
    if (process.env.NODE_ENV === "production") {
      console.error("Receipt validation stubbed in production — rejecting.");
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation stubbed — auto-approving in dev.");
    return { valid: true, expiresAt: oneYearFromNow() };
  }
  // Real validation...
}
```

**Lesson:** Stubs that grant access (payment, auth, permissions) must **always** reject in production. Use credential presence (`!process.env.X`) as the stub trigger rather than a manual boolean, so production with credentials works and dev without credentials stubs safely. Add a second layer (`NODE_ENV` check) as defense in depth.

**Pattern:** See "Stub Service with Production Safety Gate" in PATTERNS.md

**File:** `/Users/williamtower/projects/Nutri-Cam/server/services/receipt-validation.ts`

---

### API Response Consistency: Match Existing Conventions

**Problem:** The `sendError()` utility initially included `success: false` in error responses:

```typescript
// Initial implementation
export function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error }); // Extra field
}
```

**Issue:** Every other error response in the codebase uses `{ error: "..." }` without a `success` field. Adding `success: false` to subscription endpoints created an inconsistency that clients would need to handle differently.

**Fix:** Removed `success: false` to match the established convention:

```typescript
// Fixed: Matches existing pattern
export function sendError(
  res: Response,
  status: number,
  error: string,
  options?: ErrorOptions,
) {
  const body: Record<string, unknown> = { error };
  if (options?.code) body.code = options.code;
  res.status(status).json(body);
}
```

**Lesson:** Before introducing a helper that standardizes responses, check the existing response format. A utility that deviates from the established convention creates more inconsistency than it solves. When in doubt, grep for `res.status(` and `res.json({` to see the existing pattern.

**Related:** Also caught `UpgradeResponseSchema` using `z.string()` for the tier field instead of the domain-specific `subscriptionTierSchema`. When referencing a constrained value in a Zod schema, always reuse the existing domain schema rather than a generic `z.string()`. This ensures client-side validation catches invalid values the same way the server does.

---

### Restore Endpoints Need the Same Rigor as Purchase Endpoints

**Problem:** The upgrade endpoint had Zod validation, rate limiting, and transaction logging, but the restore endpoint was implemented with manual field checks and no transaction logging.

**Root Cause:** Restore feels "less important" than purchase since it doesn't charge the user. This creates a false sense that it needs less protection.

**Why it matters:**

- A restore without Zod validation accepts malformed data that could cause downstream errors
- A restore without transaction logging creates a gap in the audit trail
- A restore without rate limiting can be abused to probe for valid receipts

**Fix:** Applied identical safeguards to the restore endpoint: `RestoreRequestSchema.safeParse()`, `subscriptionRateLimit`, and `createTransaction()` call.

**Lesson:** When building paired endpoints (create/restore, subscribe/unsubscribe, save/delete), apply the same validation, rate limiting, and logging to both. The "less important" endpoint is often the one attackers target because developers protect it less.

---

### Hardcoded Tier Limits Silently Drift from Centralized Config

**Problem:** The saved items limit was hardcoded as `6` in `storage.ts`, `SavedItemsScreen.tsx`, and `SaveButton.tsx`, while `TIER_FEATURES` in `shared/types/premium.ts` was the intended single source of truth for all tier-dependent limits.

**How it happened:** When the saved items feature was first built, `TIER_FEATURES` didn't have a `maxSavedItems` property yet. The developer used a literal `6` as a quick implementation. Later, `TIER_FEATURES` became the canonical config for tier limits (scans, suggestions, recipes), but the saved items limit was never migrated. The hardcoded `6` continued to work correctly — it just wasn't connected to the config system.

**Why it's dangerous:** If someone later changed the free tier's saved items limit in `TIER_FEATURES`, the config change would have no effect because the actual enforcement was hardcoded elsewhere. The code would appear to respect the config (since `TIER_FEATURES` existed) but silently ignore it.

**Fix:** Added `maxSavedItems` to the `PremiumFeatures` interface and `TIER_FEATURES` config, then replaced all hardcoded `6` references with `features.maxSavedItems` (server) and `features.maxSavedItems` via `usePremiumContext()` (client).

**Lesson:** When adding a new tier-dependent limit, always follow the full path: add to `PremiumFeatures` interface -> set per-tier value in `TIER_FEATURES` -> consume via `features.X`. Never use a magic number as a "temporary" solution — it becomes permanent the moment someone else reads the code and assumes the config is authoritative. Grep for literal numbers when reviewing tier-related code.

**Pattern Reference:** See "Tier-Gated Route Guards" in PATTERNS.md (key element #5)

---

## Data Processing Gotchas

### Longest-Keyword-Match Prevents False Category Assignment

**Problem:** Ingredient auto-categorization used first-match substring search. "Ground cumin" matched the keyword "ground" in the meat category before reaching "cumin" in spices, causing cumin to appear in the meat aisle of grocery lists.

**Root Cause:** The original loop broke on the first keyword match. Generic keywords like "ground" (meat), "cream" (dairy), and "white" (other) are substrings of many compound ingredient names ("ground cumin", "cream of tartar", "white wine vinegar").

**Solution:**

```typescript
// Before (first-match — bug)
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw)) return category; // "ground" matches first!
  }
}

// After (longest-match — correct)
let bestMatch: { category: string; length: number } | null = null;
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw) && (!bestMatch || kw.length > bestMatch.length)) {
      bestMatch = { category, length: kw.length };
    }
  }
}
return bestMatch?.category ?? "other";
```

Additionally, removed ambiguous single-word keywords ("ground", "cream") from category lists and replaced them with specific compound terms ("ground beef", "ground pork", "cream cheese", "sour cream").

**Lesson:** When categorizing text with keyword lists, always use longest-match to resolve ambiguity. Short generic keywords are especially dangerous — prefer specific compound terms over single words that appear in many contexts.

**File:** `server/services/grocery-generation.ts`

---

### Truthy Default Values Bypass Fallback Logic

**Problem:** Ingredients from the database had `category: "other"` (the default column value). The grocery list aggregator intended to re-categorize uncategorized ingredients, but the `||` fallback never ran because `"other"` is truthy:

```typescript
// Bug: "other" is truthy, so categorizeIngredient() never runs
category: ing.category || categorizeIngredient(normalized);
```

**Fix:** Explicitly check for the sentinel value:

```typescript
// Correct: treat "other" as uncategorized
category: ing.category && ing.category !== "other"
  ? ing.category
  : categorizeIngredient(normalized);
```

**Lesson:** When a database column has a default string value that represents "unset" (e.g., `"other"`, `"none"`, `"default"`), JavaScript's `||` operator will treat it as a valid value. Always check for the sentinel explicitly: `value && value !== "sentinel"`. This is a common trap when database defaults are truthy strings rather than `null`.

**File:** `server/services/grocery-generation.ts`

---

## Testing & Tooling Learnings

### Module-Level Service Client Initialization Breaks Test Imports

**Problem:** `meal-suggestions.ts` instantiated the OpenAI client at the top of the module:

```typescript
// Before: top-level — breaks any test that imports this module
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, // undefined in test env
});
```

Any test file that imported the module (even to test a pure helper function exported from the same file) crashed because `AI_INTEGRATIONS_OPENAI_API_KEY` was not set in the test environment.

**Solution:** Lazy singleton initialization:

```typescript
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}
```

The client is only instantiated when a function that actually calls the API is invoked, not when the module is imported.

**Lesson:** Never instantiate external service clients (OpenAI, Stripe, AWS SDK, etc.) at module scope if the module exports any functions that tests might import. Use a lazy getter function instead. This applies to all server services — note that `photo-analysis.ts`, `recipe-generation.ts`, and `routes.ts` still use module-level initialization and would break if their exports were tested directly.

**File:** `server/services/meal-suggestions.ts`

---

### Vitest Cannot Import React Native Modules

**Problem:** Tests for `usePurchase` hook initially imported the hook directly. Vitest (which uses Vite/Rollup under the hood) failed with parse errors on React Native's JSX runtime and native module bindings.

**Error (abbreviated):**

```
SyntaxError: Unexpected token
 > import { Platform } from "react-native";
              ^

[vite] Pre-transform error: Failed to resolve import "react-native"
```

**Root Cause:** Vitest runs in Node.js, not in a Metro bundler environment. React Native modules (`react-native`, `expo-haptics`, `expo-iap`, etc.) contain native bindings and JSX that Vite's Rollup-based transform pipeline cannot parse. Unlike Jest (which can be configured with `react-native` presets and module mappers), Vitest has no built-in RN transform support.

**Solution:** Extract all testable business logic into pure `*-utils.ts` files that import **only** from `@shared/` or plain TypeScript modules. Test those files instead of the hooks.

```
# Testable (no RN imports)
client/lib/iap/purchase-utils.ts         → mapIAPError, buildReceiptPayload, isSupportedPlatform
client/components/upgrade-modal-utils.ts → BENEFITS, getCtaLabel, isCtaDisabled

# Not directly testable in Vitest (imports RN)
client/lib/iap/usePurchase.ts
client/components/UpgradeModal.tsx
```

**Lesson:** In a Vitest + React Native project, draw a hard boundary: pure logic in `*-utils.ts` (testable), React/RN-dependent code in hooks/components (tested via simulator or integration tests). Do not try to mock `react-native` in Vitest -- it leads to fragile mocks that break on RN upgrades.

**Pattern:** See "Pure Function Extraction for Vitest Testability" in PATTERNS.md

---

### `__DEV__` Conditional Require for Mock/Real Module Switching

**Decision:** The IAP (In-App Purchase) module needs a mock implementation in development and the real `expo-iap` library in production native builds. We chose `__DEV__` (Metro's build-time global) with `require()` rather than environment variables or other approaches.

**Implementation:**

```typescript
// client/lib/iap/index.ts
const USE_MOCK = __DEV__;

let _useIAP: () => UseIAPResult;

if (USE_MOCK) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require("./mock-iap");
  _useIAP = mock.useIAP;
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoIap = require("expo-iap");
  _useIAP = expoIap.useIAP;
}

export const useIAP: () => UseIAPResult = _useIAP;
```

**Why `__DEV__` over `.env` variables:**

| Approach                        | Pros                                                                                            | Cons                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `__DEV__`                       | Automatically correct in dev vs prod; no config needed; Metro strips dead branch in prod builds | Requires `eslint-disable` for `require()`                                              |
| `EXPO_PUBLIC_USE_MOCK_IAP=true` | Standard env pattern                                                                            | Easy to misconfigure; env vars persist across builds; developer must remember to unset |
| Dynamic import `await import()` | No `require()`                                                                                  | Async at module level; complicates hook initialization                                 |

**Key details:**

1. The `_useIAP` variable must be explicitly typed as `() => UseIAPResult` to avoid `any` (code review finding H1)
2. The `require()` calls need `eslint-disable` comments since our ESLint config forbids CommonJS require (code review finding H2)
3. Both branches must conform to the same `UseIAPResult` interface -- the type contract is the abstraction boundary

**Lesson:** When a module needs a dev stub that cannot coexist with the real implementation (because the real module only loads on native builds), use `__DEV__` conditional require with a shared type interface. This is the React Native equivalent of the server-side "Stub Service with Production Safety Gate" pattern.

**File:** `client/lib/iap/index.ts`

---

### Mounted Ref Guard for Async Hooks

**Problem:** The `usePurchase` hook runs async operations (IAP purchase, server receipt validation, subscription refresh) that may complete after the component unmounts. Calling `setState` on an unmounted component causes React warnings and can mask bugs.

**Solution:** A `mountedRef` + `safeSetState` wrapper:

```typescript
export function usePurchase() {
  const [state, setState] = useState<PurchaseState>({ status: "idle" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((newState: PurchaseState) => {
    if (mountedRef.current) {
      setState(newState);
    }
  }, []);

  // All async flows use safeSetState instead of setState
  const purchase = useCallback(async () => {
    safeSetState({ status: "loading" });
    try {
      // ... long async chain
      safeSetState({ status: "success" });
    } catch (error) {
      safeSetState({ status: "error", error: mapIAPError(error) });
    }
  }, [safeSetState]);
}
```

**Why not just useEffect cleanup with AbortController?** The IAP purchase flow spans multiple async steps (store purchase, server validation, transaction finish) from different libraries. An AbortController cannot cancel a store dialog or a `finishTransaction` call. The mounted ref is a simpler guard that lets the async chain complete but silently drops the state update if the component is gone.

**Lesson:** For hooks with multi-step async flows that cross library boundaries, a mounted ref guard is simpler and more reliable than trying to cancel each step. Use `safeSetState` consistently throughout the hook -- never call raw `setState` in an async callback.

**File:** `client/lib/iap/usePurchase.ts`

---

## Database Migration Gotchas

### getDailySummary LEFT JOIN Rewrite: When Nullable FKs Break INNER JOINs

**Problem:** The `getDailySummary()` storage method used INNER JOIN on `scannedItems` to aggregate daily nutrition. When Phase 4 added meal plan confirmation (creating `dailyLogs` with `scannedItemId: null` and `recipeId` pointing to a meal plan recipe), all confirmed meal plan items became invisible in the daily summary.

**Root Cause:** INNER JOIN drops rows where the join key is NULL. Before Phase 4, every daily log had a non-null `scannedItemId`, so INNER JOIN worked. Making `scannedItemId` nullable (to support meal confirmation logs that reference recipes instead of scanned items) silently broke the aggregation.

```typescript
// Before (Phase 3): INNER JOIN — worked because scannedItemId was always non-null
const result = await db
  .select({ totalCalories: sql`SUM(${scannedItems.calories} * ...)` })
  .from(dailyLogs)
  .innerJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id));
// Meal plan confirmation logs with scannedItemId=null are silently dropped!

// After (Phase 4): LEFT JOINs with COALESCE fallback chain
const result = await db
  .select({
    totalCalories: sql`COALESCE(SUM(
      COALESCE(CAST(${scannedItems.calories} AS DECIMAL),
               CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL), 0)
      * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
  })
  .from(dailyLogs)
  .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
  .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id));
```

**Key details:**

1. The nested `COALESCE` tries `scannedItems.calories` first, falls back to `mealPlanRecipes.caloriesPerServing`, then to `0`
2. The outer `COALESCE(..., 0)` handles the case where SUM returns NULL (no rows for the day)
3. All string-stored numbers need `CAST(... AS DECIMAL)` for arithmetic

**Lesson:** When making a previously non-null foreign key nullable, audit all queries that JOIN on that column. INNER JOINs silently drop rows with NULL keys. This is especially dangerous in aggregation queries because the result looks correct (it's a valid number) — you just don't notice the missing rows.

**File:** `/Users/williamtower/projects/Nutri-Cam/server/storage.ts` — `getDailySummary()`

**Pattern Reference:** See "LEFT JOIN with COALESCE for Nullable Foreign Keys" in PATTERNS.md

---

## TypeScript Safety Learnings

### Unsafe `as` Casts Hide Runtime Bugs in Tier Lookups

**Problem:** The grocery list deductPantry route used `as SubscriptionTier` to cast the subscription tier string before indexing into `TIER_FEATURES`:

```typescript
// Bug: tier could be any string from the database
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier as SubscriptionTier];
// If tier is not in TIER_FEATURES (e.g., "premium_legacy"), features is undefined
// Subsequent features.pantryTracking throws: Cannot read property 'pantryTracking' of undefined
```

**Root Cause:** Drizzle's `text()` columns return `string`, not the union type. The `as SubscriptionTier` cast tells TypeScript the value is valid without performing any runtime check. If the database ever contains a value not in the `subscriptionTiers` tuple (from a migration, manual edit, or future tier rename), the code silently produces `undefined` instead of a valid features object.

**Fix:** Replace the cast with a type guard:

```typescript
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

const tier = subscription?.tier || "free";
const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
// Invalid tiers safely fall back to "free"
```

**Lesson:** `as TypeName` is a compile-time-only assertion. It should never be used on data from external sources (database, API, user input) because it provides zero runtime safety. Always use a type guard that performs an actual `includes()` or `in` check, with a safe fallback for invalid values. The one-time cost of writing the guard prevents an entire class of "undefined is not an object" runtime errors.

**Pattern Reference:** See "Type Guard Over `as` Cast for Runtime Safety" in PATTERNS.md

---

## Key Takeaways

1. **Security:** Authentication + Authorization + Input Validation on every endpoint
2. **React Native:** JWT over cookies, in-memory caching over storage, cleanup over leaks
3. **Simplicity:** Delete unused code, inline over abstraction, explicit over clever
4. **Performance:** Index foreign keys, paginate lists, memoize renders
5. **Types:** Inline response types, proper navigation types, no `any`
6. **Caching:** Fire-and-forget for non-critical ops, hash-based invalidation for user-dependent content
7. **Stubs & Mocks:** Services that grant access must fail-safe in production; derive stub mode from credential presence, not manual flags
8. **Paired Endpoints:** Apply identical safeguards (validation, rate limiting, logging) to both sides of a paired operation (purchase/restore, create/delete)
9. **Testing:** Extract pure functions from RN hooks/components into `*-utils.ts` files for Vitest testability; Vitest cannot parse React Native imports
10. **Data Processing:** Use longest-match for keyword categorization; treat truthy sentinel defaults (`"other"`, `"none"`) as unset with explicit checks
11. **Service Initialization:** Lazy-init external clients (OpenAI, Stripe) to keep modules importable by tests without credentials
12. **Type Safety:** Never use `as` casts on external data — use type guards with safe fallbacks. `as` hides runtime bugs that only surface in production.
13. **Schema Migrations:** When making a FK nullable, audit all JOINs on that column — INNER JOINs silently drop NULL rows, breaking aggregations

---

## Contributing to This Document

When you discover a non-obvious learning during development:

1. Add it to the appropriate section
2. Include code examples showing before/after
3. Explain WHY, not just WHAT
4. Link to relevant commits or files
5. Focus on things that surprised you or weren't obvious
