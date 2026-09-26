// @vitest-environment jsdom
//
// Wiring-integrity test for MealPlanHomeScreen's 5-BottomSheetModal /
// one-`activeSheet`-union / ONE `useSheetBackHandler` assembly
// (todos/archive/P3-2026-07-09-mealplan-sheet-wiring-test-coverage.md;
// consolidated from 4 state atoms + 4 back-handler calls by
// todos/archive/P1-2026-09-23-meal-plan-home-sheet-slot-consolidation.md).
//
// All 4 sheets (addItemMenu, importRecipe, quickAdd, simpleEntry) share ONE
// `activeSheet: {kind, mealType} | null` state and ONE `useSheetBackHandler`
// call, wired onto all 4 `<BottomSheetModal>`s' onChange/onAnimate props (see
// client/hooks/useSheetBackHandler.ts and
// docs/solutions/logic-errors/gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md).
// The prior 4-call-site architecture needed a documented "declaration order
// is load-bearing" comment to keep Android's reverse-registration dismiss
// precedence correct during a same-screen handoff (e.g. `handleChooseRecipe`)
// — the single-call architecture has no such ordering to get wrong, since
// there is only one registration and the currently-active kind is tracked
// directly.
//
// Strategy: render the REAL screen (useSheetBackHandler stays real — it's
// the system under test alongside the JSX wiring) with every collaborator
// mocked, and a local @gorhom/bottom-sheet override that captures each
// BottomSheetModal instance's onChange/onAnimate/onDismiss + a stable
// per-instance `dismiss` spy, keyed by the sheet's own snapPoints sentinel
// (not by JSX declaration order, so a future reorder of the 4
// <BottomSheetModal> blocks can't accidentally paper over a real wiring
// bug), and renders its `children` (needed so the mocked
// AddItemMenuSheetContent's crossover callback props are reachable). Sheets
// are opened through REAL production callbacks (a click on the rendered "Add
// ... item" button, then AddItemMenuSheetContent's captured
// onChooseRecipe/onSimpleEntry/onImportRecipe props) rather than by invoking
// a captured onChange directly — the old per-instance-closure test technique
// no longer identifies which of the 4 physical refs is "active" now that all
// 4 share one onChange function.
import React from "react";
import { act, cleanup, screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import MealPlanHomeScreen, {
  MealSlotItem,
  MealSlotSection,
} from "../MealPlanHomeScreen";
import { TIER_FEATURES } from "@shared/types/premium";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
// Mocked below (vi.mock("@/hooks/useMealPlan", ...)) — imported by name so
// the pull-to-refresh test can assert the screen calls it, not a re-derived
// predicate.
import { invalidateMealPlanItems } from "@/hooks/useMealPlan";

type CapturedSheet = {
  onChange?: (index: number) => void;
  onAnimate?: (fromIndex: number, toIndex: number) => void;
  onDismiss?: () => void;
  dismiss: ReturnType<typeof vi.fn>;
  accessible?: boolean;
};

type CapturedAddItemMenuProps = {
  onChooseRecipe: () => void;
  onSimpleEntry: () => void;
  onImportRecipe: () => void;
};

const {
  mockApiRequest,
  capturedSheets,
  hookCalls,
  mealPlanItemsData,
  mealPlanQueryState,
  dailyBudgetQueryState,
  refreshControlProps,
  capturedPressables,
  addItemMenuProps,
  interactionQueue,
} = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  capturedSheets: new Map<string, CapturedSheet>(),
  // Captures AddItemMenuSheetContent's crossover props (onChooseRecipe/
  // onSimpleEntry/onImportRecipe) so the unified-back-handler tests below can
  // drive the menu -> destination-sheet handoff through REAL production
  // callbacks instead of invoking a captured BottomSheetModal onChange
  // directly (which no longer identifies a specific ref now that all 4
  // sheets share one onChange function — see the file-header comment).
  addItemMenuProps: {
    current: null as null | CapturedAddItemMenuProps,
  },
  // InteractionManager.runAfterInteractions callbacks, queued instead of run
  // immediately so a test can assert the two-step handoff's ordering (close
  // the menu, THEN open the destination sheet) before flushing. See the
  // local react-native mock below.
  interactionQueue: [] as (() => void)[],
  // Recorded so the date-basis tests below can assert the ACTUAL query window
  // the screen requested, rather than re-deriving it (which would just restate
  // the implementation).
  hookCalls: {
    mealPlanItems: [] as unknown[][],
    dailyBudget: [] as unknown[][],
  },
  // Defaults to [] (every existing describe block relies on the empty-state
  // branch). The Android-trap-release block below is the only one that
  // populates this, to reach the per-meal-type sections (and their "Add
  // item" buttons) instead of the empty state's "Browse Recipes" CTA.
  mealPlanItemsData: { value: [] as unknown[] },
  // Overridden per-test by the isLoadingError/isRefetchError describe block
  // below; every other describe block relies on these (successful, non-error)
  // defaults.
  mealPlanQueryState: {
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    refetch: vi.fn(),
  },
  // Overridden per-test by the budget-announcement tests below; defaults to a
  // successful fetch so every other describe block renders the CalorieRing.
  dailyBudgetQueryState: {
    data: { calorieGoal: 2000, foodCalories: 0, remaining: 2000 } as
      | undefined
      | { calorieGoal: number; foodCalories: number; remaining: number },
    isError: false,
    refetch: vi.fn(),
  },
  // The test/mocks/react-native.ts ScrollView mock never actually renders its
  // `refreshControl` prop's element as a child (real RN's ScrollView natively
  // owns that render; the mock only spreads unrecognized props onto the DOM
  // node), so RefreshControl's onRefresh is otherwise unreachable from a
  // fireEvent — captured here the same way the @gorhom/bottom-sheet mock
  // below captures its own callbacks.
  refreshControlProps: {
    current: null as null | { onRefresh?: () => void | Promise<void> },
  },
  // Every rendered Pressable's raw props, captured in render order — the only
  // way to inspect `accessibilityActions`/`onAccessibilityAction` at all: the
  // shared mock's hand-written Pressable doesn't destructure either prop, so
  // `accessibilityActions` falls through `...rest` and is stringified to
  // "[object Object]" on the DOM node, and `onAccessibilityAction` (matching
  // React's `/^on[A-Z]/` DOM-event-handler heuristic) is dropped outright
  // before it ever reaches an attribute — see
  // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
  // Capturing at the mock-component boundary (before that spread) sidesteps
  // the gap entirely: a plain JS object passed to a component function is
  // never mangled the way a DOM attribute/event is. Find the entry under
  // test by a discriminating prop (usually `typeof p.onAccessibilityAction
  // === "function"`, since only the accessibility-actions-bearing Pressable
  // in a given render carries that prop at all) rather than by index, since
  // sibling Pressables (the visible Confirm/Remove buttons, the Suggest
  // chip) render into the same array.
  capturedPressables: [] as Record<string, unknown>[],
}));

