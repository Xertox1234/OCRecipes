// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { InlineMicButton } from "../InlineMicButton";

describe("InlineMicButton", () => {
  const defaultProps = {
    isListening: false,
    volume: -2,
    onPress: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders mic icon when idle", () => {
    renderComponent(<InlineMicButton {...defaultProps} />);
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("renders mic icon when listening (not mic-off)", () => {
    renderComponent(<InlineMicButton {...defaultProps} isListening={true} />);
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("calls onPress on click", () => {
    const onPress = vi.fn();
    renderComponent(<InlineMicButton {...defaultProps} onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("uses correct accessibility label when idle", () => {
    renderComponent(<InlineMicButton {...defaultProps} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Start voice input",
    );
  });

  it("uses correct accessibility label when listening", () => {
    renderComponent(<InlineMicButton {...defaultProps} isListening={true} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Listening, tap to stop",
    );
  });

  it("is disabled when disabled prop is true", () => {
    const onPress = vi.fn();
    renderComponent(
      <InlineMicButton {...defaultProps} onPress={onPress} disabled />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveProperty("disabled", true);
  });

  it("accepts volume prop", () => {
    // Just verifying it renders without error with a volume value
    renderComponent(
      <InlineMicButton {...defaultProps} isListening={true} volume={5} />,
    );
    expect(screen.getByText("mic")).toBeDefined();
  });
});
