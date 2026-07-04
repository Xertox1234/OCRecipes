// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CuratedRecipeCarousel } from "../CuratedRecipeCarousel";
import type { CommunityRecipe } from "@shared/schema";

const mockRecipe = {
  id: 7,
  title: "Miso Ramen",
  imageUrl: null,
  canonicalImages: null,
} as unknown as CommunityRecipe;

const { mockUseCuratedRecipes, mockNavigate } = vi.hoisted(() => ({
  mockUseCuratedRecipes: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@/hooks/useCuratedRecipes", () => ({
  useCuratedRecipes: mockUseCuratedRecipes,
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

describe("CuratedRecipeCarousel curated badge accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCuratedRecipes.mockReturnValue({
      data: { recipes: [mockRecipe] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("announces curated status once via the card label", () => {
    renderComponent(<CuratedRecipeCarousel />);
    expect(
      screen.getByLabelText("Miso Ramen. Curated recipe. Double tap to view."),
    ).toBeDefined();
  });

  it("does not carry a redundant 'Curated recipe' label on the badge", () => {
    renderComponent(<CuratedRecipeCarousel />);
    // The card label above already contains "Curated recipe" — a badge with
    // its own label re-announces it word-for-word on the same focusable.
    expect(screen.queryByLabelText("Curated recipe")).toBeNull();
  });
});
