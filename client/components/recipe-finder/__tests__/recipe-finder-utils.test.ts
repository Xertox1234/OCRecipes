import { describe, it, expect } from "vitest";
import type {
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import {
  formatItemMeta,
  itemAccessibilityLabel,
  resultsAnnouncement,
  noticeText,
  answersLabel,
  finderItemNavParams,
  finderBlockFromMessageMetadata,
  lockedFinderButtons,
  resultsHeader,
} from "../recipe-finder-utils";

const item = (over: Partial<FinderItem> = {}): FinderItem => ({
  id: 12,
  source: "community",
  title: "Mediterranean Quinoa Salad",
  imageUrl: null,
  readyInMinutes: 20,
  calories: 350,
  ...over,
});
const block: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  items: [item(), item({ id: 13 })],
  actions: ["generate"],
  notice: null,
  flow: {
    flowId: "00000000-0000-4000-8000-000000000000",
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};

describe("recipe-finder-utils", () => {
  it("meta line shows time and calories, calories only when known", () => {
    expect(formatItemMeta(item())).toBe("20 min · 350 cal");
    expect(formatItemMeta(item({ calories: null }))).toBe("20 min");
    expect(formatItemMeta(item({ readyInMinutes: null, calories: null }))).toBe(
      "",
    );
  });

  it("row label reads as one button (§5 a11y)", () => {
    expect(itemAccessibilityLabel(item())).toBe(
      "Mediterranean Quinoa Salad, 20 minutes, 350 calories. Opens recipe.",
    );
    expect(
      itemAccessibilityLabel(item({ readyInMinutes: null, calories: null })),
    ).toBe("Mediterranean Quinoa Salad. Opens recipe.");
  });

  it("announces the list on arrival", () => {
    expect(resultsAnnouncement(block)).toBe("Found 2 community recipes");
    expect(
      resultsAnnouncement({ ...block, source: "spoonacular", items: [item()] }),
    ).toBe("Found 1 Spoonacular recipe");
    expect(
      resultsAnnouncement({ ...block, items: [], notice: "no_matches" }),
    ).toBe("No community recipes matched.");
  });

  it("notice copy never reports 'unavailable' as no results", () => {
    expect(noticeText("unavailable", "spoonacular")).toBe(
      "Spoonacular isn't available right now. Try Generate or a community pick.",
    );
    expect(noticeText(null, "community")).toBeNull();
  });

  it("headers", () => {
    expect(resultsHeader("community")).toBe("From the community");
    expect(resultsHeader("spoonacular")).toBe("From Spoonacular");
  });

  it("answers label is the visible user bubble text", () => {
    expect(
      answersLabel([
        { question: "Time?", answer: "Under 20 minutes" },
        { question: "Diet?", answer: "Vegan" },
      ]),
    ).toBe("Under 20 minutes, Vegan");
  });

  it("a Spoonacular row opens the catalog preview; a community row opens community (R1)", () => {
    expect(
      finderItemNavParams(item({ id: 715538, source: "spoonacular" })),
    ).toEqual({ recipeId: 715538, recipeType: "catalog" });
    expect(finderItemNavParams(item())).toEqual({
      recipeId: 12,
      recipeType: "community",
    });
  });

  it("reads a finder block from RecipeChef or Coach metadata", () => {
    expect(
      finderBlockFromMessageMetadata({ metadataVersion: 1, finder: block }),
    ).toEqual(block);
    expect(finderBlockFromMessageMetadata({ blocks: [block] })).toEqual(block);
    expect(finderBlockFromMessageMetadata({ recipe: {} })).toBeNull();
  });

  it("locks the buttons the account lacks (§6 premium)", () => {
    expect(
      lockedFinderButtons({ canSearchOnline: false, canGenerate: true }),
    ).toEqual(["search_online"]);
    expect(
      lockedFinderButtons({ canSearchOnline: true, canGenerate: false }),
    ).toEqual(["generate"]);
    expect(
      lockedFinderButtons({ canSearchOnline: true, canGenerate: true }),
    ).toEqual([]);
  });
});
