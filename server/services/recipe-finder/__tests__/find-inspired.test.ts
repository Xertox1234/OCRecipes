import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSuggestionListing } from "../../inspired-recipes";
import { findInspired } from "../find-inspired";
import { FINDER_MAX_ITEMS } from "@shared/schemas/recipe-finder";

vi.mock("../../inspired-recipes", () => ({ createSuggestionListing: vi.fn() }));

const card = {
  id: 4,
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 20,
  tags: [],
  imageUrl: null,
  madeRecipeId: null,
};
const args = {
  userId: "u",
  request: "tacos",
  query: { q: "tacos", mealType: "dinner" as const },
  profile: null,
  useSpoonacular: true,
};

beforeEach(() => vi.clearAllMocks());

describe("findInspired", () => {
  it("maps cards to inspired finder items, asking for FINDER_MAX_ITEMS", async () => {
    vi.mocked(createSuggestionListing).mockResolvedValue([card]);
    const out = await findInspired(args);
    expect(out).toEqual({
      status: "ok",
      items: [
        {
          id: 4,
          source: "inspired",
          title: "Bean Tacos",
          description: "Quick bright tacos tonight.",
          imageUrl: null,
          readyInMinutes: 20,
          calories: null,
        },
      ],
    });
    expect(vi.mocked(createSuggestionListing).mock.calls[0][0]).toMatchObject({
      count: FINDER_MAX_ITEMS,
      filters: { mealType: "dinner" },
    });
  });
  it("is unavailable when no listing could be made", async () => {
    vi.mocked(createSuggestionListing).mockResolvedValue(null);
    expect(await findInspired(args)).toEqual({ status: "unavailable" });
  });
});
