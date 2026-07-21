import { describe, it, expect } from "vitest";
import { pickTopSafetyFlag, type ScanFlag } from "@shared/types/scan-flags";

const flag = (over: Partial<ScanFlag>): ScanFlag => ({
  id: "x",
  kind: "allergen",
  severity: "info",
  tier: "safety",
  title: "t",
  ...over,
});

describe("pickTopSafetyFlag", () => {
  it("returns the highest-severity safety flag (danger > warn > info)", () => {
    const flags = [
      flag({ severity: "info" }),
      flag({ severity: "danger" }),
      flag({ severity: "warn" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("danger");
  });

  it("ignores non-safety (insight) flags", () => {
    const flags = [
      flag({ severity: "danger", tier: "insight" }),
      flag({ severity: "info", tier: "safety" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("info");
  });

  it("returns undefined when there are no safety flags", () => {
    expect(pickTopSafetyFlag([])).toBeUndefined();
    expect(pickTopSafetyFlag([flag({ tier: "insight" })])).toBeUndefined();
  });
});
