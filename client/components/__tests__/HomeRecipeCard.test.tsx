// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { HomeRecipeCard } from "../HomeRecipeCard";

vi.mock("@/components/Card", () => ({
  Card: ({
    children,
    onPress,
    ...props
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    [key: string]: unknown;
  }) =>
    React.createElement(
      "button",
      { onClick: onPress, role: "button", ...props },
      children,
    ),
}));

vi.mock("@/lib/query-client", () => ({
  resolveImageUrl: (url: string) => url,
}));

const baseRecipe = {
  id: 1,
  title: "Grilled Chicken Salad",
  description: "A healthy lunch option",
  imageUrl: "https://example.com/chicken.jpg",
  difficulty: "easy" as const,
  servings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  totalTimeMinutes: 25,
  authorId: 1,
  cuisine: "American",
  dietTags: ["high-protein"],
  createdAt: new Date(),
  updatedAt: new Date(),
  isPremium: false,
  isPublished: true,
  sourceUrl: null,
  calories: 350,
  proteinGrams: 30,
  carbsGrams: 20,
  fatGrams: 15,
};

describe("HomeRecipeCard", () => {
  it("renders recipe title", () => {
    renderComponent(<HomeRecipeCard recipe={baseRecipe} onPress={() => {}} />);
    expect(screen.getByText("Grilled Chicken Salad")).toBeDefined();
  });

  it("renders recipe description", () => {
    renderComponent(<HomeRecipeCard recipe={baseRecipe} onPress={() => {}} />);
    expect(screen.getByText("A healthy lunch option")).toBeDefined();
  });

  it("renders difficulty badge", () => {
    renderComponent(<HomeRecipeCard recipe={baseRecipe} onPress={() => {}} />);
    expect(screen.getByText("easy")).toBeDefined();
  });

  it("calls onPress with recipe id when pressed", () => {
    const onPress = vi.fn();
    renderComponent(<HomeRecipeCard recipe={baseRecipe} onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledWith(1);
  });

  it("renders placeholder icon when no image", () => {
    renderComponent(
      <HomeRecipeCard
        recipe={{ ...baseRecipe, imageUrl: null }}
        onPress={() => {}}
      />,
    );
    // Feather "image" icon is the placeholder
    expect(screen.getByText("image")).toBeDefined();
  });
});
