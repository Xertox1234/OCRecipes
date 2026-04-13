// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useScreenOptions } from "../useScreenOptions";

vi.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: vi.fn().mockReturnValue(false),
}));

const mockTheme = {
  text: "#000000",
  backgroundRoot: "#FFFFFF",
};

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: mockTheme, isDark: false }),
}));

const mockUseAccessibility = vi.fn(() => ({ reducedMotion: false }));
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => mockUseAccessibility(),
}));

describe("useScreenOptions", () => {
  beforeEach(() => {
    mockUseAccessibility.mockReturnValue({ reducedMotion: false });
  });

  it("returns default options with transparent header", () => {
    const { result } = renderHook(() => useScreenOptions());
    expect(result.current.headerTransparent).toBe(true);
    expect(result.current.headerTintColor).toBe("#000000");
    expect(result.current.gestureEnabled).toBe(true);
    expect(result.current.headerBlurEffect).toBe("light");
  });

  it("respects transparent=false param", () => {
    const { result } = renderHook(() =>
      useScreenOptions({ transparent: false }),
    );
    expect(result.current.headerTransparent).toBe(false);
  });

  it("sets contentStyle backgroundColor from theme", () => {
    const { result } = renderHook(() => useScreenOptions());
    expect(result.current.contentStyle).toEqual({
      backgroundColor: "#FFFFFF",
    });
  });

  it("does not set animation when reducedMotion is false", () => {
    const { result } = renderHook(() => useScreenOptions());
    expect(result.current.animation).toBeUndefined();
  });

  it('sets animation to "none" when reducedMotion is true', () => {
    mockUseAccessibility.mockReturnValue({ reducedMotion: true });
    const { result } = renderHook(() => useScreenOptions());
    expect(result.current.animation).toBe("none");
  });
});
