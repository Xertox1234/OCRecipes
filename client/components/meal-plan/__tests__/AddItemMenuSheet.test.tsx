// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { AddItemMenuSheet } from "../AddItemMenuSheet";

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
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders title with meal label", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    expect(screen.getByText("Add to Breakfast")).toBeDefined();
  });

  it("renders Choose Recipe option", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    expect(screen.getByText("Choose Recipe")).toBeDefined();
  });

  it("renders Simple Entry option", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    expect(screen.getByText("Simple Entry")).toBeDefined();
  });

  it("calls onChooseRecipe when Choose Recipe is pressed", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Choose recipe"));
    expect(defaultProps.onChooseRecipe).toHaveBeenCalledTimes(1);
  });

  it("calls onSimpleEntry when Simple Entry is pressed", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Simple entry"));
    expect(defaultProps.onSimpleEntry).toHaveBeenCalledTimes(1);
  });

  it("renders Import Recipe option", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    expect(screen.getByText("Import Recipe")).toBeDefined();
  });

  it("calls onImportRecipe when Import Recipe is pressed", () => {
    renderComponent(<AddItemMenuSheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Import recipe"));
    expect(defaultProps.onImportRecipe).toHaveBeenCalledTimes(1);
  });
});
