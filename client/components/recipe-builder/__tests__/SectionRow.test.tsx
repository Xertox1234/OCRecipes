// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SectionRow } from "../SectionRow";

describe("SectionRow", () => {
  const defaultProps = {
    icon: "clock",
    label: "Time & Servings",
    isFilled: false,
    onPress: vi.fn(),
  };

  it("renders the label text", () => {
    renderComponent(<SectionRow {...defaultProps} />);
    expect(screen.getByText("Time & Servings")).toBeDefined();
  });

  it("renders the icon", () => {
    renderComponent(<SectionRow {...defaultProps} />);
    expect(screen.getByText("clock")).toBeDefined();
  });

  it("shows summary text when provided", () => {
    renderComponent(
      <SectionRow {...defaultProps} summary="4 servings" isFilled />,
    );
    expect(screen.getByText("4 servings")).toBeDefined();
  });

  it("calls onPress when row is pressed", () => {
    const onPress = vi.fn();
    renderComponent(<SectionRow {...defaultProps} onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("renders chevron-right icon", () => {
    renderComponent(<SectionRow {...defaultProps} />);
    expect(screen.getByText("chevron-right")).toBeDefined();
  });
});
