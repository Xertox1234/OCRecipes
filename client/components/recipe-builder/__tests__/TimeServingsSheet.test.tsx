// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { TimeServingsSheet } from "../TimeServingsSheet";
import type { TimeServingsData } from "@/hooks/useRecipeForm";

describe("TimeServingsSheet", () => {
  const defaultData: TimeServingsData = {
    servings: 4,
    prepTime: "15",
    cookTime: "30",
  };
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders servings label", () => {
    renderComponent(
      <TimeServingsSheet data={defaultData} onChange={onChange} />,
    );
    expect(screen.getByText("Servings")).toBeDefined();
  });

  it("renders prep time and cook time labels", () => {
    renderComponent(
      <TimeServingsSheet data={defaultData} onChange={onChange} />,
    );
    expect(screen.getByText("Prep time")).toBeDefined();
    expect(screen.getByText("Cook time")).toBeDefined();
  });

  it("calls onChange when increase servings button is pressed", () => {
    renderComponent(
      <TimeServingsSheet data={defaultData} onChange={onChange} />,
    );
    const increaseBtn = screen.getByLabelText("Increase servings");
    fireEvent.click(increaseBtn);
    expect(onChange).toHaveBeenCalledWith({
      ...defaultData,
      servings: 5,
    });
  });

  it("calls onChange when decrease servings button is pressed", () => {
    renderComponent(
      <TimeServingsSheet data={defaultData} onChange={onChange} />,
    );
    const decreaseBtn = screen.getByLabelText("Decrease servings");
    fireEvent.click(decreaseBtn);
    expect(onChange).toHaveBeenCalledWith({
      ...defaultData,
      servings: 3,
    });
  });

  it("disables decrease button at minimum servings (1)", () => {
    renderComponent(
      <TimeServingsSheet
        data={{ ...defaultData, servings: 1 }}
        onChange={onChange}
      />,
    );
    const decreaseBtn = screen.getByLabelText("Decrease servings");
    expect(decreaseBtn).toHaveProperty("disabled", true);
  });
});