// ── Data hooks — collaborators of the screen, not the SUT ──────────────────
vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: (...args: unknown[]) => {
    hookCalls.mealPlanItems.push(args);
    return {
      data: mealPlanItemsData.value,
      isLoading: mealPlanQueryState.isLoading,
      isRefetching: false,
      isLoadingError: mealPlanQueryState.isLoadingError,
      isRefetchError: mealPlanQueryState.isRefetchError,
      // TanStack v5: isError is true for BOTH a no-data failure and a
      // background-refetch failure. Derived (not omitted) so a reversion of
      // the screen's gate to a bare `if (isError)` blanks the stale week in
      // the isRefetchError test below instead of passing on `undefined`.
      isError:
        mealPlanQueryState.isLoadingError || mealPlanQueryState.isRefetchError,
      refetch: mealPlanQueryState.refetch,
    };
  },
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReorderMealPlanItems: () => ({ mutateAsync: vi.fn(), isPending: false }),
  invalidateMealPlanItems: vi.fn(),
}));

vi.mock("@/hooks/useDailyBudget", () => ({
  useDailyBudget: (...args: unknown[]) => {
    hookCalls.dailyBudget.push(args);
    return {
      data: dailyBudgetQueryState.data,
      isError: dailyBudgetQueryState.isError,
      refetch: dailyBudgetQueryState.refetch,
    };
  },
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePantry", () => ({
  useExpiringPantryItems: () => ({ data: [] }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: TIER_FEATURES.free,
    isPremium: false,
  }),
}));

// Only `apiRequest` is used directly by the screen (the inline daily-summary
// useQuery at MealPlanHomeScreen.tsx's fetch for /api/daily-summary); every
// other named hook that would otherwise reach it is mocked above.
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 44,
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 49,
}));

// ── Heavy sheet-content children — thin doubles. Each re-exports its own
// SNAP_POINTS constant as a sentinel string so the local BottomSheetModal
// mock below can key captured instances by sheet identity instead of JSX
// declaration order. The 4 sentinels below MUST stay distinct from each
// other — the real ADD_ITEM_MENU_SNAP_POINTS and SIMPLE_ENTRY_SNAP_POINTS
// both happen to be ["45%"], so if any of these 4 mocks is ever removed
// "as unnecessary," its sheet would fall back to a REAL snap-points constant
// that can collide with a sibling's, silently overwriting one sheet's
// capturedSheets entry with another's and making a later assertion pass
// against the wrong instance. ───────────────────────────────────────────
// Captures the menu's crossover props (see the addItemMenuProps hoisted
// comment above) instead of rendering `null` outright — this sheet's own
// BottomSheetModal now renders its actual `children` (see the local
// @gorhom/bottom-sheet mock below), so this component mounts and its props
// are readable regardless of the sheet's "open" state (jsdom has no visual
// presented/dismissed distinction to gate on, same as every other captured
// prop in this file). A pure observation point — always renders null.
vi.mock("@/components/meal-plan/AddItemMenuSheet", () => ({
  AddItemMenuSheetContent: (props: CapturedAddItemMenuProps) => {
    addItemMenuProps.current = props;
    return null;
  },
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

// Capture RefreshControl's onRefresh (see the refreshControlProps hoisted
// comment above). The shared mock's ScrollView never renders its
// `refreshControl` prop as a child (real RN's ScrollView owns that render
// natively; the mock only spreads unrecognized props onto the DOM node), so
// RefreshControl's own mock component would otherwise never execute — locally
// override ScrollView too, to actually render it. Every other export passes
// through to the real mock file unchanged.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const RefreshControl = (props: {
    onRefresh?: () => void | Promise<void>;
  }) => {
    refreshControlProps.current = props;
    return null;
  };
  // No `ref` is threaded through — MealPlanHomeScreen's own <ScrollView>
  // doesn't pass one — so a plain function component (not forwardRef) avoids
  // fighting the real react-native type declarations `actual.ScrollView`
  // carries (tsc resolves `typeof import("react-native")` against the real
  // package's types, not this project's Vite alias).
  const ScrollView = ({
    children,
    refreshControl,
    ...rest
  }: {
    children?: React.ReactNode;
    refreshControl?: React.ReactNode;
  } & Record<string, unknown>) =>
    React.createElement(
      actual.ScrollView as React.ComponentType<Record<string, unknown>>,
      rest,
      refreshControl,
      children,
    );
  ScrollView.displayName = "ScrollView";
  // Capture every rendered Pressable's raw props (see the capturedPressables
  // hoisted comment above) by delegating to the real mocked Pressable
  // unchanged — this is a pure observation point, not a behavior override,
  // so every other test in this file renders identically.
  const CapturingPressable = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      capturedPressables.push(props);
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  CapturingPressable.displayName = "Pressable";
  // test/mocks/react-native.ts does not export InteractionManager at all (it
  // is a hand-written mock, not a re-export of the real package), so the
  // screen's `InteractionManager.runAfterInteractions` calls (the
  // addItemMenu -> destination-sheet handoff) would throw `undefined is not
  // a function` the first time a test actually reaches them — previously
  // never exercised because AddItemMenuSheetContent was mocked to `() =>
  // null`. Queue instead of running synchronously, so a test can assert the
  // two-step handoff's ordering (menu closes, THEN the destination opens)
  // before flushing via the interactionQueue hoisted array.
  const InteractionManager = {
    runAfterInteractions: (callback: () => void) => {
      interactionQueue.push(callback);
      return { then: () => {}, done: () => {}, cancel: () => {} };
    },
  };
  return {
    ...actual,
    RefreshControl,
    ScrollView,
    Pressable: CapturingPressable,
    InteractionManager,
  };
});

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

// ── Local @gorhom/bottom-sheet override (shadows the global vitest.config.mts
// alias for this file only). The global mock renders onChange/onAnimate as
// inert attributes on a <div> — fine for content-sheet tests, useless here,
// since this test needs to invoke those callbacks directly per instance.
// `dismiss` is a bare spy (does NOT call onDismiss) so firing it doesn't run
// the screen's real onDismiss handlers or trigger any downstream re-render —
// most tests only need to prove "the right ref's dismiss fired", not exercise
// post-dismiss state cleanup. Renders `children` (unlike the old
// always-`null` version) so AddItemMenuSheetContent's mock actually mounts
// and its captured crossover props are reachable — every OTHER sheet's
// content mock still renders `null` itself, so this has no visible effect
// beyond making addItemMenuProps reachable. ──────────────
vi.mock("@gorhom/bottom-sheet", () => {
  const BottomSheetModal = React.forwardRef(function BottomSheetModalMock(
    props: {
      snapPoints?: string[];
      onChange?: (index: number) => void;
      onAnimate?: (fromIndex: number, toIndex: number) => void;
      onDismiss?: () => void;
      accessible?: boolean;
      children?: React.ReactNode;
    },
    ref: React.Ref<{ present: () => void; dismiss: () => void }>,
  ) {
    const dismissSpy = React.useRef(vi.fn());
    const key = String(props.snapPoints?.[0] ?? "unknown");
    capturedSheets.set(key, {
      onChange: props.onChange,
      onAnimate: props.onAnimate,
      // Captured (not invoked by dismissSpy — see the file-header comment)
      // so the Android-trap-release test can call it directly to simulate
      // the sheet becoming fully dismissed, the same way capturedFilterSheetRef
      // does for RecipeBrowserScreen's imperative sheet.
      onDismiss: props.onDismiss,
      dismiss: dismissSpy.current,
      accessible: props.accessible,
    });
    React.useImperativeHandle(ref, () => ({
      present: () => {},
      dismiss: dismissSpy.current,
    }));
    return props.children ?? null;
  });
  return {
    BottomSheetModal,
    BottomSheetBackdrop: () => null,
  };
});

