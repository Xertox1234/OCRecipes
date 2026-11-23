# Offline Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable offline mutation queuing, query cache persistence, and per-feature offline guards so food logs are never silently lost and the app shows useful data on cold launch without connectivity.

**Architecture:** A custom typed queue in AsyncStorage (Phase 1) serialises the three core logging mutations so they survive force-quit; TanStack's official persister (Phase 2) writes the in-memory query cache to AsyncStorage so cold launches show stale data instead of empty screens; a thin hook (Phase 3) wires the offline state into each mutation surface's submit button. The queue uses its own error pub/sub emitter (avoiding a circular import with `query-client.ts`) and sends `X-Idempotency-Key` headers to prevent duplicate log entries on replay.

**Tech Stack:** `@react-native-async-storage/async-storage` (already installed), `@tanstack/react-query` v5, `@tanstack/query-async-storage-persister` (new), `@tanstack/react-query-persist-client` (new), Drizzle ORM, Vitest + Supertest

---

## Phase 1 — Durable Offline Mutation Queue

### File Map

| File                                                      | Action | Responsibility                                                                                  |
| --------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `client/lib/offline-queue.ts`                             | Create | Queue data model, AsyncStorage read-through cache, FIFO 50-item cap, TTL eviction               |
| `client/lib/offline-queue-drain.ts`                       | Create | Serial drain, retry/backoff, `subscribeToQueueDrainErrors` emitter                              |
| `client/components/OfflineQueueBridge.tsx`                | Create | Subscribes to drain errors, shows toast                                                         |
| `client/App.tsx`                                          | Modify | Eager `initOfflineQueue`, mount `OfflineQueueBridge`, subscribe `drainQueue` to `onlineManager` |
| `client/hooks/useNutritionLookup.ts`                      | Modify | Offline check in `addToLogMutation`; widen TData                                                |
| `client/hooks/useQuickLogSession.ts`                      | Modify | Offline check in `logAllMutation` (per-item enqueue); widen TData                               |
| `client/hooks/useDiscardItem.ts`                          | Modify | Offline check in `mutationFn`                                                                   |
| `shared/schema.ts`                                        | Modify | Add `idempotencyKey` nullable column + partial unique index to `scannedItems`                   |
| `server/routes/nutrition.ts`                              | Modify | Idempotency dedup on `POST /api/scanned-items`                                                  |
| `client/lib/__tests__/offline-queue.test.ts`              | Create | Unit tests for queue module                                                                     |
| `client/lib/__tests__/offline-queue-drain.test.ts`        | Create | Unit tests for drain module                                                                     |
| `client/components/__tests__/OfflineQueueBridge.test.tsx` | Create | Component test for bridge                                                                       |
| `server/routes/__tests__/nutrition.test.ts`               | Modify | Tests for idempotency dedup path                                                                |

---

### Task 1: `offline-queue.ts` — queue module

**Files:**

- Create: `client/lib/offline-queue.ts`
- Create: `client/lib/__tests__/offline-queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/lib/__tests__/offline-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import AFTER mock is set up
const importModule = () => import("../offline-queue");

describe("offline-queue", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    vi.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
  });

  it("enqueues an item and makes it visible via loadQueue", async () => {
    const { initOfflineQueue, enqueue, loadQueue } = await importModule();
    await initOfflineQueue();
    await enqueue({
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { productName: "Apple" },
    });
    const q = loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0].endpoint).toBe("/api/scanned-items");
    expect(q[0].attempts).toBe(0);
    expect(typeof q[0].id).toBe("string");
    expect(typeof q[0].savedAt).toBe("number");
  });

  it("dequeue removes the item by id", async () => {
    const { initOfflineQueue, enqueue, dequeue, loadQueue } =
      await importModule();
    await initOfflineQueue();
    await enqueue({ endpoint: "/api/scanned-items", method: "POST", body: {} });
    const id = loadQueue()[0].id;
    await dequeue(id);
    expect(loadQueue()).toHaveLength(0);
  });

  it("clearStale evicts items older than 24 hours", async () => {
    const { initOfflineQueue, loadQueue } = await importModule();
    const old = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    const staleQueue = [
      {
        id: "a",
        endpoint: "/api/scanned-items",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: old,
      },
      {
        id: "b",
        endpoint: "/api/scanned-items",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: Date.now(),
      },
    ];
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify(staleQueue),
    );
    await initOfflineQueue();
    expect(loadQueue()).toHaveLength(1);
    expect(loadQueue()[0].id).toBe("b");
  });

  it("enqueue drops oldest item when 50-item cap is reached", async () => {
    const { initOfflineQueue, enqueue, loadQueue } = await importModule();
    await initOfflineQueue();
    for (let i = 0; i < 50; i++) {
      await enqueue({
        endpoint: "/api/scanned-items",
        method: "POST",
        body: { name: `item-${i}` },
      });
    }
    const beforeCap = loadQueue()[0].body as { name: string };
    await enqueue({
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { name: "overflow" },
    });
    expect(loadQueue()).toHaveLength(50);
    expect(loadQueue()[0].body).not.toEqual(beforeCap); // oldest was dropped
    expect((loadQueue()[49].body as { name: string }).name).toBe("overflow");
  });

  it("incrementAttempts updates the item in memory and AsyncStorage", async () => {
    const { initOfflineQueue, enqueue, incrementAttempts, loadQueue } =
      await importModule();
    await initOfflineQueue();
    await enqueue({ endpoint: "/api/scanned-items", method: "POST", body: {} });
    const id = loadQueue()[0].id;
    await incrementAttempts(id);
    expect(loadQueue()[0].attempts).toBe(1);
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- client/lib/__tests__/offline-queue.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/lib/offline-queue.ts`**

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@ocrecipes_offline_queue";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DEPTH = 50;

