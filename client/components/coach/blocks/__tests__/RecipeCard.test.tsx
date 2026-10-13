// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import RecipeCard from "../RecipeCard";
import type { RecipeCard as RecipeCardType } from "@shared/schemas/coach-blocks";

const block: RecipeCardType = {
  type: "recipe_card",
  recipe: {
    title: "Lemon Chicken",
    calories: 520,
    protein: 42,
    prepTime: "25 min",
    imageUrl: null,
    recipeId: 88,
    source: "community",
  },
};

describe("RecipeCard", () => {
  it("renders the recipe title and macro meta", () => {
    renderComponent(<RecipeCard block={block} />);
    expect(screen.getByText("Lemon Chicken")).toBeTruthy();
  });

  it("fires a FeaturedRecipeDetail navigate action from the View button", () => {
    const onAction = vi.fn();
    renderComponent(<RecipeCard block={block} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /view recipe/i }));
    expect(onAction).toHaveBeenCalledWith({
      type: "navigate",
      screen: "FeaturedRecipeDetail",
      params: { recipeId: 88, recipeType: "community" },
    });
  });

  it("opens a generated card as a community recipe", () => {
    const onAction = vi.fn();
    renderComponent(
      <RecipeCard
        block={{ ...block, recipe: { ...block.recipe, source: "generated" } }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view recipe/i }));
    expect(onAction).toHaveBeenCalledWith({
      type: "navigate",
      screen: "FeaturedRecipeDetail",
      params: { recipeId: 88, recipeType: "community" },
    });
  });

  it("has no spoonacular Add-to-Plan button", () => {
    renderComponent(
      <RecipeCard
        block={{
          type: "recipe_card",
          recipe: { ...block.recipe, source: "community" },
        }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.queryByText("Add to Plan")).toBeNull();
    expect(screen.queryByRole("button", { name: /add to plan/i })).toBeNull();
  });
});
