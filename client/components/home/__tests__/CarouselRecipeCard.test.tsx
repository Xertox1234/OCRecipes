// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CarouselRecipeCard } from "../CarouselRecipeCard";
import type { CarouselRecipeCard as CarouselCardType } from "@shared/types/carousel";

// Every rendered Pressable's raw props, captured in render order. This is the
// only way to inspect `accessibilityActions`/`onAccessibilityAction` at all —
// the shared mock's hand-written Pressable doesn't destructure either prop,
// so `accessibilityActions` falls through `...rest` and is stringified to
// "[object Object]" on the DOM node, and `onAccessibilityAction` (matching
// React's `/^on[A-Z]/` DOM-event-handler heuristic) is dropped outright
// before it ever reaches an attribute — see
// docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
// Capturing at the mock-component boundary (before that spread) sidesteps the
// gap: a plain JS object passed to a component function is never mangled the
// way a DOM attribute/event is. `react-native` is aliased globally in
// vitest.config.mts to test/mocks/react-native.ts — this local override is
// the legitimate exception documented in
// docs/solutions/conventions/inline-vi-mock-globally-aliased-modules-2026-05-13.md
// (a capability, prop capture, the shared alias can't provide).
const { capturedPressables } = vi.hoisted(() => ({
  capturedPressables: [] as Record<string, unknown>[],
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const CapturingPressable = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      capturedPressables.push(props);
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  CapturingPressable.displayName = "Pressable";
  return { ...actual, Pressable: CapturingPressable };
});

const baseCard: CarouselCardType = {
  id: 42,
  title: "Pasta Carbonara",
  imageUrl: null,
  prepTimeMinutes: 20,
  recommendationReason: "High protein",
  allergens: null,
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

// Coverage for the universal "Contains: <allergen>" label
// (todos/archive/P3-2026-07-24-universal-allergen-label-remaining-surfaces.md).
// The card AnimatedPressable is accessible by default, which collapses the
// nested RecipeAllergenLabel's own container into the card's single focus
// stop, so the fix folds the allergen text into the card's own composed
// label — same pattern verified for the remix/curated badges above.
describe("CarouselRecipeCard universal allergen label", () => {
  it("folds the recipe's derived allergens into the card's composed accessibilityLabel", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{
          ...baseCard,
          allergens: [{ id: "peanuts", viaDerived: false }],
        }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. High protein. Contains: Peanuts. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("does not add an allergen suffix when allergens is null (never a false 'safe' signal)", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, allergens: null }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. High protein. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });
});

// Regression coverage for the double-period bug
// (todos/archive/P3-2026-07-24-carousel-card-double-period-empty-reason.md).
// `recommendationReason` can be an empty string (see `toCarouselCard`'s
// calorie/time/cuisine fallback chain in recipe-discovery-utils.ts, which
// terminates at `recipe.cuisine ?? ""`), and the composed label used to emit
// an unconditional ". " before it, producing a dangling ". .". These tests
// synthesize the empty-reason `card` prop directly rather than exercising it
// through `toCarouselCard`, so the assertion doesn't depend on the producer's
// reachability.
describe("CarouselRecipeCard empty recommendationReason", () => {
  it("does not leave a dangling double period when recommendationReason is empty", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, recommendationReason: "" }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("does not leave a dangling double period when recommendationReason is empty and an allergen suffix is present", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{
          ...baseCard,
          recommendationReason: "",
          allergens: [{ id: "peanuts", viaDerived: false }],
        }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        "Pasta Carbonara, 20 min prep. Contains: Peanuts. Double tap to view recipe.",
      ),
    ).toBeDefined();
  });

  it("does not leave a dangling double period when both prep time and recommendationReason are absent", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, prepTimeMinutes: null, recommendationReason: "" }}
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText("Pasta Carbonara. Double tap to view recipe."),
    ).toBeDefined();
  });

  // The visible caption is the sighted-user half of the same bug: rendering it
  // unconditionally left an empty <Text> that still reserved its
  // `styles.reason` marginBottom, so an empty reason showed as a blank gap.
  it("renders the reason caption when recommendationReason is non-empty", () => {
    renderComponent(<CarouselRecipeCard card={baseCard} onPress={vi.fn()} />);
    expect(screen.getByTestId("carousel-card-reason").textContent).toBe(
      "High protein",
    );
  });

  it("omits the reason caption entirely when recommendationReason is empty", () => {
    renderComponent(
      <CarouselRecipeCard
        card={{ ...baseCard, recommendationReason: "" }}
        onPress={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("carousel-card-reason")).toBeNull();
  });
});

