// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import MainTabNavigator from "../MainTabNavigator";

/**
 * Pins the wiring seam a pure `getTabContentA11y` unit test can't cover:
 * that MainTabNavigator actually lifts `menuOpen` state, threads it into the
 * wrapper `View` around `Tab.Navigator`, and threads open/close callbacks
 * into `ScanFAB` — not just that the pure function returns the right value
 * in isolation. See docs/solutions/conventions/
 * pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md.
 *
 * `@react-navigation/bottom-tabs` and the four tab-stack navigators are
 * mocked to thin doubles (same pattern as ChatStackNavigator.test.tsx) so
 * this asserts the actual wiring, not the navigators' own behavior — each
 * already has its own coverage.
 */

vi.mock("@react-navigation/bottom-tabs", () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="tab-navigator">{children}</div>
    ),
    Screen: () => null,
  }),
}));

vi.mock("@/navigation/HomeStackNavigator", () => ({ default: () => null }));
vi.mock("@/navigation/MealPlanStackNavigator", () => ({
  default: () => null,
}));
vi.mock("@/navigation/ChatStackNavigator", () => ({ default: () => null }));
vi.mock("@/navigation/ProfileStackNavigator", () => ({
  default: () => null,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      link: "#000",
      tabIconDefault: "#666",
      backgroundSecondary: "#fff",
      backgroundDefault: "#fff",
    },
    isDark: false,
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/hooks/usePendingReminders", () => ({
  usePendingReminders: () => ({ hasPending: false }),
}));

vi.mock("@/components/ScanFAB", () => ({
  ScanFAB: ({
    onOpen,
    onClose,
  }: {
    menuOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
  }) => (
    <div data-testid="scan-fab-mock">
      <button onClick={onOpen}>open-scan-menu</button>
      <button onClick={onClose}>close-scan-menu</button>
    </div>
  ),
}));

describe("MainTabNavigator — Android accessibility trap for the tab content behind the scan menu", () => {
  it("hides the tab content from the accessibility tree once the scan menu opens, and restores it on close", () => {
    renderComponent(<MainTabNavigator />);

    const tabContent = screen.getByTestId("tab-content-a11y-wrapper");
    // The mock omits the attribute entirely rather than setting it "false" —
    // absence is the restore/auto state, per test/mocks/react-native.ts's
    // ariaHiddenProps helper.
    expect(tabContent.getAttribute("aria-hidden")).toBeNull();

    fireEvent.click(screen.getByText("open-scan-menu"));
    expect(tabContent.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByText("close-scan-menu"));
    expect(tabContent.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps ScanFAB outside the hidden wrapper — it must stay reachable to close the menu", () => {
    // Structural guard for the "same-level sibling, not reparented" invariant
    // the wrapper's paint-safety comment in MainTabNavigator.tsx depends on:
    // if ScanFAB ever moved inside the a11y wrapper, it would be hidden from
    // TalkBack along with the tab content it's supposed to let you escape.
    renderComponent(<MainTabNavigator />);

    const tabContent = screen.getByTestId("tab-content-a11y-wrapper");
    const scanFab = screen.getByTestId("scan-fab-mock");
    expect(tabContent.contains(scanFab)).toBe(false);
  });
});
