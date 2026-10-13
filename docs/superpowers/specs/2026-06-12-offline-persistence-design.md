# Offline Persistence Design

**Date:** 2026-06-12
**Status:** Approved
**Scope:** Durable offline mutation queue (A), query cache persistence (B), per-feature offline guards (C)

---

## Background

The app's offline story has solid detection and signalling (`useNetworkStatus`, `OfflineBanner`, TanStack `onlineManager` wired to NetInfo, `resumePausedMutations` on reconnect) but three meaningful gaps:

1. **No durable mutation queue** — mutations that are paused in-memory while offline are lost on force-quit or crash.
2. **No query cache persistence** — the TanStack in-memory cache is wiped on every cold launch; users on airplane mode see empty screens.
3. **No per-feature offline guards** — only the global `OfflineBanner` signals offline state; individual mutation surfaces don't adapt their UI.

This spec covers all three in sequenced order: A → B → C.

---

## Section A — Durable Offline Mutation Queue

### Scope

Protected mutations (Option 1 — core logging only):

- `POST /api/scanned-items` — `addToLogMutation` in `useNutritionLookup.ts` (scan-to-log confirmation)
- `POST /api/scanned-items` — `logAllMutation` in `useQuickLogSession.ts` (quick-log batch)
- `DELETE /api/scanned-items/:id` — `useDiscardItem.ts`, called via `useHistoryData.ts` (log entry deletion)

All other mutations — including chat, recipe generation, recipe saves, cookbook additions, and grocery list edits — are out of scope for this feature. AI/streaming mutations require live server computation and can never be queued.

### Data Model

**File:** `client/lib/offline-queue.ts`
**Storage key:** `@ocrecipes_offline_queue`

```ts
interface QueuedMutation {
  id: string; // uuid, for idempotent dequeue
  endpoint: string; // e.g. "/api/scanned-items"
  method: string; // "POST" | "PATCH" | "DELETE"
  body: unknown; // serializable JSON payload
  attempts: number; // incremented on each retry attempt
  savedAt: number; // ms timestamp, for TTL eviction
}
```

The module exposes:

- `initOfflineQueue(): Promise<void>` — loads from AsyncStorage, calls `clearStale()` to evict items older than 24 hours, then populates the in-memory array
- `enqueue(item: Omit<QueuedMutation, 'id' | 'attempts' | 'savedAt'>): Promise<void>` — appends to queue; enforces a **max depth of 50 items** (FIFO eviction: oldest item dropped when the cap is reached)
- `dequeue(id: string): Promise<void>` — removes one item by id
- `loadQueue(): QueuedMutation[]` — synchronous read of the in-memory array
- `clearStale(): Promise<void>` — evicts records older than 24 hours; called by `initOfflineQueue()` on startup

The in-memory array is the source of truth for reads after init. Writes are fire-and-forget to AsyncStorage (mirrors the `token-storage.ts` read-through pattern). UUIDs are generated via `crypto.randomUUID()` (available in React Native Hermes).

**Max queue depth rationale:** a user logging food offline would need to confirm 50+ items without ever reconnecting to overflow the queue. The cap prevents unbounded AsyncStorage growth; FIFO eviction preserves the most recent entries.

### Integration with Mutation Hooks

Each of the three protected mutation hooks gains an offline check in its `mutationFn` (before calling `apiRequest`):

```ts
mutationFn: async (payload) => {
  if (!onlineManager.isOnline()) {
    await enqueue({
      endpoint: "/api/scanned-items",
      method: "POST",
      body: payload,
    });
    return; // early return — TanStack treats this as a successful mutation
  }
  // existing apiRequest call
};
```

**TypeScript widening:** the early-return path returns `undefined`. Each protected mutation's `TData` type must be widened to `T | undefined`, and any `onSuccess` callback must accept `data: T | undefined` and guard accordingly before accessing response fields.

**`logAllMutation` batch fan-out:** `logAllMutation` in `useQuickLogSession.ts` fans out N concurrent `apiRequest` calls (one per `ParsedFoodItem`). Offline, each item is enqueued as a **separate `QueuedMutation` entry** — the queue drains them serially on reconnect, preserving order. The existing `failedIndices`-based partial-error path in `onError` is bypassed offline (the mutation short-circuits before any server calls), and `onSuccess` fires pre-server-confirmation. This is a semantic shift: in the online path `onSuccess` means "server confirmed all items"; in the offline path it means "all items were enqueued". Callers relying on `onSuccess` for navigation or UI feedback must be aware that server confirmation is deferred.

