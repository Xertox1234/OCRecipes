// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeCarousel } from "../RecipeCarousel";

const { captured } = vi.hoisted(() => ({
  captured: { value: undefined as Record<string, unknown> | undefined },
}));

// The shared jsdom FlatList mock drops props it doesn't render, so a DOM
// assertion can't see `removeClippedSubviews`. Capture the props the
// carousel passes and render nothing (same approach as
// RecipeBrowserScreen.params.test.tsx). Kept in its own file because this
// mock is file-scoped and would blank the card-label tests.
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

vi.mock("@/hooks/useCarouselRecipes", () => ({
  useCarouselRecipes: () => ({
    data: { cards: [{ id: 1, title: "Lentil Stew" }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDismissCarouselRecipe: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: [] } }),
  useToggleFavouriteRecipe: () => ({ mutate: vi.fn() }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

describe("RecipeCarousel FlatList props", () => {
  beforeEach(() => {
    captured.value = undefined;
  });

  // On iOS, clipping detaches off-screen cards from the native view tree, so
  // VoiceOver can't move past the second card (owner's device pass and an
  // AXe tree dump, 2026-10-23).
  it("keeps off-screen cards in the accessibility tree (no clipping)", () => {
    renderComponent(<RecipeCarousel />);
    expect(captured.value).toBeDefined();
    expect(captured.value?.removeClippedSubviews).toBeFalsy();
  });

  it("keeps its virtualization window", () => {
    renderComponent(<RecipeCarousel />);
    expect(captured.value?.windowSize).toBe(5);
    expect(typeof captured.value?.getItemLayout).toBe("function");
  });
});
