// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { GroceryListPickerModal } from "../GroceryListPickerModal";

const mockLists = [
  {
    id: 1,
    userId: 1,
    title: "Weekly Groceries",
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    createdAt: new Date(),
  },
  {
    id: 2,
    userId: 1,
    title: "Party Prep",
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    createdAt: new Date(),
  },
];

const { mockUseGroceryLists, mockCreateList, mockAddItem } = vi.hoisted(() => ({
  mockUseGroceryLists: vi.fn(),
  mockCreateList: vi.fn(),
  mockAddItem: vi.fn(),
}));

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryLists: () => mockUseGroceryLists(),
  useCreateGroceryList: () => ({
    mutate: mockCreateList,
    isPending: false,
  }),
  useAddManualGroceryItem: () => ({
    mutate: mockAddItem,
    isPending: false,
  }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

describe("GroceryListPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGroceryLists.mockReturnValue({
      data: mockLists,
      isLoading: false,
    });
  });

  it("renders modal header when visible", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Chicken Breast"
      />,
    );
    expect(screen.getByText("Add to Grocery List")).toBeDefined();
  });

  it("renders item name in subtitle", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Chicken Breast"
      />,
    );
    expect(screen.getByText("Chicken Breast")).toBeDefined();
  });

  it("renders grocery lists", () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(screen.getByText("Weekly Groceries")).toBeDefined();
    expect(screen.getByText("Party Prep")).toBeDefined();
  });

  it("shows empty state when no lists", () => {
    mockUseGroceryLists.mockReturnValue({ data: [], isLoading: false });
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(
      screen.getByText("No grocery lists yet. Create one to get started."),
    ).toBeDefined();
  });

  it("does not render when not visible", () => {
    const { container } = renderComponent(
      <GroceryListPickerModal
        visible={false}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

// ── Date-basis regression guard ────────────────────────────────────────────
//
// `handleCreateAndAdd` defaults `startDate` to "today" and `endDate` to
// "today + 7 calendar days". It used to derive both from a raw
// UTC-converted instant (`toDateString`) and compute "+7 days" as
// milliseconds (`Date.now() + 7*24*60*60*1000`), so it was wrong at BOTH
// offset signs and on any week that crosses a DST transition. See
// todos/archive/P2-2026-08-31-remaining-client-date-derivations-still-use-a-utc-basis.md.
//
// CI runs UTC — the unique zone where the raw-instant basis agrees with the
// local one — so every block here pins a non-UTC TZ. Anchors are built as
// `...Z` UTC instant strings and read back under a pinned `TZ`, never as a
// local-constructor `Date` literal at describe/it.each-table scope (that is
// evaluated before `beforeAll`/inline pins take effect — see
// docs/solutions/logic-errors/each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md).
describe("GroceryListPickerModal — create-list date range is device-local", () => {
  const originalTz = process.env.TZ;

  const openCreateAndSubmit = () => {
    renderComponent(
      <GroceryListPickerModal
        visible={true}
        onClose={() => {}}
        itemName="Eggs"
      />,
    );
    fireEvent.click(screen.getByLabelText("Create new grocery list"));
    fireEvent.click(screen.getByLabelText("Create list and add item"));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGroceryLists.mockReturnValue({ data: mockLists, isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("keys startDate/endDate to the local day in a UTC-positive zone, at an hour inside the failing window", () => {
    process.env.TZ = "Pacific/Auckland"; // +12, no DST in September
    // Local 2026-09-02 06:00 == UTC 2026-09-01T18:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T18:00:00Z"));
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(720); // pins the mechanism

    openCreateAndSubmit();

    expect(mockCreateList).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-02",
        endDate: "2026-09-09",
      }),
      expect.anything(),
    );
  });

  it("keys startDate/endDate to the local day in a UTC-negative zone, at an hour inside the failing window", () => {
    process.env.TZ = "America/Los_Angeles"; // -7 in September
    // Local 2026-09-02 20:00 == UTC 2026-09-03T03:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(-420); // pins the mechanism

    openCreateAndSubmit();

    expect(mockCreateList).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-02",
        endDate: "2026-09-09",
      }),
      expect.anything(),
    );
  });

  it("the +7 days is calendar arithmetic, not milliseconds — still 7 calendar days across a DST spring-forward", () => {
    process.env.TZ = "America/Los_Angeles";
    // DST starts 2026-03-08 02:00 local (spring forward, loses 1 real hour).
    // "Now" = local 2026-03-04 23:30 PST (UTC-8) == UTC 2026-03-05T07:30:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-05T07:30:00Z"));
    expect(-new Date(2026, 2, 4).getTimezoneOffset()).toBe(-480); // PST, before the transition
    expect(-new Date(2026, 2, 11).getTimezoneOffset()).toBe(-420); // PDT, after the transition

    openCreateAndSubmit();

    // Calendar +7 days from Mar 4 is Mar 11. The old ms-based
    // `Date.now() + 7*24*60*60*1000` would land on Mar 12 instead, because the
    // DST spring-forward inside this week loses 1 real hour.
    expect(mockCreateList).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-03-04",
        endDate: "2026-03-11",
      }),
      expect.anything(),
    );
  });
});
