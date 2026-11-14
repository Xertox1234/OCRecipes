// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeDetailContent } from "../RecipeDetailContent";

// The instructions section records what it was handed; every other heavy
// child is a thin double so only RecipeDetailContent's own state is tested.
const { instructionsProps } = vi.hoisted(() => ({
  instructionsProps: {
    current: null as {
      expandable?: {
        expandedStep: number | null;
        onToggleStep: (index: number) => void;
      };
    } | null,
  },
}));

vi.mock("@/components/recipe-detail", () => ({
  NutritionCard: () => null,
  RecipeMetaChips: () => null,
  RecipeIngredientsList: () => null,
  RecipeDietTags: () => null,
  FoodFacts: () => null,
  RecipeInstructions: (props: typeof instructionsProps.current) => {
    instructionsProps.current = props;
    return (
      <span data-testid="expanded-step">
        {String(props?.expandable?.expandedStep ?? "none")}
      </span>
    );
  },
}));

vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    isPremium: false,
    isPremiumResolved: true,
    refreshSubscription: vi.fn(),
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useAllergenCheck", () => ({
  useAllergenCheck: () => ({ data: undefined }),
}));
vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useIsRecipeFavourited: () => false,
}));
vi.mock("@/components/CookbookPickerModal", () => ({
  CookbookPickerModal: () => null,
}));
vi.mock("@/components/UpgradeModal", () => ({ UpgradeModal: () => null }));
vi.mock("@/components/AskCoachSection", () => ({
  AskCoachSection: () => null,
}));
vi.mock("@/components/RecipeCommunityStats", () => ({
  RecipeCommunityStats: () => null,
}));
vi.mock("@/components/RecipeActionBar", () => ({
  RecipeActionBar: () => null,
}));

describe("RecipeDetailContent — expanded step", () => {
  const ui = (recipeId: number) => (
    <RecipeDetailContent
      recipeId={recipeId}
      recipeType="community"
      title="Soup"
      instructions={["Chop", "Simmer"]}
      instructionDetails={["Small dice", "Low heat"]}
      isCanonical
    />
  );

  it("collapses the expanded step when another recipe is shown", () => {
    const { rerender } = renderComponent(ui(1));
    act(() => instructionsProps.current!.expandable!.onToggleStep(1));
    expect(screen.getByTestId("expanded-step").textContent).toBe("1");

    // Same recipe re-rendered: the step stays open.
    rerender(ui(1));
    expect(screen.getByTestId("expanded-step").textContent).toBe("1");

    rerender(ui(2));
    expect(screen.getByTestId("expanded-step").textContent).toBe("none");
  });
});

describe("RecipeDetailContent — canonical gallery", () => {
  it("renders gallery photos through expo-image with their labels", () => {
    renderComponent(
      <RecipeDetailContent
        recipeId={1}
        recipeType="community"
        title="Soup"
        instructions={["Chop"]}
        isCanonical
        canonicalImages={[
          "https://cdn.example.com/a.jpg",
          "https://cdn.example.com/b.jpg",
        ]}
      />,
    );
    const photo = screen.getByLabelText("Photo 2 of 2 of Soup");
    expect(photo.getAttribute("src")).toBe("https://cdn.example.com/b.jpg");
    // data-content-fit is only emitted by the expo-image mock.
    expect(photo.getAttribute("data-content-fit")).toBe("cover");
  });
});
