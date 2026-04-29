import { describe, it, expect } from "vitest";
import { shouldReplaceWithAIFrontLabel } from "../front-label-confirm-utils";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";

const base: FrontLabelExtractionResult = {
  brand: "Acme",
  productName: "Widget Crunch",
  netWeight: "200g",
  claims: ["organic"],
  confidence: 0.5,
};

describe("shouldReplaceWithAIFrontLabel", () => {
  it("returns false when AI data matches local and confidence is low", () => {
    expect(shouldReplaceWithAIFrontLabel(base, base)).toBe(false);
  });

  it("returns true when AI confidence is high (> 0.7)", () => {
    const ai: FrontLabelExtractionResult = { ...base, confidence: 0.8 };
    expect(shouldReplaceWithAIFrontLabel(base, ai)).toBe(true);
  });

  it("returns true when AI brand differs from local", () => {
    const ai: FrontLabelExtractionResult = { ...base, brand: "Other Brand" };
    expect(shouldReplaceWithAIFrontLabel(base, ai)).toBe(true);
  });

  it("returns true when AI productName differs from local", () => {
    const ai: FrontLabelExtractionResult = {
      ...base,
      productName: "Different Product",
    };
    expect(shouldReplaceWithAIFrontLabel(base, ai)).toBe(true);
  });

  it("returns true when AI netWeight differs from local", () => {
    const ai: FrontLabelExtractionResult = { ...base, netWeight: "300g" };
    expect(shouldReplaceWithAIFrontLabel(base, ai)).toBe(true);
  });

  it("returns false when confidence is exactly 0.7 (not strictly greater)", () => {
    const ai: FrontLabelExtractionResult = { ...base, confidence: 0.7 };
    expect(shouldReplaceWithAIFrontLabel(base, ai)).toBe(false);
  });

  it("handles null fields without throwing", () => {
    const local: FrontLabelExtractionResult = {
      brand: null,
      productName: null,
      netWeight: null,
      claims: [],
      confidence: 0.4,
    };
    const ai: FrontLabelExtractionResult = {
      brand: null,
      productName: null,
      netWeight: null,
      claims: [],
      confidence: 0.5,
    };
    expect(shouldReplaceWithAIFrontLabel(local, ai)).toBe(false);
  });
});