const SHEETS = [
  { label: "addItemMenu", key: "add-item-menu" },
  { label: "importRecipe", key: "import-recipe" },
  { label: "quickAdd", key: "quick-add" },
  { label: "simpleEntry", key: "simple-entry" },
] as const;

describe("MealPlanHomeScreen — unified activeSheet back-handler wiring", () => {
  const originalPlatformOS = RN.Platform.OS;
  const originalTz = process.env.TZ;
  // Same pinned instant/local-day used by the date-basis and TalkBack-trap
  // blocks below — needed so the per-meal-type sections (and their "Add ...
  // item" buttons) render instead of the empty-state CTA.
  const INSTANT = new Date("2026-09-01T22:30:00Z");
  const FAKE_BREAKFAST_ITEM = {
    id: 1,
    userId: "test-user",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-09-02",
    mealType: "breakfast",
    servings: "1",
    sortOrder: 0,
    createdAt: INSTANT,
    recipe: null,
    scannedItem: null,
  };

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    capturedSheets.clear();
    addItemMenuProps.current = null;
    interactionQueue.length = 0;
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    mealPlanItemsData.value = [FAKE_BREAKFAST_ITEM];
  });

  afterEach(() => {
    // Unmount between tests — this file renders the same heavy screen
    // repeatedly in one describe block, and without an explicit cleanup a
    // still-mounted prior tree's useSheetBackHandler effect (and its
    // registered BackHandler listener) can outlive the test that mounted it,
    // corrupting later dismiss-call-count assertions.
    cleanup();
    mealPlanItemsData.value = [];
    // Platform.OS is a plain string property, not a function — mutate-and-restore
    // (matches useSheetBackHandler.test.ts's convention).
    RN.Platform.OS = originalPlatformOS;
    vi.restoreAllMocks();
  });

  /** Renders the screen with Android back-handling active and returns the
   *  BackHandler.addEventListener spy — exactly ONE call, for the screen's
   *  single shared `useSheetBackHandler` instance. */
  function renderScreenAndroid() {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    renderComponent(<MealPlanHomeScreen />);
    return addEventListenerSpy;
  }

  /** Fires a simulated Android hardware back press by invoking every
   *  registered listener (there is exactly one now) and returning whether
   *  any consumed the event. */
  function fireBackPress(addEventListenerSpy: ReturnType<typeof vi.spyOn>) {
    const handlers = addEventListenerSpy.mock.calls.map(
      (call: unknown[]) => call[1] as () => boolean,
    );
    for (const handler of [...handlers].reverse()) {
      if (handler()) return true;
    }
    return false;
  }

  /** Drains InteractionManager.runAfterInteractions callbacks queued by the
   *  local react-native mock (see above) — simulates the menu -> destination
   *  sheet handoff completing. */
  function flushInteractions() {
    const queued = interactionQueue.splice(0);
    for (const callback of queued) callback();
  }

  /** Clears every captured sheet's dismiss-call history — used after driving
   *  the screen into a particular open state (which itself calls .present()/
   *  .dismiss() via the present/dismiss effect) so a later assertion only
   *  observes calls triggered by the back-press simulation itself. */
  function clearDismissSpies() {
    for (const sheet of capturedSheets.values()) sheet.dismiss.mockClear();
  }

  function openAddItemMenu() {
    fireEvent.click(screen.getByRole("button", { name: /^Add \w+ item$/ }));
  }

  it("registers exactly 1 hardwareBackPress listener for the unified back handler", () => {
    const addEventListenerSpy = renderScreenAndroid();
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    for (const { key } of SHEETS) {
      expect(capturedSheets.get(key)?.onChange).toBeTypeOf("function");
      expect(capturedSheets.get(key)?.onAnimate).toBeTypeOf("function");
    }
  });

  it("opening the add-item-menu sheet via a real click makes back press dismiss only its own ref", () => {
    const addEventListenerSpy = renderScreenAndroid();
    openAddItemMenu();
    clearDismissSpies();

    expect(fireBackPress(addEventListenerSpy)).toBe(true);

    expect(capturedSheets.get("add-item-menu")!.dismiss).toHaveBeenCalledTimes(
      1,
    );
    for (const { key, label } of SHEETS) {
      if (key === "add-item-menu") continue;
      expect(
        capturedSheets.get(key)!.dismiss,
        `${label}'s ref must not be dismissed by the add-item-menu's back press`,
      ).not.toHaveBeenCalled();
    }
  });

  const CROSSOVER_DESTINATIONS = [
    { trigger: "onChooseRecipe", destKey: "quick-add", destLabel: "quickAdd" },
    {
      trigger: "onSimpleEntry",
      destKey: "simple-entry",
      destLabel: "simpleEntry",
    },
    {
      trigger: "onImportRecipe",
      destKey: "import-recipe",
      destLabel: "importRecipe",
    },
  ] as const;

  it.each(CROSSOVER_DESTINATIONS)(
    "menu -> $destLabel handoff: back press dismisses only the $destLabel sheet",
    ({ trigger, destKey }) => {
      const addEventListenerSpy = renderScreenAndroid();
      openAddItemMenu();

      act(() => {
        addItemMenuProps.current![trigger]();
      });
      act(() => {
        flushInteractions();
      });
      clearDismissSpies();

      expect(fireBackPress(addEventListenerSpy)).toBe(true);

      expect(capturedSheets.get(destKey)!.dismiss).toHaveBeenCalledTimes(1);
      for (const { key, label } of SHEETS) {
        if (key === destKey) continue;
        expect(
          capturedSheets.get(key)!.dismiss,
          `${label}'s ref must not be dismissed by the ${destKey} back press`,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it("a late onDismiss from the just-closed add-item-menu does not clobber the newly-opened quick-add sheet", () => {
    // gorhom's onDismiss fires on close-ANIMATION-complete; the menu ->
    // quickAdd handoff's InteractionManager scheduling is not guaranteed to
    // run strictly after it in production. A naive shared `setActiveSheet(null)`
    // in the menu's onDismiss would clobber quickAdd's just-opened state.
    const addEventListenerSpy = renderScreenAndroid();
    openAddItemMenu();
    act(() => {
      addItemMenuProps.current!.onChooseRecipe();
    });
    act(() => {
      flushInteractions();
    });

    act(() => {
      capturedSheets.get("add-item-menu")!.onDismiss?.();
    });

    // The Android background focus-trap stays engaged — quick-add is still
    // the active sheet.
    expect(
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden"),
    ).toBe("true");

    clearDismissSpies();
    expect(fireBackPress(addEventListenerSpy)).toBe(true);
    expect(capturedSheets.get("quick-add")!.dismiss).toHaveBeenCalledTimes(1);
  });

  // The 4 sheets share ONE onChange; a late onChange(-1) from the abandoned
  // menu can clear the shared isOpenRef while quick-add is genuinely open.
  // Correctness then rests on useSheetBackHandler's stateIsOpenRef fallback
  // (activeSheet !== null) — this pins it.
  it("a late onChange(-1) from the abandoned menu does not stop back from dismissing the newly-opened quick-add sheet", () => {
    const addEventListenerSpy = renderScreenAndroid();
    openAddItemMenu();
    act(() => {
      addItemMenuProps.current!.onChooseRecipe();
    });
    act(() => {
      flushInteractions();
    });

    act(() => {
      capturedSheets.get("quick-add")!.onChange?.(0);
      capturedSheets.get("add-item-menu")!.onChange?.(-1);
    });

    clearDismissSpies();
    expect(fireBackPress(addEventListenerSpy)).toBe(true);
    expect(capturedSheets.get("quick-add")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("a back press falls through (dismisses nothing) when no sheet is open", () => {
    const addEventListenerSpy = renderScreenAndroid();
    expect(fireBackPress(addEventListenerSpy)).toBe(false);
    for (const { key } of SHEETS) {
      expect(capturedSheets.get(key)!.dismiss).not.toHaveBeenCalled();
    }
  });
});

// ── Date-basis regression guard ────────────────────────────────────────────
//
// `planned_date` is keyed on the DEVICE-LOCAL calendar day, so the key a date
// chip reads/writes must be the same day that chip is labelled with. This was
// wrong for every UTC-positive device until
// todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md:
// `today` is normalised to LOCAL midnight (`setHours(0,0,0,0)`) and every
// display field reads local component getters, but the key was derived with
// `toDateString` (`toISOString()`), which reinterprets that local-midnight
// instant in UTC and lands one calendar day early whenever the offset is
// positive.
//
// CI runs UTC — the unique zone where the two bases agree — so the timezone is
// pinned explicitly here. `Europe/Berlin` does not transition DST at 00:00
// local, so `setHours(0,0,0,0)` always lands on a real midnight.
describe("MealPlanHomeScreen — planned_date is keyed to the local calendar day", () => {
  const originalTz = process.env.TZ;
  // 00:30 on Sep 2 in Berlin is still Sep 1 in UTC — the discriminating window.
  const INSTANT = new Date("2026-09-01T22:30:00Z");

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    hookCalls.mealPlanItems.length = 0;
    hookCalls.dailyBudget.length = 0;
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  afterEach(() => cleanup());

  it("pins the timezone and clock it claims to (guards the mechanism)", () => {
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(120);
    expect(new Date().toISOString()).toBe("2026-09-01T22:30:00.000Z");
  });

  it("keys the selected day to the local date, not the UTC date of local midnight", () => {
    renderComponent(<MealPlanHomeScreen />);
    // Local calendar day is Sep 2; the UTC day of that same instant is Sep 1.
    expect(hookCalls.dailyBudget.at(-1)?.[0]).toBe("2026-09-02");
  });

  it("requests a 7-day window covering exactly the days the strip renders", () => {
    const { container } = renderComponent(<MealPlanHomeScreen />);
    // Sep 2 2026 is a Wednesday, so the strip's week runs Sun Aug 30 → Sat Sep 5.
    expect(hookCalls.mealPlanItems.at(-1)).toEqual([
      "2026-08-30",
      "2026-09-05",
    ]);
    // Cross-surface pin: the window's bounds must be the SAME days the strip
    // labels. The labels come from `toLocaleDateString` on local components and
    // never touch the date helper, so they are basis-invariant — which is
    // exactly what makes them a usable independent reference for the window.
    // (Do not assert the ABSENCE of an "August 29" label here: no basis has
    // ever produced one, so such an assertion can never fail.)
    const labels = Array.from(
      container.querySelectorAll("[aria-label]"),
      (el) => el.getAttribute("aria-label") ?? "",
    );
    const stripDays = labels
      .map((l) => /^\w+day, (\w+ \d+)/.exec(l)?.[1])
      .filter((d): d is string => Boolean(d));
    expect(stripDays).toEqual([
      "August 30",
      "August 31",
      "September 1",
      "September 2",
      "September 3",
      "September 4",
      "September 5",
    ]);
  });

  it("sends the same local date to /api/daily-summary that it keys everything else on", () => {
    renderComponent(<MealPlanHomeScreen />);
    // The one other date-carrying call; it goes through apiRequest rather than a
    // hook, so it needs its own pin or it can drift off the shared basis.
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/daily-summary?date=2026-09-02",
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Timezone": expect.any(String) }),
      }),
    );
  });

  // NOTE: basis-invariant by construction — `dateStr` (:1364) and
  // `selectedDateStr` (:576) both go through the SAME helper, so swapping the
  // helper shifts both operands together and the same chip stays selected. It
  // is kept because it does guard the narrower property named below: a
  // single-site edit to either line breaks it. It is NOT a basis guard — the
  // literal pins above are. (Confirmed by mutation: reverting the import to
  // `toDateString` fails those three — the daily-budget, window, and
  // daily-summary pins — and leaves this one green.) Selection is exposed via
  // `accessibilityState`/`aria-selected`, not a label suffix (see the
  // dedicated single-announce test below), so this guard now keys off
  // `aria-selected` instead of a `", selected"` label substring.
  it("keeps the per-chip key and the selected key on one shared helper", () => {
    const { container } = renderComponent(<MealPlanHomeScreen />);
    const selected = Array.from(
      container.querySelectorAll('[aria-selected="true"]'),
      (el) => el.getAttribute("aria-label") ?? "",
    );
    expect(selected).toEqual(["Wednesday, September 2"]);
  });

  // P3-2026-09-23 (L12): the label used to append ", selected" ON TOP OF
  // accessibilityState={{selected}}, so VoiceOver/TalkBack announced the
  // selected state twice per chip. Selection must be state-only now.
  it("announces the selected date strip chip's selection once, via state only", () => {
    const { container } = renderComponent(<MealPlanHomeScreen />);
    const labelsWithSuffix = Array.from(
      container.querySelectorAll("[aria-label]"),
      (el) => el.getAttribute("aria-label") ?? "",
    ).filter((l) => l.includes(", selected"));
    expect(labelsWithSuffix).toEqual([]);

    const selectedChips = container.querySelectorAll('[aria-selected="true"]');
    expect(selectedChips).toHaveLength(1);
    expect(selectedChips[0]?.getAttribute("aria-label")).toBe(
      "Wednesday, September 2",
    );
  });
});

describe("MealPlanHomeScreen — iOS a11y-leaf fix (4 sheets)", () => {
  beforeEach(() => {
    capturedSheets.clear();
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  afterEach(() => cleanup());

  it.each(SHEETS)(
    "passes accessible={false} to the $label sheet (prevents the iOS a11y-leaf collapse; jsdom cannot verify the native effect)",
    ({ key, label }) => {
      // On new-arch iOS, @gorhom/bottom-sheet's default accessible=true makes
      // the wrapper an accessibility LEAF, hiding this sheet's content from
      // VoiceOver AND Maestro (jsdom renders children plainly and cannot see
      // the native leaf-collapse — this only pins that the prop is passed).
      // See docs/solutions/logic-errors/
      // gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
      renderComponent(<MealPlanHomeScreen />);
      const target = capturedSheets.get(key);
      expect(target, `no BottomSheetModal captured for ${label}`).toBeDefined();
      expect(target!.accessible).toBe(false);
    },
  );
});

// Android TalkBack background focus trap: iOS already has a working trap via
// accessibilityViewIsModal on each sheet's own content root (PR #1000); the
// Android lever is importantForAccessibility="no-hide-descendants" on the
// screen's OWN background ScrollView, applied while ANY of the 4 sheets is
// open — derived as a union of the 4 existing xxxMealType !== null booleans
// (no new state; these are the same booleans already passed as `isOpen` to
// each sheet's own useSheetBackHandler call). jsdom can't assert real
// a11y-tree exclusion — it maps the hiding-prop pair to aria-hidden
// (test/mocks/react-native.ts's ariaHiddenProps, via the plain ScrollView's
// mockComponent), so these tests pin THAT, per docs/solutions/conventions/
// jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
//
// Only the add-item-menu sheet is reachable through this file's mocking
// footprint: this file's own local @gorhom/bottom-sheet override (above)
// renders BottomSheetModal as `return null` (needed for its own onChange/
// onAnimate wiring-integrity tests), so no sheet's children ever mount —
// the other 3 sheets (importRecipe/quickAdd/simpleEntry) are only opened
// from callbacks passed into AddItemMenuSheetContent, itself mocked to
// `() => null`. Exercising add-item-menu's boolean is still a real,
// mutation-sensitive proof of the union expression (all 4 booleans compose
// identically via `!== null` — see MealPlanHomeScreen.tsx's isAnySheetOpen).
//
// The "Add item" button only renders once its meal-type section is
// expanded AND selectedDayItems is non-empty (otherwise the screen shows
// the "No meals planned yet" empty state instead of the per-meal-type
// sections) — so this block pins the clock the same way the
// "planned_date is keyed to the local calendar day" block above does
// (00:30 Europe/Berlin -> local calendar day 2026-09-02, hour 0 ->
// getAutoExpandedMealType() auto-expands "breakfast") and seeds one fake
// breakfast item for that exact date via mealPlanItemsData.
describe("MealPlanHomeScreen — Android TalkBack background trap", () => {
  const originalTz = process.env.TZ;
  const INSTANT = new Date("2026-09-01T22:30:00Z");
  const FAKE_BREAKFAST_ITEM = {
    id: 1,
    userId: "test-user",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-09-02",
    mealType: "breakfast",
    servings: "1",
    sortOrder: 0,
    createdAt: INSTANT,
    recipe: null,
    scannedItem: null,
  };

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    capturedSheets.clear();
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    mealPlanItemsData.value = [FAKE_BREAKFAST_ITEM];
  });

  afterEach(() => {
    mealPlanItemsData.value = [];
    cleanup();
  });

  it("does not hide the background content before any sheet opens", () => {
    renderComponent(<MealPlanHomeScreen />);
    expect(
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden"),
    ).toBeNull();
  });

  it("hides the background content from the Android accessibility tree while the add-item-menu sheet is open", () => {
    renderComponent(<MealPlanHomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Add \w+ item$/ }));
    expect(
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("releases the background trap once the add-item-menu sheet is dismissed — a trap that never releases makes the screen unusable to TalkBack", () => {
    renderComponent(<MealPlanHomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Add \w+ item$/ }));
    expect(
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden"),
    ).toBe("true");
    act(() => {
      capturedSheets.get("add-item-menu")!.onDismiss?.();
    });
    expect(
      screen.getByTestId("meal-plan-home-scroll").getAttribute("aria-hidden"),
    ).toBeNull();
  });
});

// P1-2026-09-23 (L6): handleRefresh used to hand-roll an
// `invalidateQueries({ queryKey: ["/api/meal-plan"] })` call instead of the
// shared `invalidateMealPlanItems` helper, and never refreshed daily-budget
// or daily-summary at all — so pull-to-refresh on this screen never updated
// the calorie ring or the confirmed-checkmarks.
describe("MealPlanHomeScreen — pull-to-refresh refreshes meal-plan, daily-budget, and daily-summary", () => {
  beforeEach(() => {
    capturedSheets.clear();
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    refreshControlProps.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("calls invalidateMealPlanItems and invalidates daily-budget + daily-summary on refresh", async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    renderComponent(<MealPlanHomeScreen />);

    expect(refreshControlProps.current?.onRefresh).toBeInstanceOf(Function);

    await act(async () => {
      await refreshControlProps.current?.onRefresh?.();
    });

    expect(invalidateMealPlanItems).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-budget"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-summary"],
    });

    invalidateSpy.mockRestore();
  });
});