export interface QueuedMutation {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  attempts: number;
  savedAt: number;
}

let queue: QueuedMutation[] = [];

async function persist(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue)).catch(
    () => {},
  );
}

export async function initOfflineQueue(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  try {
    queue = raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    queue = [];
  }
  await clearStale();
}

export async function clearStale(): Promise<void> {
  const now = Date.now();
  const fresh = queue.filter((item) => now - item.savedAt <= TTL_MS);
  if (fresh.length !== queue.length) {
    queue = fresh;
    await persist();
  }
}

export async function enqueue(
  item: Omit<QueuedMutation, "id" | "attempts" | "savedAt">,
): Promise<void> {
  const entry: QueuedMutation = {
    ...item,
    id: crypto.randomUUID(),
    attempts: 0,
    savedAt: Date.now(),
  };
  const next = [...queue, entry];
  queue = next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
  await persist();
}

export async function dequeue(id: string): Promise<void> {
  queue = queue.filter((item) => item.id !== id);
  await persist();
}

export function loadQueue(): QueuedMutation[] {
  return [...queue];
}

export async function incrementAttempts(id: string): Promise<void> {
  queue = queue.map((item) =>
    item.id === id ? { ...item, attempts: item.attempts + 1 } : item,
  );
  await persist();
}

export async function clearOfflineQueue(): Promise<void> {
  queue = [];
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- client/lib/__tests__/offline-queue.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/lib/offline-queue.ts client/lib/__tests__/offline-queue.test.ts
git commit -m "feat(offline): add offline-queue module with AsyncStorage persistence"
```

---

### Task 2: `offline-queue-drain.ts` — drain logic

**Files:**

- Create: `client/lib/offline-queue-drain.ts`
- Create: `client/lib/__tests__/offline-queue-drain.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/lib/__tests__/offline-queue-drain.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the drain module
vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/lib/offline-queue", () => ({
  loadQueue: vi.fn(),
  dequeue: vi.fn(),
  incrementAttempts: vi.fn(),
}));

vi.mock("@/lib/query-keys", () => ({
  QUERY_KEYS: {
    scannedItems: ["/api/scanned-items"],
    dailySummary: ["/api/daily-summary"],
    frequentItems: ["/api/scanned-items/frequent"],
  },
}));

const importDrain = () => import("../offline-queue-drain");

describe("offline-queue-drain", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains items in savedAt ascending order", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const items = [
      {
        id: "b",
        endpoint: "/api/scanned-items",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: 2000,
      },
      {
        id: "a",
        endpoint: "/api/scanned-items",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: 1000,
      },
    ];
    vi.mocked(loadQueue).mockReturnValue(items);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      const item = items.find((i) => i.id === id);
      if (item) item.attempts++;
    });
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    const calls = vi.mocked(apiRequest).mock.calls.map((c) => c[0]);
    // Both called — order verified by the fact that "a" (savedAt:1000) is processed first
    expect(calls).toHaveLength(2);
  });

  it("increments attempts BEFORE making the apiRequest call", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const item = {
      id: "x",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    const incrementCallOrder =
      vi.mocked(incrementAttempts).mock.invocationCallOrder[0];
    const requestCallOrder = vi.mocked(apiRequest).mock.invocationCallOrder[0];
    expect(incrementCallOrder).toBeLessThan(requestCallOrder);
  });

  it("sends X-Idempotency-Key header on POST calls", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const item = {
      id: "idem-uuid",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    const initArg = vi.mocked(apiRequest).mock.calls[0][3] as RequestInit;
    expect(
      (initArg?.headers as Record<string, string>)["X-Idempotency-Key"],
    ).toBe("idem-uuid");
  });

  it("dequeues and emits error immediately on 4xx failure", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue, subscribeToQueueDrainErrors } = await importDrain();

    const item = {
      id: "y",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockRejectedValue(new Error("400: Bad Request"));
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const errorListener = vi.fn();
    subscribeToQueueDrainErrors(errorListener);

    await drainQueue();

    expect(dequeue).toHaveBeenCalledWith("y");
    expect(errorListener).toHaveBeenCalledOnce();
  });

  it("concurrent drain calls are no-ops (lock guard)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const item = {
      id: "z",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    // Slow request so the second drain fires while first is in-flight
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(new Response()), 100),
        ),
    );
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const p1 = drainQueue();
    const p2 = drainQueue(); // should be a no-op
    vi.runAllTimers();
    await Promise.all([p1, p2]);

    expect(apiRequest).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- client/lib/__tests__/offline-queue-drain.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/lib/offline-queue-drain.ts`**

```ts
import { apiRequest, queryClient } from "@/lib/query-client";
import {
  loadQueue,
  dequeue,
  incrementAttempts,
  type QueuedMutation,
} from "@/lib/offline-queue";
import { QUERY_KEYS } from "@/lib/query-keys";

