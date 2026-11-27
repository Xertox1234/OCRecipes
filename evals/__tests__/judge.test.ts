import { describe, it, expect } from "vitest";
import { formatContextSummary } from "../judge";
import { resolveJudgeBackend } from "../lib/judge-generic";
import type { CoachContext } from "../../server/services/coach-prompt";

const BASE: CoachContext = {
  goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
  todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
  dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
};

describe("formatContextSummary", () => {
  it("renders the aboutUser block so the judge sees the personalization signal the model saw", () => {
    const out = formatContextSummary({
      ...BASE,
      aboutUser: {
        primaryGoal: "lose_weight",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "under_30_min",
        cuisinePreferences: ["Thai"],
        weightKg: 82.5,
        goalWeightKg: 75,
        measurementUnit: "metric",
      },
    });

    expect(out).toContain("ABOUT THIS USER:");
    expect(out).toContain("Primary goal: lose weight");
    expect(out).toContain("Cooking skill: beginner");
    expect(out).toContain("Cooking time available: under 30 min");
    expect(out).toContain("Favorite cuisines: Thai");
    expect(out).toContain("Weight: 82.5 kg (goal: 75 kg)");
  });

  it("shows every context section the model saw, with the same clock (audit 2026-11-24, M28)", () => {
    const out = formatContextSummary(
      {
        ...BASE,
        notebookSummary: "#5 commitment: meal prep on Sundays",
        screenContext: "Viewing recipe: Lentil soup",
        frequentFoodsSummary: "Greek yogurt (12x)",
        dueCommitmentsSummary: "#7 walk after dinner",
      },
      { now: new Date("2026-11-18T23:30:00Z"), tz: "America/Toronto" },
    );

    expect(out).toContain("#5 commitment: meal prep on Sundays");
    expect(out).toContain("Viewing recipe: Lentil soup");
    expect(out).toContain("Greek yogurt (12x)");
    expect(out).toContain("#7 walk after dinner");
    expect(out).toContain(
      "Current time for this user: Wednesday 2026-11-18 6:30 PM",
    );
    expect(out).toContain("Remaining today: 1200 cal");
    // The context only: no persona rules, no closing safety boundary.
    expect(out).not.toContain("You are NutriCoach");
    expect(out).not.toContain("USER CONTEXT:");
  });

  it("omits the aboutUser block when absent", () => {
    expect(formatContextSummary(BASE)).not.toContain("ABOUT THIS USER");
  });

  it("renders allergy severity like the coach prompt does", () => {
    const out = formatContextSummary({
      ...BASE,
      dietaryProfile: {
        dietType: null,
        allergies: [{ name: "peanuts", severity: "severe" }, { name: "soy" }],
        dislikes: [],
      },
    });

    expect(out).toContain("Allergies: peanuts (severe), soy");
  });
});

describe("resolveJudgeBackend", () => {
  it("EVAL_JUDGE_BACKEND=anthropic judges on Anthropic even with an OpenRouter key", () => {
    expect(
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        ANTHROPIC_API_KEY: "a",
        EVAL_JUDGE_BACKEND: "anthropic",
      }),
    ).toEqual({ kind: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("EVAL_JUDGE_BACKEND=anthropic without an Anthropic key is an error", () => {
    expect(() =>
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        EVAL_JUDGE_BACKEND: "anthropic",
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("prefers OpenRouter with the OpenRouter-form default", () => {
    expect(
      resolveJudgeBackend({ OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "a" }),
    ).toEqual({
      kind: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
    });
  });
  it("uses EVAL_JUDGE_MODEL as given on OpenRouter", () => {
    expect(
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        EVAL_JUDGE_MODEL: "anthropic/claude-sonnet-5",
      }),
    ).toEqual({ kind: "openrouter", model: "anthropic/claude-sonnet-5" });
  });
  it("rejects an Anthropic-style name on the OpenRouter path", () => {
    expect(() =>
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        EVAL_JUDGE_MODEL: "claude-sonnet-4-6",
      }),
    ).toThrow(/OpenRouter form, e.g. "anthropic\/claude-sonnet-4.6"/);
  });
  it("falls back to Anthropic direct with its default", () => {
    expect(resolveJudgeBackend({ ANTHROPIC_API_KEY: "a" })).toEqual({
      kind: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });
  it("throws when neither key is set", () => {
    expect(() => resolveJudgeBackend({})).toThrow(
      /OPENROUTER_API_KEY or ANTHROPIC_API_KEY/,
    );
  });
});
