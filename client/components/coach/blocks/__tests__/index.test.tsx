// @vitest-environment jsdom
/**
 * BlockRenderer dispatch tests — verifies each block.type routes to the right
 * child component and that unknown types render nothing (default branch).
 * Child cards are mocked to thin doubles so this isolates the switch logic.
 */
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import BlockRenderer from "../index";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

vi.mock("../ActionCard", () => ({
  default: () => <div data-testid="r-action" />,
}));
vi.mock("../SuggestionList", () => ({
  default: () => <div data-testid="r-suggestion" />,
}));
vi.mock("../InlineChart", () => ({
  default: () => <div data-testid="r-chart" />,
}));
vi.mock("../CommitmentCard", () => ({
  default: () => <div data-testid="r-commitment" />,
}));
vi.mock("../QuickReplies", () => ({
  default: () => <div data-testid="r-quick" />,
}));
vi.mock("../RecipeCard", () => ({
  default: () => <div data-testid="r-recipe" />,
}));
vi.mock("../MealPlanCard", () => ({
  default: () => <div data-testid="r-mealplan" />,
}));

const blocks: Record<string, CoachBlock> = {
  action_card: {
    type: "action_card",
    title: "t",
    subtitle: "s",
    actionLabel: "go",
    action: { type: "set_goal", goalType: "calories" },
  },
  suggestion_list: { type: "suggestion_list", items: [] },
  inline_chart: {
    type: "inline_chart",
    chartType: "stat_row",
    title: "c",
    data: [],
  },
  commitment_card: {
    type: "commitment_card",
    title: "c",
    followUpText: "f",
    followUpDate: "2026-06-01",
  },
  quick_replies: { type: "quick_replies", options: [] },
  recipe_card: {
    type: "recipe_card",
    recipe: {
      title: "r",
      calories: 1,
      protein: 1,
      prepTime: "1 min",
      imageUrl: null,
      recipeId: 1,
      source: "community",
    },
  },
  meal_plan_card: { type: "meal_plan_card", title: "m", days: [] },
};

describe("BlockRenderer", () => {
  it.each([
    ["action_card", "r-action"],
    ["suggestion_list", "r-suggestion"],
    ["inline_chart", "r-chart"],
    ["commitment_card", "r-commitment"],
    ["quick_replies", "r-quick"],
    ["recipe_card", "r-recipe"],
    ["meal_plan_card", "r-mealplan"],
  ])("renders the %s block", (type, testId) => {
    renderComponent(<BlockRenderer block={blocks[type]} />);
    expect(screen.getByTestId(testId)).toBeTruthy();
  });

  it("renders nothing for an unknown block type (default branch)", () => {
    const { container } = renderComponent(
      <BlockRenderer block={{ type: "mystery" } as unknown as CoachBlock} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
