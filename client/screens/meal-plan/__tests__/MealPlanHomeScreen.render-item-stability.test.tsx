// @vitest-environment jsdom
/**
 * Regression test for M2 (2026-09-23 front-end audit,
 * todos/P1-2026-09-23-unstable-mutation-and-haptics-deps-on-compiler-skipped-screens.md):
 * `handleRemoveItem`, `handleReorder`, and `handleConfirmItem` listed their
 * whole `useMutation()` return (`removeMutation`/`reorderMutation`/
 * `confirmMutation`) in their own useCallback deps. TanStack Query's
 * useMutation() returns a brand-new wrapper object every render even though
 * `mutate` itself is useCallback-stable underneath — so these callbacks got a
 * new identity on every MealPlanHomeScreen re-render, defeating `MealSlotSection`'s
 * (and `DraggableList`'s) React.memo.
 *
 * `useHaptics` is intentionally left REAL/unmocked here (not stubbed to a
 * fresh-wrapper-per-call like some other tests in this suite) — after AC #3
 * of the same todo (useHaptics() now returns a memoized object), the `haptics`
 * whole-object dependency already used elsewhere in this file (e.g.
 * `handleAddItem`, `handleToggleSection`, `handleSuggest`) is stable too, so
 * this test isolates and proves specifically the MUTATION-destructuring fix
 * (M2's actual subject) without requiring every haptics-dependent callback in
 * this large screen to also be touched.
 *
 * Denominator note: unlike a FlatList/SectionList capture (where a captured
 * props object is ALWAYS fresh on every parent render, regardless of memo),
 * `DraggableList` here sits INSIDE the memo'd `MealSlotSection`. Once the fix
 * lands, `MealSlotSection`'s props (including its `onRemoveItem`/`onReorder`
 * callbacks) are all stable, so React.memo bails and `DraggableList` itself
 * does NOT re-render — the captured props object stays the SAME reference,
 * not merely its `renderItem`/`onReorder` sub-fields. The denominator (proof
 * that the SCREEN actually re-rendered) instead comes from an independent,
 * visible signal: expanding a DIFFERENT section (lunch).
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import MealPlanHomeScreen from "../MealPlanHomeScreen";
import { TIER_FEATURES } from "@shared/types/premium";

const {
  mockApiRequest,
  mealPlanItemsData,
  removeMutate,
  reorderMutate,
  confirmMutate,
  capturedDraggableListProps,
  INSTANT_ISO,
  navigation,
  stableToast,
} = vi.hoisted(() => {
  const INSTANT_ISO = "2026-01-15";
  const BREAKFAST_ITEM_1 = {
    id: 1,
    userId: "test-user",
    recipeId: null,
    scannedItemId: null,
    plannedDate: INSTANT_ISO,
    mealType: "breakfast",
    servings: "1",
    sortOrder: 0,
    createdAt: new Date(`${INSTANT_ISO}T08:00:00Z`),
    recipe: null,
    scannedItem: null,
  };
  const BREAKFAST_ITEM_2 = {
    ...BREAKFAST_ITEM_1,
    id: 2,
    sortOrder: 1,
  };
  return {
    mockApiRequest: vi.fn(),
    INSTANT_ISO,
    // react-navigation's real useNavigation() returns the SAME memoized
    // object across re-renders — hoisted once here to match. `handleItemPress`
    // depends on the whole `navigation` object (not destructured), and it is
    // ALSO a MealSlotSection prop (onItemPress) — a fresh-per-call mock here
    // would defeat MealSlotSection's memo for a reason unrelated to this
    // test's actual subject (the mutation deps).
    navigation: { navigate: vi.fn() },
    // useToast() is a useMemo'd context value in production
    // (ToastContext.tsx) — genuinely stable across re-renders.
    stableToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    mealPlanItemsData: {
      value: [BREAKFAST_ITEM_1, BREAKFAST_ITEM_2] as unknown[],
    },
    // Real useRemoveMealPlanItem()/useConfirmMealPlanItem()/
    // useReorderMealPlanItems() calls return `.mutate` (call sites use
    // `.mutate(...)`, not `.mutateAsync`) — hoisted so the mock's WRAPPER
    // object can be fresh-per-call (faithful to real useMutation) while this
    // inner function stays the same reference.
    removeMutate: vi.fn(),
    reorderMutate: vi.fn(),
    confirmMutate: vi.fn(),
    capturedDraggableListProps: {
      value: undefined as Record<string, unknown> | undefined,
    },
  };
});

vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: () => ({
    data: mealPlanItemsData.value,
    isLoading: false,
    isRefetching: false,
  }),
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // Fresh WRAPPER object each call (faithful to real useMutation), but a
  // stable `mutate` inside it — see the `removeMutate`/`reorderMutate`/
  // `confirmMutate` comment above.
  useRemoveMealPlanItem: () => ({ mutate: removeMutate, isPending: false }),
  useConfirmMealPlanItem: () => ({ mutate: confirmMutate, isPending: false }),
  useReorderMealPlanItems: () => ({ mutate: reorderMutate, isPending: false }),
  invalidateMealPlanItems: vi.fn(),
}));

vi.mock("@/hooks/useDailyBudget", () => ({
  useDailyBudget: () => ({
    data: { calorieGoal: 2000, foodCalories: 0, remaining: 2000 },
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePantry", () => ({
  useExpiringPantryItems: () => ({ data: [] }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => stableToast,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: TIER_FEATURES.free,
    isPremium: false,
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => navigation,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 49,
}));

vi.mock("@/components/meal-plan/AddItemMenuSheet", () => ({
  AddItemMenuSheetContent: () => null,
  ADD_ITEM_MENU_SNAP_POINTS: ["add-item-menu"],
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
  SimpleEntrySheetContent: () => null,
  SIMPLE_ENTRY_SNAP_POINTS: ["simple-entry"],
}));

vi.mock("@/components/MealSuggestionsModal", () => ({
  MealSuggestionsModal: () => null,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

// The capture point for this test — DraggableList sits directly inside
// MealSlotSection and receives `onReorder` (destructured from
// `reorderMutation`/`reorderMutate`) unwrapped, and a `renderItem` callback
// whose returned element tree carries `onRemove`/`onConfirm`
// (`handleRemoveItem`/`handleConfirmItem`) unwrapped too — see the
// `renderItem(item)` call below, which invokes it as a plain function
// (no hooks in its body) to read those nested props without rendering.
vi.mock("@/components/DraggableList", () => ({
  DraggableList: (props: Record<string, unknown>) => {
    capturedDraggableListProps.value = props;
    return null;
  },
}));

describe("MealPlanHomeScreen — memoized row callback identity stability across an unrelated re-render (M2)", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    // `today`/`selectedDate` (toLocalDateString) must match the seeded
    // items' plannedDate, and getAutoExpandedMealType() (new Date().getHours(),
    // no argument) must land in the breakfast window — pin TZ to UTC and the
    // system clock to 08:00 on that date so both derive correctly regardless
    // of the machine's local time/timezone.
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${INSTANT_ISO}T08:00:00.000Z`));
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    capturedDraggableListProps.value = undefined;
  });

  it("keeps DraggableList's onReorder, and MealSlotItem's onRemove/onConfirm (via renderItem), referentially stable across an unrelated re-render", async () => {
    renderComponent(<MealPlanHomeScreen />);

    await waitFor(() => {
      expect(capturedDraggableListProps.value).toBeDefined();
    });

    const firstProps = capturedDraggableListProps.value!;
    const firstOnReorder = firstProps.onReorder;
    const firstRenderItem = firstProps.renderItem as (item: {
      id: number;
    }) => React.ReactElement;
    expect(typeof firstOnReorder).toBe("function");
    expect(typeof firstRenderItem).toBe("function");

    // Invoke renderItem as a plain function (it closes over
    // onRemoveItem/onConfirmItem but calls no hooks itself) to read the
    // MealSlotItem element's props without rendering anything.
    const firstElement = firstRenderItem({ id: 1 });
    const firstMealSlotItem = (
      firstElement.props as {
        children: { props: { onRemove: unknown; onConfirm: unknown } };
      }
    ).children;
    const firstOnRemove = firstMealSlotItem.props.onRemove;
    const firstOnConfirm = firstMealSlotItem.props.onConfirm;
    expect(typeof firstOnRemove).toBe("function");
    expect(typeof firstOnConfirm).toBe("function");

    // Denominator: expand a DIFFERENT section (lunch) — this re-renders
    // MealPlanHomeScreen (and therefore re-evaluates the JSX for the
    // breakfast MealSlotSection too) without touching anything breakfast's
    // props actually depend on.
    fireEvent.click(screen.getByRole("button", { name: /lunch, collapsed/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^lunch, expanded$/i }),
      ).toBeTruthy();
    });

    const secondProps = capturedDraggableListProps.value!;
    // The denominator proved the SCREEN re-rendered; this proves
    // MealSlotSection's own React.memo bailed as a result (every prop it
    // receives, including onRemoveItem/onReorder/onConfirmItem, is now
    // stable) — DraggableList itself never re-rendered, so its captured
    // props object is the exact SAME reference as before, not merely its
    // individual callback fields.
    expect(secondProps).toBe(firstProps);
    expect(secondProps.onReorder).toBe(firstOnReorder);

    const secondRenderItem = secondProps.renderItem as (item: {
      id: number;
    }) => React.ReactElement;
    const secondElement = secondRenderItem({ id: 1 });
    const secondMealSlotItem = (
      secondElement.props as {
        children: { props: { onRemove: unknown; onConfirm: unknown } };
      }
    ).children;
    expect(secondMealSlotItem.props.onRemove).toBe(firstOnRemove);
    expect(secondMealSlotItem.props.onConfirm).toBe(firstOnConfirm);
  });
});
