// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { WizardReviewStep } from "../WizardReviewStep";
import {
  initialWizardState,
  type WizardCover,
  type WizardRecipe,
  type WizardState,
} from "../cookbook-wizard-utils";

vi.mock("expo-image", () => ({
  Image: () => null,
}));

const onEdit = vi.fn();

const stew: WizardRecipe = {
  recipeId: 3,
  recipeType: "mealPlan",
  title: "Smoky Lentil Stew",
  imageUrl: null,
};
const chicken: WizardRecipe = {
  recipeId: 7,
  recipeType: "community",
  title: "Garlic Lemon Chicken",
  imageUrl: null,
};

function renderStep({
  cover = { kind: "none" },
  recipes = [],
}: { cover?: WizardCover; recipes?: WizardRecipe[] } = {}) {
  const state: WizardState = {
    ...initialWizardState,
    step: "review",
    furthest: 3,
    name: "Sunday Suppers",
    cover,
    recipes,
  };
  return renderComponent(<WizardReviewStep state={state} onEdit={onEdit} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WizardReviewStep", () => {
  it("reads back a plain cover with no recipes", () => {
    renderStep();
    expect(screen.getByText("Plain cloth")).toBeTruthy();
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.getByText("0 recipes")).toBeTruthy();
  });

  it("reads back a photo cover and one recipe", () => {
    renderStep({
      cover: { kind: "photo", uri: "file:///c.jpg" },
      recipes: [stew],
    });
    expect(screen.getByText("Your photo")).toBeTruthy();
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByText("1 recipe")).toBeTruthy();
  });

  it("reads back an AI cover and several recipes", () => {
    renderStep({
      cover: { kind: "candidate", candidateId: "c-1", imageUrl: "u" },
      recipes: [stew, chicken],
    });
    expect(screen.getByText("AI generated")).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByText("2 recipes")).toBeTruthy();
  });

  it("sends each Edit link to its step", () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Edit Name" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Recipes" }));
    expect(onEdit.mock.calls).toEqual([["basics"], ["cover"], ["recipes"]]);
  });
});
