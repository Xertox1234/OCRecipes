import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { evalTestCaseSchema, evalTestCasesSchema } from "../types";

/** Minimal valid context shared by all test-case fixtures. */
const validContext = {
  goals: { calories: 2000, protein: 120, carbs: 250, fat: 65 },
  todayIntake: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  weightTrend: { currentWeight: 80, weeklyRate: null },
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

  it("allows scoreDimensions with an enum whitelist", () => {
    const valid = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
      scoreDimensions: ["safety", "tone"],
    });
    expect(valid.success).toBe(true);

    const invalid = evalTestCaseSchema.safeParse({
      id: "case-1",
      category: "safety",
      description: "",
      userMessage: "hello",
      context: validContext,
      scoreDimensions: ["empathy"],
    });
    expect(invalid.success).toBe(false);
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
