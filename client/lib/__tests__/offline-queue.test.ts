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
