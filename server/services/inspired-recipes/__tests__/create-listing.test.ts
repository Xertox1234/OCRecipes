import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CatalogSearchResponse } from "@shared/types/recipe-catalog";
import type { InspiredSuggestionRow } from "@shared/schema";

import { searchCatalogRecipes } from "../../recipe-catalog";
import { suggestListing } from "../suggest-listing";
import { storage } from "../../../storage";
import { createSuggestionListing } from "../index";

vi.mock("../../recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn(),
  buildIntolerancesParam: vi.fn(() => "peanut"),
}));
vi.mock("../suggest-listing", () => ({ suggestListing: vi.fn() }));
vi.mock("../../../storage", () => ({
  storage: { createInspiredSuggestions: vi.fn() },
}));

const draft = {
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 20,
  tags: ["quick"],
};
const row: InspiredSuggestionRow = {
  ...draft,
  id: 1,
  userId: "u",
  imageUrl: null,
  makingStartedAt: null,
  madeRecipeId: null,
  createdAt: new Date(),
  expiresAt: new Date(),
};
const searchResponse: CatalogSearchResponse = {
  results: [{ id: 99, title: "Chipotle Tacos", image: "https://spoon/x.jpg" }],
  offset: 0,
  number: 1,
  totalResults: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(suggestListing).mockResolvedValue([draft]);
  vi.mocked(storage.createInspiredSuggestions).mockResolvedValue([row]);
});

const base = {
  userId: "u",
  request: "tacos",
  filters: {},
  profile: null,
  count: 5,
};

describe("createSuggestionListing", () => {
  it("passes only Spoonacular titles to suggestListing and returns client cards", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue(searchResponse);
    const out = await createSuggestionListing({
      ...base,
      useSpoonacular: true,
    });
    expect(
      vi.mocked(suggestListing).mock.calls[0][0].inspirationTitles,
    ).toEqual(["Chipotle Tacos"]);
    // The whole argument, so the image URL and Spoonacular id cannot ride along.
    expect(vi.mocked(suggestListing).mock.calls[0][0]).toEqual({
      request: "tacos",
      inspirationTitles: ["Chipotle Tacos"],
      profile: null,
      count: 5,
    });
    expect(out).toEqual([
      { id: 1, ...draft, imageUrl: null, madeRecipeId: null },
    ]);
  });

  it("maps filters onto the catalog search", async () => {
    vi.mocked(searchCatalogRecipes).mockResolvedValue(searchResponse);
    await createSuggestionListing({
      ...base,
      filters: {
        cuisine: "italian",
        diet: "vegan",
        mealType: "dinner",
        maxReadyTime: 30,
      },
      useSpoonacular: true,
    });
    expect(searchCatalogRecipes).toHaveBeenCalledWith({
      query: "tacos",
      cuisine: "italian",
      diet: "vegan",
      type: "dinner",
      maxReadyTime: 30,
      intolerances: "peanut",
      number: 10,
    });
  });

  it("still lists when Spoonacular throws", async () => {
    vi.mocked(searchCatalogRecipes).mockRejectedValue(new Error("402"));
    const out = await createSuggestionListing({
      ...base,
      useSpoonacular: true,
    });
    expect(
      vi.mocked(suggestListing).mock.calls[0][0].inspirationTitles,
    ).toEqual([]);
    expect(out).toHaveLength(1);
  });

  it("skips Spoonacular when useSpoonacular is false", async () => {
    await createSuggestionListing({ ...base, useSpoonacular: false });
    expect(searchCatalogRecipes).not.toHaveBeenCalled();
  });

  it("retries the AI once, then returns null and stores nothing", async () => {
    vi.mocked(suggestListing).mockResolvedValue(null);
    expect(
      await createSuggestionListing({ ...base, useSpoonacular: false }),
    ).toBeNull();
    expect(suggestListing).toHaveBeenCalledTimes(2);
    expect(storage.createInspiredSuggestions).not.toHaveBeenCalled();
  });
});
