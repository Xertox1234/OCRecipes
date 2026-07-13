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

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
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
