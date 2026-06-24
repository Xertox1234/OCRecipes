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

  it("treats a valid-JSON-but-non-array payload as empty without crashing (M2)", async () => {
    const { initOfflineQueue, loadQueue } = await importModule();
    // "5" parses fine but is not an array — the old `as QueuedMutation[]` cast
    // let it through and clearStale()'s queue.filter() threw at startup.
    vi.mocked(AsyncStorage.getItem).mockResolvedValue("5");
    await expect(initOfflineQueue()).resolves.toBeUndefined();
    expect(loadQueue()).toHaveLength(0);
  });

  it("drops malformed items but keeps valid ones on load (M2 per-item)", async () => {
    const { initOfflineQueue, loadQueue } = await importModule();
    const now = Date.now();
    const mixed = [
      {
        id: "good",
        endpoint: "/api/x",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: now,
      },
      {
        id: 123,
        endpoint: "/api/x",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: now,
      }, // bad id type (version skew)
      { endpoint: "/api/x", method: "POST" }, // missing fields
      null,
      "not-an-object",
    ];
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(mixed));
    await initOfflineQueue();
    const q = loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0].id).toBe("good");
  });

  it("caps the merged queue to the 50 newest on init when the persisted set alone exceeds the cap (L5)", async () => {
    const { initOfflineQueue, loadQueue } = await importModule();
    const now = Date.now();
    // 60 persisted entries, oldest first. initOfflineQueue merges persisted +
    // in-memory then slices to the last MAX_DEPTH (50) — this exercises the
    // merge-cap branch (merged.length > MAX_DEPTH), distinct from the enqueue cap.
    const persisted = Array.from({ length: 60 }, (_, i) => ({
      id: `item-${i}`,
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { name: `item-${i}` },
      attempts: 0,
      savedAt: now - (60 - i) * 1000,
    }));
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify(persisted),
    );
    await initOfflineQueue();
    const q = loadQueue();
    expect(q).toHaveLength(50);
    // The 10 oldest were dropped; the 50 newest kept, in order.
    expect(q[0].id).toBe("item-10");
    expect(q[49].id).toBe("item-59");
  });

  it("does not clobber an item enqueued while the persisted load is in flight (L2)", async () => {
    const { initOfflineQueue, enqueue, loadQueue } = await importModule();
    let resolveGet: (v: string | null) => void = () => {};
    vi.mocked(AsyncStorage.getItem).mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveGet = resolve;
      }),
    );
    const persisted = [
      {
        id: "persisted",
        endpoint: "/api/x",
        method: "POST",
        body: {},
        attempts: 0,
        savedAt: Date.now(),
      },
    ];
    const initPromise = initOfflineQueue();
    // An enqueue lands during the getItem await window (before init assigns queue).
    await enqueue({
      endpoint: "/api/scanned-items",
      method: "POST",
      body: { name: "during-load" },
    });
    resolveGet(JSON.stringify(persisted));
    await initPromise;
    const q = loadQueue();
    expect(q).toHaveLength(2);
    expect(q.some((i) => i.id === "persisted")).toBe(true);
    expect(
      q.some((i) => (i.body as { name?: string }).name === "during-load"),
    ).toBe(true);
    // Durability: the merged set must be persisted unconditionally (not left
    // memory-only) so a later force-quit can't lose the persisted-older entry.
    const lastWrite = vi.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1];
    expect(lastWrite).toContain("persisted");
    expect(lastWrite).toContain("during-load");
  });
});
