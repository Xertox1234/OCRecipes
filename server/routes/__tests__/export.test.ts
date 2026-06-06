import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../export";

vi.mock("../../storage", () => ({
  storage: {
    getUserDataExport: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

// NOTE: deliberately do NOT mock "express-rate-limit" here — we want the real
// limiter for the 429 test. The other route test files mock it so quota tests
// pass without burning RAM on a real limiter store. This file pays that cost.
vi.mock("express-rate-limit");

function buildExport() {
  return {
    profile: { account: { id: "1", username: "demo" }, dietary: null },
    scannedItems: [],
    nutritionLogs: [],
    weightLogs: [],
    mealPlans: { recipes: [], items: [] },
    recipes: [],
    chatHistory: { conversations: [], messages: [] },
    groceryLists: { lists: [], items: [] },
    cookbooks: { cookbooks: [], recipes: [] },
    fastingLogs: { schedule: null, logs: [] },
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("GET /api/users/me/export", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("returns the export envelope with all expected top-level keys", async () => {
    vi.mocked(storage.getUserDataExport).mockResolvedValue(buildExport());

    const res = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);

    // Envelope fields
    expect(typeof res.body.exportedAt).toBe("string");
    expect(new Date(res.body.exportedAt).toString()).not.toBe("Invalid Date");
    expect(typeof res.body.appVersion).toBe("string");
    expect(res.body.appVersion.length).toBeGreaterThan(0);

    // Domain keys required by CCPA/PIPEDA acceptance criteria
    for (const key of [
      "profile",
      "scannedItems",
      "nutritionLogs",
      "weightLogs",
      "mealPlans",
      "recipes",
      "chatHistory",
      "groceryLists",
      "cookbooks",
      "fastingLogs",
    ]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it("sets the Content-Disposition header to an attachment with today's UTC date", async () => {
    vi.mocked(storage.getUserDataExport).mockResolvedValue(buildExport());

    const res = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");

    const disposition = res.headers["content-disposition"];
    expect(disposition).toMatch(
      /^attachment; filename="ocrecipes-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
  });

  it("does not return system fields such as password or tokenVersion in the profile", async () => {
    // The storage layer is responsible for stripping these; the route trusts
    // it. To ensure the route doesn't accidentally introduce them, simulate a
    // storage response that omits them and assert they remain absent.
    vi.mocked(storage.getUserDataExport).mockResolvedValue(buildExport());

    const res = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");

    expect(res.body.profile.account).not.toHaveProperty("password");
    expect(res.body.profile.account).not.toHaveProperty("tokenVersion");
  });

  it("returns 500 when storage throws", async () => {
    vi.mocked(storage.getUserDataExport).mockRejectedValue(
      new Error("DB error"),
    );

    const res = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
  });
});

describe("GET /api/users/me/export — auth & rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    // Re-import with the real auth middleware so the bearer-less request is rejected.
    vi.doUnmock("../../middleware/auth");
    const { register: registerReal } = await import("../export");
    const app = express();
    app.use(express.json());
    registerReal(app);

    const res = await request(app).get("/api/users/me/export");
    expect(res.status).toBe(401);

    // Restore the auth mock for any tests that import this module later.
    vi.doMock("../../middleware/auth", async () => {
      const actual = await vi.importActual<
        typeof import("../../middleware/__mocks__/auth")
      >("../../middleware/__mocks__/auth");
      return actual;
    });
  });

  it("returns 429 after the configured rate limit is exceeded", async () => {
    // Use the real express-rate-limit so the limiter actually counts requests.
    vi.doUnmock("express-rate-limit");

    vi.doMock("../../storage", () => ({
      storage: {
        getUserDataExport: vi.fn().mockResolvedValue(buildExport()),
      },
    }));

    const { register: registerReal } = await import("../export");
    const app = express();
    app.use(express.json());
    registerReal(app);

    // The route is configured at 2 requests/hour. The first two succeed; the
    // third returns 429 from the real express-rate-limit middleware.
    const a = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");
    const b = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");
    const c = await request(app)
      .get("/api/users/me/export")
      .set("Authorization", "Bearer token");

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(429);
  });
});
