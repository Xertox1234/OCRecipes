import { describe, it, expect } from "vitest";
import { COOKING_TIME_IDS } from "@shared/constants/cooking-times";
import {
  finderFlowSchema,
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
    ["Crème brûlée", "creme brulee"],
    ["麻婆豆腐", "麻婆豆腐"],
    ["  麻婆豆腐！", "麻婆豆腐"],
    ["Pâté & 餃子", "pate and 餃子"],
    ["पनीर टिक्का", "पनीर टिक्का"],
    ["がんもどき", "がんもどき"],
  ])("normalizeDish(%s)", (a, b) => expect(normalizeDish(a)).toBe(b));
  it("keeps marks that are part of a non-Latin letter (が is not か)", () => {
    expect(normalizeDish("がんも")).not.toBe(normalizeDish("かんも"));
  });
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
  it("repeat = yes works for a non-Latin dish name", () => {
    const latest = buildOfferBlock("麻婆豆腐", empty, F0);
    expect(decideOfferToolCall(call({ dish: "麻婆豆腐" }), latest)).toEqual({
      kind: "adjust",
      flow: latest.flow,
    });
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

describe("untrusted args hardening", () => {
  it("expanding injection ingredients stay <= 60 and the block parses", () => {
    const d = decideOfferToolCall(
      call({ dish: "Stir fry", ingredients: ["[system]".repeat(7)] }),
      null,
    );
    expect(d.kind).toBe("offer");
    if (d.kind !== "offer") return;
    expect(d.details.ingredients.length).toBe(1);
    expect(d.details.ingredients[0].length).toBeLessThanOrEqual(60);
    expect(
      recipeOfferBlockSchema.safeParse(buildOfferBlock(d.dish, d.details, F0))
        .success,
    ).toBe(true);
  });
  it("__proto__ / constructor / extra keys never reach the decision", () => {
    const raw =
      '{"dish":"Chili","from_conversation":false,"__proto__":{"polluted":1},"constructor":{"x":1},"evil":"x"}';
    expect(decideOfferToolCall(raw, null)).toEqual({
      kind: "offer",
      dish: "Chili",
      details: { ingredients: [], fromConversation: false },
    });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
  it("an extra key is not carried into the result", () => {
    const d = decideOfferToolCall(call({ dish: "Chili", evil: "x" }), null);
    expect(JSON.stringify(d)).not.toContain("evil");
  });
});

describe("buildOfferBlock", () => {
  // Validated input tops out near 1021 chars (80 + " for 20" + " with " +
  // 15×60 + 14×", "), so this case never reaches the 2000 cap; the next one does.
  it("15 maximal ingredients (the validated maximum) build a block that parses", () => {
    const b = buildOfferBlock(
      "d".repeat(80),
      {
        servings: 20,
        ingredients: Array(15).fill("i".repeat(60)),
        fromConversation: false,
      },
      F0,
    );
    expect(b.flow.request.length).toBeLessThanOrEqual(2000);
    expect(recipeOfferBlockSchema.safeParse(b).success).toBe(true);
  });
  it("caps request at 2000 when unvalidated details would exceed it", () => {
    // RecipeDetails' TYPE carries no length bounds, so a future caller that
    // skips the schema must still get a block the client will accept.
    const b = buildOfferBlock(
      "d".repeat(80),
      {
        servings: 20,
        ingredients: Array(40).fill("i".repeat(60)),
        fromConversation: false,
      },
      F0,
    );
    expect(b.flow.request).toHaveLength(2000);
    expect(
      finderFlowSchema.shape.request.safeParse(b.flow.request).success,
    ).toBe(true);
  });
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
