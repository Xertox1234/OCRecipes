import { describe, it, expect } from "vitest";
import { COOKING_TIME_IDS } from "@shared/constants/cooking-times";
import {
  recipeOfferBlockSchema,
  spiceLevelSchema,
} from "@shared/schemas/recipe-finder";
import {
  OFFER_RECIPE_TOOL,
  buildOfferBlock,
  decideOfferToolCall,
  normalizeDish,
} from "../offer";

const F0 = "00000000-0000-4000-8000-000000000000";
const empty = { ingredients: [], fromConversation: false };
const cardFor = (dish: string, servings = 2) => ({
  type: "recipe_adjust" as const,
  prefill: { servings, spice: "mild" as const, time: "moderate" as const },
  avoiding: [],
  noted: { dislikes: [] },
  followUps: [],
  flow: { ...buildOfferBlock(dish, empty, F0).flow, stage: "adjust" as const },
});
const call = (o: object) => JSON.stringify({ from_conversation: false, ...o });

describe("offer tool schema", () => {
  it("enums derive from the shared constants", () => {
    const props = (
      OFFER_RECIPE_TOOL as unknown as {
        function: {
          parameters: { properties: Record<string, { enum: string[] }> };
        };
      }
    ).function.parameters.properties;
    expect(props.spice.enum).toEqual([...spiceLevelSchema.options]);
    expect(props.time.enum).toEqual([...COOKING_TIME_IDS]);
  });
});

describe("normalizeDish", () => {
  it.each([
    ["Spaghetti & Meatballs", "spaghetti and meatballs"],
    ["The spaghetti and meatballs!", "spaghetti and meatballs"],
    ["  a  Lemon-Garlic chicken ", "lemon garlic chicken"],
  ])("normalizeDish(%s)", (a, b) => expect(normalizeDish(a)).toBe(b));
});

describe("decideOfferToolCall", () => {
  it("invalid JSON / empty dish / junk → invalid", () => {
    expect(decideOfferToolCall("{", null).kind).toBe("invalid");
    expect(decideOfferToolCall(call({ dish: "  " }), null).kind).toBe(
      "invalid",
    );
    expect(decideOfferToolCall("[]", null).kind).toBe("invalid");
    expect(
      decideOfferToolCall(call({ dish: "x".repeat(200) }), null).kind,
    ).toBe("invalid");
  });
  it("valid → offer with mapped details", () => {
    expect(
      decideOfferToolCall(
        call({ dish: "Spaghetti and meatballs", servings: 8 }),
        null,
      ),
    ).toEqual({
      kind: "offer",
      dish: "Spaghetti and meatballs",
      details: { servings: 8, ingredients: [], fromConversation: false },
    });
  });
  it("drops an out-of-range optional field instead of rejecting the call", () => {
    expect(
      decideOfferToolCall(
        call({ dish: "Chili", servings: 99, spice: "extreme", time: "quick" }),
        null,
      ),
    ).toEqual({
      kind: "offer",
      dish: "Chili",
      details: { time: "quick", ingredients: [], fromConversation: false },
    });
  });
  it("repeat = yes: same dish on a live offer → adjust", () => {
    const latest = buildOfferBlock("Spaghetti & meatballs", empty, F0);
    const d = decideOfferToolCall(
      call({ dish: "spaghetti and meatballs" }),
      latest,
    );
    expect(d).toEqual({ kind: "adjust", flow: latest.flow });
  });
  it("different dish while an offer is live → a fresh offer", () => {
    const latest = buildOfferBlock("Spaghetti", empty, F0);
    expect(
      decideOfferToolCall(call({ dish: "Salmon bowl" }), latest).kind,
    ).toBe("offer");
  });
  it("same dish while its card is live → repost that card", () => {
    const card = cardFor("Chili", 8);
    expect(decideOfferToolCall(call({ dish: "chili" }), card)).toEqual({
      kind: "repost_adjust",
      block: card,
    });
  });
  it("different dish while a card is live → a fresh offer", () => {
    expect(
      decideOfferToolCall(call({ dish: "Salmon bowl" }), cardFor("Chili")).kind,
    ).toBe("offer");
  });
  it("no live block → a fresh offer, never adjust", () => {
    expect(decideOfferToolCall(call({ dish: "Spaghetti" }), null).kind).toBe(
      "offer",
    );
  });
  it("ingredients sanitized and capped", () => {
    const d = decideOfferToolCall(
      call({ dish: "Stir fry", ingredients: Array(20).fill("rice") }),
      null,
    );
    expect(d.kind === "offer" && d.details.ingredients.length).toBe(15);
  });
});

describe("buildOfferBlock", () => {
  it("result parses with the offer block schema", () => {
    const b = buildOfferBlock(
      "Stir fry",
      { servings: 4, ingredients: ["rice", "tofu"], fromConversation: true },
      F0,
    );
    expect(recipeOfferBlockSchema.safeParse(b).success).toBe(true);
    expect(b.flow.request).toBe("Stir fry for 4 with rice, tofu");
  });
});
