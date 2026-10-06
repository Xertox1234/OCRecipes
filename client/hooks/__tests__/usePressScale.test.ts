// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { usePressScale } from "../usePressScale";

const { a11y } = vi.hoisted(() => ({ a11y: { reducedMotion: false } }));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

beforeEach(() => {
  a11y.reducedMotion = false;
});

// The reanimated test mock resolves withSpring to its target, so scale.value
// reads the spring's destination.
describe("usePressScale", () => {
  it("press-in springs to the target scale and press-out back to 1", () => {
    const { result } = renderHook(() => usePressScale(0.97));

    act(() => result.current.onPressIn());
    expect(result.current.scale.value).toBe(0.97);

    act(() => result.current.onPressOut());
    expect(result.current.scale.value).toBe(1);
  });

  it("defaults to the 0.98 press tier", () => {
    const { result } = renderHook(() => usePressScale());

    act(() => result.current.onPressIn());
    expect(result.current.scale.value).toBe(0.98);
  });

  it("stays at 1 under reduced motion", () => {
    a11y.reducedMotion = true;
    const { result } = renderHook(() => usePressScale(0.97));

    act(() => result.current.onPressIn());
    expect(result.current.scale.value).toBe(1);
  });

  it("stays at 1 when disabled", () => {
    const { result } = renderHook(() =>
      usePressScale(0.97, { enabled: false }),
    );

    act(() => result.current.onPressIn());
    expect(result.current.scale.value).toBe(1);
  });

  it("exposes the scale as an animated transform", () => {
    const { result } = renderHook(() => usePressScale());

    expect(result.current.animatedStyle).toEqual({
      transform: [{ scale: 1 }],
    });
  });
});
