// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";

import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";

import { renderComponent } from "../../../../test/utils/render-component";
import { MealSlotItem, getItemAccessibilityActions } from "../MealSlotSection";

function makeItem(
  overrides: Record<string, unknown> = {},
): MealPlanItemWithRelations {
  return {
    id: 1,
    userId: "user-1",
    recipeId: 1,
    scannedItemId: null,
    plannedDate: "2026-11-17",
    mealType: "dinner",
    servings: "1",
    sortOrder: 0,
    createdAt: new Date(),
    audience: "self",
    familyProfileId: null,
    recipe: { id: 1, title: "Tacos", caloriesPerServing: "600", allergens: [] },
    scannedItem: null,
    ...overrides,
  } as unknown as MealPlanItemWithRelations;
}

function renderItem(item: MealPlanItemWithRelations, onConfirm = vi.fn()) {
  return renderComponent(
    <MealSlotItem
      item={item}
      isConfirmed={false}
      onPress={vi.fn()}
      onRemove={vi.fn()}
      onConfirm={onConfirm}
      canConfirm
    />,
  );
}

describe("MealSlotItem confirm", () => {
  it("offers confirm on the user's own meal", () => {
    renderItem(makeItem());
    expect(screen.queryByLabelText("Confirm Tacos as eaten")).not.toBeNull();
  });

  it("offers no confirm button for a profile's meal, even when canConfirm", () => {
    renderItem(makeItem({ audience: "profile", familyProfileId: 7 }));
    expect(screen.queryByLabelText("Confirm Tacos as eaten")).toBeNull();
  });

  it("exposes no confirm accessibility action for a profile's meal", () => {
    const own = getItemAccessibilityActions(makeItem(), true, false, "Tacos");
    const profile = getItemAccessibilityActions(
      makeItem({ audience: "profile", familyProfileId: 7 }),
      true,
      false,
      "Tacos",
    );
    expect(own.map((a) => a.name)).toEqual(["confirm", "remove"]);
    expect(profile.map((a) => a.name)).toEqual(["remove"]);
  });
});
