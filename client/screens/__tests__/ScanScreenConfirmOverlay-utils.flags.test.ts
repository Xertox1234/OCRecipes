import { describe, it, expect } from "vitest";
import { buildLoadedConfirmCard } from "@/screens/ScanScreenConfirmOverlay-utils";

describe("buildLoadedConfirmCard — safety flag", () => {
  it("carries the top safety flag from the response onto the card", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Trail Mix",
      calories: 210,
      flags: [
        {
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Tree Nuts",
        },
      ],
    });
    expect(card.safetyFlag?.title).toBe("Contains Tree Nuts");
  });

  it("leaves safetyFlag undefined when there are no flags", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Water",
      calories: 0,
    });
    expect(card.safetyFlag).toBeUndefined();
  });

  // Confirm-card parity (Smart Scan v1 refinements follow-up): this overlay
  // must surface the same top flag as the scan-lock chip (ProductChip), not
  // just safety-tier flags — previously it diverged from `fetchProductInfo`'s
  // topFlag composition and never showed a warn-level nutrition flag here.
  it("falls back to a warn-level nutrition flag when there is no safety flag, matching the scan-lock chip", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Soda",
      calories: 150,
      flags: [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          title: "High in sugar",
        },
      ],
    });
    expect(card.safetyFlag?.title).toBe("High in sugar");
  });

  it("still prefers a safety flag over a warn-level nutrition flag", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Trail Mix",
      calories: 210,
      flags: [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          title: "High in sugar",
        },
        {
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "info",
          tier: "safety",
          title: "Contains Tree Nuts",
        },
      ],
    });
    expect(card.safetyFlag?.title).toBe("Contains Tree Nuts");
  });

  it("never surfaces an info-severity nutrition flag", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Cola",
      calories: 140,
      flags: [
        {
          id: "nutrient:caffeine",
          kind: "nutrient",
          severity: "info",
          tier: "nutrition",
          title: "Contains caffeine",
        },
      ],
    });
    expect(card.safetyFlag).toBeUndefined();
  });
});
