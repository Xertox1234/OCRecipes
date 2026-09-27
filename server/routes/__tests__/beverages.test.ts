import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../beverages";
import {
  lookupNutrition,
  type NutritionData,
} from "../../services/nutrition-lookup";

vi.mock("../../middleware/auth");
// Pass-through rate limiter: the suite sends more requests than crudRateLimit
// allows per minute, and its counter is shared by every test in the file.
vi.mock("express-rate-limit");

vi.mock("../../services/nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    createScannedItemWithLog: vi.fn().mockResolvedValue({
      id: 1,
      userId: "1",
      productName: "Coffee (Medium)",
      calories: "5",
      protein: "0",
      carbs: "0",
      fat: "0",
      sourceType: "beverage",
    }),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

/** A CNF/USDA-shaped result: values per 100 g. */
function per100g(
  name: string,
  values: Partial<NutritionData> = {},
): NutritionData {
  return {
    name,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    sodium: 0,
    servingSize: "100g",
    source: "cnf",
    ...values,
  };
}

/** Answer each lookup query from a table; unknown queries find nothing. */
function mockLookups(table: Record<string, NutritionData>) {
  vi.mocked(lookupNutrition).mockImplementation(
    async (query: string) => table[query] ?? null,
  );
}

function savedItem() {
  return vi.mocked(storage.createScannedItemWithLog).mock.calls[0][0];
}

