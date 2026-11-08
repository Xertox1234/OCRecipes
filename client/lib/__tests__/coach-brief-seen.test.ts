import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

// The module keeps an in-memory cache, so each test gets a fresh copy.
async function load() {
  vi.resetModules();
  return import("../coach-brief-seen");
}

describe("coach-brief-seen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
  });

  it("is unknown (undefined) before the saved date is read", async () => {
    const m = await load();
    expect(m.getCachedLastBriefSeenDate()).toBeUndefined();
  });

  it("reads the saved date once and caches it", async () => {
    mockAsyncStorage.getItem.mockResolvedValue("2026-11-08");
    const m = await load();
    expect(await m.loadLastBriefSeenDate()).toBe("2026-11-08");
    expect(m.getCachedLastBriefSeenDate()).toBe("2026-11-08");
    await m.loadLastBriefSeenDate();
    expect(mockAsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });

  it("caches null when nothing is saved", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    const m = await load();
    expect(await m.loadLastBriefSeenDate()).toBeNull();
    expect(m.getCachedLastBriefSeenDate()).toBeNull();
  });

  it("leaves the cache unknown after a failed read, so it is retried", async () => {
    mockAsyncStorage.getItem.mockRejectedValue(new Error("disk"));
    const m = await load();
    expect(await m.loadLastBriefSeenDate()).toBeNull();
    expect(m.getCachedLastBriefSeenDate()).toBeUndefined();
  });

  it("marks a date seen in memory at once and on disk", async () => {
    const m = await load();
    m.markBriefSeen("2026-11-08");
    expect(m.getCachedLastBriefSeenDate()).toBe("2026-11-08");
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      m.COACH_BRIEF_SEEN_KEY,
      "2026-11-08",
    );
  });

  it("a mark made while the read is in flight wins over the disk", async () => {
    let resolve: (v: string | null) => void = () => {};
    mockAsyncStorage.getItem.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const m = await load();
    const pending = m.loadLastBriefSeenDate();
    m.markBriefSeen("2026-11-08");
    resolve("2026-11-07");
    expect(await pending).toBe("2026-11-08");
  });
});
