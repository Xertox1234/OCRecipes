import { describe, it, expect } from "vitest";
import {
  finderBlockSchema,
  finderActionSchema,
  recipeFinderMetadataSchema,
  isFinderBlockType,
  FINDER_MAX_ITEMS,
} from "../recipe-finder";
import { coachBlockSchema } from "../coach-blocks";

const FLOW_ID = "11111111-1111-4111-8111-111111111111";

const resultsBlock = {
  type: "recipe_results" as const,
  source: "community" as const,
  items: [
    {
      id: 12,
      source: "community" as const,
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: null,
      calories: 350,
    },
  ],
  actions: ["search_online", "generate", "none_of_these"] as const,
  notice: null,
  flow: {
    flowId: FLOW_ID,
    stage: "results" as const,
    request: "Mediterranean",
    query: { q: "mediterranean" },
    round: 0 as const,
    shownIds: ["community:12"],
  },
};

describe("finderBlockSchema", () => {
  it("accepts a community results block", () => {
    expect(finderBlockSchema.safeParse(resultsBlock).success).toBe(true);
  });

  it(`rejects more than ${FINDER_MAX_ITEMS} items`, () => {
    const items = Array.from({ length: FINDER_MAX_ITEMS + 1 }, (_, i) => ({
      ...resultsBlock.items[0],
      id: i + 1,
    }));
    expect(
      finderBlockSchema.safeParse({ ...resultsBlock, items }).success,
    ).toBe(false);
  });

  it("rejects a third round (the flow allows one clarifying round)", () => {
    const bad = { ...resultsBlock, flow: { ...resultsBlock.flow, round: 2 } };
    expect(finderBlockSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts a questions block", () => {
    const q = {
      type: "recipe_questions",
      questions: [
        { question: "How much time?", options: ["20 min", "1 hour"] },
      ],
      flow: { ...resultsBlock.flow, stage: "clarifying" },
    };
    expect(finderBlockSchema.safeParse(q).success).toBe(true);
  });
});

describe("finderActionSchema", () => {
  it("requires answers on an answers action", () => {
    expect(
      finderActionSchema.safeParse({ type: "answers", flowId: FLOW_ID })
        .success,
    ).toBe(false);
    expect(
      finderActionSchema.safeParse({
        type: "answers",
        flowId: FLOW_ID,
        answers: [{ question: "Time?", answer: "20 min" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid flowId", () => {
    expect(
      finderActionSchema.safeParse({ type: "generate", flowId: "abc" }).success,
    ).toBe(false);
  });
});

describe("registration", () => {
  it("coachBlockSchema accepts a finder block (else filterValidBlocks drops it — R6)", () => {
    expect(coachBlockSchema.safeParse(resultsBlock).success).toBe(true);
  });

  it("recipeFinderMetadataSchema wraps a block for RecipeChef", () => {
    expect(
      recipeFinderMetadataSchema.safeParse({
        metadataVersion: 1,
        finder: resultsBlock,
      }).success,
    ).toBe(true);
  });

  it("isFinderBlockType accepts results/questions and rejects a non-finder type", () => {
    expect(isFinderBlockType("recipe_results")).toBe(true);
    expect(isFinderBlockType("recipe_questions")).toBe(true);
    expect(isFinderBlockType("recipe_card")).toBe(false);
  });
});

const OFFER_FID = "00000000-0000-4000-8000-000000000000";
const offerFlow = {
  flowId: OFFER_FID,
  stage: "offer",
  request: "Spaghetti and meatballs",
  query: { q: "spaghetti and meatballs" },
  round: 0,
  shownIds: [],
  dish: "Spaghetti and meatballs",
  details: { servings: 8, ingredients: [], fromConversation: false },
};

describe("offer/adjust schema", () => {
  it("parses an offer block", () => {
    expect(
      finderBlockSchema.safeParse({ type: "recipe_offer", flow: offerFlow })
        .success,
    ).toBe(true);
    expect(isFinderBlockType("recipe_offer")).toBe(true);
    expect(isFinderBlockType("recipe_adjust")).toBe(true);
  });
  it("adjust_generate requires settings", () => {
    expect(
      finderActionSchema.safeParse({
        type: "adjust_generate",
        flowId: OFFER_FID,
      }).success,
    ).toBe(false);
    expect(
      finderActionSchema.safeParse({
        type: "adjust_generate",
        flowId: OFFER_FID,
        settings: { servings: 8, spice: "mild", time: "moderate" },
      }).success,
    ).toBe(true);
  });
  it.each([
    [{ servings: 0, spice: "mild", time: "moderate" }],
    [{ servings: 21, spice: "mild", time: "moderate" }],
    [{ servings: 2, spice: "extreme", time: "moderate" }],
    [{ servings: 2, spice: "mild", time: "under_20" }],
  ])("rejects tampered settings %j", (settings) => {
    expect(
      finderActionSchema.safeParse({
        type: "adjust_generate",
        flowId: OFFER_FID,
        settings,
      }).success,
    ).toBe(false);
  });
  it("old results blocks still parse (flow without dish/details)", () => {
    expect(
      finderBlockSchema.safeParse({
        type: "recipe_results",
        source: "community",
        items: [],
        actions: [],
        notice: "no_matches",
        flow: {
          ...offerFlow,
          stage: "results",
          dish: undefined,
          details: undefined,
        },
      }).success,
    ).toBe(true);
  });
});
