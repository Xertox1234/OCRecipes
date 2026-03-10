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
