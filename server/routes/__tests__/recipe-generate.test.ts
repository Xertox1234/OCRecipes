import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../recipe-generate";
import { generateRecipeContent } from "../../services/recipe-generation";

vi.mock("../../services/recipe-generation", () => ({
  generateRecipeContent: vi.fn(),
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

describe("POST /api/meal-plan/recipes/generate", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is too short", async () => {
    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "ab" });
    expect(res.status).toBe(400);
  });

  it("returns ImportedRecipeData on success", async () => {
    vi.mocked(generateRecipeContent).mockResolvedValue({
      title: "Chicken Stir Fry",
      description: "A quick weeknight dinner",
      difficulty: "Easy",
      timeEstimate: "25 minutes",
      ingredients: [
        { name: "chicken breast", quantity: "2", unit: "pieces" },
        { name: "soy sauce", quantity: "3", unit: "tbsp" },
      ],
      instructions: ["Cut chicken", "Stir fry with sauce"],
      dietTags: ["Dairy Free", "Gluten Free"],
    });

    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "quick chicken stir fry" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Chicken Stir Fry");
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.ingredients[0]).toEqual({
      name: "chicken breast",
      quantity: "2",
      unit: "pieces",
    });
    expect(res.body.instructions).toEqual([
      "Cut chicken",
      "Stir fry with sauce",
    ]);
    expect(res.body.dietTags).toEqual(["Dairy Free", "Gluten Free"]);
    expect(res.body.sourceUrl).toBe("");
  });

  it("returns 500 when generation fails", async () => {
    vi.mocked(generateRecipeContent).mockRejectedValue(
      new Error("OpenAI error"),
    );

    const res = await request(app)
      .post("/api/meal-plan/recipes/generate")
      .set("Authorization", "Bearer test-token")
      .send({ prompt: "chocolate cake" });

    expect(res.status).toBe(500);
  });
});
