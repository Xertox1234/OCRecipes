import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runAssertions } from "../assertions";
import type { EvalTestCase } from "../types";

// The dairy / vegan / multi-allergy forbidden-term patterns must not flag
// plant milks, non-dairy creams or nut/seed butters: every "pattern" failure
// in the 2026-10-17 recipe-generate model comparison was one of those
// (todos/P2-2026-10-17-recipe-eval-dairy-regex-plant-milk-false-positives.md).
// The patterns are an allowlist of KNOWN plant words — anything else before
// "milk" / "cream" / "butter" still fails.

const cases = JSON.parse(
  readFileSync(
    resolve(__dirname, "../datasets/recipe-generation-cases.json"),
    "utf8",
  ),
) as EvalTestCase[];

function assertionsOf(id: string): EvalTestCase["assertions"] {
  const found = cases.find((c) => c.id === id);
  if (!found) throw new Error(`case ${id} missing from the dataset`);
  return found.assertions;
}

/** A recipe response whose only ingredient lines are the given ones. */
function recipeWith(...ingredients: string[]): string {
  return [
    "Title: Test",
    "",
    "Ingredients:",
    ...ingredients.map((i) => `- ${i}`),
    "",
    "Instructions:",
    "1. Combine.",
  ].join("\n");
}

const DAIRY_CASES = [
  "recipe-gen-vegan-protein-01",
  "recipe-gen-dairy-free-dessert-06",
  "recipe-gen-multiple-allergies-08",
];

describe.each(DAIRY_CASES)("%s forbidden terms", (id) => {
  const assertions = assertionsOf(id);

  it.each([
    "1 cup unsweetened almond milk",
    "400 ml coconut milk, canned",
    "1 cup oat milk",
    "200 ml soy milk",
    "1/2 cup cashew cream",
    "1 can coconut cream, chilled",
    "2 tbsp natural peanut butter",
    "1 tbsp almond butter",
    "2 tbsp cocoa butter",
  ])("passes a compliant plant ingredient: %s", (line) => {
    const result = runAssertions(recipeWith(line), assertions);
    expect(result.failures).toEqual([]);
  });

  it.each([
    "1 cup whole milk",
    "1/2 cup heavy cream",
    "2 tbsp butter",
    "100 g milk chocolate",
    "1 cup milk",
    // Substring collisions: a plant word must match as a WORD, so "goat"
    // does not borrow "oat", "doughnut" does not borrow "nut".
    "1 cup goat milk",
    "2 tbsp goat cream",
    "1 doughnut milk glaze",
  ])("still fails a dairy ingredient: %s", (line) => {
    const result = runAssertions(recipeWith(line), assertions);
    expect(result.passed).toBe(false);
  });
});

describe("recipe-gen-nut-allergy-03 keeps flagging nut butters", () => {
  // The nut-allergy case's list is about NUTS; "peanut butter" must still fail
  // there — the plant-milk allowance above is per pattern, not global.
  it("fails on peanut butter and almond milk", () => {
    const assertions = assertionsOf("recipe-gen-nut-allergy-03");
    expect(
      runAssertions(recipeWith("2 tbsp peanut butter"), assertions).passed,
    ).toBe(false);
    expect(
      runAssertions(recipeWith("1 cup almond milk"), assertions).passed,
    ).toBe(false);
  });
});
