// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StyleProp, ViewStyle } from "react-native";

import { TipsCarousel } from "../TipsCarousel";

// Same PressableScale harness as ExampleCard.test.tsx (keeps style, drops scale).
vi.mock("@/components/PressableScale", async () => {
  const RN = await import("react-native");
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flat).filter(Boolean)) : s;
  return {
    PressableScale: ({
      style,
      scaleTo: _scaleTo,
      ...props
    }: Record<string, unknown>) => (
      <RN.TouchableOpacity
        {...props}
        style={flat(style) as StyleProp<ViewStyle>}
      />
    ),
  };
});

const accessibility = { reducedMotion: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => accessibility,
}));

const selection = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection }),
}));

describe("TipsCarousel", () => {
  it('Next advances the page and the last page shows "Scan now"', () => {
    render(<TipsCarousel onDone={vi.fn()} />);
    expect(screen.getByText("Get the best scan")).toBeTruthy();
    expect(screen.queryByLabelText("Scan now")).toBeNull();
    fireEvent.click(screen.getByLabelText("Next"));
    expect(screen.getByLabelText("Page 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next"));
    expect(screen.getByLabelText("Page 3 of 3")).toBeTruthy();
    expect(screen.getByLabelText("Scan now")).toBeTruthy();
    expect(screen.queryByLabelText("Next")).toBeNull();
  });

  it('"Scan now" calls onDone', () => {
    const onDone = vi.fn();
    render(<TipsCarousel onDone={onDone} />);
    fireEvent.click(screen.getByLabelText("Next"));
    fireEvent.click(screen.getByLabelText("Next"));
    fireEvent.click(screen.getByLabelText("Scan now"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('page dots expose "Page 1 of 3"', () => {
    render(<TipsCarousel onDone={vi.fn()} />);
    expect(screen.getByLabelText("Page 1 of 3")).toBeTruthy();
  });

  describe("page announcements", () => {
    const originalOS = RN.Platform.OS;
    let announceSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    });
    afterEach(() => {
      RN.Platform.OS = originalOS;
      announceSpy.mockRestore();
    });

    it("announces the page and its title after Next (iOS)", () => {
      RN.Platform.OS = "ios";
      render(<TipsCarousel onDone={vi.fn()} />);
      fireEvent.click(screen.getByLabelText("Next"));
      expect(announceSpy).toHaveBeenCalledWith(
        "Page 2 of 3. Barcodes scan by themselves",
      );
    });

    it("does not announce on first render", () => {
      RN.Platform.OS = "ios";
      render(<TipsCarousel onDone={vi.fn()} />);
      expect(announceSpy).not.toHaveBeenCalled();
    });

    it("does not announce on Android", () => {
      RN.Platform.OS = "android";
      render(<TipsCarousel onDone={vi.fn()} />);
      fireEvent.click(screen.getByLabelText("Next"));
      expect(announceSpy).not.toHaveBeenCalled();
    });
  });
});
