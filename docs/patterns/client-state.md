# Client State Patterns

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

### Typed ApiError Class for Client-Side Error Differentiation

When mutation hooks call `apiRequest` and need to **throw** on errors (rather than returning a discriminated union), use the `ApiError` class to carry a machine-readable `code` through TanStack Query's error flow:

```typescript
// client/lib/api-error.ts
export class ApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

// In the mutation hook — throw ApiError with the server's error code
import { ApiError } from "@/lib/api-error";

export function useMealSuggestions() {
  return useMutation({
    mutationFn: async (params) => {
      const res = await apiRequest("POST", "/api/meal-plan/suggest", params);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new ApiError(body.error || `${res.status}`, body.code);
      }
      return res.json();
    },
  });
}

// In the component — check error type without string parsing
const mutation = useMealSuggestions();

const isLimitReached =
  mutation.error instanceof ApiError &&
  mutation.error.code === "DAILY_LIMIT_REACHED";

if (isLimitReached) {
  // Show specific limit-reached UI
}
```

**When to use:**

- The error should trigger TanStack Query's `isError` state (loading spinners stop, retry is available)
- Multiple distinct error codes from the same endpoint need different UI treatment
- The component reads `mutation.error` to decide what to render

**When NOT to use:**

- The "error" is a recoverable business condition that should not show error UI — use "Business Logic Errors in Mutations" (discriminated union) instead
- Only one kind of error matters and a simple `isError` check suffices

**Choosing between ApiError throw vs discriminated union return:**

| Criterion                           | ApiError (throw)           | Discriminated Union (return)   |
| ----------------------------------- | -------------------------- | ------------------------------ |
| Should TanStack show error state?   | Yes                        | No                             |
| Need to distinguish error subtypes? | Yes, via `error.code`      | Yes, via `result.limitReached` |
| Typical use case                    | Rate limits, premium gates | Soft limits, save conflicts    |

**References:**

- `client/lib/api-error.ts` — ApiError class
- `client/hooks/useMealSuggestions.ts` — throws ApiError
- `client/components/MealSuggestionsModal.tsx` — checks `error.code`
- Server-side: see "Tier-Gated Route Guards" and "Error Response Structure" patterns

### useQuery Over useState+useEffect for Server Data

Always use TanStack Query's `useQuery` (or `useMutation`) for fetching server data. Never use the `useState` + `useEffect` pattern to fetch and store server data manually.

```typescript
// Bad: Manual fetch with useState+useEffect
const [confirmedIds, setConfirmedIds] = useState<number[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  async function fetch() {
    setLoading(true);
    const res = await apiRequest("GET", "/api/daily-summary");
    const data = await res.json();
    setConfirmedIds(data.confirmedMealPlanItemIds ?? []);
    setLoading(false);
  }
  fetch();
}, [date]);
// Problems: no caching, no refetch on focus, no error handling, no deduplication

// Good: useQuery + useMemo for derived state
const { data: dailySummary, isLoading } = useQuery({
  queryKey: ["/api/daily-summary", date],
  queryFn: async () => {
    const res = await apiRequest("GET", `/api/daily-summary?date=${date}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  },
});

