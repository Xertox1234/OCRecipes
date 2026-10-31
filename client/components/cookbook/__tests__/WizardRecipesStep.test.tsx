// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { WizardRecipesStep } from "../WizardRecipesStep";
import {
  initialWizardState,
  type WizardRecipe,
  type WizardState,
} from "../cookbook-wizard-utils";

const { mockSelection, sources } = vi.hoisted(() => ({
  mockSelection: vi.fn(),
  sources: {
    favourites: [] as unknown[],
    personal: [] as unknown[],
    loading: false,
  },
}));

vi.mock("expo-image", () => ({
  Image: () => null,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: mockSelection,
    disabled: false,
  }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipes: () =>
    sources.loading
      ? { data: undefined, isPending: true }
      : { data: sources.favourites, isPending: false },
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () =>
    sources.loading
      ? { data: undefined, isPending: true }
      : {
          data: { community: [], personal: sources.personal, frequent: [] },
          isPending: false,
        },
}));

const dispatch = vi.fn();
const onAvailability = vi.fn();

const chicken = {
  recipeId: 7,
  recipeType: "community" as const,
  title: "Garlic Lemon Chicken",
  imageUrl: null,
};
const stew = { id: 3, title: "Smoky Lentil Stew", imageUrl: null };

function renderStep(recipes: WizardRecipe[] = []) {
  const state: WizardState = {
    ...initialWizardState,
    step: "recipes",
    furthest: 2,
    name: "Sunday Suppers",
    recipes,
  };
  return renderComponent(
    <WizardRecipesStep
      state={state}
      dispatch={dispatch}
      onAvailability={onAvailability}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sources.favourites = [chicken];
  sources.personal = [stew];
  sources.loading = false;
});

describe("WizardRecipesStep", () => {
  it("dispatches toggleRecipe with the tapped recipe", () => {
    renderStep();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Smoky Lentil Stew" }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "toggleRecipe",
      recipe: {
        recipeId: 3,
        recipeType: "mealPlan",
        title: "Smoky Lentil Stew",
        imageUrl: null,
      },
    });
    // SelectableTile owns the selection tick — exactly one, never doubled.
    expect(mockSelection).toHaveBeenCalledTimes(1);
  });

  it("marks picked recipes checked", () => {
    renderStep([
      {
        recipeId: 7,
        recipeType: "community",
        title: "Garlic Lemon Chicken",
        imageUrl: null,
      },
    ]);
    expect(
      screen
        .getByRole("checkbox", { name: "Garlic Lemon Chicken" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: "Smoky Lentil Stew" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows the empty state and reports no recipes when both sources are empty", () => {
    sources.favourites = [];
    sources.personal = [];
    renderStep();
    expect(screen.getByText("No saved recipes yet")).toBeTruthy();
    expect(
      screen.getByText(
        "You can add recipes to this cookbook any time after you create it.",
      ),
    ).toBeTruthy();
    expect(onAvailability).toHaveBeenCalledWith(false);
    expect(onAvailability).not.toHaveBeenCalledWith(true);
  });

  it("reports recipes available when there are some", () => {
    renderStep();
    expect(onAvailability).toHaveBeenCalledWith(true);
    expect(onAvailability).not.toHaveBeenCalledWith(false);
  });

  it("reports nothing and shows no empty state while loading", () => {
    sources.loading = true;
    renderStep();
    expect(onAvailability).not.toHaveBeenCalled();
    expect(screen.queryByText("No saved recipes yet")).toBeNull();
  });

  it("filters to the user's own recipes, keeping availability on the full list", () => {
    renderStep();
    fireEvent.click(screen.getByRole("tab", { name: "My recipes" }));
    expect(
      screen.queryByRole("checkbox", { name: "Garlic Lemon Chicken" }),
    ).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Smoky Lentil Stew" }),
    ).toBeTruthy();
    expect(onAvailability).not.toHaveBeenCalledWith(false);
  });

  it("says nothing matches when the search finds no recipe", () => {
    renderStep();
    fireEvent.change(screen.getByLabelText("Search your recipes"), {
      target: { value: "tofu" },
    });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("No recipes match")).toBeTruthy();
    expect(onAvailability).not.toHaveBeenCalledWith(false);
  });
});
