import { describe, it, expect } from "vitest";
import { finderFallbackText } from "../fallback-text";
import type {
  RecipeResultsBlock,
  RecipeQuestionsBlock,
  RecipeOfferBlock,
  RecipeAdjustBlock,
} from "@shared/schemas/recipe-finder";

const flow = {
  flowId: "00000000-0000-4000-8000-000000000000",
  stage: "results" as const,
  request: "x",
  query: { q: "x" },
  round: 0 as const,
  shownIds: [],
};
const list: RecipeResultsBlock = {
  type: "recipe_results",
  source: "community",
  notice: null,
  flow,
  actions: ["search_online", "generate", "none_of_these"],
  items: [
    {
      id: 1,
      source: "community",
      title: "Mediterranean Quinoa Salad",
      imageUrl: null,
      readyInMinutes: 20,
      calories: 350,
    },
    {
      id: 2,
      source: "community",
      title: "Greek Bowl",
      imageUrl: null,
      readyInMinutes: null,
      calories: null,
    },
  ],
};

describe("finderFallbackText", () => {
  it("lists community recipes and tells an old client what to type", () => {
    expect(finderFallbackText(list)).toBe(
      'Here are 2 community recipes:\n1. Mediterranean Quinoa Salad (20 min · 350 cal)\n2. Greek Bowl\n\nReply "generate" to create a new recipe, or "none of these" to narrow it down.',
    );
  });

  it("round 1 'none of these' promises a recipe instead of questions", () => {
    expect(
      finderFallbackText({ ...list, flow: { ...flow, round: 1 } }),
    ).toContain('"none of these" to create one instead');
  });

  it("no community matches", () => {
    expect(
      finderFallbackText({ ...list, items: [], notice: "no_matches" }),
    ).toMatch(/^No community recipes matched\./);
  });

  it("Spoonacular unavailable never reads as 'no results'", () => {
    const text = finderFallbackText({
      ...list,
      source: "spoonacular",
      items: [],
      notice: "unavailable",
      actions: ["generate", "none_of_these"],
    });
    expect(text).toMatch(
      /^Spoonacular isn't available right now\. Try Generate or a community pick\./,
    );
    expect(text).not.toMatch(/no matches|no results/i);
  });

  it("generate limit", () => {
    expect(
      finderFallbackText({
        ...list,
        items: [],
        notice: "generate_limit",
        actions: ["search_online"],
      }),
    ).toBe(
      "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.",
    );
  });

  it("questions with options", () => {
    const q: RecipeQuestionsBlock = {
      type: "recipe_questions",
      flow: { ...flow, stage: "clarifying" },
      questions: [
        {
          question: "How much time do you have?",
          options: ["Under 20 minutes", "An hour or more"],
        },
      ],
    };
    expect(finderFallbackText(q)).toBe(
      'A few quick questions:\n1. How much time do you have? (Under 20 minutes / An hour or more)\n\nReply with your answers, or "generate" to create a recipe now.',
    );
  });

  it("offer text is the fixed copy + typed hints", () => {
    const offerBlock: RecipeOfferBlock = {
      type: "recipe_offer",
      flow: { ...flow, stage: "offer" },
    };
    expect(finderFallbackText(offerBlock)).toBe(
      'I can make this into a recipe right here in the chat. Want me to get started?\nI can also search OCRecipes for something similar.\n\nReply "yes", "search", or "no".',
    );
  });

  it("adjust text lists the prefill and how to proceed", () => {
    const adjustBlock: RecipeAdjustBlock = {
      type: "recipe_adjust",
      prefill: { servings: 8, spice: "mild", time: "moderate" },
      avoiding: [],
      noted: { dislikes: [] },
      followUps: [],
      flow: { ...flow, stage: "adjust", dish: "Spaghetti and meatballs" },
    };
    expect(finderFallbackText(adjustBlock)).toBe(
      'Spaghetti and meatballs — 8 servings, mild, 30-60 minutes.\n\nReply "generate" to make it.',
    );
  });
});
