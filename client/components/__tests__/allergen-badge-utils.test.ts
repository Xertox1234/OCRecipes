import { describe, it, expect } from "vitest";
import { getAllergenBadgeVisuals } from "../allergen-badge-utils";

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
});
