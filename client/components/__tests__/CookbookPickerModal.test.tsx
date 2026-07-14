// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { CookbookPickerModal } from "../CookbookPickerModal";
import * as useCookbooksModule from "@/hooks/useCookbooks";
import * as useFavouriteRecipesModule from "@/hooks/useFavouriteRecipes";
import type { CookbookWithCount } from "@shared/schema";

const { mockCreateMutate, mockAddRecipeMutate, mockToggleFavouriteMutate } =
  vi.hoisted(() => ({
    mockCreateMutate: vi.fn(),
    mockAddRecipeMutate: vi.fn(),
    mockToggleFavouriteMutate: vi.fn(),
  }));

vi.mock("@/hooks/useCookbooks", () => ({
  useCookbooks: vi.fn(),
  useCreateCookbook: () => ({ mutate: mockCreateMutate, isPending: false }),
  useAddRecipeToCookbook: () => ({
    mutate: mockAddRecipeMutate,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useIsRecipeFavourited: vi.fn(),
  useToggleFavouriteRecipe: () => ({
    mutate: mockToggleFavouriteMutate,
    isPending: false,
  }),
}));

const baseProps = {
  visible: true,
  recipeId: 42,
  recipeType: "mealPlan" as const,
};

const existingCookbook: CookbookWithCount = {
  id: 1,
  userId: "user-1",
  name: "Dinner",
  description: null,
  coverImageUrl: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  recipeCount: 2,
};

describe("CookbookPickerModal — empty state actions", () => {
  beforeEach(() => {
    vi.mocked(useFavouriteRecipesModule.useIsRecipeFavourited).mockReturnValue(
      false,
    );
  });

  it("offers New Cookbook and Save to Favourites when no cookbooks exist", () => {
    vi.mocked(useCookbooksModule.useCookbooks).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCookbooksModule.useCookbooks>);

    renderComponent(<CookbookPickerModal {...baseProps} onClose={vi.fn()} />);

    expect(screen.getByText("New Cookbook")).toBeTruthy();
    expect(screen.getByText("Save to Favourites")).toBeTruthy();
  });

  it("hides Save to Favourites when the recipe is already favourited", () => {
    vi.mocked(useCookbooksModule.useCookbooks).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCookbooksModule.useCookbooks>);
    vi.mocked(useFavouriteRecipesModule.useIsRecipeFavourited).mockReturnValue(
      true,
    );

    renderComponent(<CookbookPickerModal {...baseProps} onClose={vi.fn()} />);

    expect(screen.getByText("New Cookbook")).toBeTruthy();
    expect(screen.queryByText("Save to Favourites")).toBeNull();
  });

  it("saves the recipe to favourites and closes the modal", () => {
    vi.mocked(useCookbooksModule.useCookbooks).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCookbooksModule.useCookbooks>);
    mockToggleFavouriteMutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess?: () => void }) => {
        opts.onSuccess?.();
      },
    );
    const onClose = vi.fn();

    renderComponent(<CookbookPickerModal {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Save to Favourites"));

    expect(mockToggleFavouriteMutate).toHaveBeenCalledWith(
      { recipeId: 42, recipeType: "mealPlan" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides empty-state actions once the New Cookbook input is open", () => {
    vi.mocked(useCookbooksModule.useCookbooks).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCookbooksModule.useCookbooks>);

    renderComponent(<CookbookPickerModal {...baseProps} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("New Cookbook"));

    expect(screen.queryByText("New Cookbook")).toBeNull();
    expect(screen.queryByText("Save to Favourites")).toBeNull();
    expect(
      screen.getByPlaceholderText("Cookbook name (optional)"),
    ).toBeTruthy();
  });

  it("does not show Save to Favourites once a cookbook already exists", () => {
    vi.mocked(useCookbooksModule.useCookbooks).mockReturnValue({
      data: [existingCookbook],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useCookbooksModule.useCookbooks>);

    renderComponent(<CookbookPickerModal {...baseProps} onClose={vi.fn()} />);

    expect(screen.getByText("Dinner")).toBeTruthy();
    expect(screen.getByText("New Cookbook")).toBeTruthy();
    expect(screen.queryByText("Save to Favourites")).toBeNull();
  });
});
