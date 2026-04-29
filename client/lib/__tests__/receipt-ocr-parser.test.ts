import { describe, it, expect } from "vitest";
import { parseReceiptItemsFromOCR } from "../receipt-ocr-parser";

describe("parseReceiptItemsFromOCR", () => {
  it("returns empty result for empty input", () => {
    const result = parseReceiptItemsFromOCR([]);
    expect(result.items).toHaveLength(0);
    expect(result.storeName).toBeNull();
    expect(result.totalAmount).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns empty result for whitespace-only text", () => {
    const result = parseReceiptItemsFromOCR(["  \n\n  "]);
    expect(result.items).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("parses basic grocery receipt items with prices", () => {
    const text = [
      "WHOLE FOODS MARKET",
      "ORG BANANA 1.49",
      "CAGE FREE EGGS 5.99",
      "OAT MILK 4.29",
      "TOTAL 11.77",
    ].join("\n");

    const result = parseReceiptItemsFromOCR([text]);
    expect(result.storeName).toBe("WHOLE FOODS MARKET");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      rawName: "ORG BANANA",
      price: "1.49",
    });
    expect(result.items[1]).toMatchObject({
      rawName: "CAGE FREE EGGS",
      price: "5.99",
    });
    expect(result.items[2]).toMatchObject({
      rawName: "OAT MILK",
      price: "4.29",
    });
  });

  it("excludes total, subtotal, and tax lines", () => {
    const text = [
      "COSTCO",
      "CHICKEN BREAST 12.99",
      "SUBTOTAL 12.99",
      "TAX 1.04",
      "TOTAL 14.03",
    ].join("\n");

    const result = parseReceiptItemsFromOCR([text]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].rawName).toBe("CHICKEN BREAST");
    expect(result.totalAmount).toBeTruthy();
  });

  it("extracts quantity from prefix patterns", () => {
    const text = [
      "TRADER JOE'S",
      "2 @ 2.99 APPLES 5.98",
      "3x YOGURT CUP 1.29",
    ].join("\n");

    const result = parseReceiptItemsFromOCR([text]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[1].quantity).toBe(3);
  });

  it("caps quantity at 99 to avoid absurd OCR misreads", () => {
    const text = ["STORE", "999 @ 0.01 BULK ITEM 9.99", "200x CHIPS 2.49"].join(
      "\n",
    );

    const result = parseReceiptItemsFromOCR([text]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quantity).toBe(99);
    expect(result.items[1].quantity).toBe(99);
  });

  it("deduplicates items across multiple photos by name+price", () => {
    const photo1 = ["SAFEWAY", "BREAD 3.49", "BUTTER 4.99"].join("\n");
    const photo2 = ["SAFEWAY", "BREAD 3.49", "ORANGE JUICE 5.99"].join("\n");

    const result = parseReceiptItemsFromOCR([photo1, photo2]);
    // BREAD should appear only once (deduplicated)
    const breadItems = result.items.filter((i) => i.rawName === "BREAD");
    expect(breadItems).toHaveLength(1);
    expect(result.items).toHaveLength(3);
  });

  it("returns high confidence when many items are found", () => {
    const lines = ["KROGER"];
    for (let i = 1; i <= 8; i++) {
      lines.push(`ITEM ${i} ${(i * 1.5).toFixed(2)}`);
    }
    const result = parseReceiptItemsFromOCR([lines.join("\n")]);
    expect(result.confidence).toBe(1);
  });

  it("returns low confidence for single-item receipt", () => {
    const result = parseReceiptItemsFromOCR(["STORE\nAPPLES 2.99\nTOTAL 2.99"]);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("handles receipt with no store name", () => {
    const text = ["MILK 3.49", "EGGS 4.99", "TOTAL 8.48"].join("\n");
    const result = parseReceiptItemsFromOCR([text]);
    expect(result.storeName).toBeNull();
    expect(result.items).toHaveLength(2);
  });

  it("captures total amount", () => {
    const text = ["STORE", "ITEM 5.00", "TOTAL 5.00"].join("\n");
    const result = parseReceiptItemsFromOCR([text]);
    expect(result.totalAmount).toBe("5.00");
  });
});
