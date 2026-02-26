// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { VoiceLogButton } from "../VoiceLogButton";

describe("VoiceLogButton", () => {
  it("renders mic icon when not recording", () => {
    renderComponent(<VoiceLogButton isRecording={false} onPress={() => {}} />);
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("renders mic-off icon when recording", () => {
    renderComponent(<VoiceLogButton isRecording={true} onPress={() => {}} />);
    expect(screen.getByText("mic-off")).toBeDefined();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    renderComponent(<VoiceLogButton isRecording={false} onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("uses correct accessibility label when idle", () => {
    renderComponent(<VoiceLogButton isRecording={false} onPress={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Start voice recording",
    );
  });

  it("uses correct accessibility label when recording", () => {
    renderComponent(<VoiceLogButton isRecording={true} onPress={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Stop recording",
    );
  });

  it("is disabled when disabled prop is true", () => {
    const onPress = vi.fn();
    renderComponent(
      <VoiceLogButton isRecording={false} onPress={onPress} disabled />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveProperty("disabled", true);
  });
});
