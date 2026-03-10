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
