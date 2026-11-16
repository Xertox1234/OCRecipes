// @vitest-environment jsdom
//
// The Plan tab's week grid. Renders the REAL screen, the real WeekGrid and the
// real useMealPlanSheets state machine; data hooks, navigation and the sheet
// contents are doubles (same footprint as MealPlanDayScreen.test.tsx).
import React from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import * as RN from "react-native";

import { TIER_FEATURES } from "@shared/types/premium";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

import { renderComponent } from "../../../../test/utils/render-component";
import MealPlanHomeScreen from "../MealPlanHomeScreen";
import { invalidateMealPlanItems } from "@/hooks/useMealPlan";

type SheetContentProps = { mealType: string | null; plannedDate?: string };
type AddItemMenuProps = SheetContentProps & {
  onChooseRecipe: () => void;
  onSimpleEntry: () => void;
  onImportRecipe: () => void;
  onSuggest?: () => void;
  dayLabel?: string;
};
type SuggestionsModalProps = {
  visible: boolean;
  date: string;
  mealType: string;
  onSelectSuggestion: (suggestion: MealSuggestion) => Promise<void> | void;
};
type CapturedSheet = { onDismiss?: () => void };

const {
  hookCalls,
  itemsData,
  queryState,
  plan,
  planCheck,
  navigate,
  haptics,
  expiring,
  addItemMenuProps,
  simpleEntryProps,
  capturedSheets,
  interactionQueue,
  refreshControlProps,
  upgradeModalProps,
  suggestionsModalProps,
  addMealPlanItem,
  toast,
} = vi.hoisted(() => ({
  suggestionsModalProps: { current: null as null | SuggestionsModalProps },
  addMealPlanItem: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  hookCalls: { mealPlanItems: [] as unknown[][] },
  itemsData: { value: [] as unknown[] | undefined },
  queryState: {
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    refetch: vi.fn(),
  },
  plan: { isPremium: false },
  planCheck: { planUnknown: false, recheckPlan: vi.fn() },
  navigate: vi.fn(),
  haptics: { impact: vi.fn(), selection: vi.fn(), notification: vi.fn() },
  expiring: { value: [] as unknown[] },
  addItemMenuProps: { current: null as null | AddItemMenuProps },
  simpleEntryProps: { current: null as null | SheetContentProps },
  capturedSheets: new Map<string, CapturedSheet>(),
  interactionQueue: [] as (() => void)[],
  refreshControlProps: {
    current: null as null | { onRefresh?: () => void | Promise<void> },
  },
  upgradeModalProps: { current: null as null | { visible: boolean } },
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: (...args: unknown[]) => {
    hookCalls.mealPlanItems.push(args);
    return {
      data: itemsData.value,
      isLoading: queryState.isLoading,
      isRefetching: false,
      isLoadingError: queryState.isLoadingError,
      isRefetchError: queryState.isRefetchError,
      isError: queryState.isLoadingError || queryState.isRefetchError,
      refetch: queryState.refetch,
    };
  },
  useAddMealPlanItem: () => ({
    mutateAsync: addMealPlanItem,
    isPending: false,
  }),
  invalidateMealPlanItems: vi.fn(),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePantry", () => ({
  useExpiringPantryItems: () => ({ data: expiring.value }),
}));

vi.mock("@/hooks/useHaptics", () => ({ useHaptics: () => haptics }));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => toast,
}));

vi.mock("@/components/MealSuggestionsModal", () => ({
  MealSuggestionsModal: (props: SuggestionsModalProps) => {
    suggestionsModalProps.current = props;
    return null;
  },
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: plan.isPremium ? TIER_FEATURES.premium : TIER_FEATURES.free,
    isPremium: plan.isPremium,
  }),
}));

vi.mock("@/hooks/usePlanCheck", () => ({
  usePlanCheck: () => planCheck,
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: vi.fn(),
  resolveImageUrl: (url: string | null | undefined) => url ?? null,
}));

vi.mock("@/components/FallbackImage", () => ({
  FallbackImage: () => null,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate }),
  // Runs the focus callback once on mount, like a first focus.
  useFocusEffect: (callback: () => void) => {
    React.useEffect(() => callback(), [callback]);
  },
  useIsFocused: () => true,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 49,
}));

// Sheet contents: observation points that record the props the real sheet
// state machine hands them. Sentinel snap points key the captured modals.
vi.mock("@/components/meal-plan/AddItemMenuSheet", () => ({
  AddItemMenuSheetContent: (props: AddItemMenuProps) => {
    addItemMenuProps.current = props;
    return null;
  },
  ADD_ITEM_MENU_WITH_SUGGEST_SNAP_POINTS: ["add-item-menu"],
}));

