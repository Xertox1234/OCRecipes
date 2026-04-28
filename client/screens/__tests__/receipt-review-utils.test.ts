import { describe, it, expect } from "vitest";
import {
  shouldReplaceWithAIReceipt,
  mergeReceiptItems,
} from "../receipt-review-utils";
import type { LocalReceiptItem } from "@/lib/receipt-ocr-parser";
import type { ReceiptItem } from "@/hooks/useReceiptScan";

function makeAIItem(name: string, originalName?: string): ReceiptItem {
  return {
    name,
    originalName: originalName ?? name,
    quantity: 1,
    unit: "each",
    category: "other",
    isFood: true,
    estimatedShelfLifeDays: 7,
    confidence: 0.9,
  };
}

describe("shouldReplaceWithAIReceipt", () => {
  it("returns true when local has no items", () => {
    const aiResult = {
      items: [makeAIItem("Chicken Breast", "ORG BNS CKEN")],
      overallConfidence: 0.9,
      isPartialExtraction: false,
    };
    expect(shouldReplaceWithAIReceipt([], aiResult)).toBe(true);
  });

  it("returns true when AI confidence is high", () => {
    const local: LocalReceiptItem[] = [
      { rawName: "ORG BNS CKEN", price: "12.99", quantity: 1 },
    ];
    const aiResult = {
      items: [makeAIItem("Organic Boneless Chicken")],
      overallConfidence: 0.75,
      isPartialExtraction: false,
    };
    expect(shouldReplaceWithAIReceipt(local, aiResult)).toBe(true);
  });

  it("returns true when AI item count differs by more than 20%", () => {
    const local: LocalReceiptItem[] = [
      { rawName: "ITEM A", price: "1.00", quantity: 1 },
      { rawName: "ITEM B", price: "2.00", quantity: 1 },
      { rawName: "ITEM C", price: "3.00", quantity: 1 },
      { rawName: "ITEM D", price: "4.00", quantity: 1 },
      { rawName: "ITEM E", price: "5.00", quantity: 1 },
    ];
    const aiResult = {
      items: [makeAIItem("A"), makeAIItem("B"), makeAIItem("C")],
      overallConfidence: 0.5,
      isPartialExtraction: false,
    };
    // AI has 3, local has 5 → diff = 2/5 = 40% > 20%
    expect(shouldReplaceWithAIReceipt(local, aiResult)).toBe(true);
  });

  it("returns false when AI confidence is low and counts are similar", () => {
    const local: LocalReceiptItem[] = [
      { rawName: "ITEM A", price: "1.00", quantity: 1 },
      { rawName: "ITEM B", price: "2.00", quantity: 1 },
    ];
    const aiResult = {
      items: [makeAIItem("Item A"), makeAIItem("Item B")],
      overallConfidence: 0.5,
      isPartialExtraction: false,
    };
    expect(shouldReplaceWithAIReceipt(local, aiResult)).toBe(false);
  });
});

describe("mergeReceiptItems", () => {
  it("returns AI items directly when no local edits match", () => {
    const local: LocalReceiptItem[] = [
      { rawName: "ORG BNS CKEN", price: "12.99", quantity: 1 },
    ];
    const aiItems = [makeAIItem("Organic Boneless Chicken", "ORG BNS CKEN")];
    const result = mergeReceiptItems(local, aiItems);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(aiItems[0]);
  });

  it("returns all AI items even when local had none", () => {
    const aiItems = [makeAIItem("Milk"), makeAIItem("Eggs")];
    const result = mergeReceiptItems([], aiItems);
    expect(result).toHaveLength(2);
  });
});
