// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";

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

describe("MealSlotItem family row", () => {
  const family = {
    audienceLabel: "for Ivy",
    clashLines: ["Contains tree nuts \u2014 Ivy", "Allergens not checked"],
  };

  function renderFamilyRow(
    over: Record<string, unknown> = {},
    onChangeAudience = vi.fn(),
  ) {
    renderComponent(
      <MealSlotItem
        item={makeItem({ audience: "profile", familyProfileId: 7, ...over })}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm
        family={family}
        onChangeAudience={onChangeAudience}
      />,
    );
    return onChangeAudience;
  }

  it("shows the audience label beside the title and one line per clash", () => {
    renderFamilyRow();
    expect(screen.getByText("for Ivy")).toBeDefined();
    expect(screen.getByText("Contains tree nuts \u2014 Ivy")).toBeDefined();
    expect(screen.getByText("Allergens not checked")).toBeDefined();
  });

  it("folds the label and the clash lines into the row's own label", () => {
    renderFamilyRow();
    const card = screen.getAllByRole("button")[0];
    const label = card.getAttribute("aria-label") ?? "";
    expect(label).toContain("for Ivy");
    expect(label).toContain("Contains tree nuts \u2014 Ivy");
    expect(label).toContain("Allergens not checked");
  });

  it("has a Who's it for? button that hands the item over", () => {
    const onChange = renderFamilyRow();
    fireEvent.click(screen.getByRole("button", { name: "Who's it for?" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].id).toBe(1);
  });

  it("shows none of it without family info", () => {
    renderItem(makeItem());
    expect(screen.queryByText("Who's it for?")).toBeNull();
  });

  it("offers the audience action only when the row can change audience", () => {
    const names = (can: boolean) =>
      getItemAccessibilityActions(makeItem(), true, false, "Tacos", can).map(
        (a) => a.name,
      );
    expect(names(true)).toEqual(["confirm", "audience", "remove"]);
    expect(names(false)).toEqual(["confirm", "remove"]);
  });
});
