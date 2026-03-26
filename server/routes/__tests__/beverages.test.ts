import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../beverages";
import { lookupNutrition } from "../../services/nutrition-lookup";

vi.mock("../../middleware/auth");

vi.mock("../../services/nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
}));

vi.mock("../../db", () => {
  const mockReturning = vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: "1",
      productName: "Coffee (Medium)",
      calories: "5",
      protein: "0",
      carbs: "0",
      fat: "0",
      sourceType: "beverage",
    },
  ]);

  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  return {
    db: {
      transaction: vi.fn().mockImplementation(async (fn) => {
        return fn({
          insert: mockInsert,
        });
      }),
    },
  };
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("Beverages Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/beverages/log", () => {
    it("logs water with zero calories (no lookup)", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "water",
        size: "medium",
      });

      expect(res.status).toBe(201);
      expect(lookupNutrition).not.toHaveBeenCalled();
    });

    it("logs a standard beverage with nutrition lookup", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue({
        name: "coffee",
        calories: 5,
        protein: 0.3,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        sodium: 5,
        servingSize: "12 fl oz",
        source: "usda",
      });

      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "coffee",
        size: "medium",
      });

      expect(res.status).toBe(201);
      expect(lookupNutrition).toHaveBeenCalledWith("12oz coffee");
    });

    it("includes modifiers in nutrition query for coffee", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue({
        name: "coffee with cream",
        calories: 50,
        protein: 1,
        carbs: 1,
        fat: 3,
        fiber: 0,
        sugar: 1,
        sodium: 10,
        servingSize: "16 fl oz",
        source: "usda",
      });

      const res = await request(app)
        .post("/api/beverages/log")
        .send({
          beverageType: "coffee",
          size: "large",
          modifiers: ["cream", "sugar"],
        });

      expect(res.status).toBe(201);
      expect(lookupNutrition).toHaveBeenCalledWith(
        "16oz coffee with cream and sugar",
      );
    });

    it("logs custom beverage with name lookup", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue({
        name: "matcha latte",
        calories: 120,
        protein: 4,
        carbs: 15,
        fat: 4,
        fiber: 0,
        sugar: 12,
        sodium: 80,
        servingSize: "12 fl oz",
        source: "usda",
      });

      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "custom",
        size: "medium",
        customName: "matcha latte",
      });

      expect(res.status).toBe(201);
      expect(lookupNutrition).toHaveBeenCalledWith("12oz matcha latte");
    });

    it("logs custom beverage with raw calorie value (no lookup)", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "custom",
        size: "small",
        customCalories: 150,
      });

      expect(res.status).toBe(201);
      expect(lookupNutrition).not.toHaveBeenCalled();
    });

    it("returns 422 when nutrition lookup fails", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue(null);

      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "soda",
        size: "large",
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain("Could not find nutrition data");
      expect(res.body.code).toBe("NUTRITION_LOOKUP_FAILED");
    });

    it("returns 400 for custom beverage with no name or calories", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "custom",
        size: "medium",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Custom beverages require");
    });

    it("returns 400 for invalid beverage type", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "invalid",
        size: "medium",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid size", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "coffee",
        size: "extra-large",
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app).post("/api/beverages/log").send({});

      expect(res.status).toBe(400);
    });

    it("passes mealType through to daily log", async () => {
      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "water",
        size: "large",
        mealType: "lunch",
      });

      expect(res.status).toBe(201);
    });

    it("uses correct sizes for each option", async () => {
      vi.mocked(lookupNutrition).mockResolvedValue({
        name: "tea",
        calories: 2,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        servingSize: "8 fl oz",
        source: "usda",
      });

      await request(app).post("/api/beverages/log").send({
        beverageType: "tea",
        size: "small",
      });
      expect(lookupNutrition).toHaveBeenCalledWith("8oz tea");

      vi.clearAllMocks();
      await request(app).post("/api/beverages/log").send({
        beverageType: "tea",
        size: "medium",
      });
      expect(lookupNutrition).toHaveBeenCalledWith("12oz tea");

      vi.clearAllMocks();
      await request(app).post("/api/beverages/log").send({
        beverageType: "tea",
        size: "large",
      });
      expect(lookupNutrition).toHaveBeenCalledWith("16oz tea");
    });
  });
});
