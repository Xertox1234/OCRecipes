// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { Platform } from "react-native";

import { volumeToScale } from "@/lib/volume-scale";
import { useMicPulse } from "../useMicPulse";

const { mockAnnounce, accessibility } = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
  accessibility: { reducedMotion: false },
}));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AccessibilityInfo: { announceForAccessibility: mockAnnounce },
}));
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => accessibility,
}));
// The shared mock builds a fresh shared value every render, so a value set in
// an effect is gone by the next render. Persist it across renders so the
// scale assertions observe what the effect actually wrote.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { useRef } = await import("react");
  return {
    ...actual,
    useSharedValue: (init: number) => {
      const ref = useRef<{
        value: number;
        get: () => number;
        set: (n: number) => void;
      } | null>(null);
      if (ref.current === null) {
        const sv = {
          value: init,
          get: () => sv.value,
          set: (n: number) => {
            sv.value = n;
          },
        };
        ref.current = sv;
      }
      return ref.current;
    },
  };
});

type Props = { isListening: boolean; volume: number };

function setup(initial: Props, amplitude = 0.3) {
  return renderHook(
    ({ isListening, volume }: Props) =>
      useMicPulse(isListening, volume, amplitude),
    { initialProps: initial },
  );
}

function scaleOf(style: unknown) {
  return (style as { transform: { scale: number }[] }).transform[0].scale;
}

describe("useMicPulse", () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    mockAnnounce.mockReset();
    accessibility.reducedMotion = false;
  });
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("scales with volume by the given amplitude while listening", () => {
    const { result, rerender } = setup({ isListening: true, volume: 4 }, 0.2);
    rerender({ isListening: true, volume: 4 });
    expect(scaleOf(result.current)).toBe(volumeToScale(4, 0.2));
  });

  it("returns to 1 when listening stops", () => {
    const { result, rerender } = setup({ isListening: true, volume: 10 });
    rerender({ isListening: false, volume: 10 });
    rerender({ isListening: false, volume: 10 });
    expect(scaleOf(result.current)).toBe(1);
  });

  it("holds at 1 under reduced motion", () => {
    accessibility.reducedMotion = true;
    const { result, rerender } = setup({ isListening: true, volume: 10 });
    rerender({ isListening: true, volume: 10 });
    expect(scaleOf(result.current)).toBe(1);
  });

  it("announces listening changes on iOS, never on mount", () => {
    Platform.OS = "ios";
    const { rerender } = setup({ isListening: false, volume: -2 });
    expect(mockAnnounce).not.toHaveBeenCalled();
    rerender({ isListening: true, volume: -2 });
    rerender({ isListening: false, volume: -2 });
    expect(mockAnnounce.mock.calls).toEqual([
      ["Listening started"],
      ["Listening stopped"],
    ]);
  });

  it("does not announce on Android (the live region covers it)", () => {
    Platform.OS = "android";
    const { rerender } = setup({ isListening: false, volume: -2 });
    rerender({ isListening: true, volume: -2 });
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});
