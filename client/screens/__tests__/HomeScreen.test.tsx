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
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import HomeScreen from "../HomeScreen";

// Defaults to false (every existing test relies on the collapsed bar being
// hidden). The Android-trap-covers-the-collapsed-bar block below is the only
// one that flips it, to prove the bar stays excluded from the Android a11y
// tree even while VISIBLE, if the import sheet is also open.
const { isBarVisibleHolder } = vi.hoisted(() => ({
  isBarVisibleHolder: { value: false },
}));

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
    get isBarVisible() {
      return isBarVisibleHolder.value;
    },
  }),
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
// Renders one real button (not `() => null`) that invokes onActionPress with
// the real "import-recipe" HomeAction — the only UI path in this heavily
// stubbed screen that can trigger the import sheet for the background-trap
// tests below. action-config itself is NOT mocked, so this is the real action.
vi.mock("@/components/home/DiscoveryCarousel", async () => {
  const { HOME_ACTIONS } = await vi.importActual<
    typeof import("@/components/home/action-config")
  >("@/components/home/action-config");
  const importAction = HOME_ACTIONS.find((a) => a.id === "import-recipe");
  return {
    DiscoveryCarousel: ({
      onActionPress,
    }: {
      onActionPress: (action: unknown) => void;
    }) =>
      React.createElement(
        "button",
        {
          onClick: () => onActionPress(importAction),
          "data-testid": "open-import-sheet",
        },
        "Import a Recipe",
      ),
  };
});
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

// Android TalkBack background focus trap: iOS already has a working trap via
// accessibilityViewIsModal on the sheet's own content root (PR #1000); the
// Android lever is importantForAccessibility="no-hide-descendants" on the
// screen's OWN background content, applied only while the sheet is open.
// The background root here is Animated.ScrollView — the shared reanimated
// mock's mapA11yProps does NOT translate accessibilityElementsHidden/
// importantForAccessibility to aria-hidden (only test/mocks/react-native.ts's
// plain-component mockComponent does), so this pins the raw, untranslated
// attribute directly instead of aria-hidden. That's still a real,
// mutation-sensitive assertion (arguably more so — the value changes on every
// mutation, not just presence/absence) — see docs/solutions/conventions/
// jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
describe("HomeScreen — Android TalkBack background trap", () => {
  it("does not hide the background content before the import sheet opens", () => {
    renderComponent(<HomeScreen />);
    expect(
      screen
        .getByTestId("home-scroll")
        .getAttribute("importantforaccessibility"),
    ).toBe("auto");
  });

  it("hides the background content from the Android accessibility tree while the import sheet is open", () => {
    renderComponent(<HomeScreen />);
    fireEvent.click(screen.getByTestId("open-import-sheet"));
    expect(
      screen
        .getByTestId("home-scroll")
        .getAttribute("importantforaccessibility"),
    ).toBe("no-hide-descendants");
  });

  it("releases the background trap once the import sheet is dismissed — a trap that never releases makes the screen unusable to TalkBack", () => {
    renderComponent(<HomeScreen />);
    fireEvent.click(screen.getByTestId("open-import-sheet"));
    fireEvent.click(screen.getByTestId("close-import-sheet"));
    expect(
      screen
        .getByTestId("home-scroll")
        .getAttribute("importantforaccessibility"),
    ).toBe("auto");
  });
});

// Regression test for the review finding (2026-09-23): the collapsed summary
// bar is a SIBLING of the trapped ScrollView, not a descendant, so the
// ScrollView's own importantForAccessibility does not cover it. Isolates
// isBarVisible=true (the collapsed-bar-visible state) from isImportSheetOpen
// to prove the bar is excluded from the Android a11y tree on BOTH conditions
// independently, and reachable only when neither hides it.
describe("HomeScreen — Android TalkBack background trap also covers the collapsed bar sibling", () => {
  afterEach(() => {
    isBarVisibleHolder.value = false;
  });

  it("keeps the collapsed bar hidden while visible (its own pre-existing rule) even with the import sheet closed", () => {
    isBarVisibleHolder.value = false;
    renderComponent(<HomeScreen />);
    expect(
      screen
        .getByTestId("home-collapsed-bar")
        .getAttribute("importantforaccessibility"),
    ).toBe("no-hide-descendants");
  });

  it("exposes the collapsed bar when it is visible and no sheet is open", () => {
    isBarVisibleHolder.value = true;
    renderComponent(<HomeScreen />);
    expect(
      screen
        .getByTestId("home-collapsed-bar")
        .getAttribute("importantforaccessibility"),
    ).toBe("auto");
  });

  it("hides the visible collapsed bar from the Android accessibility tree while the import sheet is open — the gap a TalkBack user could otherwise reach behind the sheet", () => {
    isBarVisibleHolder.value = true;
    renderComponent(<HomeScreen />);
    fireEvent.click(screen.getByTestId("open-import-sheet"));
    expect(
      screen
        .getByTestId("home-collapsed-bar")
        .getAttribute("importantforaccessibility"),
    ).toBe("no-hide-descendants");
  });

  it("re-exposes the visible collapsed bar once the import sheet is dismissed", () => {
    isBarVisibleHolder.value = true;
    renderComponent(<HomeScreen />);
    fireEvent.click(screen.getByTestId("open-import-sheet"));
    fireEvent.click(screen.getByTestId("close-import-sheet"));
    expect(
      screen
        .getByTestId("home-collapsed-bar")
        .getAttribute("importantforaccessibility"),
    ).toBe("auto");
  });
});
