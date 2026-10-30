// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import {
  DismissReasonSheet,
  DismissReasonSheetContent,
} from "../DismissReasonSheet";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { CarouselRecipeCard } from "@shared/types/carousel";

const { mockDismiss, mockAnnounce } = vi.hoisted(() => ({
  mockDismiss: vi.fn(),
  mockAnnounce: vi.fn(),
}));

vi.mock("@/hooks/useSheetBackHandler", () => ({
  useSheetBackHandler: () => ({
    onSheetChange: vi.fn(),
    onSheetAnimate: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCarouselRecipes", () => ({
  useDismissCarouselRecipe: () => ({ mutate: mockDismiss }),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility: mockAnnounce,
    },
  };
});

const card = { id: 42, title: "Lentil Stew" } as CarouselRecipeCard;

describe("DismissReasonSheetContent", () => {
  it("asks why and offers the four reasons", () => {
    renderComponent(
      <DismissReasonSheetContent onPick={vi.fn()} onKeep={vi.fn()} />,
    );
    expect(screen.getByText("Why hide this recipe?")).toBeDefined();
    for (const label of [
      "Has something I avoid",
      "Doesn't fit my diet",
      "Not a cuisine I like",
      "Just not interested",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("reports the picked reason id", () => {
    const onPick = vi.fn();
    renderComponent(
      <DismissReasonSheetContent onPick={onPick} onKeep={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Not a cuisine I like"));
    expect(onPick).toHaveBeenCalledWith("cuisine_disliked");
  });

  it("lets the person keep the recipe", () => {
    const onKeep = vi.fn();
    renderComponent(
      <DismissReasonSheetContent onPick={vi.fn()} onKeep={onKeep} />,
    );
    fireEvent.click(screen.getByLabelText("Keep this recipe"));
    expect(onKeep).toHaveBeenCalled();
  });
});

describe("DismissReasonSheet", () => {
  beforeEach(() => {
    mockDismiss.mockClear();
    mockAnnounce.mockClear();
  });

  function renderSheet() {
    const sheetRef = React.createRef<BottomSheetModal>();
    const cardRef = { current: card as CarouselRecipeCard | null };
    renderComponent(
      <DismissReasonSheet sheetRef={sheetRef} cardRef={cardRef} />,
    );
  }

  it("hides the recipe with the picked reason, then says so", () => {
    renderSheet();
    fireEvent.click(screen.getByLabelText("Doesn't fit my diet"));
    expect(mockDismiss).toHaveBeenCalledWith({
      recipeId: 42,
      reason: "diet_mismatch",
    });
    expect(mockAnnounce).toHaveBeenCalledWith("Recipe hidden");
  });

  it("hides nothing when the person keeps the recipe", () => {
    renderSheet();
    fireEvent.click(screen.getByLabelText("Keep this recipe"));
    expect(mockDismiss).not.toHaveBeenCalled();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("keeps its content reachable by screen readers", () => {
    renderSheet();
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });
});
