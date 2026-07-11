import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { evalTestCaseSchema, evalTestCasesSchema } from "../types";

/** Minimal valid context shared by all test-case fixtures. */
const validContext = {
  goals: { calories: 2000, protein: 120, carbs: 250, fat: 65 },
  todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
};

describe("evalTestCaseSchema", () => {
  it("accepts a minimal valid test case", () => {
    const parsed = evalTestCaseSchema.parse({
      id: "case-1",
      category: "safety",
      description: "A description",
      userMessage: "hello",
      context: validContext,
    });
    expect(parsed.id).toBe("case-1");
    expect(parsed.category).toBe("safety");
  });

  it("rejects unknown categories", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "tone", // not an allowed category
      description: "",
      userMessage: "hello",
      context: validContext,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty id", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty userMessage", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "",
      context: validContext,
    });
    expect(result.success).toBe(false);
  });

  it("allows assertions with mustNotContain, mustContain, mustNotRecommendBelow", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
      assertions: {
        mustNotContain: ["bad"],
        mustContain: ["good"],
        mustNotRecommendBelow: 1200,
      },
    });
    expect(result.success).toBe(true);
  });

  it("allows scoreDimensions as an open string array (supports multiple suites)", () => {
    // Coach dimensions
    const coach = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
      scoreDimensions: ["safety", "tone"],
    });
    expect(coach.success).toBe(true);

    // Non-coach dimensions are now valid (recipe-chat, meal-suggestions, etc.)
    const recipeChatDimensions = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
      scoreDimensions: ["relevance", "recipe_quality", "dietary_compliance"],
    });
    expect(recipeChatDimensions.success).toBe(true);
  });

  it("allows optional context fields (screenContext, notebookSummary)", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        screenContext: "home",
        notebookSummary: "summary",
      },
    });
    expect(result.success).toBe(true);
  });

  it("requires goals shape when not null", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        goals: { calories: 2000 }, // missing macros
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts 'creativity' as a valid category", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "rg-creative-1",
      category: "creativity",
      description: "creative recipe",
      userMessage: "give me something unusual",
      context: validContext,
    });
    expect(result.success).toBe(true);
  });

  it("allows null goals (new user with no goals)", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "edge-case",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        goals: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts object allergies with severity and normalizes legacy string allergies", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "personalization",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        dietaryProfile: {
          dietType: null,
          allergies: ["peanuts", { name: "dairy", severity: "severe" }],
          dislikes: [],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.context.dietaryProfile.allergies).toEqual([
        { name: "peanuts" },
        { name: "dairy", severity: "severe" },
      ]);
    }
  });

  it("rejects an unknown allergy severity", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "personalization",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        dietaryProfile: {
          dietType: null,
          allergies: [{ name: "dairy", severity: "spicy" }],
          dislikes: [],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it("allows the optional aboutUser context block", () => {
    const result = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "personalization",
      description: "",
      userMessage: "hello",
      context: {
        ...validContext,
        aboutUser: {
          primaryGoal: "lose_weight",
          cuisinePreferences: ["Thai"],
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "under_30_min",
          weightKg: 82.5,
          goalWeightKg: 75,
          measurementUnit: "metric",
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("evalTestCasesSchema (real dataset)", () => {
  it("validates the shipped coach-cases.json dataset", () => {
    const datasetPath = path.join(
      __dirname,
      "..",
      "datasets",
      "coach-cases.json",
    );
    const raw = fs.readFileSync(datasetPath, "utf8");
    const parsed = JSON.parse(raw);
    const result = evalTestCasesSchema.safeParse(parsed);
    if (!result.success) {
      // Surface the first issue so a dataset error is easy to debug.
      const issue = result.error.errors[0];
      throw new Error(
        `coach-cases.json failed validation at ${issue.path.join(".")}: ${issue.message}`,
      );
    }
    expect(result.data.length).toBeGreaterThan(0);
  });
});
