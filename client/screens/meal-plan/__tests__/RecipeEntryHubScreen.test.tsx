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
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeEntryHubScreen from "../RecipeEntryHubScreen";

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: {} }),
  // useSheetBackHandler (a real collaborator here) calls useIsFocused itself.
  useIsFocused: () => true,
}));

// Renders a real close trigger (not `() => null`) so the Android-trap-release
// test can exercise the same `.dismiss()` → BottomSheetModal `onDismiss` path
// production code uses, rather than calling a prop function directly.
vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: ({ onDismiss }: { onDismiss: () => void }) =>
    React.createElement(
      "button",
      { onClick: onDismiss, "data-testid": "close-import-sheet" },
      "Close",
    ),
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

// Android TalkBack focus trap: iOS already has a working trap via
// accessibilityViewIsModal on the sheet's own content root (PR #1000); the
// Android lever is importantForAccessibility="no-hide-descendants" on the
// screen's OWN background content, applied only while the sheet is open.
// jsdom can't assert real a11y-tree exclusion — it maps the hiding-prop pair
// to aria-hidden (test/mocks/react-native.ts's ariaHiddenProps), so these
// tests pin THAT, per docs/solutions/conventions/
// jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
describe("RecipeEntryHubScreen — Android TalkBack background trap", () => {
  it("does not hide the background content before the import sheet opens", () => {
    renderComponent(<RecipeEntryHubScreen />);
    expect(
      screen.getByTestId("recipe-entry-hub-scroll").getAttribute("aria-hidden"),
    ).toBeNull();
  });

  it("hides the background content from the Android accessibility tree while the import sheet is open", () => {
    renderComponent(<RecipeEntryHubScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Import a Recipe" }));
    expect(
      screen.getByTestId("recipe-entry-hub-scroll").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("releases the background trap once the import sheet is dismissed — a trap that never releases makes the screen unusable to TalkBack", () => {
    renderComponent(<RecipeEntryHubScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Import a Recipe" }));
    fireEvent.click(screen.getByTestId("close-import-sheet"));
    expect(
      screen.getByTestId("recipe-entry-hub-scroll").getAttribute("aria-hidden"),
    ).toBeNull();
  });
});
