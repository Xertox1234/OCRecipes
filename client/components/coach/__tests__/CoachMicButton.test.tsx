// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachMicButton from "../CoachMicButton";

const { mockImpact } = vi.hoisted(() => ({ mockImpact: vi.fn() }));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

beforeEach(() => {
  mockImpact.mockClear();
});

describe("CoachMicButton", () => {
  it("toggles on press", () => {
    const onPress = vi.fn();
    renderComponent(
      <CoachMicButton isListening={false} volume={0} onPress={onPress} />,
    );

    fireEvent.click(screen.getByLabelText("Voice input"));

    expect(onPress).toHaveBeenCalledOnce();
  });

  it("does not buzz on mount", () => {
    renderComponent(
      <CoachMicButton isListening volume={0} onPress={vi.fn()} />,
    );
    expect(mockImpact).not.toHaveBeenCalled();
  });

  // Keyed on the listening state, not the press: a start that never happens
  // (mic permission denied) stays silent.
  it("buzzes medium when listening starts and light when it stops", () => {
    const { rerender } = renderComponent(
      <CoachMicButton isListening={false} volume={0} onPress={vi.fn()} />,
    );

    act(() =>
      rerender(<CoachMicButton isListening volume={0} onPress={vi.fn()} />),
    );
    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenLastCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );

    act(() =>
      rerender(
        <CoachMicButton isListening={false} volume={0} onPress={vi.fn()} />,
      ),
    );
    expect(mockImpact).toHaveBeenCalledTimes(2);
    expect(mockImpact).toHaveBeenLastCalledWith(
      Haptics.ImpactFeedbackStyle.Light,
    );
  });

  it("does not buzz when only the volume changes", () => {
    const { rerender } = renderComponent(
      <CoachMicButton isListening volume={0} onPress={vi.fn()} />,
    );

    act(() =>
      rerender(<CoachMicButton isListening volume={5} onPress={vi.fn()} />),
    );

    expect(mockImpact).not.toHaveBeenCalled();
  });
});
