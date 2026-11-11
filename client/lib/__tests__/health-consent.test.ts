import { describe, it, expect } from "vitest";

import {
  HEALTH_CONSENT_PROMPT,
  WITHDRAW_HEALTH_CONSENT_PROMPT,
  hasConsented,
  needsHealthConsent,
} from "../health-consent";

describe("hasConsented", () => {
  it("is false before the profile loads and for a profile with no consent", () => {
    expect(hasConsented(undefined)).toBe(false);
    expect(hasConsented(null)).toBe(false);
    expect(hasConsented({ healthDataConsentAt: null })).toBe(false);
    expect(hasConsented({})).toBe(false);
  });

  it("is true once the server has stamped a consent", () => {
    expect(hasConsented({ healthDataConsentAt: "2026-11-10T00:00:00Z" })).toBe(
      true,
    );
  });
});

describe("needsHealthConsent", () => {
  const unconsented = { healthDataConsentAt: null };
  const consented = { healthDataConsentAt: "2026-11-10T00:00:00Z" };

  it("asks when an unconsented user is about to save a health detail", () => {
    expect(
      needsHealthConsent(unconsented, {
        allergies: [{ name: "peanuts", severity: "severe" }],
      }),
    ).toBe(true);
    expect(needsHealthConsent(null, { primaryGoal: "lose_weight" })).toBe(true);
  });

  it("does not ask for preferences or cleared health fields", () => {
    expect(
      needsHealthConsent(unconsented, {
        allergies: [],
        healthConditions: [],
        primaryGoal: null,
        activityLevel: null,
        dietType: "vegan",
        foodDislikes: ["olives"],
      }),
    ).toBe(false);
  });

  it("never asks a user who already consented", () => {
    expect(
      needsHealthConsent(consented, { healthConditions: ["type 2 diabetes"] }),
    ).toBe(false);
  });
});

describe("consent prompts", () => {
  it("the consent prompt says what is collected and why", () => {
    expect(HEALTH_CONSENT_PROMPT.message).toMatch(/allergies/i);
    expect(HEALTH_CONSENT_PROMPT.message).toMatch(/never sold/i);
    expect(HEALTH_CONSENT_PROMPT.confirmLabel).toBe("Agree");
  });

  it("the withdrawal prompt says what is removed and is destructive", () => {
    expect(WITHDRAW_HEALTH_CONSENT_PROMPT.message).toMatch(/allergies/i);
    expect(WITHDRAW_HEALTH_CONSENT_PROMPT.destructive).toBe(true);
  });
});
