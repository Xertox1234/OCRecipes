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
});