const confirmedIds = useMemo(
  () => new Set(dailySummary?.confirmedMealPlanItemIds ?? []),
  [dailySummary?.confirmedMealPlanItemIds],
);
```

**When to use:** Always, for any data fetched from the server.

**When NOT to use:** Client-only state (form inputs, UI toggles, animation values) should use `useState` or `useRef`.

**Key benefits:**

1. **Automatic caching and deduplication** — multiple components requesting the same data get a single request
2. **Refetch on focus** — data refreshes when user returns to the screen
3. **Loading/error states** — built-in `isLoading`, `error`, `isRefetching`
4. **Derived data via `useMemo`** — transform query results without re-fetching

**References:**

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — derives `confirmedIds` Set from daily summary query
- `client/hooks/useMealPlan.ts` — all meal plan data fetching via useQuery

### `enabled` Parameter for Premium-Gated Queries

When a query fetches data for a premium-only feature, pass an `enabled` parameter to prevent free-tier users from making unnecessary API calls that would return 403.

```typescript
// Hook accepts enabled parameter with sensible default
export function useExpiringPantryItems(enabled = true) {
  return useQuery<PantryItem[]>({
    queryKey: ["/api/pantry/expiring"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pantry/expiring");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled, // Only fires when enabled is true
  });
}

// Caller passes premium feature flag
const features = usePremiumFeatures();
const { data: expiringItems } = useExpiringPantryItems(features.pantryTracking);
```

**When to use:**

- Any query hook that fetches premium-only data
- Queries gated behind a feature flag or user capability
- Conditional data fetching where the condition is known upfront

**When NOT to use:**

- Queries that all users can access
- Queries where you want a 403 error to display a paywall (use error handling instead)

**References:**

- `client/hooks/usePantry.ts` — `useExpiringPantryItems(enabled)`
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — passes `features.pantryTracking`

### Optimistic Mutation on Infinite Query Pages

When mutating an item in a `useInfiniteQuery` list, update the cache optimistically by mapping over all pages. The `onMutate` handler should: (1) cancel in-flight refetches, (2) snapshot previous data for rollback, (3) map over `old.pages` to update the target item, and (4) return the snapshot for `onError` rollback. Always call `invalidateQueries` in `onSettled` to reconcile with the server.

**Key insight -- per-page total correction for removals:**

```typescript
// When removing an item, only decrement total on the page that contained it.
// Decrementing on ALL pages corrupts pagination offsets.
pages: old.pages.map((page) => {
  const filtered = page.items.filter((item) => item.id !== itemId);
  return {
    ...page,
    items: filtered,
    total: filtered.length < page.items.length ? page.total - 1 : page.total,
  };
}),
```

**Key pitfalls:**

1. **Must cancel in-flight queries first** -- without `cancelQueries()`, a pending refetch can overwrite your optimistic update
2. **Per-page total correction** -- decrementing `total` on ALL pages breaks pagination. Only decrement on the page that contained the removed item.
3. **Invalidate related queries in `onSettled`** -- if the mutation affects aggregation queries (e.g., daily summary), invalidate those too

**References:**

- `client/hooks/useFavourites.ts` -- toggle optimistic update
- `client/hooks/useDiscardItem.ts` -- removal with per-page total correction
- Related learning: "Optimistic Total Must Target Correct Page" in LEARNINGS.md

### Client-Side API Timeout with Promise.race

When a client-side API call gates a UX decision (e.g., navigate to screen A vs screen B), wrap it in `Promise.race` with a timeout to prevent the user from being stuck on slow or unresponsive networks. Unlike server-side `AbortSignal.timeout()`, this pattern works with `apiRequest()` which doesn't accept a signal parameter.

**Key elements:**

1. **Short timeout (2-3s)** — the user is waiting with no visible feedback, so fail fast
2. **Safe default on failure** — the `catch` block picks the more cautious path (e.g., prompt for more data rather than skipping)
3. **No loading spinner** — the timeout is short enough that adding a loading state would cause more visual churn than the brief pause

```typescript
// client/screens/ScanScreen.tsx — barcode verification check
let verified = false;
try {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 3000),
  );
  const res = await Promise.race([
    apiRequest(
      "GET",
      `/api/nutrition/barcode/${encodeURIComponent(barcode)}/verification`,
    ),
    timeout,
  ]);
  const data = await res.json();
  verified = data.verified === true;
} catch {
  // Network error or timeout — default to the cautious path
  verified = false;
}

if (verified) {
  navigation.navigate("NutritionDetail", { barcode });
} else {
  navigation.navigate("Scan", { mode: "label", barcode });
}
```

**When to use:** Client-side API calls that gate navigation decisions or UX branching, where the user is waiting with no loading indicator.

**When NOT to use:** Data-fetching queries managed by TanStack Query (which has its own retry/timeout behavior), or server-side external API calls (use `AbortSignal.timeout()` instead — see "Fetch Timeout with AbortSignal for External APIs").

**References:**

- `client/screens/ScanScreen.tsx` — barcode verification before navigation
- Related pattern: "Fetch Timeout with AbortSignal for External APIs" (server-side equivalent)

### Ref-Based Context for High-Frequency Updates

When a context manages data that updates rapidly (e.g., barcode scans at 1/second), store the full data in `useRef` and only expose derived counts in reducer state. Consumers that need the full list call `getItems()` on-demand (e.g., on mount). Consumers that need live counts (camera overlay badge) subscribe to the minimal state.

```typescript
// Context stores items in ref, counts in state
const itemsRef = useRef<BatchItem[]>([]);
const [state, dispatch] = useReducer(reducer, {
  itemCount: 0,
  pendingCount: 0,
});

// Camera screen only re-renders for itemCount (not 50 nutrition lookups resolving)
const { itemCount } = useBatchScan();

// Summary screen reads full list once on mount
const items = getItems(); // returns [...itemsRef.current]
```

**Context owns fetch lifecycle with AbortController:**

```typescript
// AbortControllers stored per-item in a Map
const abortControllersRef = useRef(new Map<string, AbortController>());

// Lookups continue across navigation (context persists at app root)
// clearSession() aborts all pending lookups
const clearSession = useCallback(() => {
  for (const controller of abortControllersRef.current.values()) {
    controller.abort();
  }
  abortControllersRef.current.clear();
  itemsRef.current = [];
  dispatch({ type: "CLEAR" });
}, []);
```

**Concurrency throttle with queue:**

```typescript
const MAX_CONCURRENT = 3;
const inFlightRef = useRef(0);
const queueRef = useRef<{ id: string; barcode: string }[]>([]);

// processQueue() drains queue when a slot opens (called in finally block)
```

**When to use:** Context that manages async operations producing rapid state changes where most consumers only need aggregate values (counts, totals, latest status), not the full dataset.

**References:**

- `client/context/BatchScanContext.tsx` — ref-based items with reducer counts
