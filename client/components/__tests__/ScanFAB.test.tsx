// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFAB } from "../ScanFAB";

const mockNavigate = vi.fn();

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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
      "Scan food item. Long press for more options.",
    );
  });

  it("navigates to Scan screen on press", () => {
    renderComponent(<ScanFAB />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockNavigate).toHaveBeenCalledWith("Scan");
  });

  it("renders plus icon", () => {
    renderComponent(<ScanFAB />);
    expect(screen.getByText("plus")).toBeDefined();
  });
});
