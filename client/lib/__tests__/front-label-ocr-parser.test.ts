import { describe, it, expect } from "vitest";
import { parseFrontLabelFromOCR } from "../front-label-ocr-parser";

describe("parseFrontLabelFromOCR", () => {
  it("extracts brand, product, net weight, and claims from a full label", () => {
    const text = [
      "LARABAR",
      "Peanut Butter Chocolate Chip",
      "Gluten Free",
      "Non-GMO",
      "1.6 oz (45g)",
    ].join("\n");

    const result = parseFrontLabelFromOCR(text);
    expect(result.brand).toBe("LARABAR");
    expect(result.productName).toBe("Peanut Butter Chocolate Chip");
    expect(result.netWeight).toBeTruthy();
    expect(result.claims).toContain("Gluten Free");
    expect(result.claims).toContain("Non-GMO");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("extracts net weight in various units", () => {
    expect(parseFrontLabelFromOCR("Net Wt 16 oz").netWeight).toBe("16 oz");
    expect(parseFrontLabelFromOCR("250g").netWeight).toBe("250g");
    expect(parseFrontLabelFromOCR("1.5 kg").netWeight).toBe("1.5 kg");
    expect(parseFrontLabelFromOCR("12 fl oz").netWeight).toBe("12 fl oz");
    expect(parseFrontLabelFromOCR("500 ml").netWeight).toBe("500 ml");
  });

  it("detects claim keywords case-insensitively", () => {
    const text = "ORGANIC\nVEGAN\nKeto Friendly\nHigh Protein";
    const result = parseFrontLabelFromOCR(text);
    expect(result.claims.length).toBeGreaterThanOrEqual(3);
  });

  it("returns confidence = 0 for garbage text", () => {
    const result = parseFrontLabelFromOCR("!!! *** ###\n---\n...");
    expect(result.confidence).toBe(0);
    expect(result.brand).toBeNull();
    expect(result.productName).toBeNull();
    expect(result.netWeight).toBeNull();
    expect(result.claims).toHaveLength(0);
  });

  it("handles weight-only text", () => {
    const result = parseFrontLabelFromOCR("Net Weight: 454g");
    expect(result.netWeight).toBe("454g");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("handles claims-only text", () => {
    const result = parseFrontLabelFromOCR(
      "Certified Organic\nNon-GMO Verified\nGluten Free",
    );
    expect(result.claims.length).toBeGreaterThanOrEqual(2);
  });

  it("does not treat net-weight line as the brand", () => {
    const text = "320g\nGreek Yogurt\nHigh Protein";
    const result = parseFrontLabelFromOCR(text);
    expect(result.brand).not.toBe("320g");
  });

  it("returns confidence >= 0.5 when brand + product are found", () => {
    const text = "KIND\nDark Chocolate Nuts & Sea Salt";
    const result = parseFrontLabelFromOCR(text);
    expect(result.brand).toBe("KIND");
    expect(result.productName).toBe("Dark Chocolate Nuts & Sea Salt");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("handles all-caps brand without misidentifying product as brand", () => {
    const text = "CLIF BAR\nChocolate Chip\n68g\nOrganic";
    const result = parseFrontLabelFromOCR(text);
    expect(result.brand).toBe("CLIF BAR");
    expect(result.productName).toBe("Chocolate Chip");
    expect(result.claims).toContain("Organic");
  });

  it("treats empty string as zero confidence", () => {
    const result = parseFrontLabelFromOCR("");
    expect(result.confidence).toBe(0);
  });
});
