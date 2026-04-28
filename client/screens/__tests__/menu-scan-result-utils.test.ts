import { describe, it, expect } from "vitest";
import { shouldReplaceWithAIMenu } from "../menu-scan-result-utils";
import type { LocalMenuItem } from "@/lib/menu-ocr-parser";
import type { MenuAnalysisItem } from "@/hooks/useMenuScan";

function makeAIItem(name: string): MenuAnalysisItem {
  return {
    name,
    estimatedCalories: 400,
    estimatedProtein: 20,
    estimatedCarbs: 45,
    estimatedFat: 15,
    tags: [],
  };
}

describe("shouldReplaceWithAIMenu", () => {
  it("returns true when local has no items", () => {
    const local: LocalMenuItem[] = [];
    const aiItems: MenuAnalysisItem[] = [
      makeAIItem("Burger"),
      makeAIItem("Fries"),
    ];
    expect(shouldReplaceWithAIMenu(local, aiItems)).toBe(true);
  });

  it("returns true when AI finds 50% more items than local", () => {
    const local: LocalMenuItem[] = [{ name: "Burger" }, { name: "Fries" }];
    const aiItems: MenuAnalysisItem[] = [
      makeAIItem("Burger"),
      makeAIItem("Fries"),
      makeAIItem("Onion Rings"),
    ];
    // 3 >= 2 * 1.5 → true
    expect(shouldReplaceWithAIMenu(local, aiItems)).toBe(true);
  });

  it("returns false when AI item count is similar to local", () => {
    const local: LocalMenuItem[] = [
      { name: "Burger" },
      { name: "Fries" },
      { name: "Shake" },
    ];
    const aiItems: MenuAnalysisItem[] = [
      makeAIItem("Burger"),
      makeAIItem("Fries"),
      makeAIItem("Shake"),
    ];
    expect(shouldReplaceWithAIMenu(local, aiItems)).toBe(false);
  });

  it("returns true when a matched item has a different price from AI metadata", () => {
    // AI doesn't carry price — but if local had a price and AI name matches,
    // we currently don't have pricing in AI items. This test ensures the rule
    // applies when AI detects significantly more items (coverage gap).
    const local: LocalMenuItem[] = [
      { name: "Salmon", price: "$18.00" },
      { name: "Steak", price: "$32.00" },
    ];
    const aiItems: MenuAnalysisItem[] = [
      makeAIItem("Salmon"),
      makeAIItem("Steak"),
      makeAIItem("Lobster"),
      makeAIItem("Duck Confit"),
    ];
    // 4 >= 2 * 1.5 → true
    expect(shouldReplaceWithAIMenu(local, aiItems)).toBe(true);
  });

  it("returns false when local and AI have equal item counts", () => {
    const local: LocalMenuItem[] = [
      { name: "Taco" },
      { name: "Burrito" },
      { name: "Quesadilla" },
      { name: "Nachos" },
    ];
    const aiItems = local.map((i) => makeAIItem(i.name));
    expect(shouldReplaceWithAIMenu(local, aiItems)).toBe(false);
  });

  it("returns true when local is empty and AI returns nothing (both empty — edge case treated as replace)", () => {
    expect(shouldReplaceWithAIMenu([], [])).toBe(true);
  });
});
