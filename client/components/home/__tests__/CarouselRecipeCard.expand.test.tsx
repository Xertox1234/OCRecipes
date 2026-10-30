// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CarouselRecipeCard } from "../CarouselRecipeCard";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

// Two-tap card: the first tap expands the card to show its details and a
// "View recipe" button; only that button opens the recipe. A screen-reader
// user already hears every detail in the card's label, so for them the card
// still opens the recipe in one activation.
const { a11y } = vi.hoisted(() => ({
  a11y: { reducedMotion: false, screenReaderEnabled: false },
}));
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

// Rendered as a marker so the test can prove the star is gone.
vi.mock("@/components/CuratedBadge", () => ({
  CuratedBadge: () => <span data-testid="curated-badge" />,
}));

const card: CarouselCardType = {
  id: 42,
  title: "Pasta Carbonara",
  imageUrl: null,
  prepTimeMinutes: 20,
  recommendationReason: "High protein",
  // Checked (empty) allergens — a diet chip only shows once they are known.
  allergens: [],
  dietTags: ["vegan"],
  dietConflicts: [],
  spiceLevel: null,
  totalTimeMinutes: null,
  isCanonical: true,
};

function pressCard() {
  fireEvent.click(screen.getByLabelText(/^Curated recipe\. Pasta Carbonara/));
}

describe("CarouselRecipeCard tap to expand", () => {
  beforeEach(() => {
    a11y.screenReaderEnabled = false;
  });

  it("shows only the photo and title while collapsed", () => {
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={vi.fn()}
        expanded={false}
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByText("Pasta Carbonara")).toBeDefined();
    expect(screen.queryByText("Vegan")).toBeNull();
    expect(screen.queryByTestId("carousel-card-reason")).toBeNull();
    expect(screen.queryByLabelText("View recipe")).toBeNull();
  });

  it("expands instead of opening the recipe on the first tap", () => {
    const onPress = vi.fn();
    const onToggleExpand = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={onPress}
        expanded={false}
        onToggleExpand={onToggleExpand}
      />,
    );
    pressCard();
    expect(onToggleExpand).toHaveBeenCalledWith(card);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows the details and a View recipe button once expanded", () => {
    const onPress = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={onPress}
        expanded
        onToggleExpand={vi.fn()}
      />,
    );
    expect(screen.getByText("Vegan")).toBeDefined();
    expect(screen.getByTestId("carousel-card-reason").textContent).toBe(
      "High protein",
    );
    fireEvent.click(screen.getByLabelText("View recipe"));
    expect(onPress).toHaveBeenCalledWith(card);
  });

  it("collapses again when the expanded card is tapped", () => {
    const onPress = vi.fn();
    const onToggleExpand = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={onPress}
        expanded
        onToggleExpand={onToggleExpand}
      />,
    );
    pressCard();
    expect(onToggleExpand).toHaveBeenCalledWith(card);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("opens the recipe in one activation when a screen reader is on", () => {
    a11y.screenReaderEnabled = true;
    const onPress = vi.fn();
    const onToggleExpand = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={card}
        onPress={onPress}
        expanded={false}
        onToggleExpand={onToggleExpand}
      />,
    );
    pressCard();
    expect(onPress).toHaveBeenCalledWith(card);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("keeps the old one-tap card when no expand handler is given", () => {
    const onPress = vi.fn();
    renderComponent(<CarouselRecipeCard card={card} onPress={onPress} />);
    expect(screen.getByText("Vegan")).toBeDefined();
    expect(screen.queryByLabelText("View recipe")).toBeNull();
    pressCard();
    expect(onPress).toHaveBeenCalledWith(card);
  });

  it("no longer shows the curated star on the photo", () => {
    renderComponent(<CarouselRecipeCard card={card} onPress={vi.fn()} />);
    expect(screen.queryByTestId("curated-badge")).toBeNull();
  });
});
