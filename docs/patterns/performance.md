# Performance Patterns

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
      calorieGoal={user?.dailyCalorieGoal ?? DEFAULT_NUTRITION_GOALS.calories}
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

### Parameterized ID Callbacks for Memoized List Items

When a `React.memo` list item needs multiple action callbacks, define each callback in the parent with an ID parameter `(itemId: number) => void` instead of passing item-specific closures. `React.memo` does shallow comparison on all props -- if even one callback is a new arrow function, the entire component re-renders. By defining `useCallback((itemId: number) => ...)` in the parent, the reference stays stable and `renderItem` passes the same callback to all items. The child calls `onFavourite(item.id)` internally.

**Key insight -- avoid inline closures in renderItem:**

```typescript
// BAD: new closure per item defeats React.memo
<HistoryItem onFavourite={() => toggleFavourite.mutate(item.id)} />

// GOOD: stable reference, child calls onFavourite(item.id)
const handleFavourite = useCallback(
  (itemId: number) => toggleFavourite.mutate(itemId),
  [toggleFavourite],
);
<HistoryItem onFavourite={handleFavourite} />
```

**When to use:** `React.memo` list items with 2+ action callbacks, especially FlatList items with images/animations. **When NOT to use:** Non-memoized components or single-callback components.

**References:**

- `client/screens/HistoryScreen.tsx:785` -- `handleFavourite`, `handleNavigateToDetail`, `handleToggleExpand`, `handleDiscard`
- Related learning: "Inline Arrow Functions in renderItem Defeat React.memo" in LEARNINGS.md

### useMemo for Derived Filtering and Calculations

When filtering an array and then calculating derived values (totals, counts), wrap both operations in a single `useMemo` to avoid redundant computation on every render:

```typescript
// Good: Single memoized computation for filter + calculation
const { selectedFoods, totals } = useMemo(() => {
  const selected = foods.filter((_, index) => selectedItems.has(index));
  return {
    selectedFoods: selected,
    totals: calculateTotals(selected),
  };
}, [foods, selectedItems]);

// Usage in render
<ThemedText>({selectedFoods.length} items selected)</ThemedText>
<ThemedText>Total: {totals.calories} cal</ThemedText>
```

```typescript
// Bad: Recomputed on every render
const selectedFoods = foods.filter((_, index) => selectedItems.has(index));
const totals = calculateTotals(selectedFoods);
```

**When to use:**

- Filtering arrays based on selection state
- Computing totals/aggregates from filtered data
- Any derived state used multiple times in render

**When NOT to use:**

- Simple property access (`user.name`)
- Values used only once in render
- Dependencies that change frequently (defeats memoization)

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

### In-Memory TTL Cache for Per-Request DB Avoidance

Use a `Map`-based cache with time-to-live expiry to avoid hitting the database on every authenticated request. The cache is explicitly invalidated on mutation (e.g., logout bumps `tokenVersion`), so stale data never persists beyond the TTL window.

```typescript
// server/middleware/auth.ts
const cache = new Map<string, { value: number; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCached(key: string): number | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCache(key: string, value: number): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Call on mutation to immediately invalidate */
export function invalidateCache(key: string): void {
  cache.delete(key);
}
```

**Usage pattern (auth middleware):**

```typescript
// Hot path: check cache first, fall back to DB
const cachedVersion = getCachedTokenVersion(payload.sub);
if (cachedVersion !== undefined) {
  // Cache hit — no DB query
  if (payload.tokenVersion !== cachedVersion) {
    return res.status(401).json({ error: "Token revoked" });
  }
} else {
  // Cache miss — query DB, populate cache
  const user = await storage.getUser(payload.sub);
  setCachedTokenVersion(payload.sub, user.tokenVersion);
  if (payload.tokenVersion !== user.tokenVersion) {
    return res.status(401).json({ error: "Token revoked" });
  }
}

// Mutation path: invalidate immediately
export function onLogout(userId: string): void {
  invalidateTokenVersionCache(userId);
}
```

**When to use:**

- Values read on every request but written rarely (auth token versions, user tier, feature flags)
- When the TTL-induced staleness is acceptable for the use case (60s delay before revocation is fine for most auth scenarios)

**When NOT to use:**

