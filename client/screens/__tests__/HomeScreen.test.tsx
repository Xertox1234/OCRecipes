// @vitest-environment jsdom
//
// Regression test for
// todos/archive/P3-2026-09-13-homescreen-recipeentryhub-a11y-leaf-fix-untested.md:
// HomeScreen had no co-located test file at all, so its accessible={false}
// fix (from todos/archive/P2-2026-09-05-bottomsheetmodal-callers-collapse-
// a11y-subtree-on-ios.md) had zero regression coverage. On new-arch iOS,
// @gorhom/bottom-sheet's default accessible=true makes the import-recipe
// sheet's wrapper an accessibility LEAF, hiding its content from VoiceOver
// AND Maestro (jsdom renders children plainly and cannot see the native
// leaf-collapse — this only pins that the prop is passed). See
// docs/solutions/logic-errors/
// gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
//
// HomeScreen is a heavy, hook/data-laden screen (unlike the simpler sibling
// sites already covered), so every collaborator not needed to reach the
// <BottomSheetModal> is stubbed as a thin double — mirrors
// MealPlanHomeScreen.test.tsx's "heavy screen" mocking footprint (that file's
// own accessible-prop assertion uses a different, local @gorhom/bottom-sheet
// override for its multi-sheet wiring test, not the shared mock below — cited
// here only for the mocking-footprint comparison). Assertion shape mirrors
// the sibling sites' proven pattern (RecipeBrowserScreen.params.test.tsx,
// BeveragePickerSheet.test.tsx) — the shared test/mocks/gorhom-bottom-sheet.ts
// mock reflects the `accessible` prop onto a `data-accessible` DOM attribute.
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import HomeScreen from "../HomeScreen";

// The shared test/mocks/react-native-reanimated.ts mock's `Animated` namespace
// only exports View/Text/createAnimatedComponent — HomeScreen (unlike any
// currently-tested screen) also renders `Animated.ScrollView` directly, which
// is otherwise `undefined` and crashes render ("Element type is invalid").
// Patch only the missing member here, local to this file, reusing the mock's
// own plain-div View renderer (mirrors how the shared mock already treats
// plain `ScrollView` from "react-native" as a div).
vi.mock("react-native-reanimated", async () => {
  const actual = await vi.importActual<
    typeof import("react-native-reanimated")
  >("react-native-reanimated");
  return {
    ...actual,
    default: {
      ...actual.default,
      ScrollView: actual.default.View,
    },
  };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useFocusEffect: () => {},
  // useSheetBackHandler (a real collaborator here) calls useIsFocused itself.
  useIsFocused: () => true,
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 49,
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: null }),
}));

vi.mock("@/hooks/useHomeActions", () => ({
  useHomeActions: () => ({
    sections: { nutrition: false, recipes: false, planning: false },
    toggleSection: vi.fn(),
    recentActions: [],
    recordAction: vi.fn(),
    usageCounts: {},
  }),
}));

vi.mock("@/hooks/useDailyBudget", () => ({
  useDailyBudget: () => ({
    data: undefined,
    refetch: vi.fn().mockResolvedValue(undefined),
    isRefetching: false,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/useScrollLinkedHeader", () => ({
  useScrollLinkedHeader: () => ({
    scrollHandler: vi.fn(),
    scrollY: { value: 0 },
    headerAnimatedStyle: {},
    collapsedBarAnimatedStyle: {},
    isBarVisible: false,
  }),
}));

vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: () => null,
  IMPORT_RECIPE_SNAP_POINTS: ["import-recipe"],
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

// ── Heavy home-screen children — thin doubles, none needed to prove the
// sheet's own accessible prop. ─────────────────────────────────────────────
vi.mock("@/components/home/HomeInlineDrawer", () => ({
  HomeInlineDrawer: () => null,
}));
vi.mock("@/components/home/DailySummaryHeader", () => ({
  DailySummaryHeader: () => null,
}));
vi.mock("@/components/home/RecipeCarousel", () => ({
  RecipeCarousel: () => null,
}));
vi.mock("@/components/home/CuratedRecipeCarousel", () => ({
  CuratedRecipeCarousel: () => null,
}));
vi.mock("@/components/home/RecentActionsRow", () => ({
  RecentActionsRow: () => null,
}));
vi.mock("@/components/home/DiscoveryCarousel", () => ({
  DiscoveryCarousel: () => null,
}));
vi.mock("@/components/home/CollapsibleSection", () => ({
  CollapsibleSection: () => null,
}));
vi.mock("@/components/home/ActionRow", () => ({
  ActionRow: () => null,
}));
vi.mock("@/components/home/QuickLogDrawer", () => ({
  QuickLogDrawer: () => null,
}));
vi.mock("@/components/home/RecipeSearchDrawer", () => ({
  RecipeSearchDrawer: () => null,
}));
vi.mock("@/components/home/GenerateRecipeDrawer", () => ({
  GenerateRecipeDrawer: () => null,
}));

describe("HomeScreen — iOS a11y-leaf fix", () => {
  it("passes accessible={false} to the import-recipe sheet (prevents the iOS a11y-leaf collapse; jsdom cannot verify the native effect)", () => {
    renderComponent(<HomeScreen />);
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });
});
