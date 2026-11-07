import { describe, it, expect, vi, beforeEach } from "vitest";
import { AI_DAILY_CAPS } from "@shared/types/premium";

import { storage } from "../../storage";
import { generateRecipeImage } from "../recipe-generation";
import { autoGenerateRecipeImage } from "../recipe-auto-image";

vi.mock("../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    claimDailyAiCall: vi.fn(),
    updateMealPlanRecipe: vi.fn(),
  },
}));

vi.mock("../recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

const recipe = {
  id: 7,
  title: "Lentil soup",
  cuisine: "Indian",
  mealTypes: ["dinner"],
};

describe("autoGenerateRecipeImage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("makes no paid call and claims nothing for a tier without recipeAutoImages", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");

    await autoGenerateRecipeImage(recipe, "user-1");

    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(generateRecipeImage).not.toHaveBeenCalled();
  });

  it("claims the shared daily cap BEFORE the paid call and skips it when refused", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);

    await autoGenerateRecipeImage(recipe, "user-1");

    expect(storage.claimDailyAiCall).toHaveBeenCalledWith(
      "user-1",
      "recipeAutoImage",
      AI_DAILY_CAPS.recipeAutoImage,
    );
    expect(generateRecipeImage).not.toHaveBeenCalled();
  });

  it("stores the generated image on the user's recipe", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(generateRecipeImage).mockResolvedValue("https://img/x.png");

    await autoGenerateRecipeImage(recipe, "user-1");

    expect(generateRecipeImage).toHaveBeenCalledWith({
      title: "Lentil soup",
      cuisine: "Indian",
      mealTypes: ["dinner"],
    });
    expect(storage.updateMealPlanRecipe).toHaveBeenCalledWith(7, "user-1", {
      imageUrl: "https://img/x.png",
    });
  });

  it("leaves the recipe untouched when no image comes back", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    vi.mocked(generateRecipeImage).mockResolvedValue(null);

    await autoGenerateRecipeImage(recipe, "user-1");

    expect(storage.updateMealPlanRecipe).not.toHaveBeenCalled();
  });
});