vi.mock("@/components/meal-plan/ImportRecipeSheet", () => ({
  ImportRecipeSheetContent: () => null,
  IMPORT_RECIPE_SNAP_POINTS: ["import-recipe"],
}));

vi.mock("@/components/meal-plan/QuickAddSheet", () => ({
  QuickAddSheetContent: () => null,
  QUICK_ADD_SNAP_POINTS: ["quick-add"],
}));

vi.mock("@/components/meal-plan/SimpleEntrySheet", () => ({
  SimpleEntrySheetContent: (props: SheetContentProps) => {
    simpleEntryProps.current = props;
    return null;
  },
  SIMPLE_ENTRY_SNAP_POINTS: ["simple-entry"],
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: (props: { visible: boolean }) => {
    upgradeModalProps.current = props;
    return null;
  },
}));

vi.mock("@/lib/run-after-transition", () => ({
  runAfterTransition: (callback: () => void) => {
    interactionQueue.push(callback);
  },
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const RefreshControl = (props: {
    onRefresh?: () => void | Promise<void>;
  }) => {
    refreshControlProps.current = props;
    return null;
  };
  // The shared ScrollView double never renders its `refreshControl` prop, so
  // RefreshControl would never mount. Render it as a child here.
  const ScrollView = React.forwardRef<unknown, Record<string, unknown>>(
    ({ children, refreshControl, ...rest }, ref) =>
      React.createElement(
        actual.ScrollView as React.ComponentType<Record<string, unknown>>,
        { ...rest, ref },
        refreshControl as React.ReactNode,
        children as React.ReactNode,
      ),
  );
  ScrollView.displayName = "ScrollView";
  return {
    ...actual,
    RefreshControl,
    ScrollView,
  };
});

vi.mock("@gorhom/bottom-sheet", () => {
  const BottomSheetModal = React.forwardRef(function BottomSheetModalMock(
    props: {
      snapPoints?: string[];
      onDismiss?: () => void;
      children?: React.ReactNode;
    },
    ref: React.Ref<{ present: () => void; dismiss: () => void }>,
  ) {
    capturedSheets.set(String(props.snapPoints?.[0] ?? "unknown"), {
      onDismiss: props.onDismiss,
    });
    React.useImperativeHandle(ref, () => ({
      present: () => {},
      dismiss: () => {},
    }));
    return props.children ?? null;
  });
  return { BottomSheetModal, BottomSheetBackdrop: () => null };
});

let nextId = 1;
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: nextId++,
    userId: "user-1",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-11-17",
    mealType: "dinner",
    servings: "1",
    sortOrder: 0,
    createdAt: new Date(),
    recipe: null,
    scannedItem: null,
    ...overrides,
  };
}

// Three filled slots (four items) in the week of Sun 15 to Sat 21 Nov 2026.
const WEEK_ITEMS = [
  makeItem({
    sortOrder: 0,
    recipeId: 1,
    recipe: { id: 1, title: "Tacos", caloriesPerServing: "610" },
  }),
  makeItem({
    sortOrder: 1,
    recipeId: 2,
    recipe: { id: 2, title: "Stir fry", caloriesPerServing: "540" },
  }),
  makeItem({
    plannedDate: "2026-11-18",
    mealType: "snack",
    scannedItemId: 5,
    scannedItem: { id: 5, productName: "Greek yogurt", calories: "120" },
  }),
  makeItem({
    plannedDate: "2026-11-16",
    mealType: "breakfast",
    recipeId: 3,
    recipe: { id: 3, title: "Oats", caloriesPerServing: "320" },
  }),
];

function lastWindow() {
  return hookCalls.mealPlanItems.at(-1);
}

