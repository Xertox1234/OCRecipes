// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SuggestionCard } from "../SuggestionCard";

// What useSuggestionInstructions returns; tests change it across a rerender
// to simulate the instructions request settling.
const { mockInstructions } = vi.hoisted(() => ({
  mockInstructions: {
    value: { data: undefined, error: null } as {
      data: { instructions: string } | undefined;
      error: Error | null;
    },
  },
}));

vi.mock("@/hooks/useSuggestionInstructions", () => ({
  useSuggestionInstructions: () => mockInstructions.value,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

vi.mock("@/components/SaveButton", () => ({
  SaveButton: () => null,
}));

const suggestion = {
  type: "recipe" as const,
  title: "Banana Bread",
  description: "Use up ripe bananas",
};

// A fresh element per render: rerendering the same element object lets React
// skip the card, so the changed hook mock would never be read.
const card = () => (
  <SuggestionCard
    suggestion={suggestion}
    itemId={1}
    suggestionIndex={0}
    productName="Bananas"
  />
);

const button = () =>
  screen.getByLabelText(/^recipe: Banana Bread\. Use up ripe bananas\./);
const isExpanded = () =>
  /Expanded\. Tap to collapse\./.test(
    button().getAttribute("aria-label") ?? "",
  );

beforeEach(() => {
  mockInstructions.value = { data: undefined, error: null };
});

describe("SuggestionCard — loading transitions", () => {
  it("expands once the instructions arrive after a tap", () => {
    const { rerender } = renderComponent(card());
    fireEvent.click(button());
    expect(isExpanded()).toBe(false);

    mockInstructions.value = {
      data: { instructions: "Mash the bananas." },
      error: null,
    };
    rerender(card());
    expect(isExpanded()).toBe(true);
    expect(screen.getByText("Mash the bananas.")).toBeDefined();
  });

  it("collapses back when the instructions request fails", () => {
    const { rerender } = renderComponent(card());
    fireEvent.click(button());

    mockInstructions.value = { data: undefined, error: new Error("boom") };
    rerender(card());
    expect(isExpanded()).toBe(false);

    // While the error is still current, a retap falls straight back.
    fireEvent.click(button());
    expect(isExpanded()).toBe(false);

    // Collapsed, not stuck loading: once the error clears, a tap starts
    // loading again (it would be ignored while loading), and arriving data
    // then expands it.
    mockInstructions.value = { data: undefined, error: null };
    rerender(card());
    fireEvent.click(button());
    mockInstructions.value = {
      data: { instructions: "Mash the bananas." },
      error: null,
    };
    rerender(card());
    expect(isExpanded()).toBe(true);
  });

  it("an error wins over stale data, as when both effects fired together", () => {
    const { rerender } = renderComponent(card());
    fireEvent.click(button());

    mockInstructions.value = {
      data: { instructions: "Mash the bananas." },
      error: new Error("refetch failed"),
    };
    rerender(card());
    expect(isExpanded()).toBe(false);
  });

  it("does not expand from cached data until tapped", () => {
    mockInstructions.value = {
      data: { instructions: "Mash the bananas." },
      error: null,
    };
    renderComponent(card());
    expect(isExpanded()).toBe(false);

    fireEvent.click(button());
    expect(isExpanded()).toBe(true);
  });
});