// P2-2026-09-23 (M18): a failed initial fetch (isLoadingError — no cached
// data) previously rendered as an ordinary empty week (the screen only ever
// destructured isLoading/isRefetching from useMealPlanItems). A background
// refetch failure with cached data already on hand (isRefetchError) must NOT
// blank the screen — it should keep showing the stale week, the same "only
// error when there's no cached data" rule HistoryScreen's isError already
// follows (client/hooks/useHistoryData.ts).
describe("MealPlanHomeScreen — meal-plan fetch error handling", () => {
  // Same clock pin as the "Android TalkBack background trap" block above:
  // 00:30 Europe/Berlin on the local calendar day 2026-09-02 -> hour 0 ->
  // getAutoExpandedMealType() auto-expands "breakfast", so a breakfast item
  // for that date renders without needing to click a section header open.
  const originalTz = process.env.TZ;
  const INSTANT = new Date("2026-09-01T22:30:00Z");
  const FAKE_BREAKFAST_ITEM = {
    id: 1,
    userId: "test-user",
    recipeId: null,
    scannedItemId: null,
    plannedDate: "2026-09-02",
    mealType: "breakfast",
    servings: "1",
    sortOrder: 0,
    createdAt: INSTANT,
    recipe: { title: "Stale Pancakes" },
    scannedItem: null,
  };

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });

  afterAll(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    mealPlanItemsData.value = [];
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = false;
    mealPlanQueryState.isRefetchError = false;
    mealPlanQueryState.refetch = vi.fn();
    // Module-level capture — reset so a RefreshControl captured by an earlier
    // describe block can't make the "refresh stays wired" assertion pass.
    refreshControlProps.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  // The items error renders IN the scroll content where the list would go —
  // week navigation, the top-action buttons and pull-to-refresh don't depend
  // on the failed query and must stay usable (a full-screen early return used
  // to discard all three).
  it("keeps the week navigation, top actions and pull-to-refresh alive in the items-error state", () => {
    mealPlanQueryState.isLoadingError = true;

    renderComponent(<MealPlanHomeScreen />);

    expect(screen.getByText("Couldn't load your meal plan")).toBeDefined();
    expect(screen.getByLabelText("Previous week")).toBeDefined();
    expect(screen.getByLabelText("Next week")).toBeDefined();
    expect(screen.getByText("Grocery Lists")).toBeDefined();
    expect(refreshControlProps.current?.onRefresh).toBeInstanceOf(Function);
  });

  it("pull-to-refresh in the items-error state invalidates the meal plan", async () => {
    mealPlanQueryState.isLoadingError = true;
    vi.mocked(invalidateMealPlanItems).mockClear();

    renderComponent(<MealPlanHomeScreen />);
    await act(async () => {
      await refreshControlProps.current?.onRefresh?.();
    });

    expect(invalidateMealPlanItems).toHaveBeenCalledOnce();
  });

  it("shows an inline error state with retry on isLoadingError, instead of the empty-week state", () => {
    mealPlanQueryState.isLoadingError = true;

    renderComponent(<MealPlanHomeScreen />);

    expect(screen.getByText("Couldn't load your meal plan")).toBeDefined();
    expect(screen.getByText("Try Again")).toBeDefined();
    expect(screen.queryByText("No meals planned yet")).toBeNull();
  });

  it("calls the meal-plan query's refetch when Try Again is pressed", () => {
    mealPlanQueryState.isLoadingError = true;

    renderComponent(<MealPlanHomeScreen />);
    fireEvent.click(screen.getByText("Try Again"));

    expect(mealPlanQueryState.refetch).toHaveBeenCalledOnce();
  });

  it("keeps showing the stale week's items on isRefetchError instead of the error state", () => {
    mealPlanItemsData.value = [FAKE_BREAKFAST_ITEM];
    mealPlanQueryState.isRefetchError = true;

    renderComponent(<MealPlanHomeScreen />);

    expect(screen.getByText("Stale Pancakes")).toBeDefined();
    expect(screen.queryByText("Couldn't load your meal plan")).toBeNull();
  });
});