**Idempotency:** each `QueuedMutation.id` (UUID) is sent as an `X-Idempotency-Key` request header during drain. This prevents duplicate log entries if the server processed a request but the response was lost before the client received it (e.g. app killed mid-flight). Server-side: `POST /api/scanned-items` must check for a pre-existing item with the same idempotency key and return the existing record rather than creating a duplicate. This server-side dedup is **in scope for Phase 1**.

**`useDiscardItem` edge case:** this hook already has an optimistic update (`onMutate`) that removes the item from the in-memory cache immediately. With the Section B persister (1 s throttle), if the app force-quits within that window, a cold launch may briefly show the deleted item until the queued DELETE drains and `onSettled` invalidates the query. This is acceptable transient behavior — no data is lost and the UI self-corrects within seconds of reconnect.

The queue owns the retry entirely. TanStack does not see a paused mutation for these — once a queued mutation is replayed and succeeds, `queryClient.invalidateQueries` is called on the relevant query keys so the UI refreshes.

### Drain Logic

**File:** `client/lib/offline-queue-drain.ts`

`offline-queue-drain.ts` imports `apiRequest` and `queryClient` from `query-client.ts`. To avoid a circular dependency, it does **not** import from `query-client.ts`'s `onlineManager.subscribe` callback — the drain is wired externally. `offline-queue-drain.ts` owns its own error pub/sub emitter (mirroring `subscribeToQueryErrors` / `subscribeToSessionExpiry` in `query-client.ts`):

```ts
// offline-queue-drain.ts
export function subscribeToQueueDrainErrors(
  listener: (msg: string) => void,
): () => void;
```

A new **`OfflineQueueBridge`** component (sibling to `SessionExpiryBridge` and `QueryErrorToastBridge` in `App.tsx`) subscribes to this emitter and shows a toast. Drain errors are **not** routed through `queryErrorListeners` — that channel is scoped to query (read) failures only.

**Wiring `drainQueue`:** `onlineManager.subscribe` in `query-client.ts` already fires `resumePausedMutations()` on reconnect. `drainQueue()` is called from `App.tsx` (or a thin init module imported by `App.tsx`) by subscribing to `onlineManager` directly — outside `query-client.ts` — eliminating the circular dependency entirely.

`drainQueue()` drains serially, in `savedAt` ascending order, so log entries replay in chronological order.

**Retry schedule:** immediate → 2 s → 4 s → 8 s (max 4 attempts per item).

On each attempt:

- **Before the `apiRequest` call:** increment `attempts` in both the in-memory array and AsyncStorage. This ensures a mid-drain force-quit resumes at the correct attempt count rather than restarting from zero.
- Send `X-Idempotency-Key: <item.id>` as a request header on `POST` calls.
- **Success:** call `dequeue(id)`, invalidate affected query keys via `queryClient.invalidateQueries`.
- **Failure (transient / 5xx):** if `attempts >= 4`, call `dequeue(id)` and emit via `subscribeToQueueDrainErrors`.
- **Failure (4xx client error):** treat as permanent — `dequeue` immediately and emit error (retrying a 400/404 will never succeed).

The drain acquires a simple boolean lock (`isDraining`) to prevent concurrent drains if `onlineManager` fires multiple events rapidly.

### Initialization

`initOfflineQueue()` is called eagerly in `App.tsx`, before the navigation tree mounts. This is an intentional departure from the lazy-hook pattern used by `initHomeActionsCache()` (called from `useHomeActions`) and `initDiscoveryCache()` (called from `useDiscoveryCards`). Rationale: those caches are only read by their respective hook's consumer. The offline queue, by contrast, can be written to by any logged-in screen's mutation — it must be ready before any screen can mount and trigger a mutation.

### Testing

