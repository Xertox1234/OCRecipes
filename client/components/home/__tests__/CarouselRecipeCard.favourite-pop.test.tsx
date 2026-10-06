// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CarouselRecipeCard } from "../CarouselRecipeCard";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

const { mockTriggerPop, mockImpact } = vi.hoisted(() => ({
  mockTriggerPop: vi.fn(),
  mockImpact: vi.fn(),
}));

// The pop's own trigger fires the Success haptic, so a favourite should be
// exactly one buzz: the pop. Unfavouriting keeps the plain impact tap.
vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({
    trigger: mockTriggerPop,
    animatedStyle: {},
    scale: { value: 1 },
  }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

const card: CarouselCardType = {
  id: 42,
  title: "Pasta Carbonara",
  imageUrl: null,
  prepTimeMinutes: 20,
  recommendationReason: "High protein",
  allergens: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CarouselRecipeCard — favourite heart pop", () => {
  it("pops the heart (one buzz) when favouriting", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={vi.fn()}
        onFavourite={onFavourite}
      />,
    );

    fireEvent.click(screen.getByLabelText("Add to favourites"));

    expect(onFavourite).toHaveBeenCalledWith(42);
    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("taps without a pop when unfavouriting", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={vi.fn()}
        onFavourite={onFavourite}
        isFavourited
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove from favourites"));

    expect(onFavourite).toHaveBeenCalledWith(42);
    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});