function lookupQueries() {
  return vi.mocked(lookupNutrition).mock.calls.map(([query]) => query);
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

    it("scales a per-100 g result to the whole drink", async () => {
      mockLookups({
        cola: per100g("Carbonated drinks, cola", {
          calories: 41,
          carbs: 10.6,
          sugar: 10.8,
          sodium: 4,
        }),
      });

      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "soda",
        size: "medium",
      });

      expect(res.status).toBe(201);
      expect(savedItem()).toEqual(
        expect.objectContaining({
          userId: "1",
          sourceType: "beverage",
          productName: "Soda (Medium)",
          servingSize: "355 ml",
          calories: "146", // 41 × 3.55
          carbs: "37.6",
          sugar: "38.3",
          sodium: "14.2",
        }),
      );
      expect(storage.createScannedItemWithLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ source: "beverage" }),
      );
    });

    it("looks up the drink by a specific name, with no size in the query", async () => {
      mockLookups({
        "coffee, brewed": per100g("Coffee, brewed", { calories: 1 }),
        "tea, brewed": per100g("Tea, brewed", { calories: 1 }),
        "milk, 2%": per100g("Milk, fluid, partly skimmed, 2% M.F."),
        cola: per100g("Carbonated drinks, cola"),
      });

      for (const beverageType of ["coffee", "tea", "milk", "soda"]) {
        await request(app)
          .post("/api/beverages/log")
          .send({ beverageType, size: "large" })
          .expect(201);
      }

      expect(lookupQueries()).toEqual([
        "coffee, brewed",
        "tea, brewed",
        "milk, 2%",
        "cola",
      ]);
    });

    it("scales fiber, sugar and sodium, not just the macros", async () => {
      mockLookups({
        "green smoothie": per100g("Smoothie, green", {
          calories: 50,
          fiber: 2,
          sugar: 6,
          sodium: 20,
        }),
      });

      await request(app)
        .post("/api/beverages/log")
        .send({
          beverageType: "custom",
          size: "small",
          customName: "green smoothie",
        })
        .expect(201);

      expect(savedItem()).toEqual(
        expect.objectContaining({
          calories: "120", // 50 × 2.4
          fiber: "4.8",
          sugar: "14.4",
          sodium: "48",
        }),
      );
    });

    it("never scales a per-serving result twice", async () => {
      // API Ninjas answers per serving: 100 kcal in 240 g.
      mockLookups({
        "milk, 2%": per100g("milk", {
          calories: 100,
          servingSize: "240g",
          source: "api-ninjas",
        }),
      });

      await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "milk", size: "small" })
        .expect(201);
      expect(savedItem().calories).toBe("100");

      vi.clearAllMocks();
      await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "milk", size: "medium" })
        .expect(201);
      expect(savedItem().calories).toBe("148"); // 100 × 355 / 240
    });

    it("returns 422 for a result it can't scale to the drink's size", async () => {
      // "1 serving", a missing basis, or a zero-gram basis (a gated API Ninjas
      // field): nothing says what amount the values describe, so neither
      // scaling them nor labelling them with the chosen size would be honest.
      for (const servingSize of ["1 serving", "", "0g"]) {
        vi.clearAllMocks();
        mockLookups({
          "coffee, brewed": per100g("coffee", { calories: 2, servingSize }),
          "cream, table": per100g("Cream, table", { calories: 185 }),
        });

        for (const modifiers of [[], ["cream"]]) {
          const res = await request(app)
            .post("/api/beverages/log")
            .send({ beverageType: "coffee", size: "large", modifiers });
          expect(res.status, `${servingSize} ${modifiers}`).toBe(422);
        }
        expect(storage.createScannedItemWithLog).not.toHaveBeenCalled();
      }
    });

    it("returns 422 when a modifier's result can't be scaled", async () => {
      mockLookups({
        "coffee, brewed": per100g("Coffee, brewed", { calories: 1 }),
        "cream, table": per100g("cream", {
          calories: 50,
          servingSize: "1 serving",
        }),
      });

      const res = await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "coffee", size: "large", modifiers: ["cream"] });

      expect(res.status).toBe(422);
      expect(storage.createScannedItemWithLog).not.toHaveBeenCalled();
    });

    it("saves a non-numeric nutrient as 0", async () => {
      mockLookups({
        cola: per100g("cola", {
          calories: 41,
          fiber: "n/a" as unknown as number,
        }),
      });

      await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "soda", size: "medium" })
        .expect(201);

      expect(savedItem()).toEqual(
        expect.objectContaining({ calories: "146", fiber: "0" }),
      );
    });

    it("adds each modifier as a fixed amount on top of the drink", async () => {
      mockLookups({
        "coffee, brewed": per100g("Coffee, brewed", { calories: 1, sodium: 2 }),
        "cream, table": per100g("Cream, table (coffee), 18% M.F.", {
          calories: 185,
          carbs: 3.8,
          fat: 18,
          sodium: 40,
        }),
        "sugar, granulated": per100g("Sweets, sugars, granulated", {
          calories: 387,
          carbs: 100,
          sugar: 99.8,
        }),
      });

      const res = await request(app)
        .post("/api/beverages/log")
        .send({
          beverageType: "coffee",
          size: "large",
          modifiers: ["cream", "sugar"],
        });

      expect(res.status).toBe(201);
      expect(lookupQueries()).toEqual([
        "coffee, brewed",
        "cream, table",
        "sugar, granulated",
      ]);
      // 475 g coffee + 15 g cream (1 tbsp) + 4 g sugar (1 tsp)
      expect(savedItem()).toEqual(
        expect.objectContaining({
          productName: "Coffee with cream & sugar (Large)",
          servingSize: "475 ml",
          calories: "48", // 5 + 28 + 15
          fat: "2.7",
          carbs: "4.6", // 0.6 + 4
          sugar: "4",
          sodium: "15.5", // 9.5 + 6
        }),
      );
    });

    it("makes one lookup for a drink without modifiers", async () => {
      mockLookups({
        "coffee, brewed": per100g("Coffee, brewed", { calories: 1 }),
      });

      await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "coffee", size: "large" })
        .expect(201);

      expect(lookupQueries()).toEqual(["coffee, brewed"]);
      expect(savedItem().calories).toBe("5");
    });

    it("returns 422 when a modifier lookup fails", async () => {
      mockLookups({
        "tea, brewed": per100g("Tea, brewed", { calories: 1 }),
      });

      const res = await request(app)
        .post("/api/beverages/log")
        .send({ beverageType: "tea", size: "medium", modifiers: ["sugar"] });

      expect(res.status).toBe(422);
      expect(storage.createScannedItemWithLog).not.toHaveBeenCalled();
    });

    it("looks up a custom beverage by its name alone", async () => {
      mockLookups({
        "matcha latte": per100g("Matcha latte", { calories: 60 }),
      });

      const res = await request(app).post("/api/beverages/log").send({
        beverageType: "custom",
        size: "medium",
        customName: "matcha latte",
      });

      expect(res.status).toBe(201);
      expect(lookupQueries()).toEqual(["matcha latte"]);
      expect(savedItem()).toEqual(
        expect.objectContaining({
          productName: "matcha latte, Medium",
          calories: "213", // 60 × 3.55
          servingSize: "355 ml",
        }),
      );
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

    it("scales to each size's volume", async () => {
      mockLookups({
        "milk, 2%": per100g("Milk, fluid, partly skimmed, 2% M.F.", {
          calories: 50,
        }),
      });

      const calories: string[] = [];
      for (const size of ["small", "medium", "large"]) {
        vi.mocked(storage.createScannedItemWithLog).mockClear();
        await request(app)
          .post("/api/beverages/log")
          .send({ beverageType: "milk", size })
          .expect(201);
        calories.push(String(savedItem().calories));
      }

      // 240, 355 and 475 ml at 50 kcal per 100 g
      expect(calories).toEqual(["120", "178", "238"]);
    });
  });
});
