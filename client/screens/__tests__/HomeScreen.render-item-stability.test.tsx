// @vitest-environment jsdom
/**
 * Regression test for M3 (2026-09-23 front-end audit,
 * todos/P1-2026-09-23-unstable-mutation-and-haptics-deps-on-compiler-skipped-screens.md):
 * `handleRefresh`, `handleActionPress`, `handleDrawerToggle`, and
 * `handleCalorieTap` all listed the whole `haptics` object (useHaptics()
 * return) in their own useCallback deps. useHaptics() used to return a fresh
 * object literal every render (its three inner functions were already
 * useCallback-stable), so all four callbacks got a new identity on every
 * HomeScreen re-render, including one caused by an unrelated action
 * elsewhere on the screen.
 *
 * Unlike the RecipeBrowserScreen/MealPlanHomeScreen tests for the same todo,
 * `useHaptics` IS mocked here with a fresh-wrapper-per-call (matching real
 * useMutation's instability profile, not the ALSO-real post-fix
 * useHaptics memoization) — this screen's fix is the per-callback
 * `impact`/`notification` destructuring (AC #1), and using the real,
 * now-memoized hook here would make the test pass even without that
 * destructuring (since a stable whole `haptics` object stays stable
 * regardless), masking the fix this test exists to verify. The hoisted
 * `stableImpact`/`stableNotification` inner functions ARE kept stable,
 * matching useHaptics.ts's real `useCallback`-wrapped inner functions.
 *
 * `handleDrawerToggle` is only ever passed downstream via an inline arrow
 * (`onToggle={() => handleDrawerToggle(action)}` in `renderInlineAction`),
 * so its own identity has no capturable prop boundary — it still gets the
 * code fix (for AC #1 and consistency with the other three), but this test
 * only asserts the three that ARE observable through a directly-passed prop:
 * `handleCalorieTap` (DailySummaryHeader.onCalorieTap), `handleRefresh`
 * (RefreshControl.onRefresh), and `handleActionPress` (RecentActionsRow.onActionPress).
 */
import React from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import HomeScreen from "../HomeScreen";

const {
  stableImpact,
  stableNotification,
  mockRecordAction,
  mockRefetch,
  capturedDailySummaryHeaderProps,
  capturedRecentActionsRowProps,
  refreshControlProps,
  navigation,
} = vi.hoisted(() => ({
  // useHaptics.ts's real impact/notification ARE useCallback-stable
  // (deps: [reducedMotion]) — hoisted here to reproduce that, inside an
  // otherwise fresh-per-call wrapper (see file header comment).
  stableImpact: vi.fn(),
  stableNotification: vi.fn(),
  mockRecordAction: vi.fn(),
  // useDailyBudget()'s real `refetch` is stable across re-renders for the
  // same observer — a fresh vi.fn() per mock call would itself defeat
  // handleRefresh/handleCalorieTap's identity for a reason unrelated to
  // this test's actual subject (the haptics destructuring).
  mockRefetch: vi.fn().mockResolvedValue(undefined),
  capturedDailySummaryHeaderProps: {
    current: null as null | Record<string, unknown>,
  },
  capturedRecentActionsRowProps: {
    current: null as null | Record<string, unknown>,
  },
  refreshControlProps: {
    current: null as null | { onRefresh?: () => void | Promise<void> },
  },
  // react-navigation's real useNavigation() returns the SAME memoized object
  // across re-renders — hoisted once here to match. handleCalorieTap depends
  // on the whole `navigation` object (not destructured).
  navigation: { navigate: vi.fn() },
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: stableImpact,
    notification: stableNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("react-native-reanimated", async () => {
  const actual = await vi.importActual<
    typeof import("react-native-reanimated")
  >("react-native-reanimated");
  // HomeScreen's root is `Animated.ScrollView` (reanimated), not plain
  // react-native's ScrollView — the shared mock's default ScrollView->View
  // alias renders `children` only, so a `refreshControl` element passed to
  // it is never reconciled (same root cause as
  // docs/solutions/conventions/refresh-control-onrefresh-unreachable-under-scrollview-mock-2026-09-25.md,
  // for the reanimated entry point instead of the plain react-native one).
  // Render it explicitly here, alongside children.
  const AnimatedScrollView = React.forwardRef<
    unknown,
    {
      children?: React.ReactNode;
      refreshControl?: React.ReactNode;
      testID?: string;
    } & Record<string, unknown>
  >(({ children, refreshControl, testID, ...rest }, ref) =>
    React.createElement(
      "div",
      { ...rest, "data-testid": testID, ref },
      refreshControl as React.ReactNode,
      children as React.ReactNode,
    ),
  );
  AnimatedScrollView.displayName = "Animated.ScrollView";
  return {
    ...actual,
    default: {
      ...actual.default,
      ScrollView: AnimatedScrollView,
    },
  };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => navigation,
  useFocusEffect: () => {},
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
    recordAction: mockRecordAction,
    usageCounts: {},
  }),
}));

