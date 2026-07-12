import { describe, it, expect, vi } from "vitest";
import { formatContextSummary } from "../judge";
import type { CoachContext } from "../../server/services/nutrition-coach";

// ../judge value-imports formatAboutUserLines from nutrition-coach.ts, whose
// coach-tools import chains to server/storage → server/db.ts, which throws at
// module load when DATABASE_URL is unset. Mock the collaborator so this pure
// formatter test needs no database. getToolDefinitions must return an array:
// nutrition-coach.ts runs Object.freeze(getToolDefinitions()) at module scope.
vi.mock("../../server/services/coach-tools", () => ({
  getToolDefinitions: () => [],
  executeToolCall: vi.fn(),
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
  serviceUnavailable: vi.fn(),
}));

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
