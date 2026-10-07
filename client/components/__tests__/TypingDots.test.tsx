// @vitest-environment jsdom
import React from "react";
import { act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { PulsingDot, TypingDots } from "../TypingDots";

const { a11y, withRepeatSpy, cancelAnimationSpy } = vi.hoisted(() => ({
  a11y: { reducedMotion: false },
  withRepeatSpy: vi.fn((val: number) => val),
  cancelAnimationSpy: vi.fn(),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: actual.default,
    withRepeat: withRepeatSpy,
    cancelAnimation: cancelAnimationSpy,
  };
});

beforeEach(() => {
  a11y.reducedMotion = false;
  withRepeatSpy.mockClear();
  cancelAnimationSpy.mockClear();
});

describe("TypingDots", () => {
  // Positive control: the count the reduced-motion zero is measured against.
  it("starts one repeating pulse per dot", () => {
    renderComponent(<TypingDots color="#888" />);
    expect(withRepeatSpy).toHaveBeenCalledTimes(3);
  });

  it("stays still under reduced motion", () => {
    a11y.reducedMotion = true;
    renderComponent(<TypingDots color="#888" />);
    expect(withRepeatSpy).not.toHaveBeenCalled();
  });

  it("stops the pulse when reduced motion turns on", () => {
    const { rerender } = renderComponent(<TypingDots color="#888" />);
    cancelAnimationSpy.mockClear();

    a11y.reducedMotion = true;
    act(() => rerender(<TypingDots color="#888" />));

    expect(cancelAnimationSpy).toHaveBeenCalledTimes(3);
  });

  it("stops the pulse on unmount", () => {
    const { unmount } = renderComponent(<TypingDots color="#888" />);
    cancelAnimationSpy.mockClear();

    unmount();

    expect(cancelAnimationSpy).toHaveBeenCalledTimes(3);
  });
});

describe("PulsingDot", () => {
  it("starts a single repeating pulse", () => {
    renderComponent(<PulsingDot size={22} color="#888" />);
    expect(withRepeatSpy).toHaveBeenCalledTimes(1);
  });

  it("stays still under reduced motion", () => {
    a11y.reducedMotion = true;
    renderComponent(<PulsingDot size={22} color="#888" />);
    expect(withRepeatSpy).not.toHaveBeenCalled();
  });
});