- Unit tests for `offline-queue.ts`: enqueue, dequeue, clearStale (TTL eviction), FIFO cap at 50 items, in-memory/AsyncStorage consistency
- Unit tests for `offline-queue-drain.ts`: serial drain order (savedAt ascending), retry schedule (attempts incremented before each call, not after failure), 4xx immediate eviction, concurrent drain lock guard, `subscribeToQueueDrainErrors` emitter fires on final failure
- Unit test for `OfflineQueueBridge`: subscribes to emitter → toast is shown
- Integration: mock `onlineManager.isOnline()` false → enqueue items → mock true → drain fires → `X-Idempotency-Key` header present on POST calls → query invalidation triggered on success

---

## Section B — Query Cache Persistence

### New Packages

```
@tanstack/query-async-storage-persister
@tanstack/react-query-persist-client
```

### Wiring

**`client/lib/query-client.ts`** — add persister creation alongside the existing `queryClient` export:

```ts
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "@ocrecipes_query_cache",
  throttleTime: 1000, // write at most once per second
});
```

**`client/App.tsx`** — replace `QueryClientProvider` with `PersistQueryClientProvider`:

```tsx
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { asyncStoragePersister } from "@/lib/query-client";

// in JSX:
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{
    persister: asyncStoragePersister,
    maxAge: 24 * 60 * 60 * 1000,
  }}
>
  ...
</PersistQueryClientProvider>;
```

`maxAge` is set to **24 hours** — matching the offline queue TTL. A user who hasn't opened the app in over a day gets fresh fetches rather than day-old cached data.

### Cold-Launch Behaviour

On startup, `PersistQueryClientProvider` rehydrates the in-memory cache from AsyncStorage synchronously before the first render. Screens using `useQuery` immediately receive the stale cached value and display it while a background refetch runs (governed by the existing `staleTime: 5 min`). No loading spinners on a warm cache — this is the primary fix for the "airplane mode → empty screens" problem.

### Auth Teardown — Cache Eviction

`queryClient.clear()` only clears the in-memory cache. Without an explicit AsyncStorage removal, the persisted snapshot at `@ocrecipes_query_cache` survives logout — a new user on the same device would see the previous user's data on cold launch.

**Fix:** all three auth teardown paths in `client/hooks/useAuth.ts` must add `await AsyncStorage.removeItem('@ocrecipes_query_cache')` alongside the existing `queryClient.clear()` call, wrapped in the same `try/catch` guard pattern already used there:

| Teardown path     | Location in `useAuth.ts` | Action                                                     |
| ----------------- | ------------------------ | ---------------------------------------------------------- |
| `logout()`        | Line 168                 | add `AsyncStorage.removeItem` before `queryClient.clear()` |
| `expireSession()` | Line 199                 | add `AsyncStorage.removeItem` before `queryClient.clear()` |
| `deleteAccount()` | Line 225                 | add `AsyncStorage.removeItem` before `queryClient.clear()` |

The same guard pattern applies — swallow errors so a storage failure cannot skip the `setState` call that actually performs the logout.

### Query Exclusions

No exclusions are needed for the initial implementation. All current queries are safe to persist. If future queries need to be excluded, use a `shouldDehydrateQuery` function in the persister config:

```ts
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "@ocrecipes_query_cache",
  throttleTime: 1000,
  serialize: JSON.stringify,
  deserialize: JSON.parse,
});
// In PersistQueryClientProvider:
persistOptions={{
  persister: asyncStoragePersister,
  maxAge: 24 * 60 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === "success",
  },
}}
```

Note: `meta: { persist: false }` is not an automatic opt-out mechanism — it requires a `shouldDehydrateQuery` implementation to read it.

### Interaction with Section A

The persister handles only the query cache. The offline mutation queue (Section A) is entirely independent — the two systems share no state and do not coordinate.

### Testing

- Unit test: `asyncStoragePersister` config is created with correct key and throttleTime (import-level test)
- Manual verification: cold-launch with cached data on airplane mode shows stale content rather than empty screens

---

## Section C — Per-Feature Offline Guards

### Philosophy

With Section A providing data durability, offline guards are purely UX: setting user expectations rather than preventing data loss.

### Hook

**File:** `client/hooks/useOfflineGuard.ts`

A thin wrapper around the existing `useNetworkStatus`:

```ts
export function useOfflineGuard() {
  const { isOffline } = useNetworkStatus();
  const offlineLabel = (label: string) =>
    isOffline ? `${label} (offline — will sync)` : label;
  return { isOffline, offlineLabel };
}
```

