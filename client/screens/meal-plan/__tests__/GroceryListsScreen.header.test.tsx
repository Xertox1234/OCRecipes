// @vitest-environment jsdom
//
// Regression guard for the header/focus-trap contract added in PR #981
// (todos/archive/P2-2026-09-14-confirmation-modal-navigator-header-escapes-talkback-trap.md).
//
// GroceryListsScreen is mounted on TWO stacks, and the two branches need
// DIFFERENT `headerBackVisible` values:
//
//   MealPlanStack route "GroceryLists"        -> plain boolean `!isOpen`
//   RootStack modal route "GroceryListsModal" -> three-state `isOpen ? false : undefined`
//
// The modal branch is the one with a custom close-"X" `headerLeft`, and it is
// why the value must be THREE-state. Setting it to `true` in the closed state
// (what a plain `!isOpen` produces) makes react-native-screens skip its
// native-icon-nulling branch and render the system back arrow ALONGSIDE the
// custom "X" -- a duplicate-control regression during entirely normal use.
// `undefined` reproduces "never set", which `false` does not.
//
// Before this file, the modal branch had ZERO coverage anywhere in the repo:
// GroceryListsScreen.test.tsx hardcodes `useRoute` to the MealPlanStack name,
// so only the `if` side was ever exercised. Asserting the setOptions PAYLOAD
// (rather than a rendered effect) follows CookbookCreateScreen.test.tsx.
import React from "react";
import { renderComponent } from "../../../../test/utils/render-component";
import GroceryListsScreen from "../GroceryListsScreen";

const nav = vi.hoisted(() => ({
  setOptions: vi.fn(),
  routeName: "GroceryLists",
  isOpen: false,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    setOptions: nav.setOptions,
  }),
  useRoute: () => ({ name: nav.routeName, params: undefined }),
  usePreventRemove: () => {},
  useIsFocused: () => true,
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: vi.fn(),
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: nav.isOpen,
  }),
}));

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
  renderComponent(<GroceryListsScreen />);
}

describe("GroceryListsScreen -- MealPlanStack route (no custom headerLeft)", () => {
  it("leaves the native back button visible while the sheet is closed", () => {
    renderOn("GroceryLists", false);
    expect(lastOptions().headerBackVisible).toBe(true);
  });

  it("hides the native back button while the sheet is open", () => {
    renderOn("GroceryLists", true);
    expect(lastOptions().headerBackVisible).toBe(false);
  });
});

describe("GroceryListsScreen -- RootStack modal route (custom close-X headerLeft)", () => {
  // THE regression guard. A plain `!isOpen` here yields `true`, which is the
  // duplicate-back-arrow bug. `undefined` is required, and it must be PRESENT
  // as a key rather than omitted, so the dynamic value overwrites any prior
  // `false` left behind by the open state.
  it("defers to the navigator with undefined -- never true -- while the sheet is closed", () => {
    renderOn("GroceryListsModal", false);
    const options = lastOptions();

    expect(options.headerBackVisible).toBeUndefined();
    expect(
      "headerBackVisible" in options,
      "the key must be present-but-undefined, not omitted",
    ).toBe(true);
    expect(options.headerBackVisible).not.toBe(true);
  });

  it("registers a custom close control while the sheet is closed", () => {
    renderOn("GroceryListsModal", false);
    expect(lastOptions().headerLeft).toBeTypeOf("function");
  });

  it("hides the native back button and empties headerLeft while the sheet is open", () => {
    renderOn("GroceryListsModal", true);
    const options = lastOptions();

    expect(options.headerBackVisible).toBe(false);
    expect(options.headerLeft).toBeTypeOf("function");
    // Collapsing headerLeft to null is what removes the close "X" from the
    // TalkBack/VoiceOver order while the sheet owns focus.
    expect(options.headerLeft!()).toBeNull();
  });
});
