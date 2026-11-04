import { describe, it, expect } from "vitest";
import {
  VISION_ROW_IMAGES,
  visionDegraded,
} from "../ai-backup-gate-vision-rows";
import { AI_FEATURES } from "../../server/lib/ai-models";

describe("VISION_ROW_IMAGES", () => {
  it("has an image for every vision row the main gate does not drive", () => {
    const visionRows = Object.entries(AI_FEATURES)
      .filter(([name, row]) => row.vision && name !== "photo-analyze")
      .map(([name]) => name)
      .sort();
    expect(Object.keys(VISION_ROW_IMAGES).sort()).toEqual(visionRows);
  });
});

describe("visionDegraded", () => {
  it("flags the 'no food' answer from recipe-chat-image", () => {
    expect(
      visionDegraded("recipe-chat-image", "No food ingredients detected."),
    ).toBeDefined();
    expect(
      visionDegraded("recipe-chat-image", "Cherry tomatoes\nBasil"),
    ).toBeUndefined();
  });

  it("flags empty item lists", () => {
    expect(visionDegraded("photo-recipe", { ingredients: [] })).toBeDefined();
    expect(visionDegraded("receipt-scan", { items: [] })).toBeDefined();
    expect(visionDegraded("menu-scan", { menuItems: [] })).toBeDefined();
    expect(visionDegraded("cooking-ingredient-photo", [])).toBeDefined();
    expect(
      visionDegraded("receipt-scan", { items: [{ name: "Tuna" }] }),
    ).toBeUndefined();
  });

  it("flags a label with no calories and a front label with no product", () => {
    expect(visionDegraded("photo-label", { calories: null })).toBeDefined();
    expect(visionDegraded("photo-label", { calories: 230 })).toBeUndefined();
    expect(
      visionDegraded("front-label-scan", { brand: null, productName: null }),
    ).toBeDefined();
    expect(
      visionDegraded("front-label-scan", { brand: "Heinz", productName: null }),
    ).toBeUndefined();
  });

  it("flags a classification that ran no follow-up analysis", () => {
    expect(
      visionDegraded("photo-classify", { analysisResult: null }),
    ).toBeDefined();
    expect(
      visionDegraded("photo-classify", { analysisResult: { foods: [] } }),
    ).toBeUndefined();
  });
});
