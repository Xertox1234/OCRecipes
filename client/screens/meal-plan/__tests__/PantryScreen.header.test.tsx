// @vitest-environment jsdom
//
// Regression guard for the header/focus-trap contract added in PR #981
// (todos/archive/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md).
//
// PantryScreen carries the SAME dual-mount shape as GroceryListsScreen, with
// the same three-state requirement, and had no test file at all before this:
//
//   MealPlanStack route "Pantry"        -> plain boolean `!isOpen`
//   RootStack modal route "PantryModal" -> three-state `isOpen ? false : undefined`
//
// See GroceryListsScreen.header.test.tsx for why `undefined` (not `false`, and
// not an omitted key) is the required closed-state value on the modal route:
// a plain `!isOpen` yields `true`, which makes react-native-screens skip its
// native-icon-nulling branch and draw the system back arrow ALONGSIDE the
// custom close "X".
import React from "react";
import { renderComponent } from "../../../../test/utils/render-component";
import PantryScreen from "../PantryScreen";

const nav = vi.hoisted(() => ({
  setOptions: vi.fn(),
  routeName: "Pantry",
  isOpen: false,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    setOptions: nav.setOptions,
  }),
  useRoute: () => ({ name: nav.routeName, params: undefined }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: vi.fn(),
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: nav.isOpen,
  }),
}));

vi.mock("@/hooks/usePantry", () => ({
  usePantryItems: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
  useCreatePantryItem: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePantryItem: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    features: { pantryTracking: true, receiptScanner: false },
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), show: vi.fn() }),
}));

vi.mock("@/hooks/useFromHomeBackRedirect", () => ({
  useFromHomeBackRedirect: () => {},
}));

vi.mock("@/hooks/useHeaderContentInset", () => ({
  useHeaderContentInset: () => 0,
}));

// PantryScreen imports UpgradeModal, which pulls in client/lib/iap/index.ts and
// its CommonJS `require("./mock-iap")` — unresolvable under Vitest. Neutralizing
// the component keeps the header contract in scope; same shape as the existing
// mocks in MealPlanHomeScreen.test.tsx, SettingsScreen.test.tsx and
// ScanScreen.test.tsx. GroceryListsScreen needs no equivalent: it never imports
// this graph.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

type HeaderOptions = {
  headerBackVisible?: boolean;
  headerLeft?: () => React.ReactElement | null;
};

/** The most recent options object the screen registered via setOptions. */
function lastOptions(): HeaderOptions {
  const call = nav.setOptions.mock.calls.at(-1);
  expect(call, "screen never called navigation.setOptions").toBeDefined();
  return call![0] as HeaderOptions;
}

function renderOn(routeName: string, isOpen: boolean) {
  nav.routeName = routeName;
  nav.isOpen = isOpen;
  nav.setOptions.mockClear();
  renderComponent(<PantryScreen />);
}

describe("PantryScreen -- MealPlanStack route (no custom headerLeft)", () => {
  it("leaves the native back button visible while the sheet is closed", () => {
    renderOn("Pantry", false);
    expect(lastOptions().headerBackVisible).toBe(true);
  });

  it("hides the native back button while the sheet is open", () => {
    renderOn("Pantry", true);
    expect(lastOptions().headerBackVisible).toBe(false);
  });
});

describe("PantryScreen -- RootStack modal route (custom close-X headerLeft)", () => {
  it("defers to the navigator with undefined -- never true -- while the sheet is closed", () => {
    renderOn("PantryModal", false);
    const options = lastOptions();

    expect(options.headerBackVisible).toBeUndefined();
    expect(
      "headerBackVisible" in options,
      "the key must be present-but-undefined, not omitted",
    ).toBe(true);
    expect(options.headerBackVisible).not.toBe(true);
  });

  it("registers a custom close control while the sheet is closed", () => {
    renderOn("PantryModal", false);
    expect(lastOptions().headerLeft).toBeTypeOf("function");
  });

  it("hides the native back button and empties headerLeft while the sheet is open", () => {
    renderOn("PantryModal", true);
    const options = lastOptions();

    expect(options.headerBackVisible).toBe(false);
    expect(options.headerLeft).toBeTypeOf("function");
    expect(options.headerLeft!()).toBeNull();
  });
});
