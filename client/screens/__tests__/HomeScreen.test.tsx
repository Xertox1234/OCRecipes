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
import { Platform } from "react-native";
import { scrollTo } from "react-native-reanimated";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import HomeScreen from "../HomeScreen";
import { QuickLogDrawer } from "@/components/home/QuickLogDrawer";
import { UpgradeModal } from "@/components/UpgradeModal";
import { glideToTopOffset } from "@/components/home/inline-drawer-utils";
import { Spacing, FAB_CLEARANCE } from "@/constants/theme";

// Defaults to false (every existing test relies on the collapsed bar being
// hidden). The Android-trap-covers-the-collapsed-bar block below is the only
// one that flips it, to prove the bar stays excluded from the Android a11y
// tree even while VISIBLE, if the import sheet is also open.
const {
  isBarVisibleHolder,
  authHolder,
  premiumHolder,
  measureHolder,
  scrollViewProps,
  keyboardListeners,
} = vi.hoisted(() => ({
  isBarVisibleHolder: { value: false },
  // Quick Log lock cells: the raw tier (what HomeScreen used to compare) and
  // the server-resolved features (what the gate must read) vary separately.
  authHolder: { user: null as { subscriptionTier: string } | null },
  premiumHolder: { textFoodParsing: false, isPremiumResolved: true },
  // What the reanimated mock's measure() reports. null = "not laid out", which
  // makes the glide bail before scrollTo; the keyboard-inset block sets a row.
  measureHolder: { value: null as { pageY: number } | null },
  // The props HomeScreen last passed Animated.ScrollView — jsdom cannot read a
  // contentContainerStyle object back off the DOM, so the double records them.
  scrollViewProps: { current: null as Record<string, unknown> | null },
  // Every live Keyboard.addListener subscription (removed ones are spliced out).
  keyboardListeners: [] as {
    event: string;
    handler: (e: unknown) => void;
  }[],
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
    // Opening an inline drawer glides its row (measure + scrollTo on the UI
    // thread); jsdom has no layout, so measure reports "not laid out" unless a
    // test sets measureHolder.
    measure: () => measureHolder.value,
    scrollTo: vi.fn(),
    default: {
      ...actual.default,
      // Same plain-div renderer as before, but recording the props HomeScreen
      // passes (see scrollViewProps).
      ScrollView: (props: Record<string, unknown>) => {
        scrollViewProps.current = props;
        return React.createElement(actual.default.View, props);
      },
    },
  };
});