- Data that must be real-time consistent (account balances, inventory counts)
- Data that changes frequently relative to the read rate (no benefit from caching)
- Client-side caching (use TanStack Query or AsyncStorage instead)
- Multi-instance deployments without shared cache (each instance has its own Map; use Redis if instances must share state)

**Rationale:** The auth middleware runs on every authenticated request. Without caching, every request triggers a DB query for `tokenVersion`. A Map with 60s TTL reduces DB load to at most one query per user per minute while keeping revocation latency under one minute. Explicit `invalidateCache()` on logout provides instant revocation for the same server instance.

**References:**

- `server/middleware/auth.ts` -- `tokenVersionCache`, `getCachedTokenVersion`, `setCachedTokenVersion`, `invalidateTokenVersionCache`
- See also: [Token Versioning for JWT Revocation](#token-versioning-for-jwt-revocation) in Security Patterns

### Pre-Compiled Regex Cache for Keyword Matching

When a function matches input text against a known static set of keywords using regex, pre-compile the patterns at module load time into a `Map` cache instead of creating new `RegExp` objects inside the loop.

```typescript
// Pre-compiled cache — built once at module load
const keywordPatternCache = new Map<string, RegExp>();

function getKeywordPattern(keyword: string): RegExp {
  let pattern = keywordPatternCache.get(keyword);
  if (!pattern) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(
      `(?:^|[\\s,;/()\\-])${escaped}(?:$|[\\s,;/()\\-])`,
      "i",
    );
    keywordPatternCache.set(keyword, pattern);
  }
  return pattern;
}

// Pre-populate at module load
for (const kw of ALL_KEYWORDS) {
  if (!kw.includes(" ")) getKeywordPattern(kw);
}

// Hot loop uses cached patterns — no compilation overhead
function containsKeyword(text: string, keyword: string): boolean {
  if (keyword.includes(" ")) return text.includes(keyword); // multi-word: substring
  return getKeywordPattern(keyword).test(text); // single-word: cached regex
}
```

**When to use:** Any function that matches input text against a static set of keywords using regex, especially in loops (allergen detection, cultural food name mapping, exercise synonym matching).

**When NOT to use:** Dynamic patterns that change per request, or keyword sets small enough that compilation cost is negligible (< 5 keywords).

**Why:** Regex compilation is expensive relative to `.test()` execution. In allergen detection with 190+ keywords across 100 ingredients, this means thousands of regex compilations per request without caching. The cache reduces this to zero after the first module load.

**References:**

- `shared/constants/allergens.ts` -- `keywordPatternCache`, `getKeywordPattern()`

### Promise Memoization for Concurrent Call Deduplication

When rapid user interactions can trigger the same async operation multiple times before the first call resolves, use promise memoization to collapse concurrent calls into a single execution. While a call is in-flight, subsequent callers receive the same promise. On settle (success or failure), the cache clears so future calls re-execute.

```typescript
import { createPromiseMemo } from "@/lib/promise-memo";

// Create a memoized version of the async operation
const sessionMemo = createPromiseMemo(async () => {
  const response = await api.createSession();
  return response.sessionId;
});

// In rapid-fire handler (e.g., photo capture button mashed 5 times):
async function handleCapture() {
  // All 5 calls return the same promise — only 1 API call is made
  const sessionId = await sessionMemo.call();
  await uploadPhoto(sessionId);
}
```

**How it works:** The first `.call()` executes the factory and caches the resulting promise. Subsequent `.call()` invocations while the promise is pending return the same promise. On resolution or rejection, the cache clears so the next `.call()` creates a fresh promise.

**When to use:**

- Session/resource creation triggered by rapid user interactions (camera captures, button mashing)
- Any idempotent initialization that multiple callers need concurrently

**When NOT to use:**

- Operations that should execute every time (e.g., incrementing a counter)
- Operations with different parameters per call (this pattern is parameterless)

**References:**

- `client/lib/promise-memo.ts` — `createPromiseMemo<T>()` utility
- `client/lib/__tests__/promise-memo.test.ts` — tests including concurrent call deduplication

### Serial Queue for Sequential Async Processing

When concurrent async operations must execute one at a time (e.g., to avoid race conditions on shared state), use a serial queue. Tasks are processed in FIFO order; errors in one task do not block subsequent tasks.

```typescript
import { createSerialQueue } from "@/lib/serial-queue";

const analysisQueue = createSerialQueue();

// Each photo analysis runs only after the previous one finishes
async function handleNewPhoto(photoUri: string) {
  const result = await analysisQueue.enqueue(async () => {
    return await analyzePhoto(photoUri);
  });
  updateIngredients(result);
}

// Even if called rapidly, photos are analyzed sequentially:
// Photo 1 → analyze → done → Photo 2 → analyze → done → ...
```

**How it works:** Each `.enqueue()` chains onto the previous task's promise. The returned promise resolves/rejects with the task's result, while the internal tail promise swallows errors so subsequent tasks still run.

**When to use:**

- Operations that mutate shared state and would corrupt it if run concurrently (e.g., merging AI-detected ingredients into a session)
- Sequential processing where order matters (photo analysis results should apply in capture order)

**When NOT to use:**

- Independent operations that can safely run in parallel (use `Promise.all` instead)
- Operations where you want to cancel/debounce instead of queue (use debounce/throttle)

**Promise memo vs. serial queue:** These solve opposite problems. Promise memo collapses N concurrent calls into 1 (same operation, same result). Serial queue preserves all N calls but sequences them (different operations, different results).

**References:**

- `client/lib/serial-queue.ts` — `createSerialQueue()` utility
- `client/lib/__tests__/serial-queue.test.ts` — tests including FIFO ordering and error isolation

### Hour-Bucket Memoization for Timer-Driven UIs

When a timer fires every N seconds but the derived value only changes at coarser boundaries (e.g., hourly), use a floored bucket as the `useMemo` dependency instead of the raw tick value. This prevents unnecessary recomputation and gives downstream `React.memo` components a stable prop reference.

```typescript
// ❌ BAD: Recomputes every 30 seconds even though phase changes hourly
const currentPhase = useMemo(
  () => getFastingPhase(elapsedMinutes),
  [elapsedMinutes], // changes every 30s
);

// ✅ GOOD: Stable for up to 60 minutes — only recomputes on hour change
const phaseHourBucket = Math.floor(elapsedMinutes / 60);
const currentPhase = useMemo(
  () => getFastingPhase(elapsedMinutes),
  [phaseHourBucket], // changes once per hour
);
```

This also works for `React.memo` sub-components that receive timer-derived data:

```typescript
// Pass the floored value as a prop so React.memo can bail out
<MilestoneMarkers
  targetHours={targetHours}
  passedHours={Math.floor(elapsedMinutes / 60)} // stable per hour
/>
```

**When to use:** Any UI driven by a `setInterval` where the visual output changes at a coarser granularity than the tick rate (e.g., 30s tick but hourly phases, 1s tick but minute-level display).

**References:**

- `client/screens/FastingScreen.tsx` — `phaseHourBucket` for phase memoization
- `client/components/FastingTimer.tsx` — `passedHours` prop for `MilestoneMarkers`
- Discovered during PR #25 performance review

### Destructure `mutate` from TanStack Query Mutations for Stable Deps

The object returned by `useMutation()` is a new reference on every render. If you use the mutation object itself in a `useCallback` dependency array, the callback is recreated every render, defeating memoization. Destructure `{ mutate }` (or `{ mutateAsync }`) at the call site — in TanStack Query v5, the `mutate` function reference is stable across renders.

```typescript
// ❌ BAD: toggleFavourite is a new object every render → handleFavourite recreated every render
const toggleFavourite = useToggleFavourite();
const handleFavourite = useCallback(
  (itemId: number) => toggleFavourite.mutate(itemId),
  [toggleFavourite], // new reference every render!
);

// ✅ GOOD: mutate is stable in TQ v5 → handleFavourite is truly memoized
const { mutate: toggleFavourite } = useToggleFavourite();
const handleFavourite = useCallback(
  (itemId: number) => toggleFavourite(itemId),
  [toggleFavourite], // stable reference
);
```

**When to use:** Any `useCallback` or `useMemo` that depends on a TanStack Query mutation, especially callbacks passed as props to `React.memo` list items.

**When NOT to use:** Inline event handlers that don't need memoization (e.g., a button `onPress` in a non-memoized component).

**Why:** This is particularly impactful in FlatList scenarios where `React.memo` items receive action callbacks. If the callback reference changes every render, every list item re-renders on every parent render, negating the benefit of `React.memo`.

**References:**

- TanStack Query v5 mutation result stability
- Related: "Parameterized ID Callbacks for Memoized List Items" pattern
