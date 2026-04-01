// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFAB } from "../ScanFAB";

const mockNavigate = vi.fn();

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useNavigationState: (selector: (state: unknown) => unknown) =>
    selector({
      index: 0,
      routes: [
        {
          key: "HomeTab",
          name: "HomeTab",
          state: { index: 0, routes: [{ key: "Home", name: "Home" }] },
        },
      ],
    }),
}));

describe("ScanFAB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders", () => {
    renderComponent(<ScanFAB />);
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("has correct accessibility label", () => {
    renderComponent(<ScanFAB />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Open scan menu",
    );
  });

  it("opens scan menu on press instead of navigating directly", () => {
    renderComponent(<ScanFAB />);
    fireEvent.click(screen.getByRole("button"));
    // FAB now opens a menu instead of navigating directly
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders plus icon", () => {
    renderComponent(<ScanFAB />);
    expect(screen.getByText("plus")).toBeDefined();
  });
});
