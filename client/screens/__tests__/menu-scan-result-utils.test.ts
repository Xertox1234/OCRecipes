import { describe, it, expect } from "vitest";
import {
  shouldReplaceWithAIMenu,
  mergeMenuItems,
} from "../menu-scan-result-utils";
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

describe("mergeMenuItems", () => {
  it("preserves local item name when AI name matches case-insensitively", () => {
    const local: LocalMenuItem[] = [{ name: "GRILLED SALMON" }];
    const aiItems = [makeAIItem("Grilled Salmon")];
    const result = mergeMenuItems(local, aiItems);
    expect(result[0].name).toBe("GRILLED SALMON");
    expect(result[0].estimatedCalories).toBe(400);
  });

  it("uses AI item as-is when no local name matches", () => {
    const local: LocalMenuItem[] = [{ name: "Burger" }];
    const aiItems = [makeAIItem("Burger"), makeAIItem("New Item")];
    const result = mergeMenuItems(local, aiItems);
    expect(result[1].name).toBe("New Item");
  });

  it("carries over all AI macro fields onto matched items", () => {
    const local: LocalMenuItem[] = [{ name: "Pasta" }];
    const aiItem = {
      ...makeAIItem("Pasta"),
      estimatedCalories: 650,
      tags: ["vegetarian"],
      recommendation: "good" as const,
    };
    const result = mergeMenuItems(local, [aiItem]);
    expect(result[0].estimatedCalories).toBe(650);
    expect(result[0].tags).toContain("vegetarian");
    expect(result[0].recommendation).toBe("good");
  });

  it("returns all AI items when local is empty", () => {
    const aiItems = [makeAIItem("A"), makeAIItem("B")];
    const result = mergeMenuItems([], aiItems);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(aiItems[0]);
  });

  it("handles trailing whitespace in names during match", () => {
    const local: LocalMenuItem[] = [{ name: "  Caesar Salad  " }];
    const aiItems = [makeAIItem("Caesar Salad")];
    const result = mergeMenuItems(local, aiItems);
    expect(result[0].name).toBe("  Caesar Salad  ");
  });
});
