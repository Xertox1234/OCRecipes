// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { HighProteinSuggestions } from "../HighProteinSuggestions";

const { mockUseHighProteinSuggestions } = vi.hoisted(() => ({
  mockUseHighProteinSuggestions: vi.fn(),
}));

vi.mock("@/hooks/useMedication", () => ({
  useHighProteinSuggestions: (enabled: boolean) =>
    mockUseHighProteinSuggestions(enabled),
}));

// Card component renders as a pressable wrapper
vi.mock("@/components/Card", () => ({
  Card: ({ children, ...props }: Record<string, unknown>) =>
    React.createElement(
      "div",
      props as React.HTMLAttributes<HTMLDivElement>,
      children as React.ReactNode,
    ),
}));

describe("HighProteinSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when loading", () => {
    mockUseHighProteinSuggestions.mockReturnValue({
      data: null,
      isLoading: true,
    });
    const { container } = renderComponent(<HighProteinSuggestions />);
    expect(container.innerHTML).toBe("");
  });

  it("returns null when no data", () => {
    mockUseHighProteinSuggestions.mockReturnValue({
      data: null,
      isLoading: false,
    });
    const { container } = renderComponent(<HighProteinSuggestions />);
    expect(container.innerHTML).toBe("");
  });

  it("renders title and suggestions when data is available", () => {
    mockUseHighProteinSuggestions.mockReturnValue({
      data: {
        remainingProtein: 30,
        suggestions: [
          {
            title: "Greek Yogurt",
            proteinGrams: 15,
            calories: 120,
            description: "High protein snack",
            portionSize: "1 cup",
          },
        ],
      },
      isLoading: false,
    });
    renderComponent(<HighProteinSuggestions />);
    expect(screen.getByText("High-Protein Ideas")).toBeDefined();
    expect(screen.getByText("Greek Yogurt")).toBeDefined();
    expect(screen.getByText("15g")).toBeDefined();
  });

  it("passes enabled prop to hook", () => {
    mockUseHighProteinSuggestions.mockReturnValue({
      data: null,
      isLoading: false,
    });
    renderComponent(<HighProteinSuggestions enabled={false} />);
    expect(mockUseHighProteinSuggestions).toHaveBeenCalledWith(false);
  });
});
