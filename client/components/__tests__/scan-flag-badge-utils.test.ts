import { describe, it, expect } from "vitest";
import { getScanFlagBadgeVisuals } from "../scan-flag-badge-utils";

describe("scan-flag-badge-utils", () => {
  describe("getScanFlagBadgeVisuals", () => {
    it("returns the error token + alert-triangle icon for danger", () => {
      const visuals = getScanFlagBadgeVisuals("danger");
      expect(visuals.colorKey).toBe("badgeErrorText");
      expect(visuals.icon).toBe("alert-triangle");
    });

    it("returns the warning token + alert-circle icon for warn", () => {
      const visuals = getScanFlagBadgeVisuals("warn");
      expect(visuals.colorKey).toBe("badgeWarningText");
      expect(visuals.icon).toBe("alert-circle");
    });

    it("returns the info token + info icon for info", () => {
      const visuals = getScanFlagBadgeVisuals("info");
      expect(visuals.colorKey).toBe("badgeInfoText");
      expect(visuals.icon).toBe("info");
    });
  });
});
