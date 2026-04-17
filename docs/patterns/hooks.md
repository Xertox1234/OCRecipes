# Client Hook Patterns

### TanStack Query CRUD Hook Module

When building client-side data access for a resource, export a cohesive module of TanStack Query hooks from a single file: one `useQuery` per read operation and one `useMutation` per write operation. Mutations invalidate related query keys on success.

```typescript
// client/hooks/useMedication.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";

// Response types defined inline
interface MedicationLog {
  id: number;
  userId: string;
  medicationName: string;
  dosage: string;
  takenAt: string;
  sideEffects: string[];
}

interface MedicationInsights {
  totalDoses: number;
  averageAppetiteLevel: number | null;
  appetiteTrend: "decreasing" | "stable" | "increasing" | null;
  commonSideEffects: { name: string; count: number }[];
}

// READ hooks — use API path as queryKey
export function useMedicationLogs() {
  return useQuery<MedicationLog[]>({
    queryKey: ["/api/medication/logs"],
  });
}

export function useMedicationInsights() {
  return useQuery<MedicationInsights>({
    queryKey: ["/api/medication/insights"],
  });
}

// WRITE hooks — invalidate related queries on success
export function useLogMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { medicationName: string; dosage: string }) => {
      const res = await apiRequest("POST", "/api/medication/log", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medication/insights"] });
    },
  });
}

export function useUpdateMedicationLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: number } & Partial<{
      medicationName: string;
      dosage: string;
    }>) => {
      const res = await apiRequest("PUT", `/api/medication/log/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medication/insights"] });
    },
  });
}

export function useDeleteMedicationLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/medication/log/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/medication/logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/medication/insights"] });
    },
  });
}
```

**Key elements:**

1. **One file per resource** — `useMedication.ts`, `useWeightLogs.ts`, `useFasting.ts`, `useMicronutrients.ts`
2. **API path as queryKey** — `["/api/medication/logs"]` matches the actual endpoint, making cache invalidation intuitive
3. **Cross-invalidation** — mutations that modify data also invalidate derived queries (e.g., creating a medication log invalidates both the logs list AND the insights endpoint)
4. **`apiRequest()` for mutations** — uses the centralized request helper for consistent auth headers and error handling
5. **Response types inline** — defined at the top of the hook file, not shared (see Inline Response Types pattern)
6. **Naming convention:** `use{Resource}{Action}` — `useMedicationLogs`, `useLogMedication`, `useUpdateMedicationLog`, `useDeleteMedicationLog`

**When to use:** Any resource with standard CRUD operations that the client needs to read and write.

**When NOT to use:** One-off API calls that don't need caching or cache invalidation. Use `apiRequest()` directly in event handlers instead.

**Reference files:** `client/hooks/useMedication.ts`, `client/hooks/useMicronutrients.ts`, `client/hooks/useMenuScan.ts`

### Mutation Parameter Over Hook Parameter for Fresh State

When a mutation depends on state that may not exist when the hook is initialized (e.g., a session ID created by a prior mutation), pass the value as a **mutation parameter** rather than a **hook parameter**. Hook parameters are captured at hook initialization time — if the value changes between initialization and invocation, the mutation uses stale state.

```typescript
// Bad: Hook parameter captures stale state
function useAddCookPhoto(sessionId: string | null) {
  return useMutation({
    mutationFn: async (photoUri: string) => {
      // sessionId is null on first call — React state hasn't updated yet
      const res = await apiRequest("POST", `/api/cooking/${sessionId}/photos`, ...);
      return res.json();
    },
  });
}

// Usage: sessionId is null when hook initializes, even if ensureSession() just created one
const addPhoto = useAddCookPhoto(sessionId);
const sid = await ensureSession(); // creates session, sets state
await addPhoto.mutateAsync(photoUri); // BUG: uses stale null sessionId
```

```typescript
// Good: Mutation parameter always has the freshest value
function useAddCookPhoto() {
  return useMutation({
    mutationFn: async ({ photoUri, sessionId }: { photoUri: string; sessionId: string }) => {
      const res = await apiRequest("POST", `/api/cooking/${sessionId}/photos`, ...);
      return res.json();
    },
  });
}

// Usage: sessionId passed directly from the variable that just received it
const addPhoto = useAddCookPhoto();
const sid = await ensureSession();
await addPhoto.mutateAsync({ photoUri, sessionId: sid }); // Always fresh
```

**Key elements:**

1. **No stale closures** — the mutation receives the value at call time, not at hook initialization
2. **Self-documenting** — the caller explicitly provides all dependencies
3. **Works with sequential async flows** — `ensureSession()` → `addPhoto()` where the first creates state the second needs

**When to use:** Any mutation that depends on a value produced by a prior async step within the same user interaction. Common with "create-then-use" flows like session creation followed by session operations.

**When NOT to use:** When the dependent value is stable by the time the mutation fires (e.g., a route param or a query result that loaded before the screen rendered).

**Reference:** `client/hooks/useCookSession.ts` — `useAddCookPhoto()`

### FormData Upload Mutation

When a mutation needs to upload a file (image) from the device, use `FormData` with a raw `fetch` call instead of `apiRequest()`. This is necessary because `apiRequest()` sets `Content-Type: application/json`, which conflicts with multipart form data.

```typescript
// client/hooks/useMenuScan.ts
import { useMutation } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";

