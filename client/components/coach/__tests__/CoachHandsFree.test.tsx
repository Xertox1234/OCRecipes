// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachHandsFreeButton from "../CoachHandsFreeButton";
import CoachHandsFreeBar from "../CoachHandsFreeBar";

describe("CoachHandsFreeButton", () => {
  it("starts hands-free on a tap", () => {
    const onPress = vi.fn();
    renderComponent(<CoachHandsFreeButton onPress={onPress} />);
    fireEvent.click(screen.getByLabelText("Start hands-free conversation"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does nothing while disabled", () => {
    const onPress = vi.fn();
    renderComponent(<CoachHandsFreeButton onPress={onPress} disabled />);
    fireEvent.click(screen.getByLabelText("Start hands-free conversation"));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("CoachHandsFreeBar", () => {
  it("shows nothing while hands-free is off", () => {
    const { container } = renderComponent(
      <CoachHandsFreeBar phase="off" onStop={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it.each([
    ["listening", "Listening…"],
    ["thinking", "Thinking…"],
    ["speaking", "Speaking…"],
  ] as const)("says it is %s and offers a way out", (phase, text) => {
    const onStop = vi.fn();
    renderComponent(<CoachHandsFreeBar phase={phase} onStop={onStop} />);
    expect(screen.getByText("Hands-free")).toBeDefined();
    expect(screen.getByText(text)).toBeDefined();
    fireEvent.click(screen.getByLabelText("Stop hands-free"));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
