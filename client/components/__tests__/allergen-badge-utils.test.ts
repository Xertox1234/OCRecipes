import { describe, it, expect } from "vitest";
import {
  getAllergenBadgeLabel,
  getAllergenBannerMessage,
  getAllergenBadgeVisuals,
} from "../allergen-badge-utils";

describe("allergen-badge-utils", () => {
  describe("getAllergenBadgeVisuals", () => {
    it("returns the error token + alert-triangle icon for severe", () => {
      const visuals = getAllergenBadgeVisuals("severe");
      expect(visuals.colorKey).toBe("badgeErrorText");
      expect(visuals.icon).toBe("alert-triangle");
    });

    it("returns the warning token + alert-circle icon for moderate", () => {
      const visuals = getAllergenBadgeVisuals("moderate");
      expect(visuals.colorKey).toBe("badgeWarningText");
      expect(visuals.icon).toBe("alert-circle");
    });

    it("returns the info token + info icon for mild", () => {
      const visuals = getAllergenBadgeVisuals("mild");
      expect(visuals.colorKey).toBe("badgeInfoText");
      expect(visuals.icon).toBe("info");
    });
  });

  describe("getAllergenBadgeLabel", () => {
    it("keeps the severity wording for a definite match", () => {
      expect(getAllergenBadgeLabel("Milk", "severe", false)).toBe(
        "Severe allergen: Milk",
      );
      expect(getAllergenBadgeLabel("Milk", "moderate", undefined)).toBe(
        "Allergen: Milk",
      );
      expect(getAllergenBadgeLabel("Milk", "mild", false)).toBe(
        "Contains: Milk",
      );
    });
    it("says possible at every severity for a possible match", () => {
      for (const severity of ["mild", "moderate", "severe"] as const) {
        expect(getAllergenBadgeLabel("Milk", severity, true)).toBe(
          "Possible allergen: Milk",
        );
      }
    });
  });

  describe("getAllergenBannerMessage", () => {
    const m = (ingredientName: string, isPossible?: boolean) => ({
      ingredientName,
      isPossible,
    });
    it("keeps today's wording when every match is definite", () => {
      expect(getAllergenBannerMessage([m("flour", false)])).toBe(
        "1 ingredient contains your allergens",
      );
      expect(getAllergenBannerMessage([m("flour"), m("milk")])).toBe(
        "2 ingredients contain your allergens",
      );
    });
    it("says may contain when every match is possible", () => {
      expect(getAllergenBannerMessage([m("cookies", true)])).toBe(
        "1 ingredient may contain your allergens",
      );
      expect(
        getAllergenBannerMessage([m("cookies", true), m("pudding", true)]),
      ).toBe("2 ingredients may contain your allergens");
    });
    it("counts each kind when they are mixed", () => {
      expect(
        getAllergenBannerMessage([
          m("flour", false),
          m("milk", false),
          m("cookies", true),
        ]),
      ).toBe("2 ingredients contain your allergens, 1 more may contain them");
    });
    it("counts an ingredient with both kinds as definite", () => {
      expect(
        getAllergenBannerMessage([m("bagel", true), m("bagel", false)]),
      ).toBe("1 ingredient contains your allergens");
    });
  });
});
