// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import MealPlanCard from "../MealPlanCard";
import type { MealPlanCard as MealPlanCardType } from "@shared/schemas/coach-blocks";

const block: MealPlanCardType = {
  type: "meal_plan_card",
  title: "3-Day High Protein",
  days: [
    {
      label: "Monday",
      meals: [
        { type: "breakfast", title: "Eggs & Oats", calories: 450, protein: 30 },
      ],
      totals: { calories: 1800, protein: 140 },
    },
  ],
};

describe("MealPlanCard", () => {
  it("renders collapsed by default (day detail hidden)", () => {
    renderComponent(<MealPlanCard block={block} />);
    expect(screen.getByText("3-Day High Protein")).toBeTruthy();
    // Day content only renders when expanded.
    expect(screen.queryByText("Eggs & Oats")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add to meal plan/i }),
    ).toBeNull();
  });

  it("expands to show days/meals and the add button when the header is pressed", () => {
    renderComponent(<MealPlanCard block={block} />);
    fireEvent.click(screen.getByRole("button", { name: /expand meal plan/i }));
    expect(screen.getByText("Eggs & Oats")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /add to meal plan/i }),
    ).toBeTruthy();
  });

  it("fires an add_meal_plan action with the days payload", () => {
    const onAction = vi.fn();
    renderComponent(<MealPlanCard block={block} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /expand meal plan/i }));
    fireEvent.click(screen.getByRole("button", { name: /add to meal plan/i }));
    expect(onAction).toHaveBeenCalledWith({
      type: "add_meal_plan",
      plan: block.days,
    });
  });

  it("collapses again when the header is pressed twice", () => {
    renderComponent(<MealPlanCard block={block} />);
    const header = screen.getByRole("button", { name: /expand meal plan/i });
    fireEvent.click(header);
    expect(screen.getByText("Eggs & Oats")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /collapse meal plan/i }),
    );
    expect(screen.queryByText("Eggs & Oats")).toBeNull();
  });
});
