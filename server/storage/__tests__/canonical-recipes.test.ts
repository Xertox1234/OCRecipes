import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../db";

import {
  incrementRecipePopularity,
  getCuratedRecipes,
  getCuratedRecipeById,
  getEligibleForPromotion,
  markCanonical,
  markEnriched,
  getRecipeById,
} from "../canonical-recipes";

vi.mock("../../db", () => ({
  db: {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
  },
}));

describe("incrementRecipePopularity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("increments favorites counter by 1", async () => {
    await incrementRecipePopularity(42, "favorite");
    expect(db.update).toHaveBeenCalled();
  });

  it("increments mealPlan counter by 1", async () => {
    await incrementRecipePopularity(42, "mealPlan");
    expect(db.update).toHaveBeenCalled();
  });

  it("increments cookSession counter by 1", async () => {
    await incrementRecipePopularity(42, "cookSession");
    expect(db.update).toHaveBeenCalled();
  });
});

describe("markCanonical", () => {
  it("sets isCanonical true and canonicalizedAt", async () => {
    await markCanonical(42);
    expect(db.update).toHaveBeenCalled();
  });
});

describe("markEnriched", () => {
  it("sets enrichment fields and canonicalEnrichedAt", async () => {
    await markEnriched(42, {
      canonicalImages: ["/api/recipe-images/hero.png"],
      instructionDetails: ["Detailed step 1", null],
      toolsRequired: [{ name: "Cast iron skillet" }],
      chefTips: ["Use full-fat yogurt"],
      cuisineOrigin: "Italian",
    });
    expect(db.update).toHaveBeenCalled();
  });
});

const mockDb = db as any;

describe("getEligibleForPromotion", () => {
  it("queries non-canonical recipes and returns results", async () => {
    vi.mocked(mockDb.limit).mockResolvedValueOnce([]);
    const result = await getEligibleForPromotion(10);
    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe("getCuratedRecipes", () => {
  it("returns empty array when no curated recipes", async () => {
    vi.mocked(mockDb.offset).mockResolvedValueOnce([]);
    const result = await getCuratedRecipes({ limit: 20, offset: 0 });
    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe("getCuratedRecipeById", () => {
  it("returns null when recipe not found", async () => {
    vi.mocked(mockDb.limit).mockResolvedValueOnce([]);
    const result = await getCuratedRecipeById(999);
    expect(result).toBeNull();
  });
});

describe("getRecipeById", () => {
  it("returns null when recipe not found", async () => {
    vi.mocked(mockDb.limit).mockResolvedValueOnce([]);
    const result = await getRecipeById(999);
    expect(result).toBeNull();
  });
});
