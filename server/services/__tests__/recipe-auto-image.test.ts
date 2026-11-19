import { describe, it, expect, vi, beforeEach } from "vitest";
import { AI_DAILY_CAPS } from "@shared/types/premium";

import { storage } from "../../storage";
import { generateRecipeImage } from "../recipe-generation";
import { autoGenerateRecipeImage, sharedDishImage } from "../recipe-auto-image";
import { dishImageKey } from "../../lib/dish-image-key";
import { isAiSharingAllowedFor } from "../../lib/ai-sharing-gate";

vi.mock("../../storage", () => ({
  storage: {
    getEffectiveTierForUser: vi.fn(),
    claimDailyAiCall: vi.fn(),
    updateMealPlanRecipe: vi.fn(),
    getDishImageUrl: vi.fn(),
    recordDishImage: vi.fn(),
  },
}));

vi.mock("../recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

vi.mock("../../lib/ai-sharing-gate", () => ({
  isAiSharingAllowedFor: vi.fn(),
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
    vi.mocked(isAiSharingAllowedFor).mockResolvedValue(true);
  });

  // Privacy audit H3.
  it("sends nothing and claims nothing for a user with AI features off", async () => {
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
    vi.mocked(isAiSharingAllowedFor).mockResolvedValue(false);

    await autoGenerateRecipeImage(recipe, "user-1");

    expect(isAiSharingAllowedFor).toHaveBeenCalledWith("user-1");
    expect(storage.claimDailyAiCall).not.toHaveBeenCalled();
    expect(generateRecipeImage).not.toHaveBeenCalled();
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

  describe("shared dish picture", () => {
    const KEY = "k".repeat(64);

    function mockAllGatesOpen() {
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
      vi.mocked(storage.claimDailyAiCall).mockResolvedValue(true);
    }

    it("records the generated picture under the share key, after the recipe has it", async () => {
      mockAllGatesOpen();
      vi.mocked(generateRecipeImage).mockResolvedValue("https://img/x.png");

      await autoGenerateRecipeImage(recipe, "user-1", KEY);

      expect(storage.recordDishImage).toHaveBeenCalledWith(
        KEY,
        "https://img/x.png",
      );
      expect(
        vi.mocked(storage.updateMealPlanRecipe).mock.invocationCallOrder[0],
      ).toBeLessThan(
        vi.mocked(storage.recordDishImage).mock.invocationCallOrder[0],
      );
    });

    it("records nothing without a share key", async () => {
      mockAllGatesOpen();
      vi.mocked(generateRecipeImage).mockResolvedValue("https://img/x.png");

      await autoGenerateRecipeImage(recipe, "user-1");
      await autoGenerateRecipeImage(recipe, "user-1", null);

      expect(storage.recordDishImage).not.toHaveBeenCalled();
    });

    it("records nothing when no image comes back", async () => {
      mockAllGatesOpen();
      vi.mocked(generateRecipeImage).mockResolvedValue(null);

      await autoGenerateRecipeImage(recipe, "user-1", KEY);

      expect(storage.recordDishImage).not.toHaveBeenCalled();
    });

    it("records nothing when a gate refuses", async () => {
      vi.mocked(generateRecipeImage).mockResolvedValue("https://img/x.png");

      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
      await autoGenerateRecipeImage(recipe, "user-1", KEY);

      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
      vi.mocked(isAiSharingAllowedFor).mockResolvedValue(false);
      await autoGenerateRecipeImage(recipe, "user-1", KEY);

      vi.mocked(isAiSharingAllowedFor).mockResolvedValue(true);
      vi.mocked(storage.claimDailyAiCall).mockResolvedValue(false);
      await autoGenerateRecipeImage(recipe, "user-1", KEY);

      expect(generateRecipeImage).not.toHaveBeenCalled();
      expect(storage.recordDishImage).not.toHaveBeenCalled();
    });
  });
});

describe("sharedDishImage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("is off for anything but a quick entry", async () => {
    expect(
      await sharedDishImage("user_created", "Bacon and eggs", null),
    ).toEqual({ key: null, url: null });
    expect(await sharedDishImage(undefined, "Bacon and eggs", null)).toEqual({
      key: null,
      url: null,
    });
    expect(storage.getDishImageUrl).not.toHaveBeenCalled();
  });

  // A picture the person supplied is theirs: it is never looked up or shared.
  it("is off for a quick entry that came with its own picture", async () => {
    expect(
      await sharedDishImage(
        "quick_entry",
        "Bacon and eggs",
        "https://img/mine.jpg",
      ),
    ).toEqual({ key: null, url: null });
    expect(storage.getDishImageUrl).not.toHaveBeenCalled();
  });

  it("is off for a name that normalises to nothing", async () => {
    expect(await sharedDishImage("quick_entry", "!!!", null)).toEqual({
      key: null,
      url: null,
    });
    expect(storage.getDishImageUrl).not.toHaveBeenCalled();
  });

  it("returns the stored picture for a quick entry whose name is recorded", async () => {
    vi.mocked(storage.getDishImageUrl).mockResolvedValue("https://img/s.png");

    const key = dishImageKey("Bacon and eggs");
    expect(
      await sharedDishImage("quick_entry", "Bacon and eggs", null),
    ).toEqual({ key, url: "https://img/s.png" });
    expect(storage.getDishImageUrl).toHaveBeenCalledWith(key);
  });

  it("returns the key and no picture for a name nobody has entered yet", async () => {
    vi.mocked(storage.getDishImageUrl).mockResolvedValue(null);

    expect(await sharedDishImage("quick_entry", "Bacon and eggs", "")).toEqual({
      key: dishImageKey("Bacon and eggs"),
      url: null,
    });
  });

  // The create must not fail over a picture.
  it("treats a failed lookup as no picture", async () => {
    vi.mocked(storage.getDishImageUrl).mockRejectedValue(new Error("db down"));

    expect(
      await sharedDishImage("quick_entry", "Bacon and eggs", null),
    ).toEqual({ key: dishImageKey("Bacon and eggs"), url: null });
  });
});
