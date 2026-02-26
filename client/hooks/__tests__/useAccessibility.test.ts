// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useAccessibility } from "../useAccessibility";

const { mockUseReducedMotion } = vi.hoisted(() => ({
  mockUseReducedMotion: vi.fn(),
}));

vi.mock("react-native-reanimated", () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

describe("useAccessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns reducedMotion false when system reports false", () => {
    mockUseReducedMotion.mockReturnValue(false);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(false);
  });

  it("returns reducedMotion true when system reports true", () => {
    mockUseReducedMotion.mockReturnValue(true);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(true);
  });

  it("defaults to false when useReducedMotion returns null", () => {
    mockUseReducedMotion.mockReturnValue(null);

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.reducedMotion).toBe(false);
  });
});
