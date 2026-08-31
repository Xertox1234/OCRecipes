// @vitest-environment jsdom
//
// Wiring-integrity test for MealPlanHomeScreen's 4 BottomSheetModal ->
// useSheetBackHandler assembly (todos/archive/P3-2026-07-09-mealplan-sheet-wiring-test-coverage.md).
//
// Each of the 4 sheets (addItemMenu, importRecipe, quickAdd, simpleEntry)
// calls its own `useSheetBackHandler(ref, isOpen)` and must wire the
// returned onSheetChange/onSheetAnimate onto ITS OWN BottomSheetModal's
// onChange/onAnimate props (see client/hooks/useSheetBackHandler.ts and
// docs/solutions/logic-errors/gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md).
// A copy-paste swap of two sheets' callbacks would silently misroute
// Android back-button dismissal for one sheet while leaving the others
// looking correct — nothing previously caught that, since each hook
// instance is only unit-tested in isolation (useSheetBackHandler.test.ts).
//
// Strategy: render the REAL screen (useSheetBackHandler stays real — it's
// the system under test alongside the JSX wiring) with every collaborator
// mocked, and a local @gorhom/bottom-sheet override that captures each
// BottomSheetModal instance's onChange/onAnimate + a stable per-instance
// `dismiss` spy, keyed by the sheet's own snapPoints sentinel (not by JSX
// declaration order, so a future reorder of the 4 <BottomSheetModal>
// blocks can't accidentally paper over a real wiring bug). For each sheet,
// invoking its own onChange/onAnimate must dismiss ONLY its own ref.
//
// Coverage boundary: the above JSX-block-order robustness is a DIFFERENT
// axis from the four `useSheetBackHandler(...)` CALL-SITE order in
// MealPlanHomeScreen.tsx, which sets each hook's mount-time
// `BackHandler.addEventListener` registration order and therefore Android's
// reverse-registration (last-registered-first) dismiss precedence during a
// same-screen handoff like handleChooseRecipe (see MealPlanHomeScreen.tsx's
// "Declaration order below is load-bearing" comment, just above its own
// four `useSheetBackHandler(...)` calls). `fireBackPress` below DOES
// dispatch through the real registered listeners in reverse order, but
// every test here opens only ONE sheet before firing — no test ever has two
// sheets simultaneously "open" (the mid-handoff case where registration
// order actually decides which listener wins), so reordering those 4 call
// sites would NOT fail this test.
import React from "react";
import { act, cleanup } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import MealPlanHomeScreen from "../MealPlanHomeScreen";
import { TIER_FEATURES } from "@shared/types/premium";

type CapturedSheet = {
  onChange?: (index: number) => void;
  onAnimate?: (fromIndex: number, toIndex: number) => void;
  dismiss: ReturnType<typeof vi.fn>;
};

const { mockApiRequest, capturedSheets, hookCalls } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  capturedSheets: new Map<string, CapturedSheet>(),
  // Recorded so the date-basis tests below can assert the ACTUAL query window
  // the screen requested, rather than re-deriving it (which would just restate
  // the implementation).
  hookCalls: {
    mealPlanItems: [] as unknown[][],
    dailyBudget: [] as unknown[][],
  },
}));

