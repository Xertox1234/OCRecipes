import { describe, it, expect, vi, beforeEach } from "vitest";

import { sharedDishImage, autoGenerateRecipeImage } from "../recipe-auto-image";
import { fireAndForget } from "../../lib/fire-and-forget";
import {
  prepareMealPlanRecipe,
  afterRecipeCreated,
} from "../meal-plan-recipe-prepare";

vi.mock("../recipe-auto-image", () => ({
  sharedDishImage: vi.fn(),
  autoGenerateRecipeImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/fire-and-forget", () => ({ fireAndForget: vi.fn() }));

const mockShared = vi.mocked(sharedDishImage);

const validInput = {
  title: "Chicken and Rice Bowl",
  instructions: ["Cook the chicken.", "Cook the rice.", "Combine and serve."],
  sourceType: "user_created" as const,
  ingredients: [
    { name: "chicken breast", quantity: "200", unit: "g" },
    { name: "rice", quantity: "1", unit: "cup" },
  ],
};

describe("prepareMealPlanRecipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShared.mockResolvedValue({ key: null, url: null });
  });

  it("rejects a recipe that fails the quality gate", async () => {
    const result = await prepareMealPlanRecipe(
      { ...validInput, title: "" },
      "u1",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
    expect(mockShared).not.toHaveBeenCalled();
  });

  it("returns recipe data, inferred meal types and no image key", async () => {
    const result = await prepareMealPlanRecipe(validInput, "u1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipeData.title).toBe(validInput.title);
    expect(result.ingredients).toEqual(validInput.ingredients);
    expect(Array.isArray(result.mealTypes)).toBe(true);
    expect(result.imageKey).toBeNull();
    expect(result.sharedImageUrl).toBeNull();
    expect(result.recipeData).not.toHaveProperty("ingredients");
    expect(result.recipeData).not.toHaveProperty("sourceType");
  });

  it("carries a shared dish picture's url and key", async () => {
    mockShared.mockResolvedValue({ key: "dish-key", url: "https://x/y.png" });
    const result = await prepareMealPlanRecipe(validInput, "u1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageKey).toBe("dish-key");
    expect(result.sharedImageUrl).toBe("https://x/y.png");
    expect(mockShared).toHaveBeenCalledWith(
      "user_created",
      validInput.title,
      undefined,
    );
  });
});

describe("afterRecipeCreated", () => {
  beforeEach(() => vi.clearAllMocks());
  const recipe = { id: 5, title: "T", cuisine: null, mealTypes: ["dinner"] };

  it("fires the image job when the recipe has no picture", () => {
    afterRecipeCreated({
      recipe,
      userId: "u1",
      imageKey: "k",
      hasImage: false,
    });
    expect(fireAndForget).toHaveBeenCalledWith(
      "recipe-image-gen",
      expect.anything(),
    );
    expect(autoGenerateRecipeImage).toHaveBeenCalledWith(recipe, "u1", "k");
  });

  it("does nothing when a picture exists", () => {
    afterRecipeCreated({
      recipe,
      userId: "u1",
      imageKey: null,
      hasImage: true,
    });
    expect(fireAndForget).not.toHaveBeenCalled();
  });
});
