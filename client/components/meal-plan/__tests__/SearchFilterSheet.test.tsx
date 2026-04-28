// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SearchFilterSheet } from "../SearchFilterSheet";

vi.mock("@react-native-community/slider", () => {
  // `require` is used here instead of `import` because vi.mock factories are
  // hoisted to the top of the file before any ES module imports are evaluated.
  // Using `import` inside a hoisted factory would reference an unresolved binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    __esModule: true,
    default: (props: { testID?: string }) =>
      React.createElement("div", { "data-testid": props.testID ?? "slider" }),
  };
});

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      text: "#000000",
      textSecondary: "#666666",
      backgroundRoot: "#FFFFFF",
      link: "#007AFF",
      buttonText: "#FFFFFF",
      border: "#CCCCCC",
    },
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: vi.fn(), impact: vi.fn() }),
}));

describe("SearchFilterSheet", () => {
  const defaultFilters = {
    sort: "relevance" as const,
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: "all" as const,
  };

  it("renders sort options", () => {
    renderComponent(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    expect(screen.getByText("Relevance")).toBeDefined();
    expect(screen.getByText("Newest")).toBeDefined();
    expect(screen.getByText("Quickest")).toBeDefined();
  });

  it("renders source options", () => {
    renderComponent(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    expect(screen.getByText("All")).toBeDefined();
    expect(screen.getByText("My Recipes")).toBeDefined();
    expect(screen.getByText("Community")).toBeDefined();
  });

  it("calls onReset when reset button is pressed", () => {
    const onReset = vi.fn();
    renderComponent(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={onReset}
        activeFilterCount={2}
      />,
    );
    fireEvent.click(screen.getByLabelText("Reset filters"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("calls onFiltersChange when sort option is selected", () => {
    const onFiltersChange = vi.fn();
    renderComponent(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    fireEvent.click(screen.getByText("Newest"));
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "newest" }),
    );
  });

  it("does not show reset button when no filters active", () => {
    renderComponent(
      <SearchFilterSheet
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
    expect(screen.queryByText("Reset filters")).toBeNull();
  });
});
