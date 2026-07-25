import { describe, it, expect } from "vitest";
import {
  buildLoadedConfirmCard,
  getConfirmFlagPresentation,
} from "@/screens/ScanScreenConfirmOverlay-utils";
import type { ScanFlag } from "@shared/types/scan-flags";

describe("buildLoadedConfirmCard — top display flag", () => {
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
    expect(card.topDisplayFlag?.title).toBe("Contains Tree Nuts");
  });

  it("leaves topDisplayFlag undefined when there are no flags", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Water",
      calories: 0,
    });
    expect(card.topDisplayFlag).toBeUndefined();
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
    expect(card.topDisplayFlag?.title).toBe("High in sugar");
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
    expect(card.topDisplayFlag?.title).toBe("Contains Tree Nuts");
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
    expect(card.topDisplayFlag).toBeUndefined();
  });
});

describe("getConfirmFlagPresentation — tier-gated salience", () => {
  const flag = (
    tier: ScanFlag["tier"],
    severity: ScanFlag["severity"],
  ): ScanFlag => ({
    id: "x",
    kind: tier === "safety" ? "allergen" : "nutrient",
    severity,
    tier,
    title: "t",
  });

  // Safety-tier presentation is unchanged from the pre-parity behavior: the
  // badge originally rendered ONLY safety flags, always assertive + triangle.
  it("safety danger keeps the assertive live region, triangle icon, and error palette", () => {
    expect(getConfirmFlagPresentation(flag("safety", "danger"))).toEqual({
      liveRegion: "assertive",
      icon: "alert-triangle",
      colorKey: "error",
    });
  });

  it("safety warn (allergen-unavailable) keeps assertive + triangle with the warning palette", () => {
    expect(getConfirmFlagPresentation(flag("safety", "warn"))).toEqual({
      liveRegion: "assertive",
      icon: "alert-triangle",
      colorKey: "warning",
    });
  });

  it("safety info (mild allergen) keeps assertive + triangle with the info palette", () => {
    expect(getConfirmFlagPresentation(flag("safety", "info"))).toEqual({
      liveRegion: "assertive",
      icon: "alert-triangle",
      colorKey: "info",
    });
  });

  // Non-safety flags are informational heads-ups: polite (never an interrupting
  // TalkBack announcement) and never danger-shaped iconography — per the
  // assertive-polarity rule (assertive = errors/safety; polite = informational).
  it("nutrition warn gets polite live region, info icon, and warning palette", () => {
    expect(getConfirmFlagPresentation(flag("nutrition", "warn"))).toEqual({
      liveRegion: "polite",
      icon: "info",
      colorKey: "warning",
    });
  });

  // Producer invariant today is 'nutrition flags are never danger', but this
  // consumer must not depend on it: a future danger-severity nutrition flag
  // must NOT get the error palette or safety-grade salience.
  it("a danger-severity nutrition flag is capped at warning palette, polite, info icon", () => {
    expect(getConfirmFlagPresentation(flag("nutrition", "danger"))).toEqual({
      liveRegion: "polite",
      icon: "info",
      colorKey: "warning",
    });
  });

  it("an insight-tier flag is treated as informational too", () => {
    expect(getConfirmFlagPresentation(flag("insight", "info"))).toEqual({
      liveRegion: "polite",
      icon: "info",
      colorKey: "info",
    });
  });
});