// The shared react-native mock has no Keyboard (same gap QuickLogDrawer.test.tsx
// documents). HomeScreen subscribes to keyboard-show events; record them so a
// test can fire one. It has no RefreshControl either — harmless until a factory
// mock exists, because vitest then throws on ANY missing export that is read.
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  RefreshControl: () => null,
  Keyboard: {
    addListener: (event: string, handler: (e: unknown) => void) => {
      const entry = { event, handler };
      keyboardListeners.push(entry);
      return {
        remove: () => {
          const i = keyboardListeners.indexOf(entry);
          if (i >= 0) keyboardListeners.splice(i, 1);
        },
      };
    },
  },
}));

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
  useAuthContext: () => ({ user: authHolder.user }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: { textFoodParsing: premiumHolder.textFoodParsing },
    isPremiumResolved: premiumHolder.isPremiumResolved,
  }),
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
  UpgradeModal: vi.fn(() => null),
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
// Renders its children so the inline drawers (Quick Log's lock and open
// state) are reachable; every child is itself a thin double.
vi.mock("@/components/home/CollapsibleSection", () => ({
  CollapsibleSection: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/components/home/ActionRow", () => ({
  ActionRow: () => null,
}));
vi.mock("@/components/home/QuickLogDrawer", () => ({
  QuickLogDrawer: vi.fn(() => null),
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

  it("keeps the collapsed bar hidden when it is not visible (its own pre-existing rule) even with the import sheet closed", () => {
    isBarVisibleHolder.value = false;
    renderComponent(<HomeScreen />);
    expect(
      screen
        .getByTestId("home-collapsed-bar")
        .getAttribute("importantforaccessibility"),
    ).toBe("no-hide-descendants");
  });

  it("keeps the collapsed bar hidden when it is not visible and the import sheet is open — the fourth truth-table cell", () => {
    isBarVisibleHolder.value = false;
    renderComponent(<HomeScreen />);
    fireEvent.click(screen.getByTestId("open-import-sheet"));
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

describe("HomeScreen — Quick Log lock", () => {
  const quickLogProps = () => vi.mocked(QuickLogDrawer).mock.calls.at(-1)![0];
  const upgradeVisible = () =>
    vi.mocked(UpgradeModal).mock.calls.at(-1)![0].visible;

  beforeEach(() => {
    vi.mocked(QuickLogDrawer).mockClear();
    vi.mocked(UpgradeModal).mockClear();
    authHolder.user = { subscriptionTier: "free" };
    premiumHolder.textFoodParsing = false;
    premiumHolder.isPremiumResolved = true;
  });

  it("locks the row for a free account", () => {
    renderComponent(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(true);
  });

  it("leaves the row unlocked for premium (control)", () => {
    authHolder.user = { subscriptionTier: "premium" };
    premiumHolder.textFoodParsing = true;
    renderComponent(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(false);
  });

  it("locks the row for a lapsed subscriber whose raw tier still says premium", () => {
    authHolder.user = { subscriptionTier: "premium" };
    premiumHolder.textFoodParsing = false;
    renderComponent(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(true);
  });

  it("does not lock the row before the subscription has loaded (the server still gates)", () => {
    authHolder.user = { subscriptionTier: "premium" };
    premiumHolder.isPremiumResolved = false;
    renderComponent(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(false);
  });

  it("opens the upgrade modal, not the drawer, when a locked row is tapped", () => {
    renderComponent(<HomeScreen />);
    expect(upgradeVisible()).toBe(false);
    act(() => quickLogProps().onToggle());
    expect(upgradeVisible()).toBe(true);
    expect(quickLogProps().isOpen).toBe(false);
  });

  it("opens the drawer for premium, and closes it through onClose", () => {
    authHolder.user = { subscriptionTier: "premium" };
    premiumHolder.textFoodParsing = true;
    renderComponent(<HomeScreen />);
    expect(quickLogProps().isOpen).toBe(false);
    act(() => quickLogProps().onToggle());
    expect(quickLogProps().isOpen).toBe(true);
    expect(upgradeVisible()).toBe(false);
    act(() => quickLogProps().onClose());
    expect(quickLogProps().isOpen).toBe(false);
  });

  it("hands the drawer a results-shown callback for the glide", () => {
    renderComponent(<HomeScreen />);
    expect(typeof quickLogProps().onResultsShown).toBe("function");
  });

  // The subscription check can resolve AFTER a free/lapsed user has already
  // opened the row (isPremiumResolved arrives late). Without this, the
  // header repaints locked but the body stays open with a live input, and
  // the next tap closes the drawer instead of showing the upgrade flow.
  it("closes the drawer when the lock resolves to true while it is open", () => {
    premiumHolder.isPremiumResolved = false;
    const { rerender } = renderComponent(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(false);
    act(() => quickLogProps().onToggle());
    expect(quickLogProps().isOpen).toBe(true);

    premiumHolder.isPremiumResolved = true;
    rerender(<HomeScreen />);
    expect(quickLogProps().isLocked).toBe(true);
    expect(quickLogProps().isOpen).toBe(false);
  });
});

// Short Home page + inline drawer: iOS lays the keyboard over the page without
// shrinking the scroll view, so an open drawer's input needs scroll RANGE to be
// lifted above it. HomeScreen pads the content by the last keyboard height while
// a drawer is open and re-runs the glide once a keyboard shows. The padding is
// deliberately NOT removed when the keyboard hides: that shrinks the content
// beneath a lifted offset and the page snaps back in a single frame (observed
// on the iOS simulator — todos/archive/P2-2026-09-26-home-keyboard-covers-
// inline-drawer-input.md). The pure sizing rule is tested in
// inline-drawer-utils.test.ts; this block pins that HomeScreen is WIRED to it
// (docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-
// 2026-07-14.md).
describe("HomeScreen — keyboard inset for inline drawers", () => {
  const TAB_BAR_HEIGHT = 49; // the @react-navigation/bottom-tabs mock above
  const BASE_PADDING = TAB_BAR_HEIGHT + Spacing.xl + FAB_CLEARANCE;
  const KEYBOARD = 336;
  // insets.top is 0 in the safe-area mock, so the collapsed bar is just
  // HOME_HEADER_COLLAPSED tall.
  const COLLAPSED_BAR = 44;

  const quickLogProps = () => vi.mocked(QuickLogDrawer).mock.calls.at(-1)![0];
  const paddingBottom = () =>
    (
      scrollViewProps.current!.contentContainerStyle as {
        paddingBottom: number;
      }
    ).paddingBottom;
  /** Fire every live keyboard listener whose event name ends in `suffix`. */
  const fireKeyboard = (suffix: "Show" | "Hide", height = KEYBOARD) =>
    act(() => {
      for (const { event, handler } of [...keyboardListeners]) {
        if (event.endsWith(suffix)) handler({ endCoordinates: { height } });
      }
    });
  const openQuickLog = () => act(() => quickLogProps().onToggle());

  beforeEach(() => {
    vi.mocked(QuickLogDrawer).mockClear();
    // mockReset, not mockClear: the glide-ordering tests below install a
    // scrollTo implementation, and clear() would let it leak into the next test.
    vi.mocked(scrollTo).mockReset();
    measureHolder.value = null;
    scrollViewProps.current = null;
    authHolder.user = { subscriptionTier: "premium" };
    premiumHolder.textFoodParsing = true;
    premiumHolder.isPremiumResolved = true;
  });
  afterEach(() => {
    measureHolder.value = null;
    Platform.OS = "ios";
  });

  it("starts at the base bottom padding (tab bar + FAB clearance)", () => {
    renderComponent(<HomeScreen />);
    expect(paddingBottom()).toBe(BASE_PADDING);
  });

  it("pads the scroll content by the keyboard height plus a gap once it shows while a drawer is open", () => {
    renderComponent(<HomeScreen />);
    openQuickLog();
    fireKeyboard("Show");
    expect(paddingBottom()).toBe(KEYBOARD + Spacing.lg);
  });

  it("keeps that padding when the keyboard hides — dropping it would snap the page back (no layout jump)", () => {
    renderComponent(<HomeScreen />);
    openQuickLog();
    fireKeyboard("Show");
    const padded = paddingBottom();
    // Denominator: the padding really did grow, so "unchanged" below is a
    // statement about the hide, not a vacuous equality.
    expect(padded).toBeGreaterThan(BASE_PADDING);

    fireKeyboard("Hide");

    expect(paddingBottom()).toBe(padded);
  });

  it("returns to the base padding once the drawer closes", () => {
    renderComponent(<HomeScreen />);
    openQuickLog();
    fireKeyboard("Show");
    expect(paddingBottom()).toBeGreaterThan(BASE_PADDING);

    act(() => quickLogProps().onClose());

    expect(paddingBottom()).toBe(BASE_PADDING);
  });

  it("does not pad for a keyboard that shows while no drawer is open (e.g. the import sheet's input)", () => {
    measureHolder.value = { pageY: 600 };
    renderComponent(<HomeScreen />);
    fireKeyboard("Show");
    expect(paddingBottom()).toBe(BASE_PADDING);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("applies a keyboard height it already saw as soon as a drawer opens", () => {
    renderComponent(<HomeScreen />);
    fireKeyboard("Show");
    expect(paddingBottom()).toBe(BASE_PADDING);

    openQuickLog();

    expect(paddingBottom()).toBe(KEYBOARD + Spacing.lg);
  });

  it("re-runs the glide once the keyboard shows, now that the padding has made room", () => {
    measureHolder.value = { pageY: 600 };
    renderComponent(<HomeScreen />);
    openQuickLog(); // opening glides once, before any keyboard exists
    vi.mocked(scrollTo).mockClear();
    // Read the padding AT THE MOMENT scrollTo fires. On a device a glide issued
    // before React renders the grown padding is clamped by the old content
    // height, which is why the glide follows the commit in an effect instead of
    // running from the keyboard listener.
    const paddingAtGlide: number[] = [];
    vi.mocked(scrollTo).mockImplementation(() => {
      paddingAtGlide.push(paddingBottom());
    });

    fireKeyboard("Show");

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      glideToTopOffset(0, 600, COLLAPSED_BAR),
      expect.any(Boolean),
    );
    expect(paddingAtGlide).toEqual([KEYBOARD + Spacing.lg]);
  });

  it("glides again on every keyboard show, even at an unchanged keyboard height", () => {
    measureHolder.value = { pageY: 600 };
    renderComponent(<HomeScreen />);
    openQuickLog();
    vi.mocked(scrollTo).mockClear();

    fireKeyboard("Show");
    fireKeyboard("Show");

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  // The keyboard can already be up when a drawer opens (a drawer's text input
  // keeps focus after it collapses, and a header tap does not dismiss), so no
  // new show event will arrive to trigger the glide above. The open handler's
  // own glide runs BEFORE the render that applies the remembered padding, so a
  // second glide has to follow that commit.
  it("glides again once the remembered padding commits when a drawer opens with a keyboard height already known", () => {
    measureHolder.value = { pageY: 600 };
    renderComponent(<HomeScreen />);
    fireKeyboard("Show"); // no drawer open: nothing to glide, padding stays at base
    expect(scrollTo).not.toHaveBeenCalled();
    const paddingAtGlide: number[] = [];
    vi.mocked(scrollTo).mockImplementation(() => {
      paddingAtGlide.push(paddingBottom());
    });

    openQuickLog();

    // [the open handler's own glide, before the padding commits; the one that
    // follows the commit]
    expect(paddingAtGlide).toEqual([BASE_PADDING, KEYBOARD + Spacing.lg]);
  });

  it("does not glide when the drawer closes and the padding drops back (no open drawer left to lift)", () => {
    measureHolder.value = { pageY: 600 };
    renderComponent(<HomeScreen />);
    openQuickLog();
    fireKeyboard("Show");
    expect(paddingBottom()).toBe(KEYBOARD + Spacing.lg);
    vi.mocked(scrollTo).mockClear();

    act(() => quickLogProps().onClose());

    // The padding did change, so a padding-keyed glide is the thing under test.
    expect(paddingBottom()).toBe(BASE_PADDING);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("listens for keyboardWillShow on iOS", () => {
    renderComponent(<HomeScreen />);
    const events = keyboardListeners.map((l) => l.event);
    expect(events).toContain("keyboardWillShow");
    expect(events).not.toContain("keyboardDidShow");
  });

  it("listens for keyboardDidShow on Android, which has no will-events", () => {
    Platform.OS = "android";
    renderComponent(<HomeScreen />);
    const events = keyboardListeners.map((l) => l.event);
    expect(events).toContain("keyboardDidShow");
    expect(events).not.toContain("keyboardWillShow");
  });

  it("removes its keyboard listener on unmount", () => {
    const { unmount } = renderComponent(<HomeScreen />);
    expect(keyboardListeners.length).toBeGreaterThan(0);

    unmount();

    expect(keyboardListeners).toHaveLength(0);
  });
});