export function useMenuScan() {
  return useMutation<MenuAnalysisResult, Error, string>({
    mutationFn: async (photoUri: string) => {
      // Get token manually (can't use apiRequest for FormData)
      const token = await tokenStorage.get();

      const formData = new FormData();
      formData.append("photo", {
        uri: photoUri,
        type: "image/jpeg",
        name: "menu.jpg",
      } as unknown as Blob);

      const response = await fetch(`${getApiUrl()}/api/menu/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          // Do NOT set Content-Type — fetch sets it automatically with the boundary
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      return response.json();
    },
  });
}
```

**Key elements:**

1. **Get token from `tokenStorage` manually** — since we bypass `apiRequest()`
2. **React Native FormData** — the `{ uri, type, name }` object is React Native's file format, cast to `Blob` for TypeScript
3. **Do NOT set `Content-Type` header** — `fetch` automatically sets `multipart/form-data` with the correct boundary when given a `FormData` body
4. **Manual error handling** — check `response.ok` and throw with status + body text

**When to use:** Any mutation that uploads files (photos, documents, avatars) from the device.

**When NOT to use:** JSON-only mutations — use `apiRequest()` instead.

**Reference:** `client/hooks/useMenuScan.ts`. See also `Compress-Upload-Cleanup for Image Uploads` pattern for the server-side handling.

### SSE Client-Side Consumption with ReadableStream

When the server streams responses via Server-Sent Events (see "SSE Streaming for AI Responses" in Route Module Patterns), the client must consume the stream using `ReadableStream`, parse `data:` lines, and accumulate content progressively. Use `useState` for streaming content display and `useCallback` for the send function.

```typescript
// client/hooks/useChat.ts — SSE client consumption
export function useSendMessage(conversationId: number | null) {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!conversationId) return;
      setIsStreaming(true);
      setStreamingContent("");

      try {
        const baseUrl = getApiUrl();
        const token = await tokenStorage.get();
        const res = await fetch(
          new URL(
            `/api/chat/conversations/${conversationId}/messages`,
            baseUrl,
          ),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token && { Authorization: `Bearer ${token}` }),
            },
            body: JSON.stringify({ content }),
          },
        );

        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulated += data.content;
                setStreamingContent(accumulated);
              }
              if (data.done) {
                queryClient.invalidateQueries({
                  queryKey: [
                    `/api/chat/conversations/${conversationId}/messages`,
                  ],
                });
              }
              if (data.error) throw new Error(data.error);
            } catch (e) {
              // Ignore JSON parse errors from incomplete chunks
              if (e instanceof Error && !String(e).includes("JSON")) throw e;
            }
          }
        }
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
      }
    },
    [conversationId, queryClient],
  );

  return { sendMessage, streamingContent, isStreaming };
}
```

**Key elements:**

1. **`ReadableStream` reader** — use `res.body?.getReader()` to consume the stream incrementally
2. **`TextDecoder` with `{ stream: true }`** — handles multi-byte characters split across chunks
3. **Parse `data: ` prefix** — SSE lines are prefixed with `data: `, strip it before JSON.parse
4. **Accumulate content** — track `accumulated` string and update state progressively for real-time display
5. **Handle terminal events** — `{ done: true }` triggers query invalidation; `{ error: "..." }` throws
6. **Ignore partial JSON** — incomplete chunks from chunked transfer can cause `JSON.parse` failures; swallow those specifically
7. **`finally` cleanup** — always reset streaming state regardless of success/failure
8. **Bypass `apiRequest()`** — SSE responses are not standard JSON, so use raw `fetch` with manual auth header

**When to use:** Any client hook that consumes an SSE endpoint (chat, AI generation, real-time updates).

**When NOT to use:** Standard JSON API responses — use `apiRequest()` + `useQuery`/`useMutation`.

**References:**

- `client/hooks/useChat.ts` — `useSendMessage()`
- Server-side: see "SSE Streaming for AI Responses" in Route Module Patterns

### SSE Stream Drop Detection and Recovery

When an SSE stream drops mid-response (network interruption, server crash, upstream LLM timeout), the client must detect the incomplete stream and recover gracefully. Track whether the server sent its terminal `{ done: true }` event — if the stream reader finishes without it, the response was interrupted.

```typescript
// client/hooks/useChat.ts — stream drop detection
const [streamError, setStreamError] = useState(false);

const sendMessage = useCallback(
  async (content: string) => {
    setStreamError(false);
    let receivedDone = false;

    try {
      // ... fetch + stream reading loop ...
      // Inside the data parser:
      if (data.done) {
        receivedDone = true;
        queryClient.invalidateQueries({ queryKey: [messagesKey] });
      }

      // After the reader loop exits:
      if (!receivedDone && accumulated.length > 0) {
        setStreamError(true);
        // Server saves partial responses — fetch them
        queryClient.invalidateQueries({ queryKey: [messagesKey] });
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  },
  [conversationId, queryClient],
);

return { sendMessage, streamingContent, isStreaming, streamError };
```

The consumer component uses a ref guard to show the error toast exactly once per drop (see [Ref Guard for One-Shot Effects](#ref-guard-for-one-shot-effects)):

```typescript
// client/screens/ChatScreen.tsx — stream error toast
const shownStreamErrorRef = useRef(false);

useEffect(() => {
  if (streamError && !shownStreamErrorRef.current) {
    shownStreamErrorRef.current = true;
    toast.error("Response was interrupted. Partial response may be visible.");
  }
  if (!streamError) {
    shownStreamErrorRef.current = false;
  }
}, [streamError, toast]);
```

**Key elements:**

1. **`receivedDone` flag** — local variable in the send function; only set to `true` when the server's terminal `{ done: true }` event is parsed
2. **Check after reader loop** — `if (!receivedDone && accumulated.length > 0)` catches drops that occurred after content started flowing
3. **Query invalidation on drop** — the server persists partial AI responses; invalidating the messages query fetches them so the user sees what was received
4. **`streamError` state** — returned from the hook so consumers can show a notification
5. **Reset on next send** — `setStreamError(false)` at the top of `sendMessage` clears stale error state

**When to use:** Any SSE consumer where the server saves partial progress and the client needs to recover incomplete responses.

**When NOT to use:** Fire-and-forget streams where partial data has no value and should simply be discarded.

**References:**

- `client/hooks/useChat.ts` — `useSendMessage()` stream drop detection
- `client/screens/ChatScreen.tsx` — toast notification with ref guard

### refetchInterval for Live-Updating Queries

When a query represents data that changes over time without user action (timers, active sessions, sync status), use TanStack Query's `refetchInterval` to poll at a regular cadence rather than implementing manual `setInterval` + `useState` patterns.

```typescript
// client/hooks/useFasting.ts — poll active fast every 60 seconds
export function useCurrentFast() {
  return useQuery<FastingLog | null>({
    queryKey: ["/api/fasting/current"],
    refetchInterval: 60000, // Refresh every minute for timer updates
  });
}
```

**When to use:**

- Active timers (fasting, workout sessions) where the client needs fresh server data
- Sync status indicators that should reflect background processing
- Any "live" data where WebSocket/SSE is overkill

**When NOT to use:**

- Static data that only changes on user action (use manual `invalidateQueries` instead)
- High-frequency updates (<5s) — consider WebSockets or SSE instead
- Queries that are expensive on the server — polling amplifies cost linearly

**Key elements:**

1. **Set `refetchInterval` at the hook level** — not in the component, so all consumers get consistent polling
2. **Choose interval wisely** — 60s for timers (good enough for minute-level display), 30s for sync status
3. **TanStack handles cleanup** — polling stops automatically when the component unmounts or the query is disabled

**References:**

- `client/hooks/useFasting.ts` — `useCurrentFast()` with 60s polling

### Client-Side Elapsed Time Tick (No Server Round-Trip)

When displaying elapsed time from a server-provided timestamp (e.g., `startedAt`), use a local `setInterval` + `useState` tick to force re-render rather than `refetchInterval`. The server data hasn't changed — only `Date.now() - startedAt` has — so a network round-trip is wasteful.

```typescript
// client/components/profile/MiniWidgetRow.tsx — tick fasting timer every 60s
const [, setTick] = useState(0);
useEffect(() => {
  if (!fasting.currentFast) return;
  const id = setInterval(() => setTick((t) => t + 1), 60_000);
  return () => clearInterval(id);
}, [fasting.currentFast]);

// getFastingTime reads Date.now() at render time — the tick forces the recalculation
```

**When to use:**

- Elapsed time display derived from a stable `startedAt`/`createdAt` timestamp
- Countdown timers where the target time is already on the client
- Any "live" display that only depends on the clock, not fresh server state

**When NOT to use (use `refetchInterval` instead):**

- The server value itself changes over time (e.g., sync progress, queue depth)
- You need to detect server-side state transitions (e.g., fast ended by another device)

**Key distinction:** `refetchInterval` keeps the _data_ fresh. A local tick keeps the _derived calculation_ fresh. If only the calculation changes, skip the network.

**References:**

- `client/components/profile/MiniWidgetRow.tsx` — fasting elapsed time tick
- See "refetchInterval for Live-Updating Queries" above for the server-data counterpart

### Query Key Stabilization for Array/Object Keys

When a `useQuery` key includes an array or object that is derived on each render (e.g., from `.map()`), stabilize it with `JSON.stringify` inside `useMemo`. Without this, TanStack Query sees a new key on every render because arrays are compared by reference, causing unnecessary refetches.

```typescript
export function useAllergenCheck(ingredientNames: string[]) {
  // Stabilize key — array identity changes don't trigger refetch
  const stableKey = useMemo(
    () => JSON.stringify(ingredientNames),
    [ingredientNames],
  );

  return useQuery<AllergenCheckResult>({
    queryKey: ["/api/allergen-check", stableKey],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/allergen-check", {
        ingredients: ingredientNames,
      });
      return res.json();
    },
    enabled: ingredientNames.length > 0,
  });
}
```

```typescript
// Bad: unstable array key — refetches on every render
queryKey: ["/api/allergen-check", ingredientNames],

// Good: stable string key — only refetches when contents change
const stableKey = useMemo(() => JSON.stringify(ingredientNames), [ingredientNames]);
queryKey: ["/api/allergen-check", stableKey],
```

**When to use:** Any `useQuery` or `useMutation` where the query key contains an array or object prop that the caller may not memoize (especially hooks meant for broad reuse).

**When NOT to use:** Query keys that only contain primitive values (strings, numbers, booleans). Keys where the caller is guaranteed to memoize the input (but this is fragile).

**Why:** TanStack Query uses structural equality on query keys, but JavaScript arrays created from `.map()` or spread produce new references on every render. Even though the contents are identical, React sees a different object. Serializing to a JSON string creates a primitive that only changes when the data changes. This was caught as a high-severity review finding causing unnecessary API calls.

**References:**

- `client/hooks/useAllergenCheck.ts` — canonical implementation

### Map-Based Per-Key Debounce

When debouncing events that arrive for multiple different keys (e.g., different barcodes in rapid succession), use a `Map<key, timestamp>` instead of a single `setTimeout` lock. This allows different keys immediately while debouncing repeated same-key events.

```typescript
const scannedBarcodesRef = useRef(new Map<string, number>());

const handleBarcodeScanned = useCallback(
  (result: BarcodeResult, isRepeat?: boolean) => {
    const now = Date.now();
    const lastTime = scannedBarcodesRef.current.get(result.data);

    // Same key within debounce window → ignore
    if (lastTime !== undefined && now - lastTime < debounceMs) return;

    // Same key after debounce window → callback with isRepeat=true
    const isRepeat = lastTime !== undefined;
    scannedBarcodesRef.current.set(result.data, now);
    onBarcodeScanned(result, isRepeat);
  },
  [debounceMs, onBarcodeScanned],
);
```

**Why this is better than `setTimeout`:**

- No timer races — the Map IS the debounce, no cleanup needed
- No stale closures — timestamps are checked synchronously
- Different keys process immediately (no global lock)
- Same key after window triggers `isRepeat` callback (e.g., increment quantity)

**When to use:** Any scenario where rapid events arrive for multiple distinct keys and you need per-key deduplication (batch scanning, multi-input forms, multi-touch gestures).

**References:**

- `client/camera/hooks/useCamera.ts` — `batch: true` mode uses Map-based debounce

### `refetchOnMount: "always"` for Cross-Screen Data Freshness

When a query's data can be modified from a deeper screen in a native stack (e.g., adding a recipe to a cookbook from the recipe detail screen), set `refetchOnMount: "always"` on the query. Native stack navigators keep screens mounted when pushing new screens on top — when the user navigates back, the screen remounts from cache but the underlying data may have changed. Without this option, TanStack Query serves stale cached data.

```typescript
// ✅ GOOD: Always refetch when screen comes back into view
export function useCookbookRecipes(cookbookId: number) {
  return useQuery<CookbookRecipe[]>({
    queryKey: [`/api/cookbooks/${cookbookId}/recipes`],
    refetchOnMount: "always", // data changes from RecipeDetailScreen
  });
}
```

```typescript
// ❌ BAD: Default behavior serves stale data after navigating back
export function useCookbookRecipes(cookbookId: number) {
  return useQuery<CookbookRecipe[]>({
    queryKey: [`/api/cookbooks/${cookbookId}/recipes`],
    // Default refetchOnMount: true only refetches if data is stale per staleTime
  });
}
```

**When to use:**

- List screens where items can be added/removed/modified from detail screens deeper in the stack
- Any query whose data changes via mutations triggered on screens that don't have access to the same `queryClient.invalidateQueries()` call (e.g., a recipe detail screen adding to a cookbook doesn't know to invalidate the cookbook's recipe list query)
- Dashboard/summary screens that aggregate data modified elsewhere

**When NOT to use:**

- Queries where the mutating screen already calls `invalidateQueries` for the relevant key (redundant)
- Expensive queries where staleTime-based refetching is intentional (e.g., large recipe catalogs)
- Queries for data that never changes from other screens (user profile viewed but not edited from child screens)

**Why:** The default `refetchOnMount: true` only triggers a refetch if the data is considered stale (per `staleTime`, default 0). But in practice, the query observer may still serve cached data briefly before the refetch completes. `"always"` forces an unconditional network request every time the component mounts, guaranteeing fresh data. The trade-off is more network requests, but for queries behind navigation this is typically one extra fetch per screen visit.

**References:**

- TanStack Query v5 `refetchOnMount` documentation
- Related: "TanStack Query CRUD Hook Module" pattern — mutations should still invalidate queries where possible

### Optimistic Query Enabling on Premium-Gated Screens

When a screen is only reachable by premium users (e.g., via conditional `initialRouteName`), optimistically enable dependent queries during the premium status loading phase. Without this, the query stays permanently disabled if `usePremiumFeature()` returns `false` before the subscription data resolves.

```typescript
// ❌ BAD: Query never fires if premium check hasn't resolved at mount time
const { isCoachPro } = usePremiumFeature("coachPro");
const { data: context } = useCoachContext(isCoachPro);
// isCoachPro is false during loading → enabled: false → query never retries
```

```typescript
// ✅ GOOD: Optimistically enable during loading phase
const { isCoachPro, isLoading: isPremiumLoading } =
  usePremiumFeature("coachPro");
const contextEnabled = isCoachPro || isPremiumLoading;
const { data: context, isLoading, error } = useCoachContext(contextEnabled);
// Screen is only mounted for premium users, so optimistic enabling is safe.
// If the user somehow isn't premium, the server returns 403 → error UI handles it.
```

**When to use:**

- Premium-only screens mounted via conditional `initialRouteName` or navigator guards
- Any screen where a feature-flag check gates a TanStack Query `enabled` flag and the check may not have resolved at mount time

**When NOT to use:**

- Screens accessible to all users where the premium check genuinely determines whether to fetch
- Queries where the `enabled` flag depends on user input, not a loading race

**Why:** `usePremiumFeature()` wraps a TanStack Query for subscription status. On first mount, the query is in-flight and returns `false` for the feature check. If a dependent query uses this as its `enabled` flag, it starts disabled and never re-enables because TanStack Query doesn't re-evaluate `enabled` when the value changes from `false` → `true` after the initial mount in the same render cycle. The optimistic approach treats "still loading" the same as "is premium" since the screen's mount condition already guarantees premium status.

**References:**

- `client/screens/CoachProScreen.tsx` — `contextEnabled = isCoachPro || isPremiumLoading`
- `client/hooks/usePremiumFeatures.ts` — `usePremiumFeature()` hook

**Origin:** Coach Pro blank screen bug (2026-04-10) — screen rendered blank because context query was permanently disabled during premium loading race

### Hook-Returned Component Pattern for BottomSheetModal

When a reusable bottom sheet needs an imperative API (`confirm()`, `open()`) but also renders a component, return both from a custom hook. This avoids the declarative/imperative mismatch that causes timing bugs when syncing a `visible` boolean prop with `present()`/`dismiss()`.

```typescript
// client/hooks/useConfirmationModal.ts

export function useConfirmationModal() {
  const optionsRef = useRef<ConfirmOptions>(defaultOptions);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [revision, setRevision] = useState(0);

  // Imperative trigger — stores options in ref, bumps revision, presents sheet
  const confirm = useCallback((options: ConfirmOptions) => {
    optionsRef.current = options;
    setRevision((r) => r + 1); // force child re-render
    sheetRef.current?.present();
  }, []);

  // Stable component identity — useMemo with empty deps
  const ConfirmationModal = useMemo(
    () =>
      function StableConfirmationModal() {
        return (
          <ConfirmationModalInner
            sheetRef={sheetRef}
            optionsRef={optionsRef}
            revision={revision}
          />
        );
      },
    [revision],
  );

  return { confirm, ConfirmationModal };
}

// Usage in a screen:
const { confirm, ConfirmationModal } = useConfirmationModal();

const handleDelete = () => {
  confirm({
    title: "Delete item?",
    message: "This cannot be undone.",
    confirmLabel: "Delete",
    destructive: true,
    onConfirm: () => deleteMutation.mutate(itemId),
  });
};

return (
  <View>
    {/* screen content */}
    <ConfirmationModal />
  </View>
);
```

**Key elements:**

1. **Ref for options, not state** — avoids a new component identity on every `confirm()` call. Options are read by the inner component via ref.
2. **`useMemo` for stable component identity** — `useCallback` would change when options state changes, causing React to remount instead of re-render. `useMemo` with `[revision]` only changes when `confirm()` is actually called.
3. **Force-render counter (`revision`)** — since the inner component reads from a ref, React.memo/shallow comparison sees no prop change. The revision counter triggers re-renders when `confirm()` stores new options.
4. **Do NOT use `React.memo` on the inner component** — when props are refs (stable references), `React.memo` blocks ALL re-renders since shallow comparison sees no change. The revision counter bypasses this by being a changing primitive.

**When to use:** Any reusable bottom sheet or modal that needs an imperative trigger API and is consumed by multiple screens.

**When NOT to use:** One-off modals on a single screen — use the Bottom-Sheet Lifecycle State Machine pattern instead (see `docs/patterns/documentation.md`).

**References:**

- `client/hooks/useConfirmationModal.ts` — confirmation dialog hook
- Related: "Bottom-Sheet Lifecycle State Machine" in `docs/patterns/documentation.md`

### Screen Hook — Extracting Screen State into a Custom Hook

When a screen component exceeds ~800 lines or has more than ~10 state variables, extract its state management, data fetching, effects, and handlers into a dedicated `use{ScreenName}` hook. The screen file retains JSX rendering, inline sub-components, and styles.

```typescript
// client/hooks/useNutritionLookup.ts — screen hook example
export function useNutritionLookup(params: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
}) {
  const navigation = useNavigation<NutritionDetailNavigationProp>();
  const haptics = useHaptics();
  const { user } = useAuthContext();

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // ... more state, queries, effects, handlers ...

  return {
    nutrition,
    isLoading,
    error,
    handleAddToLog,
    // ... flat object of all state + handlers the screen JSX needs
  };
}
```

```typescript
// client/screens/NutritionDetailScreen.tsx — screen uses the hook
export default function NutritionDetailScreen() {
  const { theme } = useTheme();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();

  const {
    nutrition,
    isLoading,
    error,
    handleAddToLog,
  } = useNutritionLookup(route.params);

  // JSX only — no state management, no effects, no handlers
  return <ThemedView>...</ThemedView>;
}
```

**Conventions:**

1. **Get dependencies internally** — hooks call `useNavigation()`, `useAuthContext()`, `useHaptics()`, etc. themselves. Do NOT pass navigation or context as parameters.
2. **Accept only data params** — the hook receives route params or primitive configuration values (barcode, imageUri, intent), not React objects.
3. **Return a flat object** — return `{ state, handlers, computed }` as a single flat object. Do not nest into sub-objects.
4. **Use `useHaptics()` wrapper** — never call `Haptics.impactAsync()` / `Haptics.notificationAsync()` directly. The wrapper respects `reducedMotion`.
5. **Export types the screen needs** — if the hook defines types used by screen sub-components (e.g., `DailySummary`, `ClassifyState`), export them.
6. **Naming: `use{Feature}.ts`** — not `use{ScreenName}Screen.ts`. The hook describes the domain, not the UI.

**When to use:**

- Screen has >10 `useState` calls
- Screen file exceeds ~800 lines
- Screen has complex data-fetching chains (fetch → validate → transform → cache)
- Multiple effects and handlers that are hard to reason about alongside JSX

**When NOT to use:**

- Simple screens with 2-3 state variables and a single query — the overhead of a separate file isn't worth it
- Hooks that would only have 1-2 return values — keep them inline

**References:**

- `client/hooks/useNutritionLookup.ts` — data fetching + serving controls (463 lines)
- `client/hooks/usePhotoAnalysis.ts` — 35 state variables extracted (369 lines)
- `client/hooks/useScanClassification.ts` — classification state machine (220 lines)
- `client/hooks/useFastingTimer.ts` — timer + phase logic (297 lines)
- `client/hooks/useHistoryData.ts` — infinite query + 13 handlers (355 lines)
- `client/hooks/useProfileData.ts` — profile queries + navigation handlers (306 lines)
- `client/hooks/useDietaryProfileForm.ts` — form state + save logic (158 lines)

### Additive SSE Protocol Extension

When a new feature needs richer SSE events than the existing `{ content, done }` protocol, extend it by adding **optional fields** rather than introducing a new `type` discriminator. The client checks for field presence:

```typescript
// Server — yield events with optional fields alongside existing ones
yield { content: "Here's a recipe..." };                    // Text chunk (existing)
yield { content: "", recipe: validatedRecipe, allergenWarning };  // Recipe card (new)
yield { content: "", imageUrl: "/api/recipe-images/uuid.png" };   // Image ready (new)
yield { done: true };                                       // Terminal (existing)

// Client — check for optional fields, fall through to existing behavior
for (const line of lines) {
  if (line.startsWith("data: ")) {
    const data = JSON.parse(line.slice(6));
    if (data.recipe) setStreamingRecipe(data.recipe);       // New
    if (data.imageUrl) setStreamingRecipe(prev => ({ ...prev, imageUrl: data.imageUrl })); // New
    if (data.content) { accumulated += data.content; setStreamingContent(accumulated); }    // Existing
    if (data.done) { receivedDone = true; invalidateQueries(); }  // Existing
  }
}
```

**Why additive, not typed?** A typed protocol (`{ type: "text" | "recipe_card" | "image_ready" }`) requires a `switch` statement in every client, breaks backward compatibility with existing parsers, and creates a maintenance burden when new event types are added. The additive approach is backward-compatible — old clients ignore unknown fields — and simpler to parse.

**When to use:** Extending an existing SSE stream with new event data alongside the original text streaming.

**When NOT to use:** When events have fundamentally different schemas that can't be expressed as optional fields on a single object, or when the stream protocol is new (no backward compatibility needed).

**References:**

- `server/routes/chat.ts` — recipe chat path yields `recipe` and `imageUrl` fields
- `client/hooks/useChat.ts` — `useSendMessage` parses optional `recipe`, `imageUrl`, `allergenWarning` fields

### Override Parameter to Bypass Stale Closures on Async-Created IDs

When a hook's callback closes over a state variable (e.g., `conversationId`), and the caller creates a new value via `setState` then immediately calls the callback, the callback still sees the old value because React state updates are asynchronous. The fix is an **explicit override parameter**:

```typescript
// Hook — accept optional override that takes precedence over state
export function useSendMessage(conversationId: number | null) {
  const sendMessage = useCallback(
    async (content: string, screenContext?: string, conversationIdOverride?: number) => {
      const effectiveId = conversationIdOverride ?? conversationId;
      if (!effectiveId) return;
      // ... use effectiveId everywhere (URL, query invalidation, etc.)
    },
    [conversationId, queryClient],
  );
  return { sendMessage, ... };
}

// Caller — pass the just-created ID directly
const handleSend = useCallback(async () => {
  let convId = conversationId;
  if (!convId) {
    const conv = await createConversation.mutateAsync({ title: "New Chat" });
    convId = conv.id;
    setConversationId(convId);  // Async — won't be visible to sendMessage's closure yet
  }
  sendMessage(content, undefined, convId);  // Pass directly — bypasses stale closure
}, [conversationId, createConversation, sendMessage]);
```

**When to use:** Any time a caller (1) creates a resource, (2) stores its ID in state, and (3) immediately calls a hook callback that needs that ID — all in the same synchronous execution.

**Why not just use a ref?** A ref would work for the hook's internal reads, but the caller still needs to pass the value somehow. The override parameter is the clearest API — it's explicit, type-safe, and doesn't require coordinating ref updates across component boundaries.

**Why not restructure into a single API call?** Sometimes the resource creation and the subsequent action are intentionally separate concerns (e.g., creating a conversation is reusable, sending a message is a different mutation). Merging them couples unrelated operations.

**References:**

- `client/hooks/useChat.ts` — `useSendMessage` with `conversationIdOverride` parameter
- `client/screens/RecipeChatScreen.tsx` — `handleSend` passes `convId` after async conversation creation

### Batch ID Cache + Derived Boolean Hook

When rendering a list of items where each item needs a boolean check against a user's collection (e.g., "is this recipe favourited?"), avoid per-item API calls. Instead, fetch **all** IDs in one request and derive booleans locally.

**Three-layer pattern:**

1. **Server endpoint** returns all IDs in the collection (`GET /api/favourite-recipes/ids` → `{ ids: { recipeId, recipeType }[] }`)
2. **Cache hook** fetches and caches the full ID set with `staleTime` to reduce refetches (`useFavouriteRecipeIds`)
3. **Derived hook** reads from the cache and returns a boolean via `useMemo` — no network call (`useIsRecipeFavourited`)

```typescript
// Layer 2: Cache hook — fetches all IDs once, shared across components
export function useFavouriteRecipeIds() {
  return useQuery<{ ids: FavouriteId[] }>({
    queryKey: ["/api/favourite-recipes/ids"],
    queryFn: async () => {
      /* ... */
    },
    staleTime: 30_000, // Reduce refetches when navigating between screens
    refetchOnMount: "always",
  });
}

// Layer 3: Derived hook — reads from cache, no network call
export function useIsRecipeFavourited(
  recipeId: number,
  recipeType: "mealPlan" | "community",
): boolean {
  const { data } = useFavouriteRecipeIds();
  return useMemo(
    () =>
      data?.ids.some(
        (f) => f.recipeId === recipeId && f.recipeType === recipeType,
      ) ?? false,
    [data, recipeId, recipeType],
  );
}
```

**Optimistic updates** on the toggle mutation target the IDs cache — add/remove the ID immediately, rollback on error, invalidate on settle. The derived hook picks up the change instantly since it reads from the same cache.

**When to use:** Any "is this item in my collection?" check rendered across a list — favourites, bookmarks, read/unread status, selections. The key criterion: the total collection size is small enough to return in a single response (hundreds of IDs, not millions).

**References:**

- `client/hooks/useFavouriteRecipes.ts` — `useFavouriteRecipeIds` + `useIsRecipeFavourited` + `useToggleFavouriteRecipe`
- `server/routes/favourite-recipes.ts` — `GET /api/favourite-recipes/ids`

### Native Share with Server-Side Payload

When sharing content externally (social media, messaging), build the share payload server-side and consume it with React Native's `Share.share()`. This keeps deep link construction and content formatting centralized.

```typescript
// Server: GET /api/recipes/:recipeType/:recipeId/share
// Returns: { title, description, imageUrl, deepLink }

// Client hook:
export function useShareRecipe() {
  const share = useCallback(
    async (recipeId: number, recipeType: "mealPlan" | "community") => {
      const res = await apiRequest(
        "GET",
        `/api/recipes/${recipeType}/${recipeId}/share`,
      );
      const payload = await res.json();

      const message = `Check out this recipe: ${payload.title}\n\n${payload.description}\n\n${payload.deepLink}`;

      // iOS: pass url for image preview attachment
      // Android: image URL must be included in message text
      await Share.share(
        Platform.OS === "ios"
          ? {
              title: payload.title,
              message,
              url: payload.imageUrl ?? undefined,
            }
          : { title: payload.title, message },
      );
    },
    [],
  );
  return { share };
}
```

**Key details:**

- **Server builds the deep link** — the client doesn't need to know the URL scheme format
- **Platform branching** — iOS `Share.share()` supports a `url` field for image attachment; Android does not
- **Graceful cancellation** — `Share.share()` throws when the user dismisses the sheet; catch and ignore
- **Ownership checks** — the server endpoint should verify access (especially for private content like personal recipes)

**References:**

- `client/hooks/useFavouriteRecipes.ts` — `useShareRecipe`
- `server/routes/favourite-recipes.ts` — `GET /api/recipes/:recipeType/:recipeId/share`
- `server/storage/favourite-recipes.ts` — `getRecipeSharePayload` (with userId ownership check for mealPlan recipes)

### Action-Driven Callbacks Must Live Outside `setState` Updaters

When a hook exposes an `onXxxChange`-style callback option, fire it from the action handler — **never** from inside a functional `setState(prev => ...)` updater. React documents updater functions as pure; under StrictMode and concurrent rendering, React may invoke an updater twice speculatively, which double-fires any side effect inside it.

```typescript
// ❌ BAD: dedupe + callback inside the updater — runs twice under StrictMode
const setIsDirty = useCallback((value: boolean) => {
  setIsDirtyState((prev) => {
    if (prev === value) return prev;
    onDirtyChangeRef.current?.(value); // side effect in a "pure" updater
    return value;
  });
}, []);
```

```typescript
// ✅ GOOD: updater stays pure, dedupe + callback live in the action
const [isDirty, setIsDirtyState] = useState(initialDirty);
// Dedupe lives outside the updater — updaters must be pure.
const lastFiredDirtyRef = useRef(initialDirty);

const setIsDirty = useCallback((value: boolean) => {
  setIsDirtyState(value);
  if (lastFiredDirtyRef.current !== value) {
    lastFiredDirtyRef.current = value;
    onDirtyChangeRef.current?.(value);
  }
}, []);
```

**Review checklist** for any hook that accepts an `onXxx` callback option:

1. Is the callback fired inside a `setState(prev => ...)` updater? Move it out.
2. Is the "only fire on transition" check inside the updater? Move it out and use a ref to track the last-fired value.
3. Keep callbacks in a ref (`onDirtyChangeRef.current = options?.onDirtyChange`) so the action's `useCallback` deps stay empty — the ref always holds the latest callback.

**When to use:** Any custom hook with `onDirtyChange`, `onValueChange`, `onSave`, or similar callback options.

**When NOT to use:** Effects intentionally deriving a callback from a _changing_ state value — that's a separate concern (see the mount-only initial-dirty effect in `useRecipeForm` for the narrow case where firing from `useEffect` is correct).

**Rationale:** React's `useState` updater-purity contract is documented at [react.dev — `useState` / "Updater functions should be pure"](https://react.dev/reference/react/useState#updater-functions-should-be-pure). StrictMode double-invokes updaters in dev specifically to surface this bug.

**References:**

- `client/hooks/useRecipeForm.ts:161-186` — canonical implementation
- Origin: recipe-wizard code-review H1 (commits `fe87638`, `beb18d0`)

### Round-Trip Snapshots for Lossy String Representations

Form state often round-trips a structured value (`{ name, quantity, unit }`) through a single display string (`"1/2 teaspoon salt"`). The render step is lossless, but the reverse — parsing — is normalizing / lossy: `"1/2"` becomes `"0.5"`, `"1 1/2"` becomes `"1.5"`. Naïvely re-parsing on save drops fidelity from data the user never touched.

The pattern has three parts: **snapshot at load**, **drop snapshot only on real edit**, **prefer snapshot on serialize**.

```typescript
// 1. Snapshot at load — stash the original structured form alongside the text
interface IngredientRow {
  key: string;
  text: string;
  original?: { name: string; quantity: string | null; unit: string | null };
}

function buildIngredientsFromPrefill(prefill): IngredientRow[] {
  return prefill.ingredients.map((ing) => ({
    key: nextIngredientKey(),
    text: formatIngredientText(ing),
    original: { name: ing.name, quantity: ing.quantity, unit: ing.unit },
  }));
}
```

```typescript
// 2. Drop the snapshot only on real edit — preserve it on revert
const updateIngredient = useCallback(
  (key: string, text: string) => {
    setIngredients((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        // If `text` still matches the rendered snapshot, treat this as a
        // revert and keep the structured data. Any divergence invalidates it.
        const keepOriginal =
          i.original != null && formatIngredientText(i.original) === text;
        return { ...i, text, original: keepOriginal ? i.original : undefined };
      }),
    );
    setIsDirty(true);
  },
  [setIsDirty],
);
```

```typescript
// 3. Prefer the snapshot when serializing to the mutation payload
const formToPayload = useCallback(() => {
  const validIngredients = ingredients
    .filter((i) => i.text.trim())
    .map((i) => {
      if (i.original) {
        return {
          name: i.original.name,
          quantity: i.original.quantity,
          unit: i.original.unit,
        };
      }
      const parsed = parseIngredientText(i.text.trim());
      return {
        name: parsed.name,
        quantity: parsed.quantity,
        unit: parsed.unit,
      };
    });
  // ...
}, [ingredients /* ... */]);
```

**Checklist before shipping a text-edited structured form:**

1. Does `parse(format(x))` equal `x` for every realistic `x`? If not, you need a snapshot.
2. Does the form distinguish "user reverted the text" from "user made a no-op edit"? The `format(original) === text` check handles both.
3. Does the save path prefer the snapshot over re-parsing?

**When to use:** Any form where `format(struct) → string → parse(string)` is lossy AND the user edits the string. In this codebase: ingredient rows, instruction steps (`serializeSteps` / `deserializeSteps`), URL-imported recipe metadata, pantry free-text quantities.

**When NOT to use:** Round-trips that are provably lossless (e.g., integer-only fields), or forms where the structured value is never prefilled from external data.

**See also:** [Action-Driven Callbacks Must Live Outside `setState` Updaters](#action-driven-callbacks-must-live-outside-setstate-updaters) — same hook, related design rule about keeping updaters pure.

**References:**

- `client/hooks/useRecipeForm.ts:9-19` — `IngredientRow.original` field doc
- `client/hooks/useRecipeForm.ts:73-97` — `formatIngredientText` + `buildIngredientsFromPrefill`
- `client/hooks/useRecipeForm.ts:248-268` — `updateIngredient` revert logic
- `client/hooks/useRecipeForm.ts:358-378` — `formToPayload` prefers snapshot
- Origin: recipe-wizard code-review M1 (commits `fe87638`, `beb18d0`)
