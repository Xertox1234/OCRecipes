import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../recipe-community";

vi.mock("../../storage", () => ({
  storage: {
    isPublicCommunityRecipe: vi.fn(),
    setRecipeTried: vi.fn(),
    getRecipeCommunityStats: vi.fn(),
    getRecipeVariants: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const stats = {
  triedCount: 3,
  triedByMe: true,
  favouritedCount: 2,
  variantCount: 1,
};

describe("recipe community routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    vi.mocked(storage.isPublicCommunityRecipe).mockResolvedValue(true);
    vi.mocked(storage.getRecipeCommunityStats).mockResolvedValue(stats);
  });

  describe.each([
    ["put", "/api/recipes/abc/tried"],
    ["delete", "/api/recipes/0/tried"],
    ["get", "/api/recipes/-1/stats"],
    ["get", "/api/recipes/abc/variants"],
  ] as const)("%s %s", (method, path) => {
    it("returns 400 for an invalid id", async () => {
      const res = await request(app)[method](path);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(storage.isPublicCommunityRecipe).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["put", "/api/recipes/7/tried"],
    ["delete", "/api/recipes/7/tried"],
    ["get", "/api/recipes/7/stats"],
    ["get", "/api/recipes/7/variants"],
  ] as const)("%s %s on a non-public recipe", (method, path) => {
    it("returns 404 and touches nothing else", async () => {
      vi.mocked(storage.isPublicCommunityRecipe).mockResolvedValue(false);
      const res = await request(app)[method](path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(storage.isPublicCommunityRecipe).toHaveBeenCalledWith(7);
      expect(storage.setRecipeTried).not.toHaveBeenCalled();
      expect(storage.getRecipeCommunityStats).not.toHaveBeenCalled();
      expect(storage.getRecipeVariants).not.toHaveBeenCalled();
    });
  });

  it("PUT /tried marks as tried for the caller and returns the count", async () => {
    const res = await request(app).put("/api/recipes/7/tried");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tried: true, triedCount: 3 });
    expect(storage.setRecipeTried).toHaveBeenCalledWith("1", 7, true);
  });

  it("DELETE /tried unmarks for the caller and returns the count", async () => {
    vi.mocked(storage.getRecipeCommunityStats).mockResolvedValue({
      ...stats,
      triedCount: 2,
      triedByMe: false,
    });
    const res = await request(app).delete("/api/recipes/7/tried");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tried: false, triedCount: 2 });
    expect(storage.setRecipeTried).toHaveBeenCalledWith("1", 7, false);
  });

  it("GET /stats returns the stats object for the caller", async () => {
    const res = await request(app).get("/api/recipes/7/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
    expect(storage.getRecipeCommunityStats).toHaveBeenCalledWith(7, "1");
  });

  it("GET /variants wraps the list", async () => {
    vi.mocked(storage.getRecipeVariants).mockResolvedValue([
      {
        id: 9,
        title: "Spicier",
        imageUrl: null,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const res = await request(app).get("/api/recipes/7/variants");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      variants: [
        {
          id: 9,
          title: "Spicier",
          imageUrl: null,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    expect(storage.getRecipeVariants).toHaveBeenCalledWith(7);
  });

  it("returns 500 when storage throws", async () => {
    vi.mocked(storage.getRecipeCommunityStats).mockRejectedValue(
      new Error("db down"),
    );
    const res = await request(app).get("/api/recipes/7/stats");
    expect(res.status).toBe(500);
  });
});
