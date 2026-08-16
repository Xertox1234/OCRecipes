// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChatStackNavigator from "../ChatStackNavigator";

/**
 * Pins the call site that `coachInitialRoute.test.ts` cannot cover: the pure
 * function is unit-tested in isolation there, but nothing previously proved
 * `ChatStackNavigator` actually threads `isCoachPro` into it, or that the
 * `isPremiumResolved` mount guard (documented in the component's own
 * comment — a Pro-users-locked-to-ChatList bug) keeps the navigator from
 * mounting before premium status resolves.
 *
 * `@react-navigation/native-stack` is mocked to a thin `Navigator`/`Screen`
 * double so this asserts the actual `initialRouteName` PROP the component
 * passes — not merely that `coachInitialRoute` was *called* with the right
 * argument. That's the stronger check: it also catches a hardcoded route
 * name, a swapped return value, or `coachInitialRoute` silently not running
 * at all — none of which a `vi.mock("../coachInitialRoute")` spy would
 * distinguish from a wiring bug in the argument itself. See
 * docs/solutions/conventions/rn-component-render-test-jsdom-pattern-2026-05-16.md
 * for the render-test pattern this follows (first navigator instance).
 */

const { mockUsePremiumFeature, premiumContextState, registeredScreenNames } =
  vi.hoisted(() => ({
    mockUsePremiumFeature: vi.fn(),
    premiumContextState: {
      isPremiumResolved: true,
      isError: false,
      refreshSubscription: vi.fn(),
    },
    registeredScreenNames: [] as string[],
  }));

vi.mock("@react-navigation/native-stack", () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({
      initialRouteName,
      children,
    }: {
      initialRouteName?: string;
      children?: React.ReactNode;
    }) => (
      <div>
        <div>{`initial:${initialRouteName}`}</div>
        {children}
      </div>
    ),
    // Records each registered screen's `name` so a test can confirm
    // `initialRouteName` actually points at a screen that still exists —
    // without this, deleting/renaming the CoachPro Stack.Screen entry while
    // initialRouteName still says "CoachPro" would go undetected.
    Screen: ({ name }: { name: string }) => {
      registeredScreenNames.push(name);
      return null;
    },
  }),
}));

// Thin doubles — this navigator's wiring is under test, not the screens it
// hosts (each already has its own coverage). Mocking them avoids pulling in
// their full hook/context trees just to satisfy a module import.
vi.mock("@/screens/ChatListScreen", () => ({ default: () => null }));
vi.mock("@/screens/ChatScreen", () => ({ default: () => null }));
vi.mock("@/screens/CoachProScreen", () => ({ default: () => null }));

vi.mock("@/hooks/useScreenOptions", () => ({
  useScreenOptions: () => ({}),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: mockUsePremiumFeature,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => premiumContextState,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      backgroundDefault: "#fff",
      textSecondary: "#666",
      link: "#007AFF",
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  registeredScreenNames.length = 0;
  premiumContextState.isPremiumResolved = true;
  premiumContextState.isError = false;
  premiumContextState.refreshSubscription = vi.fn();
});

describe("ChatStackNavigator — initialRouteName follows isCoachPro", () => {
  it("mounts Coach Pro users on the CoachPro screen", () => {
    mockUsePremiumFeature.mockReturnValue(true);

    renderComponent(<ChatStackNavigator />);

    expect(mockUsePremiumFeature).toHaveBeenCalledWith("coachPro");
    expect(screen.getByText("initial:CoachPro")).toBeTruthy();
    expect(registeredScreenNames).toContain("CoachPro");
  });

  it("mounts free users on the ChatList screen — the premium screen is not the landing", () => {
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<ChatStackNavigator />);

    expect(mockUsePremiumFeature).toHaveBeenCalledWith("coachPro");
    expect(screen.getByText("initial:ChatList")).toBeTruthy();
    expect(registeredScreenNames).toContain("ChatList");
  });
});

describe("ChatStackNavigator — isPremiumResolved mount guard", () => {
  it("renders the loading state, not the navigator, while premium status is unresolved", () => {
    premiumContextState.isPremiumResolved = false;
    premiumContextState.isError = false;
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<ChatStackNavigator />);

    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByText(/^initial:/)).toBeNull();
  });

  it("renders the retry error state, not the navigator, on a hard subscription error with no resolved data", () => {
    premiumContextState.isPremiumResolved = false;
    premiumContextState.isError = true;
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<ChatStackNavigator />);

    const retryButton = screen.getByRole("button", {
      name: /retry loading coach/i,
    });
    expect(retryButton).toBeTruthy();
    expect(screen.queryByText(/^initial:/)).toBeNull();

    fireEvent.click(retryButton);
    expect(premiumContextState.refreshSubscription).toHaveBeenCalledTimes(1);
  });

  it("mounts the navigator normally on a resolved-but-currently-erroring query — the retry state is only for data that has never resolved", () => {
    // isSubscriptionError/isScanCountError can flip true on a background
    // refetch after subscriptionData already resolved once (PremiumContext.tsx's
    // isError = isSubscriptionError || isScanCountError, independent of
    // isPremiumResolved). The guard's `isError && !isPremiumResolved` conjunct
    // exists precisely so this case still mounts the navigator instead of
    // showing the "never loaded" retry UI.
    premiumContextState.isPremiumResolved = true;
    premiumContextState.isError = true;
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<ChatStackNavigator />);

    expect(screen.getByText("initial:ChatList")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /retry loading coach/i }),
    ).toBeNull();
  });
});
