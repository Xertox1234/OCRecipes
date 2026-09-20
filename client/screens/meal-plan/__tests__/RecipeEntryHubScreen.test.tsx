// @vitest-environment jsdom
//
// Regression test for
// todos/archive/P3-2026-09-13-homescreen-recipeentryhub-a11y-leaf-fix-untested.md:
// RecipeEntryHubScreen had no co-located test file at all, so its
// accessible={false} fix (from todos/archive/P2-2026-09-05-bottomsheetmodal-
// callers-collapse-a11y-subtree-on-ios.md) had zero regression coverage. On
// new-arch iOS, @gorhom/bottom-sheet's default accessible=true makes the
// import-recipe sheet's wrapper an accessibility LEAF, hiding its content
// from VoiceOver AND Maestro (jsdom renders children plainly and cannot see
// the native leaf-collapse — this only pins that the prop is passed). See
// docs/solutions/logic-errors/
// gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
//
// Assertion shape mirrors the sibling sites' proven pattern (RecipeBrowserScreen.
// params.test.tsx, BeveragePickerSheet.test.tsx, ConfirmationModal.test.tsx) —
// the shared test/mocks/gorhom-bottom-sheet.ts mock reflects the `accessible`
// prop onto a `data-accessible` DOM attribute.
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeEntryHubScreen from "../RecipeEntryHubScreen";

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: {} }),
  // useSheetBackHandler (a real collaborator here) calls useIsFocused itself.
  useIsFocused: () => true,
}));

vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: () => null,
  IMPORT_RECIPE_SNAP_POINTS: ["import-recipe"],
}));

describe("RecipeEntryHubScreen — iOS a11y-leaf fix", () => {
  it("passes accessible={false} to the import-recipe sheet (prevents the iOS a11y-leaf collapse; jsdom cannot verify the native effect)", () => {
    renderComponent(<RecipeEntryHubScreen />);
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });
});
