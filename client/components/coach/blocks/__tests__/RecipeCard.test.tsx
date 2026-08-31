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

const spoonacularBlock: RecipeCardType = {
  type: "recipe_card",
  recipe: {
    title: "Lemon Chicken",
    calories: 520,
    protein: 42,
    prepTime: "25 min",
    imageUrl: null,
    recipeId: 715538,
    source: "spoonacular",
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
      params: { recipeId: 88, source: "community" },
    });
  });

  it("fires an add_recipe_to_plan action carrying the recipe", () => {
    const onAction = vi.fn();
    renderComponent(
      <RecipeCard block={spoonacularBlock} onAction={onAction} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    expect(onAction).toHaveBeenCalledWith({
      type: "add_recipe_to_plan",
      recipeId: spoonacularBlock.recipe.recipeId,
      recipeTitle: spoonacularBlock.recipe.title,
    });
  });

  it("hides Add to Plan for non-catalog sources", () => {
    const onAction = vi.fn();
    const generated = {
      ...spoonacularBlock,
      recipe: { ...spoonacularBlock.recipe, source: "generated" as const },
    };
    renderComponent(<RecipeCard block={generated} onAction={onAction} />);

    expect(screen.queryByRole("button", { name: /add to plan/i })).toBeNull();
    expect(screen.getByRole("button", { name: /view recipe/i })).toBeTruthy();
  });
});
