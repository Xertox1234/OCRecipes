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
import { Platform } from "react-native";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { toLocalDateString } from "@shared/lib/date";
import GroceryListsScreen from "../GroceryListsScreen";

const { createMutate, pickerProps, androidOpen } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  pickerProps: [] as Record<string, unknown>[],
  androidOpen: vi.fn(),
}));

// The native view cannot render in jsdom — the stub records the props it gets.
vi.mock("@react-native-community/datetimepicker", () => ({
  default: (props: Record<string, unknown>) => {
    pickerProps.push(props);
    return <div data-testid="date-picker-stub" />;
  },
  DateTimePickerAndroid: { open: androidOpen, dismiss: vi.fn() },
}));

vi.mock("@/hooks/useGroceryList", () => ({
  useGroceryLists: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  useCreateGroceryList: () => ({ mutate: createMutate, isPending: false }),
  useDeleteGroceryList: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ streakUnlocks: [] }),
}));

vi.mock("@/hooks/useSafeTabBarHeight", () => ({
  useSafeTabBarHeight: () => 0,
}));

const { setOptions } = vi.hoisted(() => ({ setOptions: vi.fn() }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions }),
  useRoute: () => ({ name: "GroceryLists", params: undefined }),
  usePreventRemove: () => {},
  useIsFocused: () => true,
}));

describe("GroceryListsScreen — date range defaults to the local calendar day", () => {
  const originalTz = process.env.TZ;

  const openDatePicker = () => {
    renderComponent(<GroceryListsScreen />);
    // The date inputs live in the FlatList's ListHeaderComponent, gated
    // behind showDatePicker — open it via the header "+" the screen registers
    // through setOptions({ headerRight }).
    const headerRight = setOptions.mock.calls
      .map(([o]) => o?.headerRight)
      .filter(Boolean)
      .at(-1);
    expect(headerRight, "screen never registered a headerRight").toBeDefined();
    renderComponent(<>{headerRight()}</>);
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

    expect(screen.getByLabelText("Start date, Wed, Sep 2")).toBeTruthy();
    expect(screen.getByLabelText("End date, Tue, Sep 8")).toBeTruthy();
  });

  it("keys the default start/end date to the local day in a UTC-negative zone, at an hour inside the failing window", () => {
    process.env.TZ = "America/Los_Angeles"; // -7 in September
    // Local 2026-09-02 20:00 == UTC 2026-09-03T03:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(-420); // pins the mechanism

    openDatePicker();

    expect(screen.getByLabelText("Start date, Wed, Sep 2")).toBeTruthy();
    expect(screen.getByLabelText("End date, Tue, Sep 8")).toBeTruthy();
  });
});

