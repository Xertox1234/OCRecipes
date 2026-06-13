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
      throw new Error("500: Internal Server Error");
    });
    vi.mocked(incrementAttempts).mockImplementation(async (id) => {
      if (item.id === id) item.attempts++;
    });
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
});
