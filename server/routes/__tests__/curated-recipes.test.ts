import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { register } from "../curated-recipes";
import { createMockCommunityRecipe } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getCuratedRecipes: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("GET /api/curated-recipes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("returns empty recipes array when none exist", async () => {
    vi.mocked(storage.getCuratedRecipes).mockResolvedValue([]);
    const res = await request(app).get("/api/curated-recipes");
    expect(res.status).toBe(200);
    expect(res.body.recipes).toEqual([]);
  });

  it("returns curated recipes", async () => {
    const mockRecipe = createMockCommunityRecipe({ id: 1, isCanonical: true });
    vi.mocked(storage.getCuratedRecipes).mockResolvedValue([mockRecipe]);
    const res = await request(app).get("/api/curated-recipes");
    expect(res.status).toBe(200);
    expect(res.body.recipes).toHaveLength(1);
    expect(res.body.recipes[0].id).toBe(1);
  });

  it("passes limit and offset from query params", async () => {
    vi.mocked(storage.getCuratedRecipes).mockResolvedValue([]);
    await request(app).get("/api/curated-recipes?limit=10&offset=5");
    expect(storage.getCuratedRecipes).toHaveBeenCalledWith({
      limit: 10,
      offset: 5,
    });
  });

  it("uses default limit=20 offset=0 when not provided", async () => {
    vi.mocked(storage.getCuratedRecipes).mockResolvedValue([]);
    await request(app).get("/api/curated-recipes");
    expect(storage.getCuratedRecipes).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
    });
  });
});
