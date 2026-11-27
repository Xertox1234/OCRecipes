import { describe, it, expect } from "vitest";
import { normalizeTypedBarcode } from "../manual-barcode-utils";

describe("normalizeTypedBarcode", () => {
  it("strips spaces and dashes", () => {
    expect(normalizeTypedBarcode("0 32601 03105 3")).toBe("032601031053");
    expect(normalizeTypedBarcode("0-32601-03105-3")).toBe("032601031053");
  });

  it("rejects letters", () => {
    expect(normalizeTypedBarcode("03260103105A")).toBeNull();
    expect(normalizeTypedBarcode("abcdefgh")).toBeNull();
  });

  it("rejects 7 and 15 digits", () => {
    expect(normalizeTypedBarcode("1234567")).toBeNull();
    expect(normalizeTypedBarcode("123456789012345")).toBeNull();
  });

  it("rejects 9, 10, 11 digits", () => {
    for (const n of [9, 10, 11]) {
      expect(normalizeTypedBarcode("1".repeat(n))).toBeNull();
    }
  });

  it("accepts 8, 12, 13 and 14 digits", () => {
    for (const n of [8, 12, 13, 14]) {
      const digits = "1".repeat(n);
      expect(normalizeTypedBarcode(digits)).toBe(digits);
    }
  });

  it("rejects empty and whitespace-only input", () => {
    expect(normalizeTypedBarcode("")).toBeNull();
    expect(normalizeTypedBarcode("  - ")).toBeNull();
  });
});
