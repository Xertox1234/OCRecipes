import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../cookbooks";

vi.mock("../../storage", () => ({
  storage: {
    getUserCookbooks: vi.fn(),
    createCookbook: vi.fn(),
    getCookbook: vi.fn(),
    updateCookbook: vi.fn(),
    deleteCookbook: vi.fn(),
    addRecipeToCookbook: vi.fn(),
    removeRecipeFromCookbook: vi.fn(),
    getCookbookRecipes: vi.fn(),
    getResolvedCookbookRecipes: vi.fn(),
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

const mockCookbook = {
  id: 1,
  userId: "user-1",
  name: "Italian Favorites",
  description: "My best Italian recipes",
  coverImageUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockResolvedRecipe = {
  recipeId: 10,
  recipeType: "mealPlan" as const,
  title: "Pasta Carbonara",
  description: "Classic Roman pasta",
  imageUrl: null,
  servings: 4,
  difficulty: "Medium",
  addedAt: new Date().toISOString(),
};

describe("Cookbook Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("GET /api/cookbooks", () => {
    it("returns user cookbooks with recipe count", async () => {
      vi.mocked(storage.getUserCookbooks).mockResolvedValue([
        { ...mockCookbook, recipeCount: 3 },
      ]);

      const res = await request(app).get("/api/cookbooks");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe("Italian Favorites");
      expect(res.body[0].recipeCount).toBe(3);
    });

    it("returns empty array for user with no cookbooks", async () => {
      vi.mocked(storage.getUserCookbooks).mockResolvedValue([]);

      const res = await request(app).get("/api/cookbooks");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/cookbooks", () => {
    it("creates a cookbook with valid data", async () => {
      vi.mocked(storage.createCookbook).mockResolvedValue(mockCookbook);

      const res = await request(app).post("/api/cookbooks").send({
        name: "Italian Favorites",
        description: "My best Italian recipes",
      });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("Italian Favorites");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/cookbooks")
        .send({ description: "No name" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when name is empty string", async () => {
      const res = await request(app).post("/api/cookbooks").send({ name: "" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/cookbooks/:id", () => {
    it("returns cookbook with resolved recipes", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.getResolvedCookbookRecipes).mockResolvedValue([
        mockResolvedRecipe,
      ]);

      const res = await request(app).get("/api/cookbooks/1");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Italian Favorites");
      expect(res.body.recipes).toHaveLength(1);
      expect(res.body.recipes[0].title).toBe("Pasta Carbonara");
      expect(res.body.recipes[0].recipeType).toBe("mealPlan");
    });

    it("returns 404 for non-existent cookbook", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(undefined);

      const res = await request(app).get("/api/cookbooks/999");

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid id", async () => {
      const res = await request(app).get("/api/cookbooks/abc");

      expect(res.status).toBe(400);
    });

    it("returns cookbook with empty recipes array", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.getResolvedCookbookRecipes).mockResolvedValue([]);

      const res = await request(app).get("/api/cookbooks/1");

      expect(res.status).toBe(200);
      expect(res.body.recipes).toEqual([]);
    });
  });

  describe("PATCH /api/cookbooks/:id", () => {
    it("updates cookbook name", async () => {
      const updated = { ...mockCookbook, name: "Updated Name" };
      vi.mocked(storage.updateCookbook).mockResolvedValue(updated);

      const res = await request(app)
        .patch("/api/cookbooks/1")
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Updated Name");
    });

    it("returns 404 when cookbook not found", async () => {
      vi.mocked(storage.updateCookbook).mockResolvedValue(undefined);

      const res = await request(app)
        .patch("/api/cookbooks/999")
        .send({ name: "New Name" });

      expect(res.status).toBe(404);
    });

    it("returns 400 when no fields provided", async () => {
      const res = await request(app).patch("/api/cookbooks/1").send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/cookbooks/:id", () => {
    it("deletes cookbook successfully", async () => {
      vi.mocked(storage.deleteCookbook).mockResolvedValue(true);

      const res = await request(app).delete("/api/cookbooks/1");

      expect(res.status).toBe(204);
    });

    it("returns 404 when cookbook not found", async () => {
      vi.mocked(storage.deleteCookbook).mockResolvedValue(false);

      const res = await request(app).delete("/api/cookbooks/999");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/cookbooks/:id/recipes", () => {
    it("adds recipe to cookbook", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.addRecipeToCookbook).mockResolvedValue({
        id: 1,
        cookbookId: 1,
        recipeId: 10,
        recipeType: "mealPlan",
        addedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/cookbooks/1/recipes")
        .send({ recipeId: 10, recipeType: "mealPlan" });

      expect(res.status).toBe(201);
    });

    it("returns 409 when recipe already in cookbook", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.addRecipeToCookbook).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/cookbooks/1/recipes")
        .send({ recipeId: 10, recipeType: "mealPlan" });

      expect(res.status).toBe(409);
    });

    it("returns 404 when cookbook not found", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/cookbooks/999/recipes")
        .send({ recipeId: 10 });

      expect(res.status).toBe(404);
    });

    it("returns 400 when recipeId is missing", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);

      const res = await request(app)
        .post("/api/cookbooks/1/recipes")
        .send({ recipeType: "mealPlan" });

      expect(res.status).toBe(400);
    });

    it("defaults recipeType to mealPlan", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.addRecipeToCookbook).mockResolvedValue({
        id: 1,
        cookbookId: 1,
        recipeId: 10,
        recipeType: "mealPlan",
        addedAt: new Date(),
      });

      const res = await request(app)
        .post("/api/cookbooks/1/recipes")
        .send({ recipeId: 10 });

      expect(res.status).toBe(201);
      expect(storage.addRecipeToCookbook).toHaveBeenCalledWith(
        1,
        10,
        "mealPlan",
      );
    });
  });

  describe("DELETE /api/cookbooks/:id/recipes/:recipeId", () => {
    it("removes recipe from cookbook", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.removeRecipeFromCookbook).mockResolvedValue(true);

      const res = await request(app).delete(
        "/api/cookbooks/1/recipes/10?recipeType=mealPlan",
      );

      expect(res.status).toBe(204);
    });

    it("returns 404 when recipe not in cookbook", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.removeRecipeFromCookbook).mockResolvedValue(false);

      const res = await request(app).delete(
        "/api/cookbooks/1/recipes/10?recipeType=mealPlan",
      );

      expect(res.status).toBe(404);
    });

    it("defaults recipeType to mealPlan", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.removeRecipeFromCookbook).mockResolvedValue(true);

      const res = await request(app).delete("/api/cookbooks/1/recipes/10");

      expect(res.status).toBe(204);
      expect(storage.removeRecipeFromCookbook).toHaveBeenCalledWith(
        1,
        10,
        "mealPlan",
      );
    });

    it("supports community recipeType", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.removeRecipeFromCookbook).mockResolvedValue(true);

      const res = await request(app).delete(
        "/api/cookbooks/1/recipes/10?recipeType=community",
      );

      expect(res.status).toBe(204);
      expect(storage.removeRecipeFromCookbook).toHaveBeenCalledWith(
        1,
        10,
        "community",
      );
    });
  });

  describe("Error paths", () => {
    it("GET /api/cookbooks returns 500 on storage error", async () => {
      vi.mocked(storage.getUserCookbooks).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).get("/api/cookbooks");

      expect(res.status).toBe(500);
    });

    it("POST /api/cookbooks returns 500 on storage error", async () => {
      vi.mocked(storage.createCookbook).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/cookbooks")
        .send({ name: "Test" });

      expect(res.status).toBe(500);
    });

    it("GET /api/cookbooks/:id returns 500 on storage error", async () => {
      vi.mocked(storage.getCookbook).mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/api/cookbooks/1");

      expect(res.status).toBe(500);
    });

    it("PATCH /api/cookbooks/:id returns 500 on storage error", async () => {
      vi.mocked(storage.updateCookbook).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .patch("/api/cookbooks/1")
        .send({ name: "New" });

      expect(res.status).toBe(500);
    });

    it("DELETE /api/cookbooks/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteCookbook).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).delete("/api/cookbooks/1");

      expect(res.status).toBe(500);
    });

    it("POST /api/cookbooks/:id/recipes returns 500 on storage error", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.addRecipeToCookbook).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/cookbooks/1/recipes")
        .send({ recipeId: 10 });

      expect(res.status).toBe(500);
    });

    it("DELETE /api/cookbooks/:id/recipes/:recipeId returns 500 on storage error", async () => {
      vi.mocked(storage.getCookbook).mockResolvedValue(mockCookbook);
      vi.mocked(storage.removeRecipeFromCookbook).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).delete(
        "/api/cookbooks/1/recipes/10?recipeType=mealPlan",
      );

      expect(res.status).toBe(500);
    });
  });
});
