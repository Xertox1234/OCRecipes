// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFAB } from "../ScanFAB";

const mockNavigate = vi.fn();

// Mutable so a test can drive `isOnRootScreen` off `true` (simulating
// navigation into a nested screen, e.g. a deep link) without unmounting the
// component — the real bug this guards against.
const { navState } = vi.hoisted(() => ({
  navState: { nestedIndex: 0 },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useNavigationState: (selector: (state: unknown) => unknown) =>
    selector({
      index: 0,
      routes: [
        {
          key: "HomeTab",
          name: "HomeTab",
          state: {
            index: navState.nestedIndex,
            routes: [
              { key: "Home", name: "Home" },
              { key: "Nested", name: "Nested" },
            ],
          },
        },
      ],
    }),
}));

describe("ScanFAB", () => {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    navState.nestedIndex = 0;
  });

  it("renders", () => {
    renderComponent(
      <ScanFAB menuOpen={false} onOpen={onOpen} onClose={onClose} />,
    );
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("has correct accessibility label when closed", () => {
    renderComponent(
      <ScanFAB menuOpen={false} onOpen={onOpen} onClose={onClose} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Open scan menu",
    );
  });

  it("has correct accessibility label when open", () => {
    renderComponent(
      <ScanFAB menuOpen={true} onOpen={onOpen} onClose={onClose} />,
    );
    // Scoped by name: menuOpen renders SpeedDial's own action buttons too.
    expect(
      screen
        .getByRole("button", { name: "Close scan menu" })
        .getAttribute("aria-label"),
    ).toBe("Close scan menu");
  });

  it("calls onOpen (not navigate) on press when the menu is closed", () => {
    renderComponent(
      <ScanFAB menuOpen={false} onOpen={onOpen} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button"));
    // FAB opens a menu instead of navigating directly
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("calls onClose on press when the menu is open", () => {
    renderComponent(
      <ScanFAB menuOpen={true} onOpen={onOpen} onClose={onClose} />,
    );
    // Scoped by name: menuOpen renders SpeedDial's own action buttons too.
    fireEvent.click(screen.getByRole("button", { name: "Close scan menu" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the menu when navigation moves off the root screen while it's still open", () => {
    // Regression guard: menuOpen lives in MainTabNavigator, which does NOT
    // unmount with the FAB — `isOnRootScreen` going false only makes ScanFAB
    // `return null`, it does not unmount it (a deep link into a nested
    // screen, e.g. CoachTab > Chat, can trigger this while the menu is
    // still open, bypassing SpeedDial's own close-then-navigate handlers).
    // Without this reset, an orphaned menuOpen: true would leave every tab +
    // the tab bar permanently hidden from the Android a11y tree with no
    // FAB/SpeedDial left to close it.
    const { rerender } = renderComponent(
      <ScanFAB menuOpen={true} onOpen={onOpen} onClose={onClose} />,
    );
    expect(onClose).not.toHaveBeenCalled();

    navState.nestedIndex = 1; // navigated into a nested (non-root) screen
    rerender(<ScanFAB menuOpen={true} onOpen={onOpen} onClose={onClose} />);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders plus icon", () => {
    renderComponent(
      <ScanFAB menuOpen={false} onOpen={onOpen} onClose={onClose} />,
    );
    expect(screen.getByText("plus")).toBeDefined();
  });
});
