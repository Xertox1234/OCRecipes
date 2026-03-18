import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateGroceryItems } from "../../services/grocery-generation";
import { register } from "../grocery";

vi.mock("../../storage", () => ({
  storage: {
    getSubscriptionStatus: vi.fn(),
    getUser: vi.fn(),
    getUserProfile: vi.fn().mockResolvedValue(null),
    getGroceryLists: vi.fn(),
    getMealPlanIngredientsForDateRange: vi.fn(),
    createGroceryList: vi.fn(),
    addGroceryListItem: vi.fn(),
    addGroceryListItems: vi.fn(),
    getGroceryListWithItems: vi.fn(),
    updateGroceryListItemChecked: vi.fn(),
    updateGroceryListItemPantryFlag: vi.fn(),
    deleteGroceryList: vi.fn(),
    getPantryItems: vi.fn(),
    createPantryItem: vi.fn(),
  },
}));

vi.mock("../../services/grocery-generation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/grocery-generation")>();
  return {
    generateGroceryItems: vi.fn(),
    flagAllergenicGroceryItems: actual.flagAllergenicGroceryItems,
  };
});

vi.mock("../../services/pantry-deduction", () => ({
  deductPantryFromGrocery: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockList = {
  id: 1,
  userId: "1",
  title: "Weekly Groceries",
  dateRangeStart: "2025-01-01",
  dateRangeEnd: "2025-01-07",
};

describe("Grocery Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/meal-plan/grocery-lists", () => {
    it("creates a grocery list from date range", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        subscriptionTier: "premium",
      } as never);
      vi.mocked(storage.getGroceryLists).mockResolvedValue([] as never);
      vi.mocked(storage.getMealPlanIngredientsForDateRange).mockResolvedValue(
        [] as never,
      );
      vi.mocked(generateGroceryItems).mockReturnValue([
        { name: "Milk", quantity: 1, unit: "gallon", category: "dairy" },
      ] as never);
      vi.mocked(storage.createGroceryList).mockResolvedValue(mockList as never);
      vi.mocked(storage.addGroceryListItems).mockResolvedValue([
        { id: 1, name: "Milk" },
      ] as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-01-01", endDate: "2025-01-07" });

      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(1);
    });

    it("returns 400 for invalid dates", async () => {
      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "invalid", endDate: "2025-01-07" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when start after end", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        subscriptionTier: "free",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-01-10", endDate: "2025-01-01" });

      expect(res.status).toBe(400);
    });

    it("enforces list limit", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        subscriptionTier: "free",
      } as never);
      vi.mocked(storage.getGroceryLists).mockResolvedValue(
        Array(50).fill(mockList) as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-01-01", endDate: "2025-01-07" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/meal-plan/grocery-lists", () => {
    it("returns user grocery lists", async () => {
      vi.mocked(storage.getGroceryLists).mockResolvedValue([mockList] as never);

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("GET /api/meal-plan/grocery-lists/:id", () => {
    it("returns list with items", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
    });

    it("enriches response with allergenFlags when user has allergies", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [{ id: 1, name: "whole milk" }],
      } as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue({
        allergies: [{ name: "milk", severity: "severe" }],
      } as never);

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.allergenFlags).toBeDefined();
      expect(res.body.allergenFlags["whole milk"]).toBeDefined();
      expect(res.body.allergenFlags["whole milk"].allergenId).toBe("milk");
      expect(res.body.allergenFlags["whole milk"].severity).toBe("severe");
    });

    it("returns empty allergenFlags when user has no allergies", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [{ id: 1, name: "chicken breast" }],
      } as never);
      vi.mocked(storage.getUserProfile).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(200);
      expect(res.body.allergenFlags).toEqual({});
    });

    it("returns 404 for unknown list", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/meal-plan/grocery-lists/:id/items/:itemId", () => {
    it("toggles item checked status", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.updateGroceryListItemChecked).mockResolvedValue({
        id: 1,
        isChecked: true,
      } as never);

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true });

      expect(res.status).toBe(200);
    });

    it("returns 404 when list not found", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/999/items/1")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true });

      expect(res.status).toBe(404);
    });

    it("returns 400 when no update fields", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });

    it("handles addedToPantry-only flag", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.updateGroceryListItemPantryFlag).mockResolvedValue({
        id: 1,
        addedToPantry: true,
      } as never);

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({ addedToPantry: true });

      expect(res.status).toBe(200);
    });

    it("returns 404 when item not found on addedToPantry-only update", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.updateGroceryListItemPantryFlag).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({ addedToPantry: true });

      expect(res.status).toBe(404);
    });

    it("handles isChecked + addedToPantry combo", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.updateGroceryListItemChecked).mockResolvedValue({
        id: 1,
        isChecked: true,
      } as never);
      vi.mocked(storage.updateGroceryListItemPantryFlag).mockResolvedValue({
        id: 1,
        isChecked: true,
        addedToPantry: true,
      } as never);

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true, addedToPantry: true });

      expect(res.status).toBe(200);
      expect(res.body.addedToPantry).toBe(true);
    });
  });

  describe("POST /api/meal-plan/grocery-lists/:id/items", () => {
    it("adds manual item to list", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.addGroceryListItem).mockResolvedValue({
        id: 2,
        name: "Bread",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items")
        .set("Authorization", "Bearer token")
        .send({ name: "Bread" });

      expect(res.status).toBe(201);
    });

    it("returns 404 for unknown list", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/999/items")
        .set("Authorization", "Bearer token")
        .send({ name: "Bread" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for missing name", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items")
        .set("Authorization", "Bearer token")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/meal-plan/grocery-lists/:id", () => {
    it("deletes a grocery list", async () => {
      vi.mocked(storage.deleteGroceryList).mockResolvedValue(true as never);

      const res = await request(app)
        .delete("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(204);
    });

    it("returns 404 for unknown list", async () => {
      vi.mocked(storage.deleteGroceryList).mockResolvedValue(false as never);

      const res = await request(app)
        .delete("/api/meal-plan/grocery-lists/999")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });
  });

  describe("Error paths", () => {
    it("POST /api/meal-plan/grocery-lists returns 500 on storage error", async () => {
      vi.mocked(storage.getUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-01-01", endDate: "2025-01-07" });

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan/grocery-lists returns 500 on storage error", async () => {
      vi.mocked(storage.getGroceryLists).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("GET /api/meal-plan/grocery-lists/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("GET /api/meal-plan/grocery-lists/:id returns 500 on storage error", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .get("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("PUT /api/meal-plan/grocery-lists/:id/items/:itemId returns 400 for invalid IDs", async () => {
      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/abc/items/1")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true });

      expect(res.status).toBe(400);
    });

    it("PUT /api/meal-plan/grocery-lists/:id/items/:itemId returns 500 on storage error", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/1")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true });

      expect(res.status).toBe(500);
    });

    it("PUT toggle returns 404 when item not found on isChecked update", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.updateGroceryListItemChecked).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .put("/api/meal-plan/grocery-lists/1/items/999")
        .set("Authorization", "Bearer token")
        .send({ isChecked: true });

      expect(res.status).toBe(404);
    });

    it("POST /api/meal-plan/grocery-lists/:id/items returns 400 for invalid list ID", async () => {
      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/abc/items")
        .set("Authorization", "Bearer token")
        .send({ name: "Bread" });

      expect(res.status).toBe(400);
    });

    it("POST /api/meal-plan/grocery-lists/:id/items returns 500 on storage error", async () => {
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [],
      } as never);
      vi.mocked(storage.addGroceryListItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items")
        .set("Authorization", "Bearer token")
        .send({ name: "Bread" });

      expect(res.status).toBe(500);
    });

    it("DELETE /api/meal-plan/grocery-lists/:id returns 400 for invalid ID", async () => {
      const res = await request(app)
        .delete("/api/meal-plan/grocery-lists/abc")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("DELETE /api/meal-plan/grocery-lists/:id returns 500 on storage error", async () => {
      vi.mocked(storage.deleteGroceryList).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .delete("/api/meal-plan/grocery-lists/1")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });

    it("POST /api/meal-plan/grocery-lists enforces date range limit for free tier", async () => {
      vi.mocked(storage.getUser).mockResolvedValue({
        subscriptionTier: "free",
      } as never);
      vi.mocked(storage.getGroceryLists).mockResolvedValue([] as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-01-01", endDate: "2025-01-15" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DATE_RANGE_LIMIT");
    });

    it("POST /api/meal-plan/grocery-lists returns 400 for invalid calendar date", async () => {
      const res = await request(app)
        .post("/api/meal-plan/grocery-lists")
        .set("Authorization", "Bearer token")
        .send({ startDate: "2025-02-30", endDate: "2025-03-01" });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry", () => {
    it("returns 403 for free tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items/1/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PREMIUM_REQUIRED");
    });

    it("adds grocery item to pantry", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [
          {
            id: 1,
            name: "Milk",
            quantity: "1",
            unit: "gallon",
            category: "dairy",
          },
        ],
      } as never);
      vi.mocked(storage.createPantryItem).mockResolvedValue({
        id: 1,
        name: "Milk",
      } as never);
      vi.mocked(storage.updateGroceryListItemPantryFlag).mockResolvedValue(
        {} as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items/1/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(201);
    });

    it("returns 400 for invalid IDs", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/abc/items/1/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(400);
    });

    it("returns 404 when list not found", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue(
        null as never,
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/999/items/1/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 404 when grocery item not found in list", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [{ id: 1, name: "Milk" }],
      } as never);

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items/999/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(404);
    });

    it("returns 500 on storage error", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
      } as never);
      vi.mocked(storage.getGroceryListWithItems).mockResolvedValue({
        ...mockList,
        items: [{ id: 1, name: "Milk" }],
      } as never);
      vi.mocked(storage.createPantryItem).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/meal-plan/grocery-lists/1/items/1/add-to-pantry")
        .set("Authorization", "Bearer token");

      expect(res.status).toBe(500);
    });
  });
});
