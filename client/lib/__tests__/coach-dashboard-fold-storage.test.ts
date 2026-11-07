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
  return import("../coach-dashboard-fold-storage");
}

describe("coach-dashboard-fold-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
  });

  it("knows nothing before the saved choice is read", async () => {
    const m = await load();
    expect(m.getCachedCoachDashboardFolded()).toBeNull();
  });

  it("reads a saved fold and keeps it for the next mount", async () => {
    mockAsyncStorage.getItem.mockResolvedValue("true");
    const m = await load();
    await expect(m.loadCoachDashboardFolded()).resolves.toBe(true);
    expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(
      m.COACH_DASHBOARD_FOLDED_KEY,
    );
    expect(m.getCachedCoachDashboardFolded()).toBe(true);
  });

  it("nothing saved reads as open", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    const m = await load();
    await expect(m.loadCoachDashboardFolded()).resolves.toBe(false);
  });

  it("a failed read opens the card and tries again next time", async () => {
    mockAsyncStorage.getItem.mockRejectedValue(new Error("disk"));
    const m = await load();
    await expect(m.loadCoachDashboardFolded()).resolves.toBe(false);
    expect(m.getCachedCoachDashboardFolded()).toBeNull();
  });

  it("saving updates the cache at once and writes it", async () => {
    const m = await load();
    m.setCoachDashboardFolded(true);
    expect(m.getCachedCoachDashboardFolded()).toBe(true);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      m.COACH_DASHBOARD_FOLDED_KEY,
      "true",
    );
  });

  // A tap while the read is in flight must not be undone by the older value.
  it("a choice made during the read wins over what was on disk", async () => {
    let resolveRead: (v: string | null) => void = () => {};
    mockAsyncStorage.getItem.mockReturnValue(
      new Promise((r) => {
        resolveRead = r;
      }),
    );
    const m = await load();
    const pending = m.loadCoachDashboardFolded();
    m.setCoachDashboardFolded(true);
    resolveRead("false");
    await expect(pending).resolves.toBe(true);
    expect(m.getCachedCoachDashboardFolded()).toBe(true);
  });

  it("a failed write never throws", async () => {
    mockAsyncStorage.setItem.mockRejectedValue(new Error("disk full"));
    const m = await load();
    expect(() => m.setCoachDashboardFolded(false)).not.toThrow();
    await Promise.resolve();
  });
});
