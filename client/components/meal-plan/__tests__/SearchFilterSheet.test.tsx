// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SearchFilterSheet } from "../SearchFilterSheet";

interface MockSliderProps {
  testID?: string;
  onValueChange?: (val: number) => void;
  accessibilityValue?: { text?: string };
}

// Latest props each slider rendered with, keyed by testID, so a test can drive
// a drag (onValueChange) and read the announced accessibilityValue.
const { sliderProps } = vi.hoisted(() => ({
  sliderProps: new Map<string, MockSliderProps>(),
}));

vi.mock("@react-native-community/slider", () => {
  // `require` is used here instead of `import` because vi.mock factories are
  // hoisted to the top of the file before any ES module imports are evaluated.
  // Using `import` inside a hoisted factory would reference an unresolved binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    __esModule: true,
    default: (props: MockSliderProps) => {
      sliderProps.set(props.testID ?? "slider", props);
      return React.createElement("div", {
        "data-testid": props.testID ?? "slider",
      });
    },
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

const { mockSelection } = vi.hoisted(() => ({ mockSelection: vi.fn() }));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: mockSelection, impact: vi.fn() }),
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

  it("renders source options (Online removed — now an inline CTA)", () => {
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
    // "Online" chip removed: online search is now triggered via the inline CTA
    expect(screen.queryByText("Online")).toBeNull();
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

describe("SearchFilterSheet — chip haptics", () => {
  beforeEach(() => mockSelection.mockClear());

  it.each(["Newest", "My Recipes"])(
    "tapping %s gives one selection tick",
    (label) => {
      const onFiltersChange = vi.fn();
      renderComponent(
        <SearchFilterSheet
          filters={{
            sort: "relevance",
            maxPrepTime: undefined,
            maxCalories: undefined,
            minProtein: undefined,
            source: "all",
          }}
          onFiltersChange={onFiltersChange}
          onReset={vi.fn()}
          activeFilterCount={0}
        />,
      );
      fireEvent.click(screen.getByText(label));
      expect(onFiltersChange).toHaveBeenCalledOnce();
      expect(mockSelection).toHaveBeenCalledTimes(1);
    },
  );
});

describe("SearchFilterSheet — live slider value follows committed filters", () => {
  const baseFilters = {
    sort: "relevance" as const,
    maxPrepTime: undefined,
    maxCalories: undefined,
    minProtein: undefined,
    source: "all" as const,
  };

  function renderSheet(filters: typeof baseFilters | Record<string, unknown>) {
    return renderComponent(
      <SearchFilterSheet
        filters={filters as typeof baseFilters}
        onFiltersChange={vi.fn()}
        onReset={vi.fn()}
        activeFilterCount={0}
      />,
    );
  }

  function announced(testID: string) {
    return sliderProps.get(testID)?.accessibilityValue?.text;
  }

  it.each([
    [
      "prep-time-slider",
      "maxPrepTime",
      30,
      "30 minutes",
      60,
      "60 minutes",
      "Any prep time",
    ],
    [
      "calories-slider",
      "maxCalories",
      400,
      "400 calories",
      800,
      "800 calories",
      "Any calories",
    ],
    [
      "protein-slider",
      "minProtein",
      20,
      "20 grams",
      40,
      "40 grams",
      "Any protein",
    ],
  ] as const)(
    "%s: a drag updates the announcement; an external change (e.g. Reset) overrides it",
    (testID, key, committed, committedText, dragged, draggedText, anyText) => {
      const { rerender } = renderSheet({ ...baseFilters, [key]: committed });
      expect(announced(testID)).toBe(committedText);

      act(() => sliderProps.get(testID)?.onValueChange?.(dragged));
      expect(announced(testID)).toBe(draggedText);

      // An unrelated filter change leaves the live (dragged) value alone.
      rerender(
        <SearchFilterSheet
          filters={{ ...baseFilters, [key]: committed, sort: "newest" }}
          onFiltersChange={vi.fn()}
          onReset={vi.fn()}
          activeFilterCount={0}
        />,
      );
      expect(announced(testID)).toBe(draggedText);

      // Reset clears the committed value: the announcement snaps back.
      rerender(
        <SearchFilterSheet
          filters={baseFilters}
          onFiltersChange={vi.fn()}
          onReset={vi.fn()}
          activeFilterCount={0}
        />,
      );
      expect(announced(testID)).toBe(anyText);
    },
  );
});