// The items and budget error EmptyStates have no live region, so each is
// announced cross-platform on its own error transition. Both announcements
// skip a screen that MOUNTS already errored (announcing on top of initial
// focus), so every test here starts in the loading skeleton and rerenders
// into the error — the transition a real failed fetch produces.
describe("MealPlanHomeScreen — fetch errors are announced for screen readers", () => {
  const ITEMS_COPY = "Couldn't load your meal plan. Try again.";
  const BUDGET_COPY = "Couldn't load your calorie budget. Try again.";
  // iOS drops the second of two same-commit announcements, so both errors
  // appearing together must be spoken as ONE utterance.
  const BOTH_COPY =
    "Couldn't load your meal plan or calorie budget. Try again.";
  const HAPPY_BUDGET = { calorieGoal: 2000, foodCalories: 0, remaining: 2000 };
  let announceSpy: ReturnType<typeof vi.spyOn>;

  const callsWith = (copy: string) =>
    announceSpy.mock.calls.filter((c: unknown[]) => c[0] === copy).length;

  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    mealPlanItemsData.value = [];
    mealPlanQueryState.isLoading = true;
    mealPlanQueryState.isLoadingError = false;
    mealPlanQueryState.isRefetchError = false;
    mealPlanQueryState.refetch = vi.fn();
    dailyBudgetQueryState.data = HAPPY_BUDGET;
    dailyBudgetQueryState.isError = false;
    dailyBudgetQueryState.refetch = vi.fn();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
    cleanup();
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = false;
    dailyBudgetQueryState.data = HAPPY_BUDGET;
    dailyBudgetQueryState.isError = false;
  });

  it("announces the meal-plan error exactly once on the isLoadingError transition", () => {
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = true;
    rerender(<MealPlanHomeScreen />);
    // An unrelated re-render with the error still showing must not repeat it.
    rerender(<MealPlanHomeScreen />);

    expect(announceSpy).toHaveBeenCalledExactlyOnceWith(ITEMS_COPY);
  });

  it("does not announce on the happy path", () => {
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    mealPlanQueryState.isLoading = false;
    rerender(<MealPlanHomeScreen />);

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("announces the budget error once when both queries fail, and not again when the items query is retried", () => {
    dailyBudgetQueryState.data = undefined;
    dailyBudgetQueryState.isError = true;
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    // Items fetch fails too — both EmptyStates are now on screen.
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = true;
    rerender(<MealPlanHomeScreen />);
    expect(screen.getByText("Couldn't load your calorie budget")).toBeDefined();
    expect(announceSpy).toHaveBeenCalledExactlyOnceWith(BOTH_COPY);

    // Tap Try Again on the items error: TanStack resets a data-less query to
    // pending (skeleton, error cleared), then it fails again. The budget
    // error never cleared, so it must not be re-announced.
    mealPlanQueryState.isLoading = true;
    mealPlanQueryState.isLoadingError = false;
    rerender(<MealPlanHomeScreen />);
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = true;
    rerender(<MealPlanHomeScreen />);

    expect(callsWith(BUDGET_COPY)).toBe(0);
    expect(callsWith(BOTH_COPY)).toBe(1);
    // The items error cleared (pending) and failed again, so IT re-announces
    // on its own — this pins the items re-arm.
    expect(callsWith(ITEMS_COPY)).toBe(1);
  });

  it("speaks one combined announcement when both errors appear in the same commit", () => {
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    // A shared outage: both queries fail in the same render.
    dailyBudgetQueryState.data = undefined;
    dailyBudgetQueryState.isError = true;
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = true;
    rerender(<MealPlanHomeScreen />);

    expect(announceSpy).toHaveBeenCalledExactlyOnceWith(BOTH_COPY);
  });

  it("does not announce when the screen mounts with the items error already showing", () => {
    mealPlanQueryState.isLoading = false;
    mealPlanQueryState.isLoadingError = true;
    const { rerender } = renderComponent(<MealPlanHomeScreen />);
    rerender(<MealPlanHomeScreen />);

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("does not announce when the screen mounts with the budget error already showing", () => {
    mealPlanQueryState.isLoading = false;
    dailyBudgetQueryState.data = undefined;
    dailyBudgetQueryState.isError = true;
    const { rerender } = renderComponent(<MealPlanHomeScreen />);
    rerender(<MealPlanHomeScreen />);

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("does not announce the budget error while the skeleton hides it, then announces once it is visible", () => {
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    // Budget fails while the items query is still loading (skeleton up).
    dailyBudgetQueryState.data = undefined;
    dailyBudgetQueryState.isError = true;
    rerender(<MealPlanHomeScreen />);
    expect(callsWith(BUDGET_COPY)).toBe(0);

    mealPlanQueryState.isLoading = false;
    rerender(<MealPlanHomeScreen />);
    expect(callsWith(BUDGET_COPY)).toBe(1);
  });

  it("re-announces the budget error after it clears and fails again", () => {
    mealPlanQueryState.isLoading = false;
    const { rerender } = renderComponent(<MealPlanHomeScreen />);

    dailyBudgetQueryState.data = undefined;
    dailyBudgetQueryState.isError = true;
    rerender(<MealPlanHomeScreen />);
    // Budget Try Again: the data-less query resets to pending (error cleared)…
    dailyBudgetQueryState.isError = false;
    rerender(<MealPlanHomeScreen />);
    // …and fails again.
    dailyBudgetQueryState.isError = true;
    rerender(<MealPlanHomeScreen />);

    expect(callsWith(BUDGET_COPY)).toBe(2);
  });
});

// P1-2026-09-23 (H2): MealSlotItem's Confirm/Remove buttons and
// MealSlotSection's Suggest chip are Pressables nested inside an `accessible`
// card/header Pressable (RN defaults `accessible={true}`), which collapses
// the whole subtree into one iOS VoiceOver focus stop (device-verified: an RN
// `accessible={true}` wrapper collapses its subtree on iOS but NOT on Android
// — see docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md
// item 9) — the nested buttons are visible and individually clickable in
// jsdom (which doesn't model the collapse) but unreachable on iOS VoiceOver.
// The accessibilityActions fix is additive/harmless on Android, where the
// nested buttons stay independently reachable regardless. The fix exposes
// each as an
// `accessibilityActions` entry on the card/header, mirroring
// CarouselRecipeCard's existing `toggleFavourite` pattern
// (client/components/home/CarouselRecipeCard.tsx:102-124).
//
// jsdom cannot observe `accessibilityActions`/`onAccessibilityAction` via the
// DOM or `fireEvent` at all (see the capturedPressables hoisted comment
// above) — these tests capture the raw props at the mock-component boundary
// instead, and render MealSlotItem/MealSlotSection in isolation (exported
// solely for this) rather than through the full screen, since neither
// depends on anything but `useTheme()`.
describe("MealSlotItem accessibility actions", () => {
  function makeItem(
    overrides: Record<string, unknown> = {},
  ): MealPlanItemWithRelations {
    return {
      id: 7,
      userId: "test-user",
      recipeId: null,
      scannedItemId: null,
      plannedDate: "2026-09-02",
      mealType: "breakfast",
      servings: "1",
      sortOrder: 0,
      createdAt: new Date("2026-09-01T00:00:00Z"),
      recipe: null,
      scannedItem: null,
      ...overrides,
    } as MealPlanItemWithRelations;
  }

  beforeEach(() => {
    capturedPressables.length = 0;
  });

  afterEach(() => cleanup());

  function findCardProps() {
    return capturedPressables.find(
      (p) => typeof p.onAccessibilityAction === "function",
    );
  }

  it("exposes only a remove action when the item cannot be confirmed", () => {
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm={false}
      />,
    );
    const cardProps = findCardProps();
    expect(
      cardProps,
      "no accessibility-actions Pressable captured",
    ).toBeDefined();
    expect(cardProps!.accessibilityActions).toEqual([
      { name: "remove", label: "Remove Item removed" },
    ]);
  });

  it("also exposes a confirm action when the item is confirmable and not yet confirmed", () => {
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm={true}
      />,
    );
    const cardProps = findCardProps();
    expect(cardProps!.accessibilityActions).toEqual([
      { name: "confirm", label: "Confirm Item removed as eaten" },
      { name: "remove", label: "Remove Item removed" },
    ]);
  });

  it("omits the confirm action once the item is already confirmed — nothing left to confirm", () => {
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={true}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm={true}
      />,
    );
    const cardProps = findCardProps();
    expect(cardProps!.accessibilityActions).toEqual([
      { name: "remove", label: "Remove Item removed" },
    ]);
  });

  it("dispatches onConfirm when the confirm accessibility action fires", () => {
    const onConfirm = vi.fn();
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={onConfirm}
        canConfirm={true}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "confirm" },
      });
    });
    expect(onConfirm).toHaveBeenCalledWith(7);
  });

  it("dispatches onRemove when the remove accessibility action fires", () => {
    const onRemove = vi.fn();
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={onRemove}
        onConfirm={vi.fn()}
        canConfirm={true}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "remove" },
      });
    });
    expect(onRemove).toHaveBeenCalledWith(7);
  });

  it("does not dispatch either handler for an unrecognized action name", () => {
    const onConfirm = vi.fn();
    const onRemove = vi.fn();
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={onRemove}
        onConfirm={onConfirm}
        canConfirm={true}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "unknown" },
      });
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("keeps the visible confirm and remove buttons independently reachable by touch, unaffected by the fix", () => {
    const onConfirm = vi.fn();
    const onRemove = vi.fn();
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={onRemove}
        onConfirm={onConfirm}
        canConfirm={true}
      />,
    );
    fireEvent.click(screen.getByLabelText("Confirm Item removed as eaten"));
    expect(onConfirm).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByLabelText("Remove Item removed"));
    expect(onRemove).toHaveBeenCalledWith(7);
  });
});

