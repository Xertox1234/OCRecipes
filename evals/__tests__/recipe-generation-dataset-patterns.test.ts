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
// "milk" / "cream" / "butter" still fails. The recipe-chat dataset carries
// the same patterns (same model comparison, 2026-10-18), so both datasets
// are checked here.

function loadCases(file: string): EvalTestCase[] {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../datasets", file), "utf8"),
  ) as EvalTestCase[];
}

const DATASETS = {
  "recipe-generation": loadCases("recipe-generation-cases.json"),
  "recipe-chat": loadCases("recipe-chat-cases.json"),
} as const;

function assertionsOf(
  dataset: keyof typeof DATASETS,
  id: string,
): EvalTestCase["assertions"] {
  const found = DATASETS[dataset].find((c) => c.id === id);
  if (!found) throw new Error(`case ${id} missing from ${dataset} dataset`);
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

const DAIRY_CASES: [keyof typeof DATASETS, string][] = [
  ["recipe-generation", "recipe-gen-vegan-protein-01"],
  ["recipe-generation", "recipe-gen-dairy-free-dessert-06"],
  ["recipe-generation", "recipe-gen-multiple-allergies-08"],
  ["recipe-chat", "recipe-chat-vegan-protein-03"],
  ["recipe-chat", "recipe-chat-dessert-dairy-free-08"],
];

describe.each(DAIRY_CASES)("%s %s forbidden terms", (dataset, id) => {
  const assertions = assertionsOf(dataset, id);

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

const VEGAN_CASES: [keyof typeof DATASETS, string][] = [
  ["recipe-generation", "recipe-gen-vegan-protein-01"],
  ["recipe-chat", "recipe-chat-vegan-protein-03"],
];

describe.each(VEGAN_CASES)("%s %s egg term", (dataset, id) => {
  const assertions = assertionsOf(dataset, id);

  it.each(["1 medium eggplant, cubed", "2 cups veggie broth"])(
    "passes a word that merely contains 'egg': %s",
    (line) => {
      expect(runAssertions(recipeWith(line), assertions).failures).toEqual([]);
    },
  );

  it.each(["2 eggs", "1 egg, beaten"])("still fails %s", (line) => {
    expect(runAssertions(recipeWith(line), assertions).passed).toBe(false);
  });
});

const LOW_CARB_CASES: [keyof typeof DATASETS, string][] = [
  ["recipe-generation", "recipe-gen-keto-04"],
  ["recipe-chat", "recipe-chat-low-carb-06"],
];

describe.each(LOW_CARB_CASES)("%s %s carb terms", (dataset, id) => {
  const assertions = assertionsOf(dataset, id);

  it.each([
    "2 cups cauliflower rice",
    "1/2 cup almond flour",
    "2 tbsp coconut flour",
  ])("passes a low-carb substitute: %s", (line) => {
    expect(runAssertions(recipeWith(line), assertions).failures).toEqual([]);
  });

  it.each(["1 cup white rice", "1 cup all-purpose flour", "2 slices bread"])(
    "still fails %s",
    (line) => {
      expect(runAssertions(recipeWith(line), assertions).passed).toBe(false);
    },
  );
});

describe("nut-allergy cases keep flagging nut butters", () => {
  // The nut-allergy lists are about NUTS; "peanut butter" must still fail
  // there — the plant-milk allowance above is per pattern, not global.
  it.each([
    ["recipe-generation", "recipe-gen-nut-allergy-03"],
    ["recipe-chat", "recipe-chat-nut-allergy-baking-12"],
  ] as [keyof typeof DATASETS, string][])(
    "%s %s fails on peanut butter and almond milk",
    (dataset, id) => {
      const assertions = assertionsOf(dataset, id);
      expect(
        runAssertions(recipeWith("2 tbsp peanut butter"), assertions).passed,
      ).toBe(false);
      expect(
        runAssertions(recipeWith("1 cup almond milk"), assertions).passed,
      ).toBe(false);
    },
  );
});
