// @vitest-environment jsdom
//
// Regression guard for todos/archive/P2-2026-08-31-remaining-client-date-derivations-still-use-a-utc-basis.md.
//
// The date-range picker used to default `startDate`/`endDate` from
// `toDateString(new Date())` — the UTC day of the raw current instant — so it
// answered "what calendar day is it here" wrong at BOTH offset signs (unlike
// the planner defect, which was UTC-positive-only and constant): positive
// offsets break in the early morning, negative offsets break in the late
// evening. `endDate` was already calendar arithmetic (`setDate(getDate()+6)`),
// so only the local-basis formatting needed to change.
//
// CI runs UTC — the unique zone where the raw-instant basis agrees with the
// local one — so both blocks below pin a non-UTC TZ, at an hour inside the
// failing window. Anchors are built as `...Z` UTC instant strings, never as a
// local-constructor `Date` literal at describe scope (evaluated before
// `beforeAll` pins TZ — see
// docs/solutions/logic-errors/each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md).
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import GroceryListsScreen from "../GroceryListsScreen";

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryLists: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  useCreateGroceryList: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteGroceryList: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ streakUnlocks: [] }),
}));

vi.mock("@/hooks/useSafeTabBarHeight", () => ({
  useSafeTabBarHeight: () => 0,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: undefined }),
  usePreventRemove: () => {},
  useIsFocused: () => true,
}));

describe("GroceryListsScreen — date range defaults to the local calendar day", () => {
  const originalTz = process.env.TZ;

  const openDatePicker = () => {
    renderComponent(<GroceryListsScreen />);
    // The date inputs live in the FlatList's ListHeaderComponent, gated
    // behind showDatePicker — open it via the FAB.
    fireEvent.click(screen.getByLabelText("Generate new grocery list"));
  };

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("keys the default start/end date to the local day in a UTC-positive zone, at an hour inside the failing window", () => {
    process.env.TZ = "Pacific/Auckland"; // +12, no DST in September
    // Local 2026-09-02 06:00 == UTC 2026-09-01T18:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T18:00:00Z"));
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(720); // pins the mechanism

    openDatePicker();

    expect(screen.getByLabelText("Start date").getAttribute("value")).toBe(
      "2026-09-02",
    );
    expect(screen.getByLabelText("End date").getAttribute("value")).toBe(
      "2026-09-08",
    );
  });

  it("keys the default start/end date to the local day in a UTC-negative zone, at an hour inside the failing window", () => {
    process.env.TZ = "America/Los_Angeles"; // -7 in September
    // Local 2026-09-02 20:00 == UTC 2026-09-03T03:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(-420); // pins the mechanism

    openDatePicker();

    expect(screen.getByLabelText("Start date").getAttribute("value")).toBe(
      "2026-09-02",
    );
    expect(screen.getByLabelText("End date").getAttribute("value")).toBe(
      "2026-09-08",
    );
  });
});