// P1-2026-09-23 (M8): the "Dismiss recipe" button has the identical
// interactive-descendant swallow as the favourite toggle above — the card
// AnimatedPressable is accessible by default, collapsing the whole subtree
// (including this button) into one VoiceOver/TalkBack focus stop. Extends the
// existing `accessibilityActions` entry (see the favourite-heart describe
// block above) to also cover `dismiss`.
//
// jsdom cannot observe accessibilityActions/onAccessibilityAction via the DOM
// or fireEvent at all (see the capturedPressables comment at the top of this
// file) — these tests capture the raw props at the mock-component boundary
// instead of relying on a render/DOM assertion.
describe("CarouselRecipeCard dismiss accessibility action", () => {
  function findCardProps() {
    return capturedPressables.find(
      (p) => typeof p.onAccessibilityAction === "function",
    );
  }

  it("exposes toggleFavourite and dismiss as accessibility actions on the card", () => {
    capturedPressables.length = 0;
    renderComponent(<CarouselRecipeCard card={baseCard} onPress={vi.fn()} />);
    const cardProps = findCardProps();
    expect(
      cardProps,
      "no accessibility-actions Pressable captured",
    ).toBeDefined();
    expect(cardProps!.accessibilityActions).toEqual([
      { name: "toggleFavourite", label: "Add to favourites" },
      { name: "dismiss", label: "Dismiss recipe" },
    ]);
  });

  it("labels toggleFavourite as remove when already favourited", () => {
    capturedPressables.length = 0;
    renderComponent(
      <CarouselRecipeCard card={baseCard} onPress={vi.fn()} isFavourited />,
    );
    const cardProps = findCardProps();
    expect(cardProps!.accessibilityActions).toEqual([
      { name: "toggleFavourite", label: "Remove from favourites" },
      { name: "dismiss", label: "Dismiss recipe" },
    ]);
  });

  it("is undefined when actions are hidden", () => {
    capturedPressables.length = 0;
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        showActions={false}
      />,
    );
    const cardProps = findCardProps();
    expect(cardProps!.accessibilityActions).toBeUndefined();
  });

  it("dispatches onDismiss when the dismiss accessibility action fires", () => {
    capturedPressables.length = 0;
    const onDismiss = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "dismiss" },
      });
    });
    expect(onDismiss).toHaveBeenCalledWith(baseCard);
  });

  it("dispatches onFavourite when the toggleFavourite accessibility action fires", () => {
    capturedPressables.length = 0;
    const onFavourite = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        onFavourite={onFavourite}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "toggleFavourite" },
      });
    });
    expect(onFavourite).toHaveBeenCalledWith(42);
  });

  it("does not dispatch either handler for an unrecognized action name", () => {
    capturedPressables.length = 0;
    const onFavourite = vi.fn();
    const onDismiss = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        onFavourite={onFavourite}
        onDismiss={onDismiss}
      />,
    );
    const cardProps = findCardProps();
    act(() => {
      (cardProps!.onAccessibilityAction as (e: unknown) => void)({
        nativeEvent: { actionName: "unknown" },
      });
    });
    expect(onFavourite).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps the visible dismiss button independently reachable by touch, unaffected by the fix", () => {
    capturedPressables.length = 0;
    const onDismiss = vi.fn();
    renderComponent(
      <CarouselRecipeCard
        card={baseCard}
        onPress={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    const dismissButton = screen.getByLabelText("Dismiss recipe");
    fireEvent.click(dismissButton);
    expect(onDismiss).toHaveBeenCalledWith(baseCard);
  });
});
