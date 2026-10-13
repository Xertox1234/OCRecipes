import { describe, it, expect } from "vitest";
import type {
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import {
  FINDER_BUTTON_LABELS,
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
      resultsAnnouncement({
        ...block,
        source: "inspired",
        items: [item({ source: "inspired" })],
      }),
    ).toBe("Found 1 idea for you");
    expect(
      resultsAnnouncement({
        ...block,
        source: "inspired",
        items: [
          item({ source: "inspired" }),
          item({ id: 13, source: "inspired" }),
        ],
      }),
    ).toBe("Found 2 ideas for you");
    expect(
      resultsAnnouncement({ ...block, items: [], notice: "no_matches" }),
    ).toBe("No community recipes matched.");
  });

  it("notice copy never reports 'unavailable' as no results", () => {
    expect(noticeText("unavailable", "inspired")).toBe(
      "Ideas aren't available right now. Try Generate or a community pick.",
    );
    expect(noticeText("no_matches", "inspired")).toBe("No ideas came up.");
    expect(noticeText("generate_limit", "inspired")).toBe(
      "You've reached today's limit for generated recipes. Community picks and ideas for you still work.",
    );
    expect(noticeText(null, "community")).toBeNull();
  });

  it("headers", () => {
    expect(resultsHeader("community")).toBe("From the community");
    expect(resultsHeader("inspired")).toBe("Ideas for you");
  });

  it("answers label is the visible user bubble text", () => {
    expect(
      answersLabel([
        { question: "Time?", answer: "Under 20 minutes" },
        { question: "Diet?", answer: "Vegan" },
      ]),
    ).toBe("Under 20 minutes, Vegan");
  });

  it("a community row opens the community recipe", () => {
    expect(finderItemNavParams(item())).toEqual({
      recipeId: 12,
      recipeType: "community",
    });
  });

  it("inspired items have no detail screen (they are made, not opened)", () => {
    expect(
      finderItemNavParams({
        id: 4,
        source: "inspired",
        title: "T",
        imageUrl: null,
        readyInMinutes: 20,
        calories: null,
      }),
    ).toBeNull();
  });

  it("search_online button reads 'Get ideas for you'", () => {
    expect(FINDER_BUTTON_LABELS.search_online).toBe("Get ideas for you");
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
