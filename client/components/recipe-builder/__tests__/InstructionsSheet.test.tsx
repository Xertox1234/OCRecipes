// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { InstructionsSheet } from "../InstructionsSheet";
import type { StepRow } from "@/hooks/useRecipeForm";

describe("InstructionsSheet", () => {
  const twoSteps: StepRow[] = [
    { key: "s1", text: "Preheat oven to 350F" },
    { key: "s2", text: "Mix dry ingredients" },
  ];

  const callbacks = {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onUpdate: vi.fn(),
    onMove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders step number badges", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    // Badges show just the index: 1, 2
    expect(screen.getByLabelText("Move step 1 up")).toBeDefined();
    expect(screen.getByLabelText("Move step 2 up")).toBeDefined();
  });

  it("renders Add step button", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    expect(screen.getByText("Add step")).toBeDefined();
  });

  it("calls onAdd when Add step is pressed", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    fireEvent.click(screen.getByLabelText("Add step"));
    expect(callbacks.onAdd).toHaveBeenCalledOnce();
  });

  it("renders move controls for each step", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    expect(screen.getAllByText("chevron-up").length).toBe(2);
    expect(screen.getAllByText("chevron-down").length).toBe(2);
  });

  it("shows delete buttons when more than 1 step", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    // Delete icon is "x" (not trash-2)
    expect(screen.getByLabelText("Remove step 1")).toBeDefined();
    expect(screen.getByLabelText("Remove step 2")).toBeDefined();
  });

  it("disables move-up on first step", () => {
    renderComponent(<InstructionsSheet data={twoSteps} {...callbacks} />);
    const moveUp1 = screen.getByLabelText("Move step 1 up");
    expect(moveUp1).toHaveProperty("disabled", true);
  });
});
