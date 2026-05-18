import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveVerificationStreak,
  _testInternals,
} from "../verification-streak-cache";
import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getUserVerificationStats: vi.fn(),
  },
}));

const mockGetUserVerificationStats = vi.mocked(
  storage.getUserVerificationStats,
);

/** Build verification stats with a given streak. */
const statsWithStreak = (streak: number) => ({
  count: streak,
  frontLabelCount: 0,
  compositeScore: streak,
  streak,
});

describe("verification-streak-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testInternals.streakCache.clear();
  });

  it("fetches verification stats on cache miss and returns the streak", async () => {
    mockGetUserVerificationStats.mockResolvedValue(statsWithStreak(7));

    const streak = await resolveVerificationStreak("u1");

    expect(mockGetUserVerificationStats).toHaveBeenCalledWith("u1");
    expect(streak).toBe(7);
  });

  it("returns a cached streak on the second call without hitting the DB", async () => {
    mockGetUserVerificationStats.mockResolvedValue(statsWithStreak(3));

    await resolveVerificationStreak("u2");
    const streak = await resolveVerificationStreak("u2");

    expect(mockGetUserVerificationStats).toHaveBeenCalledTimes(1);
    expect(streak).toBe(3);
  });

  it("caches a zero streak (does not re-fetch a falsy value)", async () => {
    mockGetUserVerificationStats.mockResolvedValue(statsWithStreak(0));

    await resolveVerificationStreak("u3");
    const streak = await resolveVerificationStreak("u3");

    expect(mockGetUserVerificationStats).toHaveBeenCalledTimes(1);
    expect(streak).toBe(0);
  });

  it("re-fetches after the TTL expires", async () => {
    mockGetUserVerificationStats.mockResolvedValue(statsWithStreak(5));

    await resolveVerificationStreak("u4");

    // Manually expire the cache entry
    const entry = _testInternals.streakCache.get("u4")!;
    entry.expiresAt = Date.now() - 1;

    await resolveVerificationStreak("u4");

    expect(mockGetUserVerificationStats).toHaveBeenCalledTimes(2);
  });
});
