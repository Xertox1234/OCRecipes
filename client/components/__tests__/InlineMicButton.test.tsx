// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { InlineMicButton } from "../InlineMicButton";

describe("InlineMicButton", () => {
  const defaultProps = {
    isRecording: false,
    isTranscribing: false,
    onPress: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders mic icon when idle", () => {
    renderComponent(<InlineMicButton {...defaultProps} />);
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("renders mic-off icon when recording", () => {
    renderComponent(<InlineMicButton {...defaultProps} isRecording={true} />);
    expect(screen.getByText("mic-off")).toBeDefined();
  });

  it("shows ActivityIndicator when transcribing", () => {
    renderComponent(
      <InlineMicButton {...defaultProps} isTranscribing={true} />,
    );
    // ActivityIndicator should be rendered; mic icon should not
    expect(screen.queryByText("mic")).toBeNull();
    expect(screen.queryByText("mic-off")).toBeNull();
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
      "Start voice recording",
    );
  });

  it("uses correct accessibility label when recording", () => {
    renderComponent(<InlineMicButton {...defaultProps} isRecording={true} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Stop recording",
    );
  });

  it("uses correct accessibility label when transcribing", () => {
    renderComponent(
      <InlineMicButton {...defaultProps} isTranscribing={true} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Transcribing voice recording",
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

  it("is disabled when transcribing", () => {
    const onPress = vi.fn();
    renderComponent(
      <InlineMicButton {...defaultProps} onPress={onPress} isTranscribing />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveProperty("disabled", true);
  });
});