describe("MealSlotSection suggest accessibility action", () => {
  const baseSectionProps = {
    mealType: "breakfast" as const,
    items: [] as MealPlanItemWithRelations[],
    confirmedIds: new Set<number>(),
    onItemPress: vi.fn(),
    onRemoveItem: vi.fn(),
    onAddItem: vi.fn(),
    onConfirmItem: vi.fn(),
    onToggle: vi.fn(),
    sectionSummary: { itemCount: 0, totalCalories: 0 },
  };

  beforeEach(() => {
    capturedPressables.length = 0;
  });

  afterEach(() => cleanup());

  function findHeaderProps() {
    return capturedPressables.find(
      (p) => typeof p.onAccessibilityAction === "function",
    );
  }

  it("exposes a suggest action when the section is expanded", () => {
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={vi.fn()}
        canSuggest={true}
        canConfirm={false}
        isExpanded={true}
      />,
    );
    const headerProps = findHeaderProps();
    expect(
      headerProps,
      "no accessibility-actions Pressable captured",
    ).toBeDefined();
    expect(headerProps!.accessibilityActions).toEqual([
      { name: "suggest", label: "AI suggest breakfast" },
    ]);
  });

  it("labels the suggest action as an upgrade prompt when suggestions are gated", () => {
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={vi.fn()}
        canSuggest={false}
        canConfirm={false}
        isExpanded={true}
      />,
    );
    const headerProps = findHeaderProps();
    expect(headerProps!.accessibilityActions).toEqual([
      { name: "suggest", label: "Upgrade to suggest breakfast" },
    ]);
  });

  it("exposes no suggest action while collapsed — no Suggest chip is rendered to route it to", () => {
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={vi.fn()}
        canSuggest={true}
        canConfirm={false}
        isExpanded={false}
      />,
    );
    const headerProps = findHeaderProps();
    expect(headerProps!.accessibilityActions).toBeUndefined();
  });

  it("dispatches onSuggest when the suggest accessibility action fires", () => {
    const onSuggest = vi.fn();
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={onSuggest}
        canSuggest={true}
        canConfirm={false}
        isExpanded={true}
      />,
    );
    const headerProps = findHeaderProps();
    act(() => {
      (headerProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "suggest" },
      });
    });
    expect(onSuggest).toHaveBeenCalledWith("breakfast");
  });

  it("does not dispatch onSuggest for an unrecognized action name", () => {
    const onSuggest = vi.fn();
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={onSuggest}
        canSuggest={true}
        canConfirm={false}
        isExpanded={true}
      />,
    );
    const headerProps = findHeaderProps();
    act(() => {
      (headerProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "unknown" },
      });
    });
    expect(onSuggest).not.toHaveBeenCalled();
  });

  it("keeps the visible Suggest chip independently reachable by touch, unaffected by the fix", () => {
    const onSuggest = vi.fn();
    renderComponent(
      <MealSlotSection
        {...baseSectionProps}
        onSuggest={onSuggest}
        canSuggest={true}
        canConfirm={false}
        isExpanded={true}
      />,
    );
    fireEvent.click(screen.getByLabelText("AI suggest breakfast"));
    expect(onSuggest).toHaveBeenCalledWith("breakfast");
  });
});

