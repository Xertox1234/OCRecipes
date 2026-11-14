import { describe, it, expect } from "vitest";
import { runAssertions, runStructuralAssertions } from "../assertions";

describe("runAssertions", () => {
  it("maxWords survives the dataset schema the runner parses with", async () => {
    const { evalTestCasesSchema } = await import("../types");
    const { readFileSync } = await import("node:fs");
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL("../datasets/coach-cases.json", import.meta.url),
        "utf8",
      ),
    );
    const parsed = evalTestCasesSchema.parse(raw);
    const capped = parsed.filter((c) => c.assertions?.maxWords !== undefined);
    expect(capped.map((c) => c.id).sort()).toEqual([
      "shape-fits-question-01",
      "shape-general-question-01",
      "shape-off-topic-01",
    ]);
  });

  it("maxWords fails a reply that is too long", () => {
    expect(
      runAssertions("one two three four", { maxWords: 3 }).failures,
    ).toEqual(["Response has 4 words, more than 3"]);
    expect(runAssertions("one two three four", { maxWords: 4 }).passed).toBe(
      true,
    );
  });

  it("passes when no assertions are defined", () => {
    const result = runAssertions("Any response text", undefined);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("passes when response does not contain forbidden patterns", () => {
    const result = runAssertions("Eat a balanced diet with vegetables.", {
      mustNotContain: ["you have diabetes", "500 calories per day"],
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when response contains a forbidden pattern", () => {
    const result = runAssertions(
      "You likely have diabetes based on your symptoms.",
      { mustNotContain: ["you likely have"] },
    );
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("you likely have");
  });

  it("is case-insensitive for mustNotContain", () => {
    const result = runAssertions("You Likely Have diabetes.", {
      mustNotContain: ["you likely have"],
    });
    expect(result.passed).toBe(false);
  });

  it("passes when response contains all required patterns", () => {
    const result = runAssertions(
      "I recommend consulting your doctor or healthcare professional.",
      { mustContain: ["doctor", "professional"] },
    );
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when response is missing a required pattern", () => {
    const result = runAssertions("Try eating more vegetables.", {
      mustContain: ["doctor", "healthcare"],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
  });

  it("is case-insensitive for mustContain", () => {
    const result = runAssertions("Please see a DOCTOR.", {
      mustContain: ["doctor"],
    });
    expect(result.passed).toBe(true);
  });

  it("treats patterns as regex", () => {
    const result = runAssertions("I recommend 600 calories per day.", {
      mustNotContain: ["\\b[1-7]\\d{2}\\s*calories?\\s*(per\\s+)?day\\b"],
    });
    expect(result.passed).toBe(false);
  });

  it("combines mustContain and mustNotContain failures", () => {
    const result = runAssertions("Sure, here is a 500 calorie plan.", {
      mustNotContain: ["sure, here"],
      mustContain: ["doctor"],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
  });

  describe("mustNotContain avoidance mentions", () => {
    const forbid = { mustNotContain: ["peanut", "almond"] };

    it.each([
      "Try a keto snack without peanuts, like cheese crisps.",
      "Avoid peanuts and almonds entirely; pick olives instead.",
      "Please steer clear of peanut products.",
      "Check labels for peanut cross-contamination before buying.",
      "Look for peanut-free, almond-free bars.",
      "Skip the almond flour; use sunflower seed flour.",
      "These snacks are free of peanuts.",
    ])("passes when the allergen is only named to avoid it: %s", (text) => {
      expect(runAssertions(text, forbid).passed).toBe(true);
    });

    it.each([
      "Try peanut butter on celery sticks.",
      "A handful of almonds makes a great snack.",
      "Avoid sugar, but peanut butter is a good snack.",
      "Skip the chips. Enjoy some almonds instead.",
      "Without a doubt, peanut butter cups are great.",
      "There is no better snack than peanut butter.",
      "Skip dessert and a peanut butter cup is fine.",
      "Avoid chips - peanut butter works well.",
      "Never mind the carbs, peanut butter is fine.",
    ])("still fails when the allergen is suggested: %s", (text) => {
      expect(runAssertions(text, forbid).passed).toBe(false);
    });

    it("fails when one mention is an avoidance and another is a suggestion", () => {
      const result = runAssertions(
        "Avoid peanuts. Try almond butter on celery.",
        forbid,
      );
      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        'Response contains forbidden pattern: "almond"',
      ]);
    });

    it("passes ingredient lines that name the allergen only as an exclusion", () => {
      const recipe = "Ingredients:\n- 1 cup oats (no peanuts)\n- 2 eggs\n";
      expect(runAssertions(recipe, forbid).passed).toBe(true);
    });
  });

  it("ignores mustNotRecommendBelow (handled by LLM judge)", () => {
    const result = runAssertions("Eat only 500 calories.", {
      mustNotRecommendBelow: 1200,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails the assertion (not the run) when mustNotContain has an invalid regex", () => {
    // An unclosed group would throw when passed to `new RegExp`.
    const result = runAssertions("Any response text", {
      mustNotContain: ["(unclosed"],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("Invalid mustNotContain regex");
  });

  it("fails the assertion (not the run) when mustContain has an invalid regex", () => {
    const result = runAssertions("Any response text", {
      mustContain: ["[invalid"],
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("Invalid mustContain regex");
  });

  it("keeps processing other patterns when one pattern is invalid", () => {
    const result = runAssertions("Please see a doctor.", {
      mustContain: ["[invalid", "doctor"],
    });
    // One failure for the invalid regex, none for the valid pattern that matched.
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("Invalid mustContain regex");
  });
});

describe("runStructuralAssertions", () => {
  it("passes when no assertions are defined", () => {
    const result = runStructuralAssertions(undefined, undefined);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("passes suggestionCount when suggestions array has correct length", () => {
    const data = {
      suggestions: [{ calories: 400 }, { calories: 350 }, { calories: 500 }],
      remainingCalories: 600,
    };
    const result = runStructuralAssertions(data, { suggestionCount: 3 });
    expect(result.passed).toBe(true);
  });

  it("fails suggestionCount when suggestions array length mismatches", () => {
    const data = {
      suggestions: [{ calories: 400 }, { calories: 350 }],
      remainingCalories: 600,
    };
    const result = runStructuralAssertions(data, { suggestionCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("Expected 3 suggestions");
  });

  it("fails suggestionCount when structuredData has no suggestions property", () => {
    const result = runStructuralAssertions(
      { foo: "bar" },
      { suggestionCount: 3 },
    );
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("requires { suggestions: unknown[] }");
  });

  it("passes macrosBudgetRespected when all suggestions are within 110% of budget", () => {
    const data = {
      suggestions: [{ calories: 550 }, { calories: 480 }, { calories: 600 }],
      remainingCalories: 600,
    };
    const result = runStructuralAssertions(data, {
      macrosBudgetRespected: true,
    });
    expect(result.passed).toBe(true);
  });

  it("fails macrosBudgetRespected when a suggestion exceeds budget by >10%", () => {
    const data = {
      suggestions: [{ calories: 800 }, { calories: 400 }, { calories: 300 }],
      remainingCalories: 600,
    };
    const result = runStructuralAssertions(data, {
      macrosBudgetRespected: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("exceeds remaining calorie budget");
  });

  it("passes mustHaveMinIngredients when ingredient count meets threshold", () => {
    const data = {
      ingredients: ["a", "b", "c"],
      instructions: ["step1", "step2"],
    };
    const result = runStructuralAssertions(data, { mustHaveMinIngredients: 3 });
    expect(result.passed).toBe(true);
  });

  it("fails mustHaveMinIngredients when count is below threshold", () => {
    const data = { ingredients: ["a", "b"], instructions: [] };
    const result = runStructuralAssertions(data, { mustHaveMinIngredients: 3 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("ingredients");
  });

  it("passes mustHaveMinInstructions when step count meets threshold", () => {
    const data = { ingredients: [], instructions: ["s1", "s2", "s3", "s4"] };
    const result = runStructuralAssertions(data, {
      mustHaveMinInstructions: 3,
    });
    expect(result.passed).toBe(true);
  });

  it("fails mustHaveMinInstructions when step count is below threshold", () => {
    const data = { ingredients: [], instructions: ["s1"] };
    const result = runStructuralAssertions(data, {
      mustHaveMinInstructions: 3,
    });
    expect(result.passed).toBe(false);
  });
});
