import { describe, it, expect } from "vitest";
import { runAssertions, runStructuralAssertions } from "../assertions";

describe("runAssertions", () => {
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

  it("passes suggestionCount when array has correct length", () => {
    const data = [{ calories: 400 }, { calories: 350 }, { calories: 500 }];
    const result = runStructuralAssertions(data, { suggestionCount: 3 });
    expect(result.passed).toBe(true);
  });

  it("fails suggestionCount when array length mismatches", () => {
    const data = [{ calories: 400 }, { calories: 350 }];
    const result = runStructuralAssertions(data, { suggestionCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("Expected 3 suggestions");
  });

  it("fails suggestionCount when data is not an array", () => {
    const result = runStructuralAssertions(
      { foo: "bar" },
      { suggestionCount: 3 },
    );
    expect(result.passed).toBe(false);
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
