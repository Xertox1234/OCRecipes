// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CarouselRecipeCard } from "../CarouselRecipeCard";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

const baseCard: CarouselCardType = {
  id: 42,
  title: "Pasta Carbonara",
  imageUrl: null,
  prepTimeMinutes: 20,
  recommendationReason: "High protein",
};

describe("CarouselRecipeCard remix badge accessibility", () => {
  // Exact-match assertions on the full composed label pin the spacing and
  // punctuation of every segment across all isRemix × prepLabel combinations.
  it("prefixes the card label with the remix status for remix cards", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isRemix: true }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Remixed recipe. Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("prefixes the remix status for remix cards without prep time", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isRemix: true, prepTimeMinutes: null }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Remixed recipe. Pasta Carbonara. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("does not carry a redundant 'Remixed recipe' label on the badge", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isRemix: true }}
        onPress={vi.fn()}
      />,
    );
    // Guards against re-introducing the badge's own accessibilityLabel (the
    // double-announcement bug). The accessible={false} half of the fix is
    // native-only behavior the jsdom RN mock cannot model — on-device
    // VoiceOver/TalkBack verification covers that.
    expect(screen.queryByLabelText("Remixed recipe")).toBeNull();
  });

  it("does not mention remix in the label for non-remix cards", () => {
    renderComponent(<CarouselRecipeCard card={baseCard} onPress={vi.fn()} />);
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText(/Remixed recipe/)).toBeNull();
  });

  it("does not mention remix for non-remix cards without prep time", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, prepTimeMinutes: null }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("treats a prep time of 0 as no prep time", () => {
    // Characterization: 0 is not a meaningful prep duration — the label and
    // badge intentionally omit the prep segment, same as null.
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, prepTimeMinutes: 0 }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });
});

describe("CarouselRecipeCard curated badge accessibility", () => {
  it("prefixes the card label with the curated status for canonical cards", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isCanonical: true }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Curated recipe. Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("orders remix before curated when both statuses apply", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isRemix: true, isCanonical: true }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Remixed recipe. Curated recipe. Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("does not carry a redundant 'Curated recipe' label on the badge", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, isCanonical: true }}
        onPress={vi.fn()}
      />,
    );
    // Same guard as the remix badge: curated status is conveyed via the
    // parent label prefix, never by the badge's own label.
    expect(screen.queryByLabelText("Curated recipe")).toBeNull();
  });
});

// Regression coverage for the favourite-heart accessibility fix. The card
// AnimatedPressable is accessible by default, so its whole subtree —
// including the nested favourite Pressable — collapses into one
// VoiceOver/TalkBack focus stop. The fix exposes the favourite toggle as an
// `accessibilityActions` entry on the card instead of restructuring the
// layout.
//
// jsdom cannot model either the collapse itself or the accessibilityActions/
// onAccessibilityAction wiring: the RN mock stringifies `accessibilityActions`
// to `"[object Object]"` and React drops `onAccessibilityAction` outright
// ("Unknown event handler property... It will be ignored" — it doesn't match
// a real DOM event). See
// docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
// These tests assert only what's provable: the composed card label is
// unchanged by the fix, and the visible favourite Pressable's own label/role/
// onPress (the pre-existing touch path) still work. Real screen-reader
// reachability is verified on-device, not here.
describe("CarouselRecipeCard favourite-heart accessibility", () => {
  it("keeps the card's composed accessibilityLabel unchanged by the fix", () => {
    renderComponent(<CarouselRecipeCard card={baseCard} onPress={vi.fn()} />);
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("keeps the visible favourite button independently reachable by touch, unaffected by the fix", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        onFavourite={onFavourite}
      />,
    );
    const favouriteButton = screen.getByLabelText("Add to favourites");
    fireEvent.click(favouriteButton);
    expect(onFavourite).toHaveBeenCalledWith(42);
  });

  it("labels the favourite button as remove when already favourited", () => {
    renderComponent(
      <CarouselRecipeCard card={baseCard} onPress={vi.fn()} isFavourited />,
    );
    expect(screen.getByLabelText("Remove from favourites")).toBeDefined();
  });

  it("does not render a favourite button when actions are hidden", () => {
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        showActions={false}
      />,
    );
    expect(screen.queryByLabelText("Add to favourites")).toBeNull();
  });
});
