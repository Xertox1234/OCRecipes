// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
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
  // AXe tree dump, 2026-10-23). It must be an explicit `false`: an omitted
  // prop falls back to FlatList's default, which clips on Android.
  it("keeps off-screen cards in the accessibility tree (no clipping)", () => {
    renderComponent(<RecipeCarousel onDismissRequest={vi.fn()} />);
    expect(captured.value).toBeDefined();
    expect(captured.value?.removeClippedSubviews).toBe(false);
  });

  // FlatList only re-renders its rows when `data` or `extraData` changes, so
  // the open card must ride in `extraData` — otherwise a tap updates the
  // state but the card keeps its old shape until something else re-renders.
  it("re-renders its rows when a card opens", () => {
    renderComponent(<RecipeCarousel onDismissRequest={vi.fn()} />);
    const before = captured.value?.extraData;
    const renderItem = captured.value?.renderItem as (info: {
      item: { id: number; title: string };
    }) => React.ReactElement<{
      onToggleExpand: (card: { id: number; title: string }) => void;
    }>;
    const card = renderItem({ item: { id: 1, title: "Lentil Stew" } });
    act(() => {
      card.props.onToggleExpand({ id: 1, title: "Lentil Stew" });
    });
    expect(captured.value?.extraData).not.toEqual(before);
  });

  // The X asks why before anything is hidden: it hands the card to the
  // screen's reason sheet instead of dismissing straight away.
  it("asks for a reason instead of hiding the card on X", () => {
    const onDismissRequest = vi.fn();
    renderComponent(<RecipeCarousel onDismissRequest={onDismissRequest} />);
    const renderItem = captured.value?.renderItem as (info: {
      item: { id: number; title: string };
    }) => React.ReactElement<{
      onDismiss: (card: { id: number; title: string }) => void;
    }>;
    const card = renderItem({ item: { id: 1, title: "Lentil Stew" } });
    card.props.onDismiss({ id: 1, title: "Lentil Stew" });
    expect(onDismissRequest).toHaveBeenCalledWith({
      id: 1,
      title: "Lentil Stew",
    });
  });

  it("keeps its virtualization window", () => {
    renderComponent(<RecipeCarousel onDismissRequest={vi.fn()} />);
    expect(captured.value?.windowSize).toBe(5);
    expect(typeof captured.value?.getItemLayout).toBe("function");
  });
});
