// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { CuratedRecipeCarousel } from "../CuratedRecipeCarousel";

const { captured } = vi.hoisted(() => ({
  captured: { value: undefined as Record<string, unknown> | undefined },
}));

// See RecipeCarousel.flatlist-props.test.tsx for why this mock lives in its
// own file.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const FlatList = React.forwardRef<unknown, Record<string, unknown>>(
    (props, _ref) => {
      captured.value = props;
      return null;
    },
  );
  FlatList.displayName = "FlatList";
  return { ...actual, FlatList };
});

vi.mock("@/hooks/useCuratedRecipes", () => ({
  useCuratedRecipes: () => ({
    data: { recipes: [{ id: 7, title: "Miso Ramen" }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

describe("CuratedRecipeCarousel FlatList props", () => {
  beforeEach(() => {
    captured.value = undefined;
  });

  it("keeps off-screen cards in the accessibility tree (no clipping)", () => {
    renderComponent(<CuratedRecipeCarousel />);
    expect(captured.value).toBeDefined();
    expect(captured.value?.removeClippedSubviews).toBe(false);
  });

  it("keeps its virtualization window", () => {
    renderComponent(<CuratedRecipeCarousel />);
    expect(captured.value?.windowSize).toBe(5);
    expect(typeof captured.value?.getItemLayout).toBe("function");
  });
});