// ── Data hooks — collaborators of the screen, not the SUT ──────────────────
vi.mock("@/hooks/useMealPlan", () => ({
  useMealPlanItems: (...args: unknown[]) => {
    hookCalls.mealPlanItems.push(args);
    return { data: [], isLoading: false, isRefetching: false };
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
      data: { calorieGoal: 2000, foodCalories: 0, remaining: 2000 },
      isError: false,
      refetch: vi.fn(),
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

// ── Local @gorhom/bottom-sheet override (shadows the global vitest.config.ts
// alias for this file only). The global mock renders onChange/onAnimate as
// inert attributes on a <div> — fine for content-sheet tests, useless here,
// since this test needs to invoke those callbacks directly per instance.
// `dismiss` is a bare spy (does NOT call onDismiss) so firing it doesn't run
// the screen's real onDismiss handlers (set*MealType(null)) or trigger any
// downstream re-render — this test only needs to prove "the right ref's
// dismiss fired", not exercise post-dismiss state cleanup. ──────────────
vi.mock("@gorhom/bottom-sheet", () => {
  const BottomSheetModal = React.forwardRef(function BottomSheetModalMock(
    props: {
      snapPoints?: string[];
      onChange?: (index: number) => void;
      onAnimate?: (fromIndex: number, toIndex: number) => void;
    },
    ref: React.Ref<{ present: () => void; dismiss: () => void }>,
  ) {
    const dismissSpy = React.useRef(vi.fn());
    const key = String(props.snapPoints?.[0] ?? "unknown");
    capturedSheets.set(key, {
      onChange: props.onChange,
      onAnimate: props.onAnimate,
      dismiss: dismissSpy.current,
    });
    React.useImperativeHandle(ref, () => ({
      present: () => {},
      dismiss: dismissSpy.current,
    }));
    return null;
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

describe("MealPlanHomeScreen — 4-sheet BottomSheetModal wiring integrity", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    capturedSheets.clear();
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  afterEach(() => {
    // Unmount between tests — this file renders the same heavy screen
    // repeatedly in one describe block, and without an explicit cleanup a
    // still-mounted prior tree's useSheetBackHandler effects (and their
    // registered BackHandler listeners) can outlive the test that mounted
    // them, corrupting later dismiss-call-count assertions.
    cleanup();
    // Platform.OS is a plain string property, not a function — mutate-and-restore
    // (matches useSheetBackHandler.test.ts's convention).
    RN.Platform.OS = originalPlatformOS;
    vi.restoreAllMocks();
  });

  /** Renders the screen with Android back-handling active and returns the
   *  BackHandler.addEventListener spy (one call per useSheetBackHandler
   *  instance, in declaration order — see MealPlanHomeScreen.tsx's own
   *  comment on why that order is load-bearing for same-screen crossovers).
   *
   *  Each sheet's own mount-time effect (`if (mealType) present(); else
   *  dismiss();`) calls `.dismiss()` once on mount, since every mealType
   *  state starts `null` — harmless in production (dismissing an
   *  already-closed sheet is a no-op), but it pollutes a call-count
   *  assertion. Clear every captured dismiss spy's history right after
   *  mount so tests only observe calls triggered by the back-press
   *  simulation itself. */
  function renderScreenAndroid() {
    RN.Platform.OS = "android";
    const addEventListenerSpy = vi.spyOn(RN.BackHandler, "addEventListener");
    renderComponent(<MealPlanHomeScreen />);
    for (const sheet of capturedSheets.values()) {
      sheet.dismiss.mockClear();
    }
    return addEventListenerSpy;
  }

  /** Fires a simulated Android hardware back press: consults registered
   *  listeners in reverse-registration order (mirrors BackHandler.android.js)
   *  and stops at the first one that consumes the event. */
  function fireBackPress(addEventListenerSpy: ReturnType<typeof vi.spyOn>) {
    const handlers = addEventListenerSpy.mock.calls.map(
      (call: unknown[]) => call[1] as () => boolean,
    );
    for (const handler of [...handlers].reverse()) {
      if (handler()) return true;
    }
    return false;
  }

  it("registers exactly 4 hardwareBackPress listeners, one per sheet", () => {
    const addEventListenerSpy = renderScreenAndroid();
    expect(addEventListenerSpy).toHaveBeenCalledTimes(SHEETS.length);
    for (const { key } of SHEETS) {
      expect(capturedSheets.get(key)?.onChange).toBeTypeOf("function");
      expect(capturedSheets.get(key)?.onAnimate).toBeTypeOf("function");
    }
  });

  it.each(SHEETS)(
    "onChange wiring: opening the $label sheet dismisses only its own ref, not a sibling's",
    ({ key, label }) => {
      const addEventListenerSpy = renderScreenAndroid();
      const target = capturedSheets.get(key);
      expect(target, `no BottomSheetModal captured for ${label}`).toBeDefined();

      act(() => {
        target!.onChange!(0); // settled at snap index 0 == presented
      });

      expect(fireBackPress(addEventListenerSpy)).toBe(true);

      expect(target!.dismiss).toHaveBeenCalledTimes(1);
      for (const other of SHEETS) {
        if (other.key === key) continue;
        expect(
          capturedSheets.get(other.key)!.dismiss,
          `${other.label}'s ref must not be dismissed by ${label}'s back press`,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it.each(SHEETS)(
    "onAnimate wiring: the $label sheet's opening animation opens only its own ref, not a sibling's",
    ({ key, label }) => {
      const addEventListenerSpy = renderScreenAndroid();
      const target = capturedSheets.get(key);
      expect(target, `no BottomSheetModal captured for ${label}`).toBeDefined();

      act(() => {
        target!.onAnimate!(-1, 0); // animating toward snap index 0
      });

      expect(fireBackPress(addEventListenerSpy)).toBe(true);

      expect(target!.dismiss).toHaveBeenCalledTimes(1);
      for (const other of SHEETS) {
        if (other.key === key) continue;
        expect(
          capturedSheets.get(other.key)!.dismiss,
          `${other.label}'s ref must not be dismissed by ${label}'s back press`,
        ).not.toHaveBeenCalled();
      }
    },
  );

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
  // `toDateString` fails those two and leaves this one green.)
  it("keeps the per-chip key and the selected key on one shared helper", () => {
    const { container } = renderComponent(<MealPlanHomeScreen />);
    const selected = Array.from(
      container.querySelectorAll("[aria-label]"),
      (el) => el.getAttribute("aria-label") ?? "",
    ).filter((l) => l.includes(", selected"));
    expect(selected).toEqual(["Wednesday, September 2, selected"]);
  });
});
