import { describe, it, expect } from "vitest";
import {
  buildShareContent,
  formatSavedItemTime,
} from "../saved-item-card-utils";

describe("buildShareContent", () => {
  it("includes title", () => {
    const content = buildShareContent({
      title: "Chicken Salad",
      description: null,
      instructions: null,
      sourceProductName: null,
    });
    expect(content).toBe("Chicken Salad\n");
  });

  it("includes description when present", () => {
    const content = buildShareContent({
      title: "Chicken Salad",
      description: "A healthy salad with grilled chicken",
      instructions: null,
      sourceProductName: null,
    });
    expect(content).toContain("A healthy salad with grilled chicken");
  });

  it("includes instructions when present", () => {
    const content = buildShareContent({
      title: "Chicken Salad",
      description: null,
      instructions: "Mix ingredients and serve",
      sourceProductName: null,
    });
    expect(content).toContain("Instructions:\nMix ingredients and serve");
  });

  it("includes source product name when present", () => {
    const content = buildShareContent({
      title: "Chicken Salad",
      description: null,
      instructions: null,
      sourceProductName: "Rotisserie Chicken",
    });
    expect(content).toContain("Suggested for: Rotisserie Chicken");
  });

  it("includes all fields when all present", () => {
    const content = buildShareContent({
      title: "Chicken Salad",
      description: "A healthy salad",
      instructions: "Mix and serve",
      sourceProductName: "Rotisserie Chicken",
    });
    expect(content).toContain("Chicken Salad");
    expect(content).toContain("A healthy salad");
    expect(content).toContain("Instructions:\nMix and serve");
    expect(content).toContain("Suggested for: Rotisserie Chicken");
  });

  it("omits empty sections", () => {
    const content = buildShareContent({
      title: "Simple Item",
      description: null,
      instructions: null,
      sourceProductName: null,
    });
    expect(content).not.toContain("Instructions:");
    expect(content).not.toContain("Suggested for:");
  });

  it("handles empty string fields as truthy (includes them)", () => {
    const content = buildShareContent({
      title: "Item",
      description: "",
      instructions: "",
      sourceProductName: "",
    });
    // Empty strings are falsy, so they should be omitted like null
    expect(content).toBe("Item\n");
  });
});

describe("formatSavedItemTime", () => {
  // The AI writes the estimate as free text, so one list showed "1 hr 30 min"
  // beside "1 hour 15 min" (visual QA sweep #82). Readable estimates get one
  // spelling; anything else is shown as written.
  it("gives readable estimates one spelling", () => {
    expect(formatSavedItemTime("1 hour 15 min")).toBe("1 hr 15 min");
    expect(formatSavedItemTime("1 hr 30 min")).toBe("1 hr 30 min");
    expect(formatSavedItemTime("45 minutes")).toBe("45 min");
    expect(formatSavedItemTime("2 hours")).toBe("2 hr");
  });

  it("keeps text it cannot read, and null for nothing", () => {
    expect(formatSavedItemTime("Quick")).toBe("Quick");
    expect(formatSavedItemTime(null)).toBeNull();
    expect(formatSavedItemTime(undefined)).toBeNull();
  });
});
