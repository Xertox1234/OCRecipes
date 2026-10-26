// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, within } from "@testing-library/react";

import { Colors } from "@/constants/theme";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeSearchDrawer } from "../RecipeSearchDrawer";
import { LABELLED_INPUT_GEOMETRY } from "../../text-input-utils";

// jsdom cannot read a style array off the DOM, and FocusField hands its root
// Animated.View one — so record every Animated.View's raw props and read the
// style there (same harness as FocusTextInput.test.tsx).
const viewProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("react-native-reanimated", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  const Animated = actual.default as Record<string, React.ElementType>;
  const View = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      viewProps.push(props);
      return React.createElement(Animated.View, { ...props, ref });
    },
  );
  View.displayName = "Animated.View";
  return { ...actual, default: { ...Animated, View } };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection: vi.fn(), impact: vi.fn() }),
}));

vi.mock("@/hooks/useTrendingSearches", () => ({
  useTrendingSearches: () => ({
    isLoading: false,
    isError: false,
    data: { terms: ["pasta"] },
  }),
}));

vi.mock("@/lib/recent-recipe-searches-storage", () => ({
  getRecentSearches: () => [],
  pushRecentSearch: vi.fn(),
}));

function flattenDeep(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenDeep));
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

beforeEach(() => {
  viewProps.length = 0;
});

describe("RecipeSearchDrawer search field", () => {
  it("draws the ring on the rounded field that holds the input", () => {
    renderComponent(<RecipeSearchDrawer isOpen onUsed={vi.fn()} />);
    const input = screen.getByLabelText("Search recipes");
    const ring = screen.getByTestId("focus-field-ring");
    // The ring's container is the field, and the input sits inside it.
    expect(ring.parentElement!.contains(input)).toBe(true);
    // Exactly one ring — no square ring inside the rounded one.
    expect(screen.getAllByTestId("focus-field-ring")).toHaveLength(1);

    // The FocusField root carries the drawer field's fill and edge.
    const field = viewProps
      .map((p) => flattenDeep(p.style))
      .find((s) => s.minHeight === LABELLED_INPUT_GEOMETRY.containerMinHeight);
    expect(field).toMatchObject({
      backgroundColor: Colors.light.backgroundSecondary,
      borderColor: Colors.light.border,
      borderWidth: 1,
    });
  });

  it('shows the floating label "Search recipes" inside the field', () => {
    renderComponent(<RecipeSearchDrawer isOpen onUsed={vi.fn()} />);
    const ring = screen.getByTestId("focus-field-ring");
    const label = within(ring.parentElement!).getByTestId("focus-field-label");
    expect(label.textContent).toBe("Search recipes");
  });

  it("hides the placeholder while the label rests and shows it once focused", () => {
    renderComponent(<RecipeSearchDrawer isOpen onUsed={vi.fn()} />);
    const input = screen.getByLabelText("Search recipes");
    expect(input.getAttribute("placeholder")).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute("placeholder")).toBe("Search recipes…");
  });
});
