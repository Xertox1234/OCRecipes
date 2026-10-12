import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register, PROFILE_HUB_RATE_LIMIT_MAX } from "../profile-hub";

vi.mock("../../storage", () => ({
  storage: {
    getLibraryCounts: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");
// express-rate-limit is deliberately NOT mocked: this suite exercises the real
// limiter (docs/rules/testing.md — call N+1 times, assert the (N+1)th is 429).

describe("profile hub rate limit (QA sweep #61)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getLibraryCounts).mockResolvedValue({} as any);
  });

  it("does not trip on the old 15/min ceiling, then 429s at the new max", async () => {
    const app = express();
    register(app);

    // 16 requests = the old ceiling + 1; ordinary use must not hit it.
    for (let i = 0; i < 16; i++) {
      const res = await request(app).get("/api/profile/library-counts");
      expect(res.status).toBe(200);
    }
    for (let i = 16; i < PROFILE_HUB_RATE_LIMIT_MAX; i++) {
      await request(app).get("/api/profile/library-counts");
    }
    const overflow = await request(app).get("/api/profile/library-counts");
    expect(overflow.status).toBe(429);
    expect(overflow.body.code).toBe("RATE_LIMITED");
  });
});
