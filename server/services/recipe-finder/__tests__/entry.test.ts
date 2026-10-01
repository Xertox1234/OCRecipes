import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@shared/schema";
import type { FinderBlock } from "@shared/schemas/recipe-finder";
import {
  finderBlockFromMetadata,
  getLatestFinderBlock,
  isActionCurrent,
  matchTypedFinderCommand,
  decideRecipeChefEntry,
  decideCoachFinderEntry,
} from "../entry";

const F0 = "00000000-0000-4000-8000-000000000000";
const block: FinderBlock = {
  type: "recipe_results",
  source: "community",
  items: [],
  actions: ["generate"],
  notice: "no_matches",
  flow: {
    flowId: F0,
    stage: "results",
    request: "x",
    query: { q: "x" },
    round: 0,
    shownIds: [],
  },
};
const recipe = {
  title: "Chicken Curry",
  description: "d",
  difficulty: "Easy",
  timeEstimate: "30 min",
  servings: 2,
  ingredients: [],
  instructions: ["cook"],
  dietTags: [],
};
let nextId = 1;
const msg = (
  role: ChatMessage["role"],
  metadata: unknown = null,
  content = "c",
): ChatMessage => ({
  id: nextId++,
  conversationId: 1,
  role,
  content,
  metadata,
  turnKey: null,
  createdAt: new Date(),
});

describe("finderBlockFromMetadata", () => {
  it("reads RecipeChef metadata and Coach blocks", () => {
    expect(
      finderBlockFromMetadata({ metadataVersion: 1, finder: block }),
    ).toEqual(block);
    expect(
      finderBlockFromMetadata({
        blocks: [{ type: "quick_replies", options: [] }, block],
      }),
    ).toEqual(block);
    expect(finderBlockFromMetadata(null)).toBeNull();
  });
});

describe("getLatestFinderBlock / isActionCurrent", () => {
  it("only the most recent assistant message's block is active", () => {
    const active = [
      msg("user"),
      msg("assistant", { metadataVersion: 1, finder: block }),
      msg("user"),
    ];
    expect(getLatestFinderBlock(active)).toEqual(block);
    const superseded = [
      ...active,
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
    ];
    expect(getLatestFinderBlock(superseded)).toBeNull();
  });

  it("matches flowIds exactly", () => {
    expect(isActionCurrent(block, { type: "generate", flowId: F0 })).toBe(true);
    expect(
      isActionCurrent(block, {
        type: "generate",
        flowId: "99999999-9999-4999-8999-999999999999",
      }),
    ).toBe(false);
    expect(isActionCurrent(null, { type: "generate", flowId: F0 })).toBe(false);
  });
});

describe("matchTypedFinderCommand (old-client guard, §9 item 7)", () => {
  it.each([
    ["generate", "recipe_results", "generate"],
    ["Generate!", "recipe_results", "generate"],
    ['"generate"', "recipe_results", "generate"],
    ["  generate a recipe. ", "recipe_results", "generate"],
    ["None of these", "recipe_results", "none_of_these"],
    ["none of those.", "recipe_results", "none_of_these"],
    ["generate", "recipe_questions", "generate"],
    // "none" is a valid clarifying ANSWER ("Any diet?" → "none") — never a command there.
    ["none of these", "recipe_questions", null],
    ["none", "recipe_results", null],
    ["generate something spicy with chicken", "recipe_results", null],
    ["can you generate it with tofu", "recipe_results", null],
  ] as const)("%j at %s → %s", (text, stage, expected) => {
    expect(matchTypedFinderCommand(text, stage)).toBe(expected);
  });
});

describe("decideRecipeChefEntry (§3.3)", () => {
  it("first user message → start the flow", () => {
    expect(decideRecipeChefEntry([], "Mediterranean")).toEqual({
      kind: "finder",
      input: { kind: "start", text: "Mediterranean" },
    });
  });
  it("active flow → typed input with command detection", () => {
    const h = [
      msg("user"),
      msg("assistant", { metadataVersion: 1, finder: block }),
    ];
    expect(decideRecipeChefEntry(h, "generate")).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "generate", command: "generate" },
    });
  });
  it("after a card → classify", () => {
    const h = [
      msg("user"),
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
    ];
    expect(decideRecipeChefEntry(h, "make it spicier")).toEqual({
      kind: "classify",
      recipeTitle: "Chicken Curry",
    });
  });
  it("otherwise legacy", () => {
    const h = [
      msg("user"),
      msg("assistant", null, "Sorry, I'm having trouble…"),
    ];
    expect(decideRecipeChefEntry(h, "try again")).toEqual({ kind: "legacy" });
  });
});

describe("decideCoachFinderEntry", () => {
  const cardLatest = [
    msg("user"),
    msg("assistant", {
      metadataVersion: 1,
      recipe,
      allergenWarning: null,
      imageUrl: null,
    }),
    msg("user"),
  ];
  it("a button action always enters the flow", () => {
    const action = { type: "generate" as const, flowId: F0 };
    expect(
      decideCoachFinderEntry([], "Generate", "vague_request", action),
    ).toEqual({ kind: "finder", input: { kind: "action", action } });
  });
  it("safety_refusal never enters the flow, even mid-flow", () => {
    const h = [msg("assistant", { blocks: [block] }), msg("user")];
    expect(
      decideCoachFinderEntry(h, "I have diabetes", "safety_refusal"),
    ).toEqual({ kind: "none" });
  });
  it("recipe_request starts the flow", () => {
    expect(
      decideCoachFinderEntry(
        [msg("user")],
        "find me a chicken recipe",
        "recipe_request",
      ),
    ).toEqual({
      kind: "finder",
      input: { kind: "start", text: "find me a chicken recipe" },
    });
  });
  it("a card as the latest assistant message → classify", () => {
    expect(
      decideCoachFinderEntry(
        cardLatest,
        "make it spicier",
        "personalized_advice",
      ),
    ).toEqual({ kind: "classify", recipeTitle: "Chicken Curry" });
  });
  it("a card further back does not trigger classifyTurn in Coach", () => {
    const h = [
      ...cardLatest,
      msg("assistant", null, "You're at 1,400 cal"),
      msg("user"),
    ];
    expect(
      decideCoachFinderEntry(h, "how am I doing?", "personalized_advice"),
    ).toEqual({ kind: "none" });
  });
  it("ordinary coaching stays on the coach path", () => {
    expect(
      decideCoachFinderEntry(
        [msg("user")],
        "How am I doing today?",
        "personalized_advice",
      ),
    ).toEqual({ kind: "none" });
  });
});
