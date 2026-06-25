import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { register } from "../admin-search-index";
import { rebuildSearchIndex } from "../../services/recipe-search";

vi.mock("../../services/recipe-search", () => ({
  rebuildSearchIndex: vi.fn(),
}));

// Auto-mocked auth middleware sets req.userId to "1" (see admin-api-keys.test).
vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Admin Search Index Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("POST /api/admin/search-index/rebuild", () => {
    it("rebuilds the index for an admin and returns the document total", async () => {
      vi.stubEnv("ADMIN_USER_IDS", "1"); // mock auth sets userId to "1"
      vi.mocked(rebuildSearchIndex).mockResolvedValue({ total: 25 });

      const res = await request(app).post("/api/admin/search-index/rebuild");

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(25);
      expect(rebuildSearchIndex).toHaveBeenCalledOnce();
    });

    it("returns 403 and does not rebuild for a non-admin user", async () => {
      vi.stubEnv("ADMIN_USER_IDS", "999"); // userId "1" is not in the list

      const res = await request(app).post("/api/admin/search-index/rebuild");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("UNAUTHORIZED");
      expect(rebuildSearchIndex).not.toHaveBeenCalled();
    });
  });
});
