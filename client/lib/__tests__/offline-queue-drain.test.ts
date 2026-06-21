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

// Mock token storage so the auth gate can be driven deterministically. The drain
// reads tokenStorage.get() (a) to gate the whole drain and (b) inside attemptDrain
// to detect a logout+relogin that straddles a retry backoff.
vi.mock("@/lib/token-storage", () => ({
  tokenStorage: {
    get: vi.fn(),
  },
}));

const importDrain = () => import("../offline-queue-drain");

describe("offline-queue-drain", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    // Default: an authenticated user (token-A). Individual tests override this
    // to exercise the unauthenticated and cross-user-straddle paths. vi.mocked()
    // resolves the module mock declared above (reset by vi.resetModules()).
    const { tokenStorage } = await import("@/lib/token-storage");
    vi.mocked(tokenStorage.get).mockResolvedValue("token-A");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains items in savedAt ascending order (oldest first)", async () => {
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
        body: { tag: "newer" },
        attempts: 0,
        savedAt: 2000,
      },
      {
        id: "a",
        endpoint: "/api/scanned-items",
        method: "POST",
        body: { tag: "older" },
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

    // Assert the actual processing ORDER via a distinguishing body field: the
    // older item (savedAt 1000) must be sent before the newer one (savedAt 2000).
    // (The prior assertion only checked call COUNT, so the sort was untested — L3.)
    const tags = vi
      .mocked(apiRequest)
      .mock.calls.map((c) => (c[2] as { tag: string }).tag);
    expect(tags).toEqual(["older", "newer"]);
  });

  it("treats a 404 on a replayed DELETE as idempotent success, not a discard error (M1)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest, queryClient } = await import("@/lib/query-client");
    const { drainQueue, subscribeToQueueDrainErrors } = await importDrain();
    // Import ApiError dynamically AFTER beforeEach's vi.resetModules() so it
    // shares the drain module's class identity — a top-level static import
    // would bind a stale generation and `instanceof ApiError` would fail.
    const { ApiError } = await import("@/lib/api-error");

    const item = {
      id: "del-1",
      endpoint: "/api/scanned-items/42",
      method: "DELETE",
      body: undefined,
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    // The original DELETE committed server-side but its response was lost; the
    // replay finds the row already gone → 404. That is success for a DELETE.
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("404: Not Found", undefined, 404),
    );
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const errorListener = vi.fn();
    subscribeToQueueDrainErrors(errorListener);

    await drainQueue();

    expect(dequeue).toHaveBeenCalledWith("del-1");
    expect(errorListener).not.toHaveBeenCalled();
    // It synced (row gone) → affected lists invalidated.
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("still treats a 404 on a POST as a failure (only DELETE is idempotent on 404)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue, subscribeToQueueDrainErrors } = await importDrain();
    // Dynamic import for class-identity parity with the drain (see DELETE-404 test).
    const { ApiError } = await import("@/lib/api-error");

    const item = {
      id: "post-404",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("404: Not Found", undefined, 404),
    );
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const errorListener = vi.fn();
    subscribeToQueueDrainErrors(errorListener);

    await drainQueue();

    expect(dequeue).toHaveBeenCalledWith("post-404");
    expect(errorListener).toHaveBeenCalledOnce();
    // Discarded, not synced → no invalidation (symmetric with the 4xx case).
    const { queryClient } = await import("@/lib/query-client");
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("invalidates affected queries once after the whole drain, not per item (L7)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest, queryClient } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const items = [1, 2, 3].map((n) => ({
      id: `i${n}`,
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000 + n,
    }));
    vi.mocked(loadQueue).mockReturnValue(items);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      const it = items.find((i) => i.id === id);
      if (it) it.attempts++;
    });
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    // 3 items synced, but the 3 affected keys are invalidated ONCE each (3 total),
    // not once per item (which would have been 3 × 3 = 9 — a reconnect refetch storm).
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it("does not invalidate when nothing synced (item discarded on 4xx)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest, queryClient } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();
    // Dynamic import for class-identity parity with the drain (see DELETE-404 test).
    const { ApiError } = await import("@/lib/api-error");

    const item = {
      id: "bad",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("400: Bad Request", undefined, 400),
    );
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("treats an unknown (non-ApiError, statusless) error as a server failure and evicts after MAX_ATTEMPTS", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue, subscribeToQueueDrainErrors } = await importDrain();

    const item = {
      id: "unknown-err",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    // A plain Error has no numeric `.status`, so it is neither a network
    // TypeError nor a classified 4xx — it must fall into the server-retry
    // budget so the `while (!done)` loop stays bounded and the item is
    // eventually evicted, not retried forever.
    vi.mocked(apiRequest).mockRejectedValue(new Error("unexpected failure"));
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const errorListener = vi.fn();
    subscribeToQueueDrainErrors(errorListener);

    // The loop accumulates retry delays across the 4 server attempts — advance
    // fake timers so each wait() resolves.
    const p = drainQueue();
    await vi.runAllTimersAsync();
    await p;

    expect(dequeue).toHaveBeenCalledWith("unknown-err");
    expect(errorListener).toHaveBeenCalledOnce();
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
    // Dynamic import for class-identity parity with the drain (see DELETE-404 test).
    const { ApiError } = await import("@/lib/api-error");

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
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError("400: Bad Request", undefined, 400),
    );
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
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(apiRequest).toHaveBeenCalledOnce();
  });

  it("4 consecutive TypeError failures do not evict the item", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const item = {
      id: "ne-1",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    vi.mocked(apiRequest).mockRejectedValue(
      new TypeError("Network request failed"),
    );
    vi.mocked(dequeue).mockResolvedValue(undefined);

    // Each drainQueue call: TypeError fires → early return, isDraining unlocked.
    // 4 separate invocations simulate 4 reconnect attempts on a flappy connection.
    // Attempts 2-4 accumulate retry delays (2s, 4s, 8s) — advance fake timers.
    for (let i = 0; i < 4; i++) {
      const p = drainQueue();
      await vi.runAllTimersAsync();
      await p;
    }

    // Despite raw attempts reaching MAX_ATTEMPTS, dequeue must NOT be called
    // because all failures were network-layer TypeErrors.
    expect(dequeue).not.toHaveBeenCalled();
  });

  it("mixed TypeError + 5xx failures count only 5xx against the retry budget", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue, subscribeToQueueDrainErrors } = await importDrain();
    // Dynamic import for class-identity parity with the drain (see DELETE-404 test).
    const { ApiError } = await import("@/lib/api-error");

    const item = {
      id: "mix-1",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: {},
      attempts: 0,
      savedAt: 1000,
    };

    // Call sequence across all drainQueue invocations:
    // invocation 1 → TypeError (budget: 0 server attempts)
    // invocation 2 → TypeError (budget: 0 server attempts)
    // invocation 3 → loops: 5xx, 5xx, 5xx, 5xx → evict on 4th server error
    // If TypeErrors wrongly consumed budget, eviction would fire at svrCount=2.
    let callCount = 0;
    vi.mocked(apiRequest).mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) throw new TypeError("Network request failed");
      throw new ApiError("500: Internal Server Error", undefined, 500);
    });
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    // NOTE: the SAME mutable `item` reference is returned each call — the drain
    // loop reads its mutated `attempts` back via loadQueue().find(). Do not
    // switch this to a shallow copy ([{ ...item }]) or attempts freeze at 0.
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const errorListener = vi.fn();
    subscribeToQueueDrainErrors(errorListener);

    // TypeError invocations: attempts accumulate, causing retry delays on each
    // subsequent call — advance fake timers so the wait() resolves.
    let p = drainQueue(); // TypeError #1 — no eviction
    await vi.runAllTimersAsync();
    await p;
    expect(dequeue).not.toHaveBeenCalled();

    p = drainQueue(); // TypeError #2 — no eviction
    await vi.runAllTimersAsync();
    await p;
    expect(dequeue).not.toHaveBeenCalled();

    // Third invocation loops through 4 x 5xx (each loop iteration has a retry
    // delay — advance all timers until the drain completes).
    p = drainQueue();
    await vi.runAllTimersAsync();
    await p;

    // Only after 4 server-side (5xx) attempts should the item be evicted.
    expect(dequeue).toHaveBeenCalledWith("mix-1");
    expect(errorListener).toHaveBeenCalledOnce();
  });

  it("does not drain (no apiRequest) when unauthenticated (auth gate)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    const { drainQueue } = await importDrain();

    // No session token → the drain must early-return before touching the queue.
    vi.mocked(tokenStorage.get).mockResolvedValue(null);

    const item = {
      id: "no-auth",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { tag: "A-write" },
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    await drainQueue();

    // Nothing is dispatched and nothing is dequeued — the queue is left intact
    // for the next authenticated reconnect.
    expect(apiRequest).not.toHaveBeenCalled();
    expect(dequeue).not.toHaveBeenCalled();

    // The early-return must still release the isDraining lock: a subsequent
    // authenticated reconnect drains normally. (Pins that the auth gate sits
    // inside the try/finally, not before the lock — see drainQueue.)
    vi.mocked(tokenStorage.get).mockResolvedValue("token-A");
    await drainQueue();
    expect(apiRequest).toHaveBeenCalledOnce();
  });

  it("does NOT replay an in-flight item under a new user's token when logout+relogin straddles the backoff wait (cross-user replay race)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    const { drainQueue } = await importDrain();

    // Item enqueued by user A, already on a retry iteration (attempts: 1, a prior
    // 5xx) so the next incrementAttempts → 2 → RETRY_DELAYS_MS[1] = 2000ms wait,
    // i.e. the drain parks in a backoff `wait` before dispatch.
    const item = {
      id: "race-1",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { tag: "A-captured-write" },
      attempts: 1,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    // Token sequence (deterministic, no real timing):
    //   1) drainQueue top-level gate           → token-A (authenticated, proceed)
    //   2) attemptDrain tokenAtStart capture    → token-A (the draining user)
    //   3) post-wait re-check (after relogin)   → token-B (the NEW user)
    // The straddle: A logs out and B logs in WHILE the 2s backoff wait is parked.
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("token-A")
      .mockResolvedValueOnce("token-A")
      .mockResolvedValue("token-B");

    const p = drainQueue();
    await vi.runAllTimersAsync();
    await p;

    // The in-flight item must NOT be POSTed: it would otherwise land under B's
    // bearer token (apiRequest reads tokenStorage at dispatch time). The abort
    // leaves it queued and never dispatches.
    expect(apiRequest).not.toHaveBeenCalled();
    expect(dequeue).not.toHaveBeenCalled();
  });

  it("pins the captured token as apiRequest's bearer override so a dispatch-time storage mutation can't repoint it (microtask TOCTOU)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { tokenStorage } = await import("@/lib/token-storage");
    const { drainQueue } = await importDrain();

    const item = {
      id: "pin-1",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { tag: "A-write" },
      attempts: 0,
      savedAt: 1000,
    };
    vi.mocked(loadQueue).mockReturnValue([item]);
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    // Token reads in order: (1) drainQueue gate, (2) tokenAtStart capture,
    // (3) post-wait re-check — all token-A (same user, re-check passes). The
    // 4th read models the token mutating to token-B in the microtask gap AFTER
    // the re-check but before dispatch. The drain must already have pinned A and
    // forward it to apiRequest as the explicit bearer (5th arg) — never let
    // apiRequest re-read storage at dispatch time (which would see B). The
    // companion api-request-pinned-token test proves apiRequest honors the pin.
    vi.mocked(tokenStorage.get)
      .mockResolvedValueOnce("token-A")
      .mockResolvedValueOnce("token-A")
      .mockResolvedValueOnce("token-A")
      .mockResolvedValue("token-B");

    await drainQueue();

    expect(apiRequest).toHaveBeenCalledOnce();
    // 5th positional arg (index 4) is the pinned bearer; it must be the captured
    // token-A, not the post-re-check token-B.
    expect(vi.mocked(apiRequest).mock.calls[0][4]).toBe("token-A");
  });

  it("aborts an in-flight item cleared from the queue during the backoff wait (clearOfflineQueue on teardown)", async () => {
    const { loadQueue, incrementAttempts, dequeue } = await import(
      "@/lib/offline-queue"
    );
    const { apiRequest } = await import("@/lib/query-client");
    const { drainQueue } = await importDrain();

    const item = {
      id: "cleared-1",
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { tag: "A-captured-write" },
      attempts: 1,
      savedAt: 1000,
    };
    // The item is visible up to and including the top of the attemptDrain loop;
    // after the backoff wait, clearOfflineQueue has emptied the queue, so the
    // post-wait membership re-check finds nothing and aborts before dispatch.
    // loadQueue call order: (1) drainQueue sort, (2) drainQueue `exists` find,
    // (3) attemptDrain top-of-loop `current` find, (4) post-wait re-check.
    vi.mocked(loadQueue)
      .mockReturnValueOnce([item]) // (1) drainQueue sort
      .mockReturnValueOnce([item]) // (2) drainQueue exists find
      .mockReturnValueOnce([item]) // (3) attemptDrain top-of-loop find
      .mockReturnValue([]); // (4+) post-wait re-check → queue cleared
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
    vi.mocked(apiRequest).mockResolvedValue(new Response());
    vi.mocked(dequeue).mockResolvedValue(undefined);

    const p = drainQueue();
    await vi.runAllTimersAsync();
    await p;

    // Not dispatched, and not explicitly dequeued either — the item was already
    // removed by clearOfflineQueue, so the abort path must not double-clear.
    expect(apiRequest).not.toHaveBeenCalled();
    expect(dequeue).not.toHaveBeenCalled();
  });
});
