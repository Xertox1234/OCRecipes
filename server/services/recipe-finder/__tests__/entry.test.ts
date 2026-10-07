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

describe("matchTypedFinderCommand — offer phrases (stage-gated)", () => {
  it.each([
    ["Yes please!", "recipe_offer", "yes"],
    ["  OK. ", "recipe_offer", "yes"],
    ["go ahead", "recipe_adjust", "yes"],
    ["No thanks", "recipe_offer", "no"],
    ["not now!", "recipe_adjust", "no"],
    ["Search OCRecipes", "recipe_offer", "search"],
    ["search for one", "recipe_offer", "search"],
    ["search", "recipe_adjust", null],
    ["yes please!", "recipe_results", null],
    ["no", "recipe_questions", null],
    ["yes with extra garlic", "recipe_offer", null],
  ] as const)("%j at %s → %s", (text, stage, expected) => {
    expect(matchTypedFinderCommand(text, stage, true)).toBe(expected);
  });
  it("flag off: a leftover offer/adjust block gets no yes/no/search (as before)", () => {
    expect(matchTypedFinderCommand("yes", "recipe_offer")).toBeNull();
    expect(matchTypedFinderCommand("no", "recipe_adjust", false)).toBeNull();
    expect(matchTypedFinderCommand("search", "recipe_offer", false)).toBeNull();
    expect(matchTypedFinderCommand("generate", "recipe_offer")).toBe(
      "generate",
    );
  });
});

describe("decideRecipeChefEntry — offer on (legacy → offer, H3)", () => {
  const afterNo = () => [
    msg("user", null, "pasta"),
    msg("assistant", null, "No problem."),
  ];
  it("no block, no card, prior user turns → start", () => {
    expect(
      decideRecipeChefEntry(afterNo(), "actually, make it spicy", {
        offer: true,
      }),
    ).toEqual({
      kind: "finder",
      input: { kind: "start", text: "actually, make it spicy" },
    });
  });
  it("an earlier card that is not the latest message: offer on → start, off → classify", () => {
    const h = [
      msg("user"),
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
      msg("user"),
      msg("assistant", null, "No problem."),
    ];
    expect(decideRecipeChefEntry(h, "make it spicy", { offer: true })).toEqual({
      kind: "finder",
      input: { kind: "start", text: "make it spicy" },
    });
    expect(decideRecipeChefEntry(h, "make it spicy")).toEqual({
      kind: "classify",
      recipeTitle: "Chicken Curry",
    });
  });
  it("offer on: the card IS the latest message → classify (refine exception)", () => {
    const h = [
      msg("user"),
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
    ];
    expect(decideRecipeChefEntry(h, "spicier", { offer: true })).toEqual({
      kind: "classify",
      recipeTitle: "Chicken Curry",
    });
  });
  it("offer off → legacy (unchanged)", () => {
    expect(
      decideRecipeChefEntry(afterNo(), "actually, make it spicy", {
        offer: false,
      }),
    ).toEqual({ kind: "legacy" });
    expect(decideRecipeChefEntry(afterNo(), "x")).toEqual({ kind: "legacy" });
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

describe("decideCoachFinderEntry — offer on (H2/H3)", () => {
  const F1 = "11111111-1111-4111-8111-111111111111";
  const offerFlow = {
    flowId: F1,
    stage: "offer" as const,
    request: "Chili",
    query: { q: "Chili" },
    round: 0 as const,
    shownIds: [],
    dish: "Chili",
    details: { ingredients: [], fromConversation: false },
  };
  const offerBlock: FinderBlock = { type: "recipe_offer", flow: offerFlow };
  const adjustBlock: FinderBlock = {
    type: "recipe_adjust",
    prefill: { servings: 2, spice: "mild", time: "moderate" },
    avoiding: [],
    noted: { dislikes: [] },
    followUps: [],
    flow: { ...offerFlow, stage: "adjust" },
  };
  const live = (b: FinderBlock) => [
    msg("assistant", { blocks: [b] }),
    msg("user"),
  ];
  const on = { offer: true };

  it("a live offer + typed yes → finder with the typed command (stays in the finder)", () => {
    expect(
      decideCoachFinderEntry(
        live(offerBlock),
        "yes please",
        "vague_request",
        undefined,
        on,
      ),
    ).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "yes please", command: "yes" },
    });
  });
  it("a live adjust + typed generate → finder (no offer→card→offer loop)", () => {
    expect(
      decideCoachFinderEntry(
        live(adjustBlock),
        "generate",
        "vague_request",
        undefined,
        on,
      ),
    ).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "generate", command: "generate" },
    });
  });
  it("a live offer + other typed text → none (tool loop)", () => {
    expect(
      decideCoachFinderEntry(
        live(offerBlock),
        "make it for 6 instead",
        "vague_request",
        undefined,
        on,
      ),
    ).toEqual({ kind: "none" });
  });
  it("a live adjust + free text → none (tool loop)", () => {
    expect(
      decideCoachFinderEntry(
        live(adjustBlock),
        "can you add mushrooms",
        "vague_request",
        undefined,
        on,
      ),
    ).toEqual({ kind: "none" });
  });
  it("intent recipe_request with no block → none (the model decides)", () => {
    expect(
      decideCoachFinderEntry(
        [msg("user")],
        "find me a chicken recipe",
        "recipe_request",
        undefined,
        on,
      ),
    ).toEqual({ kind: "none" });
  });
  it("a live recipe_results + typed text → finder (unchanged)", () => {
    expect(
      decideCoachFinderEntry(
        live(block),
        "something with rice",
        "vague_request",
        undefined,
        on,
      ),
    ).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "something with rice", command: null },
    });
  });
  it("a recipe card latest → classify, as today", () => {
    const h = [
      msg("user"),
      msg("assistant", {
        metadataVersion: 1,
        recipe,
        allergenWarning: null,
        imageUrl: null,
      }),
      msg("user"),
    ];
    expect(
      decideCoachFinderEntry(h, "spicier", "vague_request", undefined, on),
    ).toEqual({ kind: "classify", recipeTitle: "Chicken Curry" });
  });
  it("offer off: a leftover offer block + typed yes → finder with no command (as before)", () => {
    expect(
      decideCoachFinderEntry(live(offerBlock), "yes", "vague_request"),
    ).toEqual({
      kind: "finder",
      input: { kind: "typed", text: "yes", command: null },
    });
  });
});
