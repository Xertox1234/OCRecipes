import { describe, it, expect } from "vitest";

import { standoutCopy } from "../NutritionSummaryCard-utils";

describe("standoutCopy", () => {
  it("uses the spec's benefit copy verbatim", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "excellent",
        hasValue: true,
      }),
    ).toBe("Excellent source of fibre");
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "good",
        hasValue: true,
      }),
    ).toBe("Good source of fibre");
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "protein",
        band: "good",
        hasValue: true,
      }),
    ).toBe("Good source of protein");
  });

  it("names a zero benefit without implying it is good news", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "none",
        hasValue: true,
      }),
    ).toBe("No fibre");
  });

  it("distinguishes a promoted fibre row with NO recorded value", () => {
    // Rule 4 promotes fibre regardless of hasValue, so this state is reachable
    // and must not read as "no fibre".
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: false,
      }),
    ).toBe("Fibre not recorded");
  });

  it("distinguishes a known fibre value we cannot place on a scale", () => {
    expect(
      standoutCopy({
        group: "benefit",
        nutrient: "fibre",
        band: "unknown",
        hasValue: true,
      }),
    ).toBe("Fibre");
  });

  it("uses the concern copy for concern standouts", () => {
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "sugar",
        band: "high",
        hasValue: true,
      }),
    ).toBe("High in sugar");
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "saturatedFat",
        band: "medium",
        hasValue: true,
      }),
    ).toBe("Moderate saturated fat");
    expect(
      standoutCopy({
        group: "concern",
        nutrient: "sodium",
        band: "low",
        hasValue: true,
      }),
    ).toBe("Low in sodium");
  });
});
