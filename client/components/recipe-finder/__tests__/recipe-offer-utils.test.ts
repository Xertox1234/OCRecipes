import {
  finderActionSchema,
  type RecipeAdjustBlock,
} from "@shared/schemas/recipe-finder";
import {
  avoidingAccessibilityLabel,
  buildAdjustAction,
  clampServings,
  notedText,
  offerDisplayText,
  servingsAfterAccessibilityAction,
  timeLabel,
} from "../recipe-offer-utils";

const FLOW = "00000000-0000-4000-8000-000000000000";

const block: RecipeAdjustBlock = {
  type: "recipe_adjust",
  prefill: { servings: 8, spice: "mild", time: "moderate" },
  avoiding: ["peanuts", "shellfish"],
  noted: { dietType: "pescatarian", dislikes: ["olives"] },
  followUps: [
    { question: "Beef, pork, or a mix?", options: ["Beef", "Mix", "Pork"] },
    { question: "Sauce?", options: ["Marinara", "Arrabbiata"] },
  ],
  flow: {
    flowId: FLOW,
    stage: "adjust",
    request: "spaghetti and meatballs for 8",
    query: { q: "spaghetti and meatballs" },
    round: 0,
    shownIds: [],
    dish: "Spaghetti & meatballs",
  },
};

describe("clampServings", () => {
  it("keeps servings within 1..20", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(-3)).toBe(1);
    expect(clampServings(25)).toBe(20);
    expect(clampServings(8)).toBe(8);
  });

  it("rounds a fractional value", () => {
    expect(clampServings(2.6)).toBe(3);
  });
});

describe("timeLabel", () => {
  it("uses the shared cooking-time descriptions", () => {
    expect(timeLabel("quick")).toBe("Under 30 minutes");
    expect(timeLabel("moderate")).toBe("30-60 minutes");
    expect(timeLabel("leisurely")).toBe("1+ hours, no rush");
  });
});

describe("buildAdjustAction", () => {
  it("sends the settings and only the answered questions, verbatim", () => {
    const action = buildAdjustAction(block, {
      servings: 6,
      spice: "hot",
      time: "quick",
      answers: { "Beef, pork, or a mix?": "Mix" },
    });
    expect(action).toEqual({
      type: "adjust_generate",
      flowId: FLOW,
      settings: { servings: 6, spice: "hot", time: "quick" },
      answers: [{ question: "Beef, pork, or a mix?", answer: "Mix" }],
    });
    expect(finderActionSchema.safeParse(action).success).toBe(true);
  });

  it("leaves answers out entirely when none were chosen", () => {
    const action = buildAdjustAction(block, {
      servings: 8,
      spice: "mild",
      time: "moderate",
      answers: {},
    });
    expect("answers" in action).toBe(false);
    expect(finderActionSchema.safeParse(action).success).toBe(true);
  });

  it("drops answers that are not an offered question + option", () => {
    const action = buildAdjustAction(block, {
      servings: 8,
      spice: "mild",
      time: "moderate",
      answers: {
        "Sauce?": "Pesto",
        "Unknown question?": "Beef",
        "Beef, pork, or a mix?": "Beef",
      },
    });
    expect(action.answers).toEqual([
      { question: "Beef, pork, or a mix?", answer: "Beef" },
    ]);
    expect(finderActionSchema.safeParse(action).success).toBe(true);
  });

  it("clamps servings so the action always validates", () => {
    const action = buildAdjustAction(block, {
      servings: 40,
      spice: "medium",
      time: "leisurely",
      answers: {},
    });
    expect(action.settings?.servings).toBe(20);
    expect(finderActionSchema.safeParse(action).success).toBe(true);
  });
});

describe("offerDisplayText", () => {
  const OFFER =
    "I can make this into a recipe right here in the chat. Want me to get started?\nI can also search OCRecipes for something similar.";

  it("drops the old-client reply hint RecipeChef's text ends with", () => {
    expect(
      offerDisplayText(`${OFFER}\n\nReply "yes", "search", or "no".`),
    ).toBe(OFFER);
  });

  it("keeps Coach lead text and the offer copy as written", () => {
    const content = `Great choice for a crowd!\n\n${OFFER}`;
    expect(offerDisplayText(content)).toBe(content);
  });

  it("returns empty text for no content", () => {
    expect(offerDisplayText(undefined)).toBe("");
    expect(offerDisplayText("")).toBe("");
  });
});

describe("avoidingAccessibilityLabel", () => {
  it("names the allergies and where to change them", () => {
    expect(avoidingAccessibilityLabel(["peanuts", "shellfish"])).toBe(
      "Avoiding peanuts, shellfish. Change allergies in your profile.",
    );
  });
});

describe("notedText", () => {
  it("joins the diet and dislikes", () => {
    expect(notedText(block.noted)).toBe("Pescatarian · dislikes olives");
  });

  it("is null when there is nothing to note", () => {
    expect(notedText({ dislikes: [] })).toBeNull();
  });

  it("shows dislikes alone", () => {
    expect(notedText({ dislikes: ["olives", "anchovies"] })).toBe(
      "dislikes olives, anchovies",
    );
  });
});

describe("servingsAfterAccessibilityAction", () => {
  it("steps by one and stays in range", () => {
    expect(servingsAfterAccessibilityAction(8, "increment")).toBe(9);
    expect(servingsAfterAccessibilityAction(8, "decrement")).toBe(7);
    expect(servingsAfterAccessibilityAction(20, "increment")).toBe(20);
    expect(servingsAfterAccessibilityAction(1, "decrement")).toBe(1);
    expect(servingsAfterAccessibilityAction(8, "activate")).toBe(8);
  });
});
