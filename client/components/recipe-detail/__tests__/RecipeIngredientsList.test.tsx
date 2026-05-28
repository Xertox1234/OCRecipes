// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeIngredientsList } from "../RecipeIngredientsList";
import type { AllergenCheckResult } from "@shared/types/allergen-check";

// Isolate the test to RecipeIngredientsList's own rendering; the child
// components are covered by their own tests.
vi.mock("@/components/IngredientIcon", () => ({ IngredientIcon: () => null }));
vi.mock("@/components/AllergenBadge", () => ({ AllergenBadge: () => null }));
vi.mock("@/components/InlineSubstitution", () => ({
  InlineSubstitution: () => null,
}));
vi.mock("@/components/AllergenWarningBanner", () => ({
  AllergenWarningBanner: () => null,
}));

const ingredients = [{ name: "peanuts" }, { name: "wheat flour" }];
const CAUTION = /unable to check this recipe against your allergies/i;

describe("RecipeIngredientsList — allergen check failure (H8 safety)", () => {
  it("shows a cautionary banner when the allergen check failed — never silence", () => {
    // A failed check must NOT look identical to "no allergens found": a
    // declared-allergy user could otherwise read silence as "safe".
    renderComponent(
      <RecipeIngredientsList ingredients={ingredients} allergenCheckFailed />,
    );
    expect(screen.getByText(CAUTION)).toBeDefined();
  });

  it("does NOT show the cautionary banner when the check succeeded with no matches", () => {
    const result: AllergenCheckResult = { matches: [], substitutions: [] };
    renderComponent(
      <RecipeIngredientsList
        ingredients={ingredients}
        allergenResult={result}
      />,
    );
    expect(screen.queryByText(CAUTION)).toBeNull();
  });

  it("retries the check when the cautionary banner is pressed", () => {
    const onRetry = vi.fn();
    renderComponent(
      <RecipeIngredientsList
        ingredients={ingredients}
        allergenCheckFailed
        onRetryAllergenCheck={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: CAUTION }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