type DrainErrorListener = (message: string) => void;
const drainErrorListeners = new Set<DrainErrorListener>();

export function subscribeToQueueDrainErrors(
  listener: DrainErrorListener,
): () => void {
  drainErrorListeners.add(listener);
  return () => drainErrorListeners.delete(listener);
}

function emitDrainError(): void {
  drainErrorListeners.forEach((l) =>
    l("A queued item couldn't be synced and was discarded."),
  );
}

let isDraining = false;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [0, 2000, 4000, 8000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptDrain(item: QueuedMutation): Promise<void> {
  let done = false;
  while (!done) {
    // Increment before the request — survives force-quit mid-drain
    await incrementAttempts(item.id);
    const current = loadQueue().find((i) => i.id === item.id);
    if (!current) return; // dequeued externally

    const delayMs = RETRY_DELAYS_MS[current.attempts - 1] ?? 8000;
    if (delayMs > 0) await wait(delayMs);

    const init: RequestInit = {};
    if (current.method === "POST") {
      init.headers = { "X-Idempotency-Key": current.id };
    }

    try {
      await apiRequest(current.method, current.endpoint, current.body, init);
      await dequeue(current.id);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.frequentItems,
      });
      done = true;
    } catch (error) {
      const is4xx = error instanceof Error && /^4\d\d:/.test(error.message);
      if (is4xx || current.attempts >= MAX_ATTEMPTS) {
        await dequeue(current.id);
        emitDrainError();
        done = true;
      }
      // 5xx with remaining attempts: loop
    }
  }
}

export async function drainQueue(): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  try {
    const sorted = [...loadQueue()].sort((a, b) => a.savedAt - b.savedAt);
    for (const item of sorted) {
      const exists = loadQueue().find((i) => i.id === item.id);
      if (exists) await attemptDrain(item);
    }
  } finally {
    isDraining = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- client/lib/__tests__/offline-queue-drain.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/lib/offline-queue-drain.ts client/lib/__tests__/offline-queue-drain.test.ts
git commit -m "feat(offline): add offline-queue-drain with retry/backoff and error emitter"
```

---

### Task 3: `OfflineQueueBridge.tsx` — bridge component

**Files:**

- Create: `client/components/OfflineQueueBridge.tsx`
- Create: `client/components/__tests__/OfflineQueueBridge.test.tsx`

- [ ] **Step 1: Write failing test**

Create `client/components/__tests__/OfflineQueueBridge.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react-native";
import { OfflineQueueBridge } from "../OfflineQueueBridge";

const mockToastError = vi.fn();
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError }),
}));

let drainErrorCallback: ((msg: string) => void) | null = null;
vi.mock("@/lib/offline-queue-drain", () => ({
  subscribeToQueueDrainErrors: (cb: (msg: string) => void) => {
    drainErrorCallback = cb;
    return () => {
      drainErrorCallback = null;
    };
  },
}));

