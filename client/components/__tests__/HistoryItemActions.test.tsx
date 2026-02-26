// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { HistoryItemActions } from "../HistoryItemActions";

describe("HistoryItemActions", () => {
  const defaultProps = {
    isFavourited: false,
    isPremium: true,
    isFavouriteLoading: false,
    isDiscardLoading: false,
    onFavourite: vi.fn(),
    onGroceryList: vi.fn(),
    onGenerateRecipe: vi.fn(),
    onShare: vi.fn(),
    onDiscard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 5 action buttons", () => {
    renderComponent(<HistoryItemActions {...defaultProps} />);
    expect(screen.getByText("Favourite")).toBeDefined();
    expect(screen.getByText("Grocery")).toBeDefined();
    expect(screen.getByText("Recipe")).toBeDefined();
    expect(screen.getByText("Share")).toBeDefined();
    expect(screen.getByText("Discard")).toBeDefined();
  });

  it("shows Saved label when item is favourited", () => {
    renderComponent(
      <HistoryItemActions {...defaultProps} isFavourited={true} />,
    );
    expect(screen.getByText("Saved")).toBeDefined();
    expect(screen.queryByText("Favourite")).toBeNull();
  });

  it("calls onFavourite when Favourite button is pressed", () => {
    const onFavourite = vi.fn();
    renderComponent(
      <HistoryItemActions {...defaultProps} onFavourite={onFavourite} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Favourite" }));
    expect(onFavourite).toHaveBeenCalledOnce();
  });

  it("calls onDiscard when Discard button is pressed", () => {
    const onDiscard = vi.fn();
    renderComponent(
      <HistoryItemActions {...defaultProps} onDiscard={onDiscard} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("shows loading indicator for favourite when loading", () => {
    renderComponent(
      <HistoryItemActions {...defaultProps} isFavouriteLoading={true} />,
    );
    const spinners = screen.getAllByRole("progressbar");
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });
});
