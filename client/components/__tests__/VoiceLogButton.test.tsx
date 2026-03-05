// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { VoiceLogButton } from "../VoiceLogButton";

describe("VoiceLogButton", () => {
  it("renders mic icon when not listening", () => {
    renderComponent(
      <VoiceLogButton isListening={false} volume={-2} onPress={() => {}} />,
    );
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("renders mic icon when listening (not mic-off)", () => {
    renderComponent(
      <VoiceLogButton isListening={true} volume={3} onPress={() => {}} />,
    );
    expect(screen.getByText("mic")).toBeDefined();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    renderComponent(
      <VoiceLogButton isListening={false} volume={-2} onPress={onPress} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("uses correct accessibility label when idle", () => {
    renderComponent(
      <VoiceLogButton isListening={false} volume={-2} onPress={() => {}} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Start voice input",
    );
  });

  it("uses correct accessibility label when listening", () => {
    renderComponent(
      <VoiceLogButton isListening={true} volume={3} onPress={() => {}} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Listening, tap to stop",
    );
  });

  it("is disabled when disabled prop is true", () => {
    const onPress = vi.fn();
    renderComponent(
      <VoiceLogButton
        isListening={false}
        volume={-2}
        onPress={onPress}
        disabled
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveProperty("disabled", true);
  });
});