describe("MealPlanHomeScreen — the week grid", () => {
  const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  const originalPlatformOS = RN.Platform.OS;

  beforeAll(() => {
    Element.prototype.scrollTo = vi.fn() as typeof Element.prototype.scrollTo;
    vi.useFakeTimers({ toFake: ["Date"] });
    // Monday 16 November 2026, midday local.
    vi.setSystemTime(new Date(2026, 10, 16, 12, 0, 0));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hookCalls.mealPlanItems.length = 0;
    itemsData.value = WEEK_ITEMS;
    queryState.isLoading = false;
    queryState.isLoadingError = false;
    queryState.isRefetchError = false;
    plan.isPremium = false;
    planCheck.planUnknown = false;
    expiring.value = [];
    addItemMenuProps.current = null;
    simpleEntryProps.current = null;
    upgradeModalProps.current = null;
    suggestionsModalProps.current = null;
    addMealPlanItem.mockResolvedValue({ id: 1 });
    capturedSheets.clear();
    interactionQueue.length = 0;
  });

  afterEach(() => {
    cleanup();
    RN.Platform.OS = originalPlatformOS;
  });

  it("requests the visible Sunday-to-Saturday week", () => {
    renderComponent(<MealPlanHomeScreen />);
    expect(lastWindow()).toEqual(["2026-11-15", "2026-11-21"]);
  });

  it("names the month of the week and counts the planned slots", () => {
    renderComponent(<MealPlanHomeScreen />);
    expect(screen.getByText("November 2026")).toBeDefined();
    // Three slots hold meals; Tuesday dinner's two items count once.
    expect(screen.getByText("3 of 28 planned")).toBeDefined();
  });

  it("pages the week with the arrows", () => {
    renderComponent(<MealPlanHomeScreen />);
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(lastWindow()).toEqual(["2026-11-22", "2026-11-28"]);
    fireEvent.click(screen.getByLabelText("Previous week"));
    fireEvent.click(screen.getByLabelText("Previous week"));
    expect(lastWindow()).toEqual(["2026-11-08", "2026-11-14"]);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  describe("the forward limit", () => {
    it("stops a free user past 7 days with the upgrade prompt, and keeps the week", () => {
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Next week"));
      expect(lastWindow()).toEqual(["2026-11-22", "2026-11-28"]);
      expect(upgradeModalProps.current?.visible).toBe(false);

      fireEvent.click(screen.getByLabelText("Next week"));
      expect(lastWindow()).toEqual(["2026-11-22", "2026-11-28"]);
      expect(upgradeModalProps.current?.visible).toBe(true);
      expect(haptics.notification).toHaveBeenCalledTimes(1);
    });

    it("lets a premium user go further", () => {
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Next week"));
      fireEvent.click(screen.getByLabelText("Next week"));
      expect(lastWindow()).toEqual(["2026-11-29", "2026-12-05"]);
      expect(upgradeModalProps.current?.visible).toBe(false);
    });

    it("rechecks the plan instead of upselling while the plan is unknown", () => {
      planCheck.planUnknown = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Next week"));
      fireEvent.click(screen.getByLabelText("Next week"));
      expect(lastWindow()).toEqual(["2026-11-22", "2026-11-28"]);
      expect(planCheck.recheckPlan).toHaveBeenCalledTimes(1);
      expect(upgradeModalProps.current?.visible).toBe(false);
    });
  });

  it("opens the day screen from a day header and from a filled cell", () => {
    renderComponent(<MealPlanHomeScreen />);
    fireEvent.click(
      screen.getByLabelText("Tuesday November 17, 1,150 calories planned"),
    );
    expect(navigate).toHaveBeenLastCalledWith("MealPlanDay", {
      date: "2026-11-17",
    });
    fireEvent.click(
      screen.getByLabelText("Wednesday snack, Greek yogurt, 120 calories"),
    );
    expect(navigate).toHaveBeenLastCalledWith("MealPlanDay", {
      date: "2026-11-18",
    });
  });

  describe("adding from a cell", () => {
    it("opens the add menu for that cell's meal", () => {
      renderComponent(<MealPlanHomeScreen />);
      expect(addItemMenuProps.current?.mealType ?? null).toBeNull();
      fireEvent.click(
        screen.getByLabelText("Tuesday lunch, empty, add a meal"),
      );
      expect(addItemMenuProps.current?.mealType).toBe("lunch");
      expect(haptics.selection).toHaveBeenCalledTimes(1);
    });

    it("plans the meal for the cell tapped last, not one opened and dismissed earlier", () => {
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(
        screen.getByLabelText("Tuesday lunch, empty, add a meal"),
      );
      act(() => capturedSheets.get("add-item-menu")?.onDismiss?.());

      fireEvent.click(
        screen.getByLabelText("Thursday dinner, empty, add a meal"),
      );
      act(() => addItemMenuProps.current?.onSimpleEntry());
      act(() => {
        interactionQueue.splice(0).forEach((run) => run());
      });

      expect(simpleEntryProps.current).toEqual(
        expect.objectContaining({
          mealType: "dinner",
          plannedDate: "2026-11-19",
        }),
      );
    });
  });

  describe("the shortcut chips", () => {
    it("keeps all four, with the pantry's expiring count", () => {
      expiring.value = [{ id: 1 }, { id: 2 }];
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Browse Recipes"));
      expect(navigate).toHaveBeenLastCalledWith("RecipeBrowser", {});
      fireEvent.click(screen.getByLabelText("Pantry, 2 expiring"));
      expect(navigate).toHaveBeenLastCalledWith("Pantry");
      fireEvent.click(screen.getByLabelText("Grocery Lists"));
      expect(navigate).toHaveBeenLastCalledWith("GroceryLists");
      fireEvent.click(screen.getByLabelText("Cookbooks"));
      expect(navigate).toHaveBeenLastCalledWith("CookbookList");
    });
  });

  describe("when the week fails to load", () => {
    it("shows the error state in place of the grid, with the chips and arrows still working", () => {
      itemsData.value = undefined;
      queryState.isLoadingError = true;
      renderComponent(<MealPlanHomeScreen />);

      expect(screen.getByText("Couldn't load your meal plan")).toBeDefined();
      expect(screen.queryByTestId("week-grid-scroll")).toBeNull();

      fireEvent.click(screen.getByLabelText("Next week"));
      expect(lastWindow()).toEqual(["2026-11-22", "2026-11-28"]);
      fireEvent.click(screen.getByLabelText("Browse Recipes"));
      expect(navigate).toHaveBeenLastCalledWith("RecipeBrowser", {});
    });

    it("retries from Try Again", () => {
      itemsData.value = undefined;
      queryState.isLoadingError = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByText("Try Again"));
      expect(queryState.refetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the stale grid when only a background refetch failed", () => {
      queryState.isRefetchError = true;
      renderComponent(<MealPlanHomeScreen />);
      expect(screen.queryByText("Couldn't load your meal plan")).toBeNull();
      expect(screen.getByTestId("week-grid-scroll")).toBeDefined();
      expect(screen.getByText("3 of 28 planned")).toBeDefined();
    });

    it("announces the error once when it appears, and never on mount", () => {
      const { rerender } = renderComponent(<MealPlanHomeScreen />);
      expect(announce).not.toHaveBeenCalled();

      itemsData.value = undefined;
      queryState.isLoadingError = true;
      rerender(<MealPlanHomeScreen />);
      rerender(<MealPlanHomeScreen />);
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        "Couldn't load your meal plan. Try again.",
      );
    });

    it("stays silent when the screen opens already in the error state", () => {
      itemsData.value = undefined;
      queryState.isLoadingError = true;
      renderComponent(<MealPlanHomeScreen />);
      expect(announce).not.toHaveBeenCalled();
    });
  });

  it("shows a skeleton, not the grid, while the first load is in flight", () => {
    itemsData.value = undefined;
    queryState.isLoading = true;
    renderComponent(<MealPlanHomeScreen />);
    expect(screen.getByTestId("meal-plan-loading-skeleton")).toBeDefined();
    expect(screen.queryByTestId("week-grid-scroll")).toBeNull();
  });

  it("pull-to-refresh reloads the meal plan", async () => {
    renderComponent(<MealPlanHomeScreen />);
    await act(async () => {
      await refreshControlProps.current?.onRefresh?.();
    });
    expect(invalidateMealPlanItems).toHaveBeenCalledTimes(1);
  });

  it("hides the background from TalkBack only while a sheet is open", () => {
    renderComponent(<MealPlanHomeScreen />);
    const hidden = () =>
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden");
    expect(hidden()).toBeNull();

    fireEvent.click(screen.getByLabelText("Tuesday lunch, empty, add a meal"));
    expect(hidden()).toBe("true");

    act(() => capturedSheets.get("add-item-menu")?.onDismiss?.());
    expect(hidden()).toBeNull();
  });

  it("registers exactly one hardware back listener for its four sheets", () => {
    RN.Platform.OS = "android";
    const addEventListener = vi.spyOn(RN.BackHandler, "addEventListener");
    renderComponent(<MealPlanHomeScreen />);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    addEventListener.mockRestore();
    expect([...capturedSheets.keys()].sort()).toEqual([
      "add-item-menu",
      "import-recipe",
      "quick-add",
      "simple-entry",
    ]);
  });

  describe("the add menu's title", () => {
    it("names the day of the cell, since the grid shows seven of them", () => {
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(
        screen.getByLabelText("Tuesday lunch, empty, add a meal"),
      );
      expect(addItemMenuProps.current?.dayLabel).toBe("Tue, Nov 17");
    });
  });

  describe("suggesting a meal from a cell", () => {
    const SUGGESTION: MealSuggestion = {
      title: "Lemon salmon",
      description: "Bright and quick",
      reasoning: "High in protein",
      calories: 520,
      protein: 38,
      carbs: 12,
      fat: 30,
      prepTimeMinutes: 20,
      difficulty: "Easy",
      ingredients: [{ name: "Salmon", quantity: "2", unit: "fillets" }],
      instructions: ["Roast", "Serve"],
      dietTags: ["pescatarian"],
    };

    /** Tuesday lunch → the menu's Suggest row → the deferred handoff. */
    function chooseSuggest() {
      fireEvent.click(
        screen.getByLabelText("Tuesday lunch, empty, add a meal"),
      );
      act(() => addItemMenuProps.current?.onSuggest?.());
      act(() => {
        interactionQueue.splice(0).forEach((run) => run());
      });
    }

    it("opens the suggestions for that cell's day and meal on a plan that includes them", () => {
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      expect(suggestionsModalProps.current?.visible).toBe(false);
      chooseSuggest();
      expect(suggestionsModalProps.current).toEqual(
        expect.objectContaining({
          visible: true,
          date: "2026-11-17",
          mealType: "lunch",
        }),
      );
      expect(upgradeModalProps.current?.visible).toBe(false);
    });

    it("adds the picked suggestion to that slot in one call and confirms it", async () => {
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      chooseSuggest();
      await act(async () => {
        await suggestionsModalProps.current?.onSelectSuggestion(SUGGESTION);
      });
      expect(addMealPlanItem).toHaveBeenCalledTimes(1);
      expect(addMealPlanItem).toHaveBeenCalledWith(
        expect.objectContaining({
          plannedDate: "2026-11-17",
          mealType: "lunch",
          recipe: expect.objectContaining({
            title: "Lemon salmon",
            sourceType: "ai_suggestion",
          }),
        }),
      );
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.error).not.toHaveBeenCalled();
      expect(suggestionsModalProps.current?.visible).toBe(false);
    });

    it("a failed add shows the error, no success, and keeps the suggestions open", async () => {
      plan.isPremium = true;
      addMealPlanItem.mockRejectedValue(new Error("nope"));
      renderComponent(<MealPlanHomeScreen />);
      chooseSuggest();
      await act(async () => {
        await suggestionsModalProps.current?.onSelectSuggestion(SUGGESTION);
      });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
      expect(suggestionsModalProps.current?.visible).toBe(true);
    });

    it("shows a free user the upgrade prompt instead", () => {
      renderComponent(<MealPlanHomeScreen />);
      chooseSuggest();
      expect(upgradeModalProps.current?.visible).toBe(true);
      expect(suggestionsModalProps.current?.visible).toBe(false);
      expect(haptics.notification).toHaveBeenCalledTimes(1);
    });

    it("offers no Suggest row while the plan is unknown", () => {
      planCheck.planUnknown = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(
        screen.getByLabelText("Tuesday lunch, empty, add a meal"),
      );
      expect(addItemMenuProps.current?.onSuggest).toBeUndefined();
    });
  });

  describe("the actions under the grid", () => {
    it("opens the grocery lists for everyone", () => {
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Open grocery lists"));
      expect(navigate).toHaveBeenLastCalledWith("GroceryLists");
    });

    it("hides Plan from pantry from a free user", () => {
      renderComponent(<MealPlanHomeScreen />);
      expect(screen.queryByLabelText("Plan meals from your pantry")).toBeNull();
    });

    it("hides Plan from pantry while the plan is unknown", () => {
      plan.isPremium = true;
      planCheck.planUnknown = true;
      renderComponent(<MealPlanHomeScreen />);
      expect(screen.queryByLabelText("Plan meals from your pantry")).toBeNull();
    });

    it("opens the pantry planner with its own default start for the current week", () => {
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Plan meals from your pantry"));
      expect(navigate).toHaveBeenLastCalledWith("ReceiptMealPlan", {
        startDate: undefined,
      });
    });

    it("starts the pantry planner on a future week's first day", () => {
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      fireEvent.click(screen.getByLabelText("Next week"));
      fireEvent.click(screen.getByLabelText("Plan meals from your pantry"));
      expect(navigate).toHaveBeenLastCalledWith("ReceiptMealPlan", {
        startDate: "2026-11-22",
      });
    });

    it("shows neither action when the week failed to load", () => {
      itemsData.value = undefined;
      queryState.isLoadingError = true;
      plan.isPremium = true;
      renderComponent(<MealPlanHomeScreen />);
      expect(screen.queryByLabelText("Open grocery lists")).toBeNull();
      expect(screen.queryByLabelText("Plan meals from your pantry")).toBeNull();
    });
  });
});