// Regression coverage for todos/archive/P2-2026-09-23-touch-targets-regressed-below-44pt.md
// (M13, 2026-09-23 front-end audit): the confirm (20pt icon + hitSlop 8 =
// 36pt) and remove (16pt icon + hitSlop 8 = 32pt) Pressables on a meal-slot
// row both fall below the 44pt platform minimum. Reuses this file's
// `capturedPressables` mock-boundary capture (see the "MealSlotItem
// accessibility actions" describe block above) rather than a DOM-based
// assertion — the shared react-native mock's Pressable drops `style` before
// rendering, so a rendered node can't reveal it either way.
describe("MealSlotItem touch targets (P2-2026-09-23, M13)", () => {
  function makeItem(
    overrides: Record<string, unknown> = {},
  ): MealPlanItemWithRelations {
    return {
      id: 7,
      userId: "test-user",
      recipeId: null,
      scannedItemId: null,
      plannedDate: "2026-09-02",
      mealType: "breakfast",
      servings: "1",
      sortOrder: 0,
      createdAt: new Date("2026-09-01T00:00:00Z"),
      recipe: null,
      scannedItem: null,
      ...overrides,
    } as MealPlanItemWithRelations;
  }

  beforeEach(() => {
    capturedPressables.length = 0;
  });

  afterEach(() => cleanup());

  function flattenStyle(
    style: unknown,
    pressed = false,
  ): Record<string, unknown> {
    if (typeof style === "function") {
      return flattenStyle(
        (style as (state: { pressed: boolean }) => unknown)({ pressed }),
      );
    }
    if (Array.isArray(style)) {
      return style.reduce(
        (acc: Record<string, unknown>, s) => ({ ...acc, ...flattenStyle(s) }),
        {},
      );
    }
    return (style as Record<string, unknown> | null | undefined) ?? {};
  }

  function flattenHitSlop(hitSlop: unknown): {
    top: number;
    bottom: number;
    left: number;
    right: number;
  } {
    if (typeof hitSlop === "number") {
      return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
    }
    if (hitSlop && typeof hitSlop === "object") {
      const h = hitSlop as Record<string, number>;
      return {
        top: h.top ?? 0,
        bottom: h.bottom ?? 0,
        left: h.left ?? 0,
        right: h.right ?? 0,
      };
    }
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  /** visual box size (explicit width/height, or minWidth/minHeight, or the
   * given fallback) PLUS hitSlop on each axis — hitSlop always adds to the
   * visual box, it never gets shadowed by an explicit size. */
  function effectiveTouchSize(
    props: Record<string, unknown> | undefined,
    fallbackVisualSize: number,
  ): { width: number; height: number } {
    const style = flattenStyle(props?.style);
    const hitSlop = flattenHitSlop(props?.hitSlop);
    const visualWidth =
      typeof style.width === "number"
        ? style.width
        : typeof style.minWidth === "number"
          ? style.minWidth
          : fallbackVisualSize;
    const visualHeight =
      typeof style.height === "number"
        ? style.height
        : typeof style.minHeight === "number"
          ? style.minHeight
          : fallbackVisualSize;
    return {
      width: visualWidth + hitSlop.left + hitSlop.right,
      height: visualHeight + hitSlop.top + hitSlop.bottom,
    };
  }

  it("Confirm and Remove buttons both reach 44pt on both axes", () => {
    renderComponent(
      <MealSlotItem
        item={makeItem()}
        isConfirmed={false}
        onPress={vi.fn()}
        onRemove={vi.fn()}
        onConfirm={vi.fn()}
        canConfirm={true}
      />,
    );

    const confirmProps = capturedPressables.find(
      (p) => p.accessibilityLabel === "Confirm Item removed as eaten",
    );
    const removeProps = capturedPressables.find(
      (p) => p.accessibilityLabel === "Remove Item removed",
    );
    expect(confirmProps, "confirm Pressable not captured").toBeDefined();
    expect(removeProps, "remove Pressable not captured").toBeDefined();

    // Feather "circle" (confirm) is rendered at size={20}; Feather "x"
    // (remove) at size={16} — both from MealPlanHomeScreen.tsx's MealSlotItem.
    const confirm = effectiveTouchSize(confirmProps, 20);
    const remove = effectiveTouchSize(removeProps, 16);
    expect(confirm.width).toBeGreaterThanOrEqual(44);
    expect(confirm.height).toBeGreaterThanOrEqual(44);
    expect(remove.width).toBeGreaterThanOrEqual(44);
    expect(remove.height).toBeGreaterThanOrEqual(44);
  });
});

// P2-2026-09-23 (M15): the loading skeleton must be one hidden region (both
// platforms) with a delayed announce, not a container whose own
// accessibilityLabel is hidden along with the decorative boxes. Fake timers
// scoped to this describe only, mirroring NutritionDetailScreen.test.tsx's
// loading-branch characterisation.
describe("MealPlanHomeScreen — loading skeleton screen-reader signal", () => {
  beforeEach(() => {
    mealPlanQueryState.isLoading = true;
    mealPlanQueryState.isLoadingError = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    mealPlanQueryState.isLoading = false;
  });

  it("hides the skeleton region from screen readers as one unit", () => {
    renderComponent(<MealPlanHomeScreen />);
    const region = screen.getByTestId("meal-plan-loading-skeleton");
    expect(region.getAttribute("aria-hidden")).toBe("true");
  });

  // Fails on main: today the region itself carries `accessibilityLabel=
  // "Loading..."` alongside `accessibilityElementsHidden`, which hides the
  // label along with the decorative boxes on iOS.
  it("does not carry its own hidden Loading label", () => {
    renderComponent(<MealPlanHomeScreen />);
    expect(screen.queryByLabelText("Loading...")).toBeNull();
  });

  it("does not announce Loading synchronously, then announces it once after the delay", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      renderComponent(<MealPlanHomeScreen />);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");

      vi.advanceTimersByTime(500);

      expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("cancels the pending Loading announce if the screen unmounts before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { unmount } = renderComponent(<MealPlanHomeScreen />);
      unmount();
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });
});
