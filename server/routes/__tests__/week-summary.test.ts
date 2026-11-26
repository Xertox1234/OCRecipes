import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../week-summary";

vi.mock("../../storage", () => ({
  storage: { getDailySummary: vi.fn() },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const summary = (totalCalories: unknown) =>
  ({
    totalCalories,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    itemCount: 1,
  }) as Record<string, unknown> as Awaited<
    ReturnType<typeof storage.getDailySummary>
  >;

describe("GET /api/daily-summary/week", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary("1500.5"));
  });

  it("is the signed-in user's seven days ending on the date asked, in one request", async () => {
    const res = await request(createApp())
      .get("/api/daily-summary/week?end=2026-11-20")
      .set("Authorization", "Bearer token")
      .set("X-Timezone", "America/Los_Angeles");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      endDate: "2026-11-20",
      calories: Array(7).fill(1500.5),
    });
    expect(storage.getDailySummary).toHaveBeenCalledTimes(7);
    for (const call of vi.mocked(storage.getDailySummary).mock.calls) {
      expect(call[0]).toBe("1");
      expect(call[2]).toBe("America/Los_Angeles");
    }
  });

  it("ends today in the user's zone when no date is given", async () => {
    const before = new Date().toISOString().slice(0, 10);
    const res = await request(createApp())
      .get("/api/daily-summary/week")
      .set("Authorization", "Bearer token")
      .set("X-Timezone", "UTC");
    const after = new Date().toISOString().slice(0, 10);
    expect(res.status).toBe(200);
    // Either side of a midnight the request might straddle.
    expect([before, after]).toContain(res.body.endDate);
  });

  it("rejects a date that is not a calendar day (400)", async () => {
    for (const end of ["2026-02-30", "today", "2026-11-20T00:00:00Z"]) {
      const res = await request(createApp())
        .get(`/api/daily-summary/week?end=${end}`)
        .set("Authorization", "Bearer token");
      expect(res.status).toBe(400);
    }
    expect(storage.getDailySummary).not.toHaveBeenCalled();
  });

  it("is a 500, not a partial week, when a day can't be read", async () => {
    vi.mocked(storage.getDailySummary).mockRejectedValue(new Error("db down"));
    const res = await request(createApp())
      .get("/api/daily-summary/week?end=2026-11-20")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(500);
  });
});
