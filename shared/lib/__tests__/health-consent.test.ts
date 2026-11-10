import { describe, it, expect } from "vitest";

import {
  HEALTH_CONSENT_VERSION,
  PROFILE_HEALTH_FIELDS,
  hasHealthData,
} from "../health-consent";

describe("hasHealthData", () => {
  it("is false for an empty object", () => {
    expect(hasHealthData({})).toBe(false);
  });

  it("is false for the empty defaults the onboarding skip path sends", () => {
    expect(
      hasHealthData({
        allergies: [],
        healthConditions: [],
        primaryGoal: null,
        activityLevel: null,
        glp1Mode: false,
        glp1Medication: null,
        glp1StartDate: null,
      }),
    ).toBe(false);
  });

  it("ignores preference fields that are not health data", () => {
    expect(
      hasHealthData({
        dietType: "vegan",
        foodDislikes: ["olives"],
        cuisinePreferences: ["thai"],
        householdSize: 4,
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "30min",
      }),
    ).toBe(false);
  });

  it.each([
    ["allergies", [{ name: "peanuts", severity: "severe" }]],
    ["healthConditions", ["type 2 diabetes"]],
    ["primaryGoal", "lose_weight"],
    ["activityLevel", "moderate"],
    ["glp1Mode", true],
    ["glp1Medication", "semaglutide"],
    ["glp1StartDate", new Date("2026-01-01")],
  ])("is true when %s carries a value", (field, value) => {
    expect(hasHealthData({ [field]: value })).toBe(true);
  });

  it("is false for a blank string", () => {
    expect(hasHealthData({ primaryGoal: "" })).toBe(false);
  });

  it("covers every listed profile health field", () => {
    expect([...PROFILE_HEALTH_FIELDS].sort()).toEqual(
      [
        "activityLevel",
        "allergies",
        "glp1Medication",
        "glp1Mode",
        "glp1StartDate",
        "healthConditions",
        "primaryGoal",
      ].sort(),
    );
  });

  it("carries the policy version the consent is recorded against", () => {
    expect(HEALTH_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