describe("GroceryListsScreen — date picker", () => {
  const originalOS = Platform.OS;
  const originalTz = process.env.TZ;

  const day = (d: Date) => toLocalDateString(d);
  const lastPicker = () => pickerProps.at(-1) as Record<string, any>;

  const open = () => {
    renderComponent(<GroceryListsScreen />);
    const headerRight = setOptions.mock.calls
      .map(([o]) => o?.headerRight)
      .filter(Boolean)
      .at(-1);
    renderComponent(<>{headerRight()}</>);
    fireEvent.click(screen.getByLabelText("Generate new grocery list"));
  };

  beforeEach(() => {
    process.env.TZ = "America/Los_Angeles";
    // Local 2026-09-02 20:00 == UTC 2026-09-03T03:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));
    pickerProps.length = 0;
    androidOpen.mockClear();
    createMutate.mockClear();
    Platform.OS = "ios";
  });

  afterEach(() => {
    vi.useRealTimers();
    Platform.OS = originalOS;
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("shows the default start date in words", () => {
    open();
    expect(screen.getByLabelText("Start date, Wed, Sep 2")).toBeTruthy();
    expect(screen.getByText("Wed, Sep 2")).toBeTruthy();
  });

  it("opens an end picker whose minimumDate is the start date (iOS inline)", () => {
    open();
    expect(screen.queryByTestId("date-picker-stub")).toBeNull();
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    expect(screen.getByTestId("date-picker-stub")).toBeTruthy();
    expect(lastPicker().mode).toBe("date");
    expect(lastPicker().display).toBe("inline");
    expect(day(lastPicker().minimumDate)).toBe("2026-09-02");
    expect(day(lastPicker().value)).toBe("2026-09-08");
  });

  it("closes the picker when the same field is tapped again", () => {
    open();
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    expect(screen.queryByTestId("date-picker-stub")).toBeNull();
  });

  it("moves the end date to the start when the start passes it", () => {
    open();
    fireEvent.click(screen.getByLabelText("Start date, Wed, Sep 2"));
    act(() => {
      lastPicker().onValueChange({}, new Date(2026, 8, 20));
    });
    expect(screen.getByLabelText("Start date, Sun, Sep 20")).toBeTruthy();
    expect(screen.getByLabelText("End date, Sun, Sep 20")).toBeTruthy();
  });

  it("sends YYYY-MM-DD strings built from the chosen local dates", () => {
    open();
    fireEvent.click(screen.getByLabelText("Start date, Wed, Sep 2"));
    act(() => {
      lastPicker().onValueChange({}, new Date(2026, 8, 4));
    });
    fireEvent.click(screen.getByLabelText("Generate grocery list"));
    expect(createMutate).toHaveBeenCalledWith(
      { startDate: "2026-09-04", endDate: "2026-09-08" },
      expect.anything(),
    );
  });

  it("closes any open picker on Cancel, so reopening starts with none", () => {
    open();
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    expect(screen.getByTestId("date-picker-stub")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Cancel")[0]);
    fireEvent.click(screen.getByLabelText("Generate new grocery list"));
    expect(screen.queryByTestId("date-picker-stub")).toBeNull();
  });

  it("closes any open picker after a successful Generate", () => {
    createMutate.mockImplementation((_p, opts) => opts.onSuccess({ id: 1 }));
    open();
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    fireEvent.click(screen.getByLabelText("Generate grocery list"));
    fireEvent.click(screen.getByLabelText("Generate new grocery list"));
    expect(screen.queryByTestId("date-picker-stub")).toBeNull();
    createMutate.mockReset();
  });

  it("compares days only: a start picked later on the end's day leaves end unchanged", () => {
    open();
    fireEvent.click(screen.getByLabelText("Start date, Wed, Sep 2"));
    act(() => {
      lastPicker().onValueChange({}, new Date(2026, 8, 8, 23, 0));
    });
    fireEvent.click(screen.getByLabelText("Start date, Tue, Sep 8"));
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    // End stays its own local noon; start is normalized to noon too.
    expect(lastPicker().value).toEqual(new Date(2026, 8, 8, 12));
    expect(lastPicker().minimumDate).toEqual(new Date(2026, 8, 8, 12));
  });

  it("opens the imperative Android picker with minimumDate for End, rendering nothing inline", () => {
    Platform.OS = "android";
    open();
    fireEvent.click(screen.getByLabelText("End date, Tue, Sep 8"));
    expect(screen.queryByTestId("date-picker-stub")).toBeNull();
    expect(androidOpen).toHaveBeenCalledTimes(1);
    const arg = androidOpen.mock.calls[0][0];
    expect(arg.mode).toBe("date");
    expect(day(arg.value)).toBe("2026-09-08");
    expect(day(arg.minimumDate)).toBe("2026-09-02");
  });
});

describe("GroceryListsScreen — dates survive a DST crossing (America/Denver)", () => {
  const originalOS = Platform.OS;
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/Denver"; // DST ends Sun 2026-11-01
    // Local Mon 2026-10-26 10:00 MDT == 16:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T16:00:00Z"));
    pickerProps.length = 0;
    createMutate.mockReset();
    Platform.OS = "ios";
    renderComponent(<GroceryListsScreen />);
    const headerRight = setOptions.mock.calls
      .map(([o]) => o?.headerRight)
      .filter(Boolean)
      .at(-1);
    renderComponent(<>{headerRight()}</>);
    fireEvent.click(screen.getByLabelText("Generate new grocery list"));
  });

  afterEach(() => {
    vi.useRealTimers();
    Platform.OS = originalOS;
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("anchors the dates it hands the picker at local noon", () => {
    fireEvent.click(screen.getByLabelText("Start date, Mon, Oct 26"));
    const props = pickerProps.at(-1) as Record<string, any>;
    expect(props.value.getHours()).toBe(12);
    expect(props.value.getDate()).toBe(26);
  });

  it("keeps the picked day when iOS returns the old UTC time of day across DST", () => {
    fireEvent.click(screen.getByLabelText("Start date, Mon, Oct 26"));
    // iOS keeps the UTC time of day of the value it was given: noon MDT is
    // 18:00Z, which on Nov 5 is 11:00 MST (still Nov 5). A midnight anchor
    // would be 06:00Z, i.e. 23:00 MST on Nov 4.
    act(() => {
      const shown = (pickerProps.at(-1) as Record<string, any>).value as Date;
      (pickerProps.at(-1) as Record<string, any>).onValueChange(
        {},
        new Date(Date.UTC(2026, 10, 5, shown.getUTCHours())),
      );
    });
    expect(screen.getByLabelText("Start date, Thu, Nov 5")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Generate grocery list"));
    expect(createMutate.mock.calls[0][0].startDate).toBe("2026-11-05");
  });
});
