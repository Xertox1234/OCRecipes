// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { AddItemMenuSheetContent } from "../AddItemMenuSheet";

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

describe("AddItemMenuSheet", () => {
  const defaultProps = {
    mealType: "breakfast" as const,
    onChooseRecipe: vi.fn(),
    onSimpleEntry: vi.fn(),
    onImportRecipe: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders title with meal label", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    expect(screen.getByText("Add to Breakfast")).toBeDefined();
  });

  it("renders Choose Recipe option", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    expect(screen.getByText("Choose Recipe")).toBeDefined();
  });

  it("renders Simple Entry option", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    expect(screen.getByText("Simple Entry")).toBeDefined();
  });

  it("calls onChooseRecipe when Choose Recipe is pressed", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Choose recipe"));
    expect(defaultProps.onChooseRecipe).toHaveBeenCalledTimes(1);
  });

  it("calls onSimpleEntry when Simple Entry is pressed", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Simple entry"));
    expect(defaultProps.onSimpleEntry).toHaveBeenCalledTimes(1);
  });

  it("renders Import Recipe option", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    expect(screen.getByText("Import Recipe")).toBeDefined();
  });

  it("calls onImportRecipe when Import Recipe is pressed", () => {
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Import recipe"));
    expect(defaultProps.onImportRecipe).toHaveBeenCalledTimes(1);
  });

  it("guards against a near-simultaneous double-tap on two different rows — only the first press fires", () => {
    // A near-simultaneous tap on two rows could otherwise present two
    // sheets at once via the parent's InteractionManager.runAfterInteractions
    // deferral (see the todo that added this guard).
    renderComponent(<AddItemMenuSheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Choose recipe"));
    fireEvent.click(screen.getByLabelText("Simple entry"));

    expect(defaultProps.onChooseRecipe).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSimpleEntry).not.toHaveBeenCalled();
  });

  it("resets the double-tap guard when the sheet reopens for a new mealType", () => {
    const { rerender } = renderComponent(
      <AddItemMenuSheetContent {...defaultProps} />,
    );
    fireEvent.click(screen.getByLabelText("Choose recipe"));
    expect(defaultProps.onChooseRecipe).toHaveBeenCalledTimes(1);

    rerender(<AddItemMenuSheetContent {...defaultProps} mealType="lunch" />);
    fireEvent.click(screen.getByLabelText("Simple entry"));
    expect(defaultProps.onSimpleEntry).toHaveBeenCalledTimes(1);
  });
});
