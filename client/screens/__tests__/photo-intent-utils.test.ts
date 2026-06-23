import { describe, it, expect } from "vitest";
import { isIntentOptionLocked } from "../photo-intent-utils";

/** Convenience: both premium gates on by default, override per-test. */
const feats = (over?: { cookAndTrack?: boolean; menuScanner?: boolean }) => ({
  cookAndTrack: true,
  menuScanner: true,
  ...over,
});

describe("isIntentOptionLocked", () => {
  it("never locks a non-premium option, even with every feature off", () => {
    expect(
      isIntentOptionLocked(
        { intent: "log" },
        feats({ cookAndTrack: false, menuScanner: false }),
        false,
      ),
    ).toBe(false);
  });

  // Regression guard for the bug found in PR-A review: the menu intent was
  // gated on the recipe-generation quota (isRecipeAvailable) instead of
  // menuScanner, so a premium user out of recipe generations was wrongly
  // locked out of menu scanning.
  it("gates the menu intent on menuScanner, NOT the recipe-generation quota", () => {
    // menuScanner owned, recipe quota exhausted -> menu stays UNLOCKED
    expect(
      isIntentOptionLocked(
        { intent: "menu", requiresPremium: true },
        feats(),
        false,
      ),
    ).toBe(false);

    // menuScanner not owned -> locked (regardless of recipe quota)
    expect(
      isIntentOptionLocked(
        { intent: "menu", requiresPremium: true },
        feats({ menuScanner: false }),
        true,
      ),
    ).toBe(true);
  });

  it("gates the cook intent on cookAndTrack", () => {
    expect(
      isIntentOptionLocked(
        { intent: "cook", requiresPremium: true },
        feats({ cookAndTrack: false }),
        true,
      ),
    ).toBe(true);
    expect(
      isIntentOptionLocked(
        { intent: "cook", requiresPremium: true },
        feats({ cookAndTrack: true }),
        false,
      ),
    ).toBe(false);
  });

  it("gates the recipe intent on recipe-generation availability", () => {
    expect(
      isIntentOptionLocked(
        { intent: "recipe", requiresPremium: true },
        feats(),
        false,
      ),
    ).toBe(true);
    expect(
      isIntentOptionLocked(
        { intent: "recipe", requiresPremium: true },
        feats(),
        true,
      ),
    ).toBe(false);
  });
});
