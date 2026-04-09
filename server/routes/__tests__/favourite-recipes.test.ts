import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../favourite-recipes";

vi.mock("../../storage", () => ({
  storage: {
    toggleFavouriteRecipe: vi.fn(),
    getUserFavouriteRecipeIds: vi.fn(),
    isRecipeFavourited: vi.fn(),
    getResolvedFavouriteRecipes: vi.fn(),
    getRecipeSharePayload: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
}));

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return { ...actual };
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockResolvedFavourite = {
  recipeId: 10,
  recipeType: "mealPlan" as const,
  title: "Pasta Carbonara",
  description: "Classic Roman pasta",
  imageUrl: null,
  servings: 4,
  difficulty: "Medium",
  favouritedAt: new Date().toISOString(),
};

describe("Favourite Recipe Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/favourite-recipes", () => {
    it("returns resolved favourite recipes", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([
        mockResolvedFavourite,
      ]);

      const res = await request(app).get("/api/favourite-recipes");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe("Pasta Carbonara");
    });

    it("returns empty array when no favourites", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([]);

      const res = await request(app).get("/api/favourite-recipes");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("respects limit query param", async () => {
      vi.mocked(storage.getResolvedFavouriteRecipes).mockResolvedValue([]);

      const res = await request(app).get("/api/favourite-recipes?limit=10");

      expect(res.status).toBe(200);
      expect(storage.getResolvedFavouriteRecipes).toHaveBeenCalledWith("1", 10);
    });
  });

  describe("POST /api/favourite-recipes/toggle", () => {
    it("toggles recipe on (returns favourited: true)", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(true);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "mealPlan" });

      expect(res.status).toBe(200);
      expect(res.body.favourited).toBe(true);
    });

    it("toggles recipe off (returns favourited: false)", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(false);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "community" });

      expect(res.status).toBe(200);
      expect(res.body.favourited).toBe(false);
    });

    it("returns 403 with code LIMIT_REACHED when null", async () => {
      vi.mocked(storage.toggleFavouriteRecipe).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "mealPlan" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("LIMIT_REACHED");
    });

    it("returns 400 for invalid recipeType", async () => {
      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeId: 10, recipeType: "invalid" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing recipeId", async () => {
      const res = await request(app)
        .post("/api/favourite-recipes/toggle")
        .send({ recipeType: "mealPlan" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/favourite-recipes/check", () => {
    it("returns true when recipe is favourited", async () => {
      vi.mocked(storage.isRecipeFavourited).mockResolvedValue(true);

      const res = await request(app).get(
        "/api/favourite-recipes/check?recipeId=10&recipeType=mealPlan",
      );

      expect(res.status).toBe(200);
      expect(res.body.favourited).toBe(true);
    });

    it("returns false when recipe is not favourited", async () => {
      vi.mocked(storage.isRecipeFavourited).mockResolvedValue(false);

      const res = await request(app).get(
        "/api/favourite-recipes/check?recipeId=10&recipeType=community",
      );

      expect(res.status).toBe(200);
      expect(res.body.favourited).toBe(false);
    });

    it("returns 400 for missing query params", async () => {
      const res = await request(app).get("/api/favourite-recipes/check");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/favourite-recipes/ids", () => {
    it("returns all favourite recipe IDs", async () => {
      vi.mocked(storage.getUserFavouriteRecipeIds).mockResolvedValue([
        { recipeId: 10, recipeType: "mealPlan" },
        { recipeId: 20, recipeType: "community" },
      ]);

      const res = await request(app).get("/api/favourite-recipes/ids");

      expect(res.status).toBe(200);
      expect(res.body.ids).toHaveLength(2);
      expect(res.body.ids[0].recipeId).toBe(10);
    });

    it("returns empty array when no favourites", async () => {
      vi.mocked(storage.getUserFavouriteRecipeIds).mockResolvedValue([]);

      const res = await request(app).get("/api/favourite-recipes/ids");

      expect(res.status).toBe(200);
      expect(res.body.ids).toEqual([]);
    });
  });

  describe("GET /api/recipes/:recipeType/:recipeId/share", () => {
    it("returns share payload for community recipe", async () => {
      vi.mocked(storage.getRecipeSharePayload).mockResolvedValue({
        title: "Pasta Carbonara",
        description: "Classic Roman pasta",
        imageUrl: "https://example.com/pasta.jpg",
      });

      const res = await request(app).get("/api/recipes/community/10/share");

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Pasta Carbonara");
      expect(res.body.description).toBe("Classic Roman pasta");
      expect(res.body.imageUrl).toBe("https://example.com/pasta.jpg");
      expect(res.body.deepLink).toBe("ocrecipes://recipe/10?type=community");
    });

    it("returns 404 when recipe not found", async () => {
      vi.mocked(storage.getRecipeSharePayload).mockResolvedValue(null);

      const res = await request(app).get("/api/recipes/community/999/share");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid recipe type", async () => {
      const res = await request(app).get("/api/recipes/invalid/10/share");
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-numeric recipe ID", async () => {
      const res = await request(app).get("/api/recipes/community/abc/share");
      expect(res.status).toBe(400);
    });

    it("passes userId for ownership check", async () => {
      vi.mocked(storage.getRecipeSharePayload).mockResolvedValue({
        title: "My Recipe",
        description: "",
        imageUrl: null,
      });

      await request(app).get("/api/recipes/mealPlan/5/share");

      expect(storage.getRecipeSharePayload).toHaveBeenCalledWith(
        5,
        "mealPlan",
        "1",
      );
    });
  });
});
