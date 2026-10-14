// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SuggestionCard } from "../SuggestionCard";

const { mockImpact } = vi.hoisted(() => ({ mockImpact: vi.fn() }));

vi.mock("@/components/FallbackImage", () => ({
  FallbackImage: () => <div data-testid="card-photo" />,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

const s = {
  id: 1,
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 25,
  tags: ["quick"],
  imageUrl: null,
  madeRecipeId: null,
};

describe("SuggestionCard", () => {
  it("shows title, description, time and a Make this mine button", () => {
    const onMake = vi.fn();
    renderComponent(
      <SuggestionCard suggestion={s} making={false} onMake={onMake} />,
    );
    expect(screen.getByText("Bean Tacos")).toBeTruthy();
    expect(screen.getByText("Quick bright tacos tonight.")).toBeTruthy();
    expect(screen.getByText("25 min")).toBeTruthy();
    expect(screen.queryByTestId("card-photo")).toBeNull();
    fireEvent.click(screen.getByLabelText("Make Bean Tacos mine"));
    expect(onMake).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
  it("disables the button while making", () => {
    const onMake = vi.fn();
    mockImpact.mockClear();
    renderComponent(<SuggestionCard suggestion={s} making onMake={onMake} />);
    fireEvent.click(screen.getByLabelText("Make Bean Tacos mine"));
    expect(onMake).not.toHaveBeenCalled();
    expect(mockImpact).not.toHaveBeenCalled();
  });
});
