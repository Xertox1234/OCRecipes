import { describe, it, expect } from "vitest";
import {
  formatPeopleCount,
  triedBarCaption,
  triedButtonLabel,
  triedButtonA11yLabel,
  triedRowValue,
  favouritedRowValue,
  variantsRowValue,
  applyTriedOptimistic,
} from "../recipe-community-stats-utils";

const base = {
  triedCount: 2,
  triedByMe: false,
  favouritedCount: 0,
  variantCount: 0,
};

describe("recipe-community-stats-utils", () => {
  it("formatPeopleCount pluralises", () => {
    expect(formatPeopleCount(1)).toBe("1 person");
    expect(formatPeopleCount(12)).toBe("12 people");
  });

  it("triedBarCaption", () => {
    expect(triedBarCaption(0)).toBe("Be the first to try it");
    expect(triedBarCaption(1)).toBe("1 person tried this");
    expect(triedBarCaption(12)).toBe("12 people tried this");
  });

  it("triedButtonLabel", () => {
    expect(triedButtonLabel(false)).toBe("I tried it");
    expect(triedButtonLabel(true)).toBe("Tried");
  });

  it("triedButtonA11yLabel", () => {
    expect(triedButtonA11yLabel(0)).toBe(
      "I tried it, no one has tried this yet",
    );
    expect(triedButtonA11yLabel(1)).toBe("I tried it, 1 person tried this");
    expect(triedButtonA11yLabel(12)).toBe("I tried it, 12 people tried this");
  });

  it("row values turn zero into invitations", () => {
    expect(triedRowValue(0)).toBe("Be the first");
    expect(triedRowValue(3)).toBe("3 people");
    expect(favouritedRowValue(0)).toBe("Not yet");
    expect(favouritedRowValue(1)).toBe("1 person");
    expect(variantsRowValue(0)).toBe("Remix it");
    expect(variantsRowValue(3)).toBe("3");
  });

  describe("applyTriedOptimistic", () => {
    it("marks: +1 and triedByMe", () => {
      expect(applyTriedOptimistic(base, true)).toEqual({
        ...base,
        triedCount: 3,
        triedByMe: true,
      });
    });

    it("unmarks: -1", () => {
      expect(applyTriedOptimistic({ ...base, triedByMe: true }, false)).toEqual(
        { ...base, triedCount: 1, triedByMe: false },
      );
    });

    it("is idempotent when already in the target state", () => {
      expect(applyTriedOptimistic(base, false)).toBe(base);
      const tried = { ...base, triedByMe: true };
      expect(applyTriedOptimistic(tried, true)).toBe(tried);
    });

    it("never goes below zero", () => {
      expect(
        applyTriedOptimistic({ ...base, triedCount: 0, triedByMe: true }, false)
          .triedCount,
      ).toBe(0);
    });
  });
});
