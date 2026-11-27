import { describe, expect, it } from "vitest";
import { runCoachProChecks } from "../lib/coach-pro-checks";

const reply = {
  toolCalls: [
    { name: "lookup_nutrition", args: { query: "egg" } },
    { name: "log_food_item", args: { food: "boiled egg", count: 2 } },
  ],
  blockTypes: ["quick_replies"],
  proposals: [{ kind: "food", args: {} }],
};

describe("runCoachProChecks (audit 2026-11-24, M30)", () => {
  it("passes when every check holds", () => {
    expect(
      runCoachProChecks(reply, {
        expectTools: ["log_food_item"],
        forbidTools: ["add_to_grocery_list"],
        toolArgs: { log_food_item: { food: "egg", count: "^2$" } },
        expectBlocks: ["quick_replies"],
        forbidBlocks: ["recipe_offer"],
        expectProposal: "food",
      }),
    ).toEqual([]);
  });

  it("reports each failed check", () => {
    const failures = runCoachProChecks(reply, {
      expectTools: ["add_to_meal_plan"],
      forbidTools: ["lookup_nutrition"],
      toolArgs: { log_food_item: { count: "^3$" } },
      expectBlocks: ["progress"],
      forbidBlocks: ["quick_replies"],
      expectProposal: "grocery",
    });
    expect(failures).toEqual([
      "expected a add_to_meal_plan call; calls: lookup_nutrition, log_food_item",
      "forbidden tool was called: lookup_nutrition",
      'log_food_item.count = "2" does not match /^3$/',
      "expected a progress block; blocks: quick_replies",
      "forbidden block shown: quick_replies",
      "expected a grocery card; cards: food",
    ]);
  });

  it("checks a tool's args only when that tool was called", () => {
    expect(
      runCoachProChecks(reply, {
        toolArgs: { add_to_grocery_list: { x: "y" } },
      }),
    ).toEqual(["toolArgs: add_to_grocery_list was not called"]);
  });

  it("forbidProposal fails when any card was proposed", () => {
    expect(runCoachProChecks(reply, { forbidProposal: true })).toEqual([
      "expected no card; cards: food",
    ]);
  });

  it("expectOffer checks the recipe offer both ways", () => {
    expect(runCoachProChecks(reply, { expectOffer: true })).toEqual([
      "expected an offer_recipe call",
    ]);
    expect(
      runCoachProChecks(
        { ...reply, offer: { dish: "x" } },
        { expectOffer: false },
      ),
    ).toEqual(["offer_recipe was called but should not be"]);
  });

  it("no checks means no failures", () => {
    expect(runCoachProChecks(reply, undefined)).toEqual([]);
  });
});
