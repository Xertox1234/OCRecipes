// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { ThemedText } from "@/components/ThemedText";
import { RecipeInstructions } from "../RecipeInstructions";

const steps = ["Mix the batter", "Fry until golden"];

describe("RecipeInstructions — plain", () => {
  it("names the list and each step", () => {
    renderComponent(<RecipeInstructions instructions={steps} />);
    expect(screen.getByLabelText("Instructions, 2 steps")).toBeDefined();
    expect(screen.getByLabelText("Step 1 of 2: Mix the batter")).toBeDefined();
  });

  it("renders nothing for no steps", () => {
    const { container } = renderComponent(
      <RecipeInstructions instructions={[]} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("RecipeInstructions — expandable", () => {
  const base = {
    details: ["Whisk for two minutes", null],
    expandedStep: null as number | null,
    showHint: false,
  };

  it("marks only steps with a detail as tappable and toggles them", () => {
    const onToggleStep = vi.fn();
    renderComponent(
      <RecipeInstructions
        instructions={steps}
        expandable={{ ...base, onToggleStep }}
      />,
    );
    const first = screen.getByLabelText(
      "Step 1 of 2: Mix the batter. Tap for more detail.",
    );
    expect(
      screen.getByLabelText("Step 2 of 2: Fry until golden"),
    ).toBeDefined();
    fireEvent.click(first);
    expect(onToggleStep).toHaveBeenCalledWith(0);
  });

  it("shows the detail only for the expanded step", () => {
    const { rerender } = renderComponent(
      <RecipeInstructions
        instructions={steps}
        expandable={{ ...base, onToggleStep: vi.fn() }}
      />,
    );
    expect(screen.queryByText("Whisk for two minutes")).toBeNull();
    rerender(
      <RecipeInstructions
        instructions={steps}
        expandable={{ ...base, expandedStep: 0, onToggleStep: vi.fn() }}
      />,
    );
    expect(screen.getByText("Whisk for two minutes")).toBeDefined();
  });

  it("shows the hold hint and renders children inside the list", () => {
    renderComponent(
      <RecipeInstructions
        instructions={steps}
        expandable={{ ...base, showHint: true, onToggleStep: vi.fn() }}
      >
        <ThemedText>Tools Required</ThemedText>
      </RecipeInstructions>,
    );
    expect(screen.getByText("Hold any step for more detail")).toBeDefined();
    const list = screen.getByLabelText("Instructions, 2 steps");
    expect(list.textContent).toContain("Tools Required");
  });
});
