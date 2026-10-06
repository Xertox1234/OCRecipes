// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeCard } from "../RecipeCard";
import type { StreamingRecipe } from "@/hooks/useChat";
import {
  impactAsync as rawImpactAsync,
  selectionAsync as rawSelectionAsync,
} from "expo-haptics";

const { mockImpact, mockNotification, mockSelection, mockTriggerPop } =
  vi.hoisted(() => ({
    mockImpact: vi.fn(),
    mockNotification: vi.fn(),
    mockSelection: vi.fn(),
    mockTriggerPop: vi.fn(),
  }));

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
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

// The shared react-native DOM mock (test/mocks/react-native.ts) doesn't export
// LayoutAnimation — nothing else under test needs it — but RecipeCard calls
// `LayoutAnimation.configureNext` on every ingredient/instruction toggle, so
// leaving it unmocked would throw before the haptics call under test runs.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    LayoutAnimation: {
      configureNext: vi.fn(),
      Presets: { easeInEaseOut: {} },
    },
  };
});

const recipe: StreamingRecipe = {
  title: "Lemon Herb Chicken",
  description: "A bright, herby weeknight dinner.",
  difficulty: "Easy",
  timeEstimate: "30 min",
  servings: 4,
  ingredients: [{ name: "chicken breast", quantity: "1", unit: "lb" }],
  instructions: ["Preheat oven to 400F.", "Roast chicken 25 minutes."],
  dietTags: [],
  imageUrl: null,
};

describe("RecipeCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the recipe title", () => {
    renderComponent(<RecipeCard recipe={recipe} />);
    expect(screen.getByText("Lemon Herb Chicken")).toBeTruthy();
  });

  // A null image (generation failed or timed out) is final: the card shows
  // the no-image placeholder, not a loading skeleton that never resolves.
  it("shows the no-image placeholder when the recipe has no image and none is loading", () => {
    const { container } = renderComponent(<RecipeCard recipe={recipe} />);
    expect(screen.getByText("image")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows neither the image nor the placeholder while the image is loading", () => {
    const { container } = renderComponent(
      <RecipeCard recipe={{ ...recipe, imageUrl: undefined }} isImageLoading />,
    );
    expect(screen.queryByText("image")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the recipe image when it has one", () => {
    const { container } = renderComponent(
      <RecipeCard
        recipe={{ ...recipe, imageUrl: "https://cdn.example.com/r.jpg" }}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/r.jpg",
    );
  });

  it("triggers haptics via useHaptics (not raw expo-haptics) when expanding ingredients", () => {
    renderComponent(<RecipeCard recipe={recipe} />);
    fireEvent.click(
      screen.getByLabelText(`Ingredients, ${recipe.ingredients.length} items`),
    );
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(rawSelectionAsync).not.toHaveBeenCalled();
  });

  it("triggers haptics via useHaptics (not raw expo-haptics) when expanding instructions", () => {
    renderComponent(<RecipeCard recipe={recipe} />);
    fireEvent.click(
      screen.getByLabelText(
        `Instructions, ${recipe.instructions.length} steps`,
      ),
    );
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(rawSelectionAsync).not.toHaveBeenCalled();
  });

  it("triggers haptics via useHaptics (not raw expo-haptics) when saving", () => {
    const onSave = vi.fn();
    renderComponent(
      <RecipeCard recipe={recipe} onSave={onSave} isSaved={false} />,
    );
    fireEvent.click(screen.getByLabelText(`Save ${recipe.title} recipe`));
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(rawImpactAsync).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe("RecipeCard — favourite heart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a heart beside Save that calls onFavourite", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <RecipeCard recipe={recipe} onSave={vi.fn()} onFavourite={onFavourite} />,
    );

    const heart = screen.getByLabelText("Add Lemon Herb Chicken to favourites");
    expect(heart.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(heart);
    expect(onFavourite).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalled();
  });

  it("a favourited recipe reads as selected and offers removal", () => {
    renderComponent(
      <RecipeCard
        recipe={recipe}
        onSave={vi.fn()}
        isSaved
        isFavourited
        onFavourite={vi.fn()}
      />,
    );

    const heart = screen.getByLabelText(
      "Remove Lemon Herb Chicken from favourites",
    );
    expect(heart.getAttribute("aria-selected")).toBe("true");
  });

  it("no heart without onFavourite (e.g. a streaming card)", () => {
    renderComponent(<RecipeCard recipe={recipe} onSave={vi.fn()} />);
    expect(
      screen.queryByLabelText("Add Lemon Herb Chicken to favourites"),
    ).toBeNull();
  });

  it("the heart waits while the recipe is saving", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <RecipeCard
        recipe={recipe}
        onSave={vi.fn()}
        isSaving
        onFavourite={onFavourite}
      />,
    );

    fireEvent.click(
      screen.getByLabelText("Add Lemon Herb Chicken to favourites"),
    );
    expect(onFavourite).not.toHaveBeenCalled();
  });
});

// docs/rules/accessibility.md: never `accessible` on a card wrapper with an
// interactive child — iOS collapses the subtree into one node and VoiceOver
// (and Maestro) can't reach Save, the heart or the section toggles. jsdom
// can't see that collapse (React drops the boolean `accessible` attribute),
// so the reachability half was measured on the iOS simulator; this pins
// where the card's summary moved to.
describe("RecipeCard — accessibility tree", () => {
  it("the title is a header that carries the recipe summary", () => {
    renderComponent(<RecipeCard recipe={recipe} />);
    expect(
      screen.getByRole("header", {
        name: "Recipe: Lemon Herb Chicken. Easy, 30 min, 4 servings",
      }),
    ).toBeDefined();
  });
});

// The pop fires its own Success haptic, so it only runs where the heart flips
// at tap time: an already-saved recipe. On an unsaved one the parent saves
// first and that save is the Success moment, so the heart keeps its light tap.
describe("RecipeCard — favourite heart pop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pops (one buzz) when favouriting a saved recipe", () => {
    renderComponent(
      <RecipeCard
        recipe={recipe}
        isSaved
        onSave={vi.fn()}
        onFavourite={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByLabelText("Add Lemon Herb Chicken to favourites"),
    );
    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("taps without a pop when unfavouriting", () => {
    renderComponent(
      <RecipeCard
        recipe={recipe}
        isSaved
        isFavourited
        onSave={vi.fn()}
        onFavourite={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByLabelText("Remove Lemon Herb Chicken from favourites"),
    );
    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });

  it("taps without a pop on an unsaved recipe (the save is the moment)", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <RecipeCard recipe={recipe} onSave={vi.fn()} onFavourite={onFavourite} />,
    );
    fireEvent.click(
      screen.getByLabelText("Add Lemon Herb Chicken to favourites"),
    );
    expect(onFavourite).toHaveBeenCalledTimes(1);
    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});
