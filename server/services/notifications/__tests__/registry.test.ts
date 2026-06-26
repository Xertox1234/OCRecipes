import { describe, it, expect } from "vitest";
import { NOTIFICATION_REGISTRY, getCategoryDef } from "../registry";

describe("notification registry", () => {
  it("commitment is governed, in-app + push, not capped (dated)", () => {
    const def = getCategoryDef("commitment");
    expect(def.lane).toBe("governed");
    expect(def.channels).toEqual(["in-app", "push"]);
    expect(def.countsAgainstCap).toBe(false);
  });

  it("daily-checkin and meal-log are ambient: in-app only, capped", () => {
    for (const key of ["daily-checkin", "meal-log"] as const) {
      const def = getCategoryDef(key);
      expect(def.lane).toBe("governed");
      expect(def.channels).toEqual(["in-app"]);
      expect(def.countsAgainstCap).toBe(true);
    }
  });

  it("registers exactly the three Phase 0 categories", () => {
    expect(Object.keys(NOTIFICATION_REGISTRY).sort()).toEqual([
      "commitment",
      "daily-checkin",
      "meal-log",
    ]);
  });
});