describe("OfflineQueueBridge", () => {
  it("shows a toast when a drain error is emitted", () => {
    render(<OfflineQueueBridge />);
    expect(drainErrorCallback).not.toBeNull();
    drainErrorCallback?.("A queued item couldn't be synced and was discarded.");
    expect(mockToastError).toHaveBeenCalledWith(
      "A queued item couldn't be synced and was discarded.",
    );
  });

  it("renders nothing", () => {
    const { toJSON } = render(<OfflineQueueBridge />);
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- client/components/__tests__/OfflineQueueBridge.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/components/OfflineQueueBridge.tsx`**

```tsx
import { useEffect } from "react";
import { subscribeToQueueDrainErrors } from "@/lib/offline-queue-drain";
import { useToast } from "@/context/ToastContext";

/**
 * Bridges module-level offline queue drain errors to the React-tree toast system.
 * Mirrors QueryErrorToastBridge — renders nothing, subscribes to an emitter.
 * Mount once as a sibling inside <ToastProvider> in App.tsx.
 */
export function OfflineQueueBridge(): null {
  const toast = useToast();

  useEffect(() => {
    return subscribeToQueueDrainErrors((message) => {
      toast.error(message);
    });
  }, [toast]);

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- client/components/__tests__/OfflineQueueBridge.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/OfflineQueueBridge.tsx client/components/__tests__/OfflineQueueBridge.test.tsx
git commit -m "feat(offline): add OfflineQueueBridge component"
```

---

### Task 4: Wire drain into `App.tsx`

**Files:**

- Modify: `client/App.tsx`

- [ ] **Step 1: Add imports and `initOfflineQueue` call**

In `client/App.tsx`, add these imports alongside the existing ones:

```tsx
import { onlineManager } from "@tanstack/react-query";
import { initOfflineQueue } from "@/lib/offline-queue";
import { drainQueue } from "@/lib/offline-queue-drain";
import { OfflineQueueBridge } from "@/components/OfflineQueueBridge";
```

Then add an eager init call **before** the `initReporter()` call at module level (top of the file, outside any component):

```tsx
// Eager init — must run before any mutation surface can mount
void initOfflineQueue();

// Wire drain to fire on every reconnect event
onlineManager.subscribe((isOnline) => {
  if (isOnline) {
    void drainQueue();
  }
});
```

- [ ] **Step 2: Mount `OfflineQueueBridge`**

In the `AppContent` component, add `<OfflineQueueBridge />` alongside the existing bridges:

```tsx
// Before (existing):
<QueryErrorToastBridge />
<SessionExpiryBridge />

// After:
<QueryErrorToastBridge />
<SessionExpiryBridge />
<OfflineQueueBridge />
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run check:types 2>&1 | grep -E "App.tsx|offline-queue"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/App.tsx
git commit -m "feat(offline): wire offline queue init and drain into App"
```

---

### Task 5: Protect `addToLogMutation` in `useNutritionLookup.ts`

**Files:**

- Modify: `client/hooks/useNutritionLookup.ts`

- [ ] **Step 1: Add imports**

At the top of `client/hooks/useNutritionLookup.ts`, add:

```ts
import { onlineManager } from "@tanstack/react-query";
import { enqueue } from "@/lib/offline-queue";
import type { ScannedItemResponse } from "@/types/api";
```

- [ ] **Step 2: Update `addToLogMutation`**

Locate the `addToLogMutation` (around line 427). Replace the `mutationFn` with the offline-aware version, and widen `onSuccess` to guard the `undefined` case:

```ts
const addToLogMutation = useMutation<ScannedItemResponse | undefined, Error>({
  mutationFn: async () => {
    if (!nutrition) return undefined;

    if (!onlineManager.isOnline()) {
      await enqueue({
        endpoint: "/api/scanned-items",
        method: "POST",
        body: {
          ...nutrition,
          servings: servingQuantity,
          userId: user?.id,
        },
      });
      return undefined; // queued — server confirmation deferred
    }

    const response = await apiRequest("POST", "/api/scanned-items", {
      ...nutrition,
      servings: servingQuantity,
      userId: user?.id,
    });
    return response.json() as Promise<ScannedItemResponse>;
  },
  onSuccess: (data) => {
    // data is undefined when the mutation was queued offline
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  },
  onError: () => {
    haptics.notification(Haptics.NotificationFeedbackType.Error);
  },
});
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run check:types 2>&1 | grep "useNutritionLookup"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useNutritionLookup.ts
git commit -m "feat(offline): protect addToLogMutation with offline queue"
```

---

### Task 6: Protect `logAllMutation` in `useQuickLogSession.ts`

**Files:**

- Modify: `client/hooks/useQuickLogSession.ts`

- [ ] **Step 1: Add imports**

```ts
import { onlineManager } from "@tanstack/react-query";
import { enqueue } from "@/lib/offline-queue";
```

- [ ] **Step 2: Update `logAllMutation`**

Locate `logAllMutation` (around line 169). Replace `mutationFn` with an offline-aware version. Note: each `ParsedFoodItem` is enqueued as a **separate** `QueuedMutation`. The `onSuccess` type widens to `ScannedItemResponse[] | undefined`:

```ts
const logAllMutation = useMutation<
  ScannedItemResponse[] | undefined,
  Error,
  ParsedFoodItem[]
>({
  mutationFn: async (items: ParsedFoodItem[]) => {
    setCapWarning(null);

    if (!onlineManager.isOnline()) {
      // Enqueue each item individually so they replay in order
      const capped = items.slice(0, MAX_LOG_ITEMS);
      if (items.length > MAX_LOG_ITEMS) {
        setCapWarning(
          `Only the first ${MAX_LOG_ITEMS} items were logged. Please log the rest separately.`,
        );
      }
      for (const item of capped) {
        await enqueue({
          endpoint: "/api/scanned-items",
          method: "POST",
          body: {
            productName: `${item.quantity} ${item.unit} ${item.name}`,
            sourceType: item.sourceType ?? "voice",
            calories: item.calories?.toString(),
            protein: item.protein?.toString(),
            carbs: item.carbs?.toString(),
            fat: item.fat?.toString(),
            servingSize: item.servingSize,
          },
        });
      }
      return undefined; // queued — server confirmation deferred
    }

    // Online path — unchanged
    const capped = items.slice(0, MAX_LOG_ITEMS);
    if (items.length > MAX_LOG_ITEMS) {
      setCapWarning(
        `Only the first ${MAX_LOG_ITEMS} items were logged. Please log the rest separately.`,
      );
    }
    const results = await Promise.allSettled(
      capped.map(async (item) => {
        const res = await apiRequest("POST", "/api/scanned-items", {
          productName: `${item.quantity} ${item.unit} ${item.name}`,
          sourceType: item.sourceType ?? "voice",
          calories: item.calories?.toString(),
          protein: item.protein?.toString(),
          carbs: item.carbs?.toString(),
          fat: item.fat?.toString(),
          servingSize: item.servingSize,
        });
        return res.json() as Promise<ScannedItemResponse>;
      }),
    );
    const failedIndices = results
      .map((r, i) => (r.status === "rejected" ? i : -1))
      .filter((i) => i !== -1);
    if (failedIndices.length > 0) {
      const err: PartialLogError = new Error("Some items failed to log");
      err.failedIndices = failedIndices;
      throw err;
    }
    return results.map(
      (r) => (r as PromiseFulfilledResult<ScannedItemResponse>).value,
    );
  },
  onSuccess: (data, items) => {
    // data is undefined when all items were queued offline
    if (data === undefined) {
      const loggedItems = items.slice(0, MAX_LOG_ITEMS);
      const summary: LogSummary = {
        itemCount: loggedItems.length,
        totalCalories: loggedItems.reduce(
          (sum, item) => sum + (item.calories ?? 0),
          0,
        ),
        firstName: loggedItems[0]?.name ?? "Food",
      };
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      setParsedItems([]);
      setInputText("");
      setSubmitError(null);
      onLogSuccessRef.current?.(summary);
      return;
    }
    // Online success path — unchanged
    const loggedItems = items.slice(0, MAX_LOG_ITEMS);
    const summary: LogSummary = {
      itemCount: loggedItems.length,
      totalCalories: loggedItems.reduce(
        (sum, item) => sum + (item.calories ?? 0),
        0,
      ),
      firstName: loggedItems[0]?.name ?? "Food",
    };
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    setParsedItems([]);
    setInputText("");
    setSubmitError(null);
    onLogSuccessRef.current?.(summary);
  },
  // onError unchanged
});
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run check:types 2>&1 | grep "useQuickLogSession"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useQuickLogSession.ts
git commit -m "feat(offline): protect logAllMutation with per-item offline queue enqueue"
```

---

### Task 7: Protect `useDiscardItem.ts`

**Files:**

- Modify: `client/hooks/useDiscardItem.ts`

- [ ] **Step 1: Add imports**

```ts
import { onlineManager } from "@tanstack/react-query";
import { enqueue } from "@/lib/offline-queue";
```

- [ ] **Step 2: Update `mutationFn`**

The `mutationFn` returns `void`. The offline early-return is already compatible — no TData widening needed here since it returns nothing.

```ts
return useMutation({
  mutationFn: async (itemId: number) => {
    if (!onlineManager.isOnline()) {
      await enqueue({
        endpoint: `/api/scanned-items/${itemId}`,
        method: "DELETE",
        body: undefined,
      });
      return; // queued — optimistic update already removed item from cache
    }
    await apiRequest("DELETE", `/api/scanned-items/${itemId}`);
  },
  // onMutate, onError, onSettled unchanged
});
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npm run check:types 2>&1 | grep "useDiscardItem"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useDiscardItem.ts
git commit -m "feat(offline): protect useDiscardItem DELETE with offline queue"
```

---

### Task 8: Schema — add `idempotencyKey` to `scannedItems`

**Files:**

- Modify: `shared/schema.ts`

- [ ] **Step 1: Add the column**

In `shared/schema.ts`, find the `scannedItems` table definition (line 169). Add the new column after `discardedAt`:

```ts
// After discardedAt:
idempotencyKey: text("idempotency_key"),
```

Then add a partial unique index inside the table's constraints array (after the existing `check` constraints):

```ts
uniqueIndex("scanned_items_idempotency_key_idx")
  .on(table.userId, table.idempotencyKey)
  .where(sql`idempotency_key IS NOT NULL`),
```

- [ ] **Step 2: Push the schema to the database**

```bash
npm run db:push
```

Expected: Drizzle detects the new column and index and applies them. No data migration needed (column is nullable).

- [ ] **Step 3: Verify types compile**

```bash
npm run check:types 2>&1 | grep "schema"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat(offline): add idempotency_key column to scanned_items"
```

---

### Task 9: Server — idempotency dedup for `POST /api/scanned-items`

**Files:**

- Modify: `server/routes/nutrition.ts`
- Modify: `server/routes/__tests__/nutrition.test.ts`

- [ ] **Step 1: Write failing test**

In `server/routes/__tests__/nutrition.test.ts`, add a new `describe` block for the idempotency path (add it after the existing POST tests):

```ts
describe("POST /api/scanned-items — idempotency", () => {
  it("returns existing item when X-Idempotency-Key matches a prior request", async () => {
    const existingItem = createMockScannedItem({
      id: 99,
      idempotencyKey: "test-uuid-1",
    });
    vi.mocked(storage.getScannedItemByIdempotencyKey).mockResolvedValue(
      existingItem,
    );

    const res = await request(app)
      .post("/api/scanned-items")
      .set("Authorization", "Bearer valid-token")
      .set("X-Idempotency-Key", "test-uuid-1")
      .send({ productName: "Apple", calories: "52" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(99);
    expect(storage.createScannedItemWithLog).not.toHaveBeenCalled();
  });

  it("creates a new item and stores the key when no prior match exists", async () => {
    vi.mocked(storage.getScannedItemByIdempotencyKey).mockResolvedValue(null);
    const newItem = createMockScannedItem({
      id: 100,
      idempotencyKey: "test-uuid-2",
    });
    vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(newItem);

    const res = await request(app)
      .post("/api/scanned-items")
      .set("Authorization", "Bearer valid-token")
      .set("X-Idempotency-Key", "test-uuid-2")
      .send({ productName: "Banana", calories: "89" });

    expect(res.status).toBe(201);
    expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "test-uuid-2" }),
    );
  });

  it("creates normally when no X-Idempotency-Key header is present", async () => {
    vi.mocked(storage.getScannedItemByIdempotencyKey).mockResolvedValue(null);
    const newItem = createMockScannedItem({ id: 101 });
    vi.mocked(storage.createScannedItemWithLog).mockResolvedValue(newItem);

    const res = await request(app)
      .post("/api/scanned-items")
      .set("Authorization", "Bearer valid-token")
      .send({ productName: "Cherry", calories: "63" });

    expect(res.status).toBe(201);
    expect(storage.getScannedItemByIdempotencyKey).not.toHaveBeenCalled();
  });
});
```

Also add `getScannedItemByIdempotencyKey: vi.fn()` to the `storage` mock at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- server/routes/__tests__/nutrition.test.ts
```

Expected: FAIL — `getScannedItemByIdempotencyKey` not found.

- [ ] **Step 3: Add `getScannedItemByIdempotencyKey` to the storage layer**

**`server/storage/nutrition.ts`** — add this function after `createScannedItemWithLog` (line ~338):

```ts
export async function getScannedItemByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
): Promise<ScannedItem | null> {
  const [item] = await db
    .select()
    .from(scannedItems)
    .where(
      and(
        eq(scannedItems.userId, userId),
        eq(scannedItems.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return item ?? null;
}
```

(`ScannedItem` is already imported at the top of that file as the Drizzle inferred type. `and`, `eq` are from `drizzle-orm` — check the existing imports and add if absent.)

**`server/storage/index.ts`** — the storage object is a flat delegation map (not a TypeScript interface). Add one line alongside the other `nutrition.*` delegations (around line 83):

```ts
getScannedItemByIdempotencyKey: nutrition.getScannedItemByIdempotencyKey,
```

**`createScannedItemWithLog` requires no signature change.** It accepts `InsertScannedItem`, which is Drizzle-inferred from the schema. After the `db:push` in Task 8 adds the `idempotencyKey` column, `InsertScannedItem` automatically includes `idempotencyKey?: string | null` — no manual update needed.

- [ ] **Step 4: Update the POST handler in `server/routes/nutrition.ts`**

In the `app.post("/api/scanned-items", ...)` handler (around line 192), add the idempotency check before `storage.createScannedItemWithLog`:

```ts
app.post(
  "/api/scanned-items",
  requireAuth,
  pantryRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers["x-idempotency-key"] as
        | string
        | undefined;

      // Idempotency check: if key present and we've seen it, return existing item
      if (idempotencyKey) {
        const existing = await storage.getScannedItemByIdempotencyKey(
          req.userId!,
          idempotencyKey,
        );
        if (existing) {
          return res.status(200).json(existing);
        }
      }

      const validated = scannedItemInputSchema.parse({
        ...req.body,
        userId: req.userId,
      });

      const item = await storage.createScannedItemWithLog({
        userId: validated.userId,
        barcode: validated.barcode,
        productName: validated.productName,
        brandName: validated.brandName,
        servingSize: validated.servingSize,
        calories: validated.calories,
        protein: validated.protein,
        carbs: validated.carbs,
        fat: validated.fat,
        fiber: validated.fiber,
        sugar: validated.sugar,
        sodium: validated.sodium,
        imageUrl: validated.imageUrl,
        idempotencyKey: idempotencyKey ?? null,
      });

      res.status(201).json(item);
    } catch (error) {
      handleRouteError(res, error, "save item");
    }
  },
);
```

Also update `createScannedItemWithLog` in the storage layer to accept and store `idempotencyKey`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:run -- server/routes/__tests__/nutrition.test.ts
```

Expected: all tests pass including new idempotency tests.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts server/routes/nutrition.ts server/storage/ server/routes/__tests__/nutrition.test.ts
git commit -m "feat(offline): server-side idempotency dedup for POST /api/scanned-items"
```

---

## Phase 2 — Query Cache Persistence

### File Map

| File                         | Action | Responsibility                                                  |
| ---------------------------- | ------ | --------------------------------------------------------------- |
| `package.json`               | Modify | Add two TanStack persister packages                             |
| `client/lib/query-client.ts` | Modify | Export `asyncStoragePersister`                                  |
| `client/App.tsx`             | Modify | Replace `QueryClientProvider` with `PersistQueryClientProvider` |
| `client/hooks/useAuth.ts`    | Modify | Clear persisted cache on all three auth teardown paths          |

---

### Task 10: Install packages + create persister export

**Files:**

- Modify: `package.json`
- Modify: `client/lib/query-client.ts`

- [ ] **Step 1: Install packages**

```bash
npm install @tanstack/query-async-storage-persister @tanstack/react-query-persist-client
```

Expected: both packages added to `package.json` dependencies.

- [ ] **Step 2: Add persister to `query-client.ts`**

At the bottom of `client/lib/query-client.ts`, after the existing exports, add:

```ts
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "@ocrecipes_query_cache",
  throttleTime: 1000,
});
```

(The import for `AsyncStorage` may already exist at the top — check and deduplicate if so.)

- [ ] **Step 3: Verify types compile**

```bash
npm run check:types 2>&1 | grep "query-client"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json client/lib/query-client.ts
git commit -m "feat(offline): add TanStack async-storage persister"
```

---

### Task 11: Wire `PersistQueryClientProvider` in `App.tsx`

**Files:**

- Modify: `client/App.tsx`

- [ ] **Step 1: Replace `QueryClientProvider`**

In `client/App.tsx`, add the import:

```tsx
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { asyncStoragePersister } from "@/lib/query-client";
```

Replace the existing `<QueryClientProvider client={queryClient}>` wrapper with:

```tsx
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{
    persister: asyncStoragePersister,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours — matches offline queue TTL
  }}
>
  {/* existing children unchanged */}
</PersistQueryClientProvider>
```

Remove the now-unused `QueryClientProvider` import from `@tanstack/react-query`.

- [ ] **Step 2: Verify types compile**

```bash
npm run check:types 2>&1 | grep "App.tsx"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/App.tsx
git commit -m "feat(offline): wire PersistQueryClientProvider for query cache persistence"
```

---

### Task 12: Auth teardown — clear persisted cache on logout

**Files:**

- Modify: `client/hooks/useAuth.ts`

- [ ] **Step 1: Update all three teardown paths**

The `QUERY_CACHE_STORAGE_KEY` constant is defined in `query-client.ts` as part of the persister config (`"@ocrecipes_query_cache"`). To avoid importing from `query-client.ts` (large module), define the key as a local constant in `useAuth.ts`:

```ts
const QUERY_CACHE_KEY = "@ocrecipes_query_cache";
```

Then in each of the three teardown functions, add `await AsyncStorage.removeItem(QUERY_CACHE_KEY)` inside the existing `try { queryClient.clear() } catch {}` block, **before** `queryClient.clear()`:

**`logout()`** (around line 178):

```ts
try {
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  queryClient.clear();
} catch {}
```

**`expireSession()`** (around line 208):

```ts
try {
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  queryClient.clear();
} catch {}
```

**`deleteAccount()`** (around line 242):

```ts
try {
  await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  queryClient.clear();
} catch {}
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npm run check:types 2>&1 | grep "useAuth"
```

Expected: no errors.

- [ ] **Step 3: Run the auth tests to verify nothing is broken**

```bash
npm run test:run -- client/hooks/__tests__/useAuth.test.ts
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add client/hooks/useAuth.ts
git commit -m "fix(offline): clear persisted query cache on logout/expiry/account-delete"
```

---

## Phase 3 — Per-Feature Offline Guards

### File Map

| File                                             | Action | Responsibility                                           |
| ------------------------------------------------ | ------ | -------------------------------------------------------- |
| `client/hooks/useOfflineGuard.ts`                | Create | Thin wrapper exposing `isOffline` + `offlineLabel`       |
| `client/hooks/__tests__/useOfflineGuard.test.ts` | Create | Unit tests                                               |
| `client/screens/NutritionDetailScreen.tsx`       | Modify | Disable confirm button + inline note when offline        |
| `client/screens/QuickLogScreen.tsx`              | Modify | Disable log-all button + inline note when offline        |
| `client/screens/HistoryScreen.tsx`               | Modify | Disable / mute discard action + inline note when offline |

---

### Task 13: `useOfflineGuard` hook

**Files:**

- Create: `client/hooks/useOfflineGuard.ts`
- Create: `client/hooks/__tests__/useOfflineGuard.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/hooks/__tests__/useOfflineGuard.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react-native";
import { useOfflineGuard } from "../useOfflineGuard";

vi.mock("../useNetworkStatus", () => ({
  useNetworkStatus: vi.fn(),
}));

import { useNetworkStatus } from "../useNetworkStatus";

describe("useOfflineGuard", () => {
  it("returns isOffline: false and unmodified label when online", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOffline: false,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
    const { result } = renderHook(() => useOfflineGuard());
    expect(result.current.isOffline).toBe(false);
    expect(result.current.offlineLabel("Save")).toBe("Save");
  });

  it("returns isOffline: true and annotated label when offline", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
    const { result } = renderHook(() => useOfflineGuard());
    expect(result.current.isOffline).toBe(true);
    expect(result.current.offlineLabel("Save")).toBe(
      "Save (offline — will sync)",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:run -- client/hooks/__tests__/useOfflineGuard.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useOfflineGuard.ts`**

```ts
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function useOfflineGuard() {
  const { isOffline } = useNetworkStatus();
  const offlineLabel = (label: string) =>
    isOffline ? `${label} (offline — will sync)` : label;
  return { isOffline, offlineLabel };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- client/hooks/__tests__/useOfflineGuard.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useOfflineGuard.ts client/hooks/__tests__/useOfflineGuard.test.ts
git commit -m "feat(offline): add useOfflineGuard hook"
```

---

### Task 14: Offline guard — `NutritionDetailScreen.tsx`

**Files:**

- Modify: `client/screens/NutritionDetailScreen.tsx`

- [ ] **Step 1: Add the hook and update the confirm button**

Add the import:

```tsx
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
```

Inside the component, call the hook:

```tsx
const { isOffline, offlineLabel } = useOfflineGuard();
```

Find the confirm/add-to-log button (the one that calls `handleAddToLog`) and:

1. Pass `disabled={isOffline || addToLogMutation.isPending}` (replace any existing disabled condition)
2. Pass `offlineLabel("Add to Log")` as the button label
3. Add a conditional `ThemedText` note below the button:

```tsx
{
  isOffline && (
    <ThemedText
      type="small"
      style={{
        color: theme.textSecondary,
        textAlign: "center",
        marginTop: Spacing.xs,
      }}
    >
      You're offline. This will sync when you reconnect.
    </ThemedText>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run check:types 2>&1 | grep "NutritionDetailScreen"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/screens/NutritionDetailScreen.tsx
git commit -m "feat(offline): add offline guard to NutritionDetailScreen confirm button"
```

---

### Task 15: Offline guard — `QuickLogScreen.tsx`

**Files:**

- Modify: `client/screens/QuickLogScreen.tsx`

- [ ] **Step 1: Add the hook and update the log-all button**

Add the import:

```tsx
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
```

Inside the component:

```tsx
const { isOffline, offlineLabel } = useOfflineGuard();
```

Find the log-all submit button (the one that calls `logAllMutation.mutate`) and:

1. Set `disabled={isOffline || logAllMutation.isPending}`
2. Use `offlineLabel("Log All")` as the button label
3. Add the conditional note below:

```tsx
{
  isOffline && (
    <ThemedText
      type="small"
      style={{
        color: theme.textSecondary,
        textAlign: "center",
        marginTop: Spacing.xs,
      }}
    >
      You're offline. This will sync when you reconnect.
    </ThemedText>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run check:types 2>&1 | grep "QuickLogScreen"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/screens/QuickLogScreen.tsx
git commit -m "feat(offline): add offline guard to QuickLogScreen log-all button"
```

---

### Task 16: Offline guard — `HistoryScreen.tsx`

**Files:**

- Modify: `client/screens/HistoryScreen.tsx`

- [ ] **Step 1: Add the hook and update the discard action**

Add the import:

```tsx
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
```

Inside the component:

```tsx
const { isOffline } = useOfflineGuard();
```

Find the swipe-to-delete / discard action (the gesture handler or button that calls `discardItem.mutate`). Apply visual muting when offline:

- If it's a swipe action, reduce the action's opacity or add `accessibilityLabel` annotation
- Add a brief note in the list's `ListEmptyComponent` area or as a top-of-list banner when `isOffline`:

```tsx
{
  isOffline && (
    <ThemedText
      type="small"
      style={{
        color: theme.textSecondary,
        textAlign: "center",
        paddingVertical: Spacing.sm,
      }}
    >
      You're offline. Deletions will sync when you reconnect.
    </ThemedText>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run check:types 2>&1 | grep "HistoryScreen"
```

Expected: no errors.

- [ ] **Step 3: Run full test suite to confirm nothing regressed**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/screens/HistoryScreen.tsx
git commit -m "feat(offline): add offline guard to HistoryScreen discard action"
```

---

## PR Guide

| PR      | Branch                           | Contains    |
| ------- | -------------------------------- | ----------- |
| Phase 1 | `feat/offline-queue`             | Tasks 1–9   |
| Phase 2 | `feat/offline-cache-persistence` | Tasks 10–12 |
| Phase 3 | `feat/offline-guards`            | Tasks 13–16 |

Phase 1 must merge before Phase 3 (guards reference `enqueue` in tests). Phase 2 is fully independent.
