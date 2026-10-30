import { describe, it, expect } from "vitest";
import {
  isIntentOptionLocked,
  isScanIntent,
  isScanIntentLocked,
  getPhotoIntentDestination,
} from "../photo-intent-utils";

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

describe("isScanIntent", () => {
  it("accepts every PhotoIntent and cook", () => {
    for (const v of [
      "log",
      "identify",
      "recipe",
      "calories",
      "menu",
      "label",
      "cook",
    ]) {
      expect(isScanIntent(v)).toBe(true);
    }
  });

  it("rejects unknown values, arrays and non-strings", () => {
    expect(isScanIntent("admin")).toBe(false);
    expect(isScanIntent(["menu", "log"])).toBe(false);
    expect(isScanIntent(undefined)).toBe(false);
    expect(isScanIntent(3)).toBe(false);
  });
});

describe("isScanIntentLocked", () => {
  it("locks premium intents the user lacks and never locks free ones", () => {
    const f = feats({ menuScanner: false, cookAndTrack: false });
    expect(isScanIntentLocked("menu", f, true)).toBe(true);
    expect(isScanIntentLocked("cook", f, true)).toBe(true);
    expect(isScanIntentLocked("recipe", f, false)).toBe(true);
    expect(isScanIntentLocked("recipe", f, true)).toBe(false);
    expect(isScanIntentLocked("log", f, false)).toBe(false);
  });
});

describe("getPhotoIntentDestination", () => {
  it("keeps the picked intent when there is no photo yet", () => {
    expect(getPhotoIntentDestination("menu", undefined)).toEqual({
      screen: "Scan",
      params: { intent: "menu" },
    });
    expect(getPhotoIntentDestination("recipe", undefined)).toEqual({
      screen: "Scan",
      params: { intent: "recipe" },
    });
    expect(getPhotoIntentDestination("cook", undefined)).toEqual({
      screen: "Scan",
      params: { intent: "cook" },
    });
  });

  it("reuses label mode for the label intent without a photo", () => {
    expect(getPhotoIntentDestination("label", undefined)).toEqual({
      screen: "Scan",
      params: { mode: "label" },
    });
  });

  it("routes with a photo", () => {
    expect(getPhotoIntentDestination("menu", "file://a")).toEqual({
      screen: "MenuScanResult",
      params: { imageUri: "file://a" },
    });
    expect(getPhotoIntentDestination("recipe", "file://a")).toEqual({
      screen: "PhotoAnalysis",
      params: { imageUri: "file://a", intent: "recipe" },
    });
    expect(getPhotoIntentDestination("label", "file://a")).toEqual({
      screen: "LabelAnalysis",
      params: { imageUri: "file://a" },
    });
    expect(getPhotoIntentDestination("cook", "file://a")).toEqual({
      screen: "CookSessionCapture",
      params: { initialPhotoUri: "file://a" },
    });
  });
});
