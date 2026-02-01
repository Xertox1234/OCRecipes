# Learnings from Code Reviews

This document captures key learnings, gotchas, and architectural decisions discovered during code reviews and refactoring sessions.

## Table of Contents

- [Architecture Decisions](#architecture-decisions)
- [React Native / Expo Go Gotchas](#react-native--expo-go-gotchas)
- [Security Learnings](#security-learnings)
- [Simplification Principles](#simplification-principles)
- [Performance Learnings](#performance-learnings)

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

## Key Takeaways

1. **Security:** Authentication + Authorization + Input Validation on every endpoint
2. **React Native:** JWT over cookies, in-memory caching over storage, cleanup over leaks
3. **Simplicity:** Delete unused code, inline over abstraction, explicit over clever
4. **Performance:** Index foreign keys, paginate lists, memoize renders
5. **Types:** Inline response types, proper navigation types, no `any`

---

## Contributing to This Document

When you discover a non-obvious learning during development:

1. Add it to the appropriate section
2. Include code examples showing before/after
3. Explain WHY, not just WHAT
4. Link to relevant commits or files
5. Focus on things that surprised you or weren't obvious