### Application

The three mutation surfaces each receive:

1. **Disabled submit button** when `isOffline` (or visually muted via reduced opacity)
2. **Inline note** below the button using `ThemedText` with `textSecondary` color:
   > _"You're offline. This will sync when you reconnect."_

This note is conditionally rendered — it disappears as soon as connectivity returns. No modal, no toast, no new components. `ThemedText` already exists; `textSecondary` is already defined in `client/constants/theme.ts`.

**Target screens:**

- `NutritionDetailScreen.tsx` — scan-to-log confirm button (uses `addToLogMutation`)
- `QuickLogScreen.tsx` — log-all submit button (uses `logAllMutation`)
- `HistoryScreen.tsx` — swipe-to-delete / discard action (uses `useDiscardItem` via `useHistoryData`)

`DailyNutritionDetailScreen.tsx` is read-only (no mutations) — it is not a target for Section C guards.

### Exclusions

- The global `OfflineBanner` is unchanged — it remains the app-wide signal.
- AI/streaming surfaces (chat, recipe generation) are explicitly excluded — they show their own error states.
- No "queued items review" UI — that is out of scope for this feature.

### Testing

- Unit tests for `useOfflineGuard`: returns correct `isOffline` and `offlineLabel` values for both states
- Component tests for the three mutation surfaces: verify button is disabled and inline note renders when `useNetworkStatus` returns `isOffline: true`

---

## Sequencing

| Phase | Deliverable                         | Notes                                           |
| ----- | ----------------------------------- | ----------------------------------------------- |
| 1     | Section A — offline queue           | Ships independently; no UI dependency on B or C |
| 2     | Section B — query cache persistence | One-file wiring change + two new packages       |
| 3     | Section C — per-feature guards      | Polish; depends on A being in place             |

Each phase has its own PR. No phase blocks the others from being reviewed in parallel, but A should merge before C (guards reference the queue's enqueue behaviour in tests).

---

## Files Created / Modified

| File                                       | Change                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/lib/offline-queue.ts`              | New — queue data model, AsyncStorage persistence, 50-item cap, TTL eviction                                                                                 |
| `client/lib/offline-queue-drain.ts`        | New — drain logic, retry/backoff, `subscribeToQueueDrainErrors` emitter                                                                                     |
| `client/components/OfflineQueueBridge.tsx` | New — subscribes to drain errors, shows toast (mirrors `SessionExpiryBridge`)                                                                               |
| `client/hooks/useOfflineGuard.ts`          | New — thin offline guard hook                                                                                                                               |
| `client/lib/query-client.ts`               | Modified — add `asyncStoragePersister` export (no drain wiring here — avoids circular import)                                                               |
| `client/App.tsx`                           | Modified — eager `initOfflineQueue()` call; `PersistQueryClientProvider` wrapper; `OfflineQueueBridge`; `onlineManager.subscribe` call to wire `drainQueue` |
| `client/hooks/useAuth.ts`                  | Modified — add `AsyncStorage.removeItem('@ocrecipes_query_cache')` to all three teardown paths (`logout`, `expireSession`, `deleteAccount`)                 |
| `client/hooks/useNutritionLookup.ts`       | Modified — offline check in `addToLogMutation`; widen `TData` to `T \| undefined`                                                                           |
| `client/hooks/useQuickLogSession.ts`       | Modified — offline check in `logAllMutation` (per-item enqueue); widen `TData` to `T \| undefined`                                                          |
| `client/hooks/useDiscardItem.ts`           | Modified — offline check in `mutationFn`                                                                                                                    |
| `client/screens/NutritionDetailScreen.tsx` | Modified — `useOfflineGuard` integration (Section C)                                                                                                        |
| `client/screens/QuickLogScreen.tsx`        | Modified — `useOfflineGuard` integration (Section C)                                                                                                        |
| `client/screens/HistoryScreen.tsx`         | Modified — `useOfflineGuard` integration (Section C)                                                                                                        |
| `server/routes/scanned-items.ts`           | Modified — idempotency key dedup on `POST /api/scanned-items` via `X-Idempotency-Key` header                                                                |
| `package.json`                             | Modified — add `@tanstack/query-async-storage-persister` and `@tanstack/react-query-persist-client`                                                         |
