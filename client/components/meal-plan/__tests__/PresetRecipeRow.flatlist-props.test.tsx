// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { PresetRecipeRow } from "../PresetRecipeRow";
import type { SearchableRecipe } from "@shared/types/recipe-search";

const { captured } = vi.hoisted(() => ({
  captured: { value: undefined as Record<string, unknown> | undefined },
}));

// See client/components/home/__tests__/RecipeCarousel.flatlist-props.test.tsx
// for why FlatList is captured here instead of rendered.
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

const recipe = { id: "community:1", title: "Pantry Pasta" } as SearchableRecipe;

function renderRow() {
  return renderComponent(
    <PresetRecipeRow
      title="From your pantry"
      recipes={[recipe]}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      onOpenRecipe={vi.fn()}
    />,
  );
}

describe("PresetRecipeRow FlatList props", () => {
  beforeEach(() => {
    captured.value = undefined;
  });

  it("keeps off-screen cards in the accessibility tree (no clipping)", () => {
    renderRow();
    expect(captured.value).toBeDefined();
    expect(captured.value?.removeClippedSubviews).toBe(false);
  });

  it("keeps its virtualization window", () => {
    renderRow();
    expect(captured.value?.windowSize).toBe(5);
    expect(typeof captured.value?.getItemLayout).toBe("function");
  });
});