vi.mock("@/hooks/useDailyBudget", () => ({
  useDailyBudget: () => ({
    data: undefined,
    refetch: mockRefetch,
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

vi.mock("@/components/home/HomeInlineDrawer", () => ({
  HomeInlineDrawer: () => null,
}));

// Capture point for handleCalorieTap — passed directly (unwrapped) as
// onCalorieTap.
vi.mock("@/components/home/DailySummaryHeader", () => ({
  DailySummaryHeader: (props: Record<string, unknown>) => {
    capturedDailySummaryHeaderProps.current = props;
    return null;
  },
}));

vi.mock("@/components/home/RecipeCarousel", () => ({
  RecipeCarousel: () => null,
}));
vi.mock("@/components/home/CuratedRecipeCarousel", () => ({
  CuratedRecipeCarousel: () => null,
}));

// Capture point for handleActionPress — passed directly (unwrapped) as
// onActionPress.
vi.mock("@/components/home/RecentActionsRow", () => ({
  RecentActionsRow: (props: Record<string, unknown>) => {
    capturedRecentActionsRowProps.current = props;
    return null;
  },
}));

// Renders one real button that invokes the REAL onActionPress with the real
// "import-recipe" HomeAction — used as this test's independent re-render
// trigger (opens the import sheet, an unrelated state change), exactly as
// HomeScreen.test.tsx's own Android-trap tests already do.
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

// HomeScreen's <RefreshControl> (imported from "react-native") is passed
// into Animated.ScrollView's `refreshControl` prop — captured here so its
// onRefresh is reachable (the reanimated mock override above is what makes
// this element actually get reconciled as a child at all).
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const RefreshControl = (props: {
    onRefresh?: () => void | Promise<void>;
  }) => {
    refreshControlProps.current = props;
    return null;
  };
  return { ...actual, RefreshControl };
});

describe("HomeScreen — haptics-dependent callback identity stability across an unrelated re-render (M3)", () => {
  beforeEach(() => {
    capturedDailySummaryHeaderProps.current = null;
    capturedRecentActionsRowProps.current = null;
    refreshControlProps.current = null;
  });

  it("keeps onCalorieTap, onRefresh, and onActionPress referentially stable when an unrelated action re-renders the screen", async () => {
    renderComponent(<HomeScreen />);

    await waitFor(() => {
      expect(capturedDailySummaryHeaderProps.current).toBeDefined();
      expect(capturedRecentActionsRowProps.current).toBeDefined();
      expect(refreshControlProps.current?.onRefresh).toBeInstanceOf(Function);
    });

    const firstCalorieTap = capturedDailySummaryHeaderProps.current!
      .onCalorieTap as () => void;
    const firstActionPress = capturedRecentActionsRowProps.current!
      .onActionPress as (action: unknown) => void;
    const firstRefresh = refreshControlProps.current!.onRefresh;

    // Denominator: opening the import sheet (via the real handleActionPress,
    // triggered on an UNRELATED action button) sets isImportSheetOpen, an
    // independent, visible state change that re-renders HomeScreen.
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-import-sheet"));
    });
    await waitFor(() => {
      expect(
        screen
          .getByTestId("home-scroll")
          .getAttribute("importantforaccessibility"),
      ).toBe("no-hide-descendants");
    });

    expect(capturedDailySummaryHeaderProps.current!.onCalorieTap).toBe(
      firstCalorieTap,
    );
    expect(capturedRecentActionsRowProps.current!.onActionPress).toBe(
      firstActionPress,
    );
    expect(refreshControlProps.current!.onRefresh).toBe(firstRefresh);
  });
});
