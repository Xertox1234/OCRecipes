// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useTheme } from "../useTheme";

const { mockUseColorScheme } = vi.hoisted(() => ({
  mockUseColorScheme: vi.fn(),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    useColorScheme: () => mockUseColorScheme(),
  };
});

describe("useTheme", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns light theme when system reports light", () => {
    mockUseColorScheme.mockReturnValue("light");

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(false);
    expect(result.current.colorScheme).toBe("light");
    expect(result.current.theme).toBeDefined();
    expect(result.current.theme.backgroundRoot).toBeDefined();
  });

  it("returns dark theme when system reports dark", () => {
    mockUseColorScheme.mockReturnValue("dark");

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(true);
    expect(result.current.colorScheme).toBe("dark");
  });

  it("defaults to light when system returns null", () => {
    mockUseColorScheme.mockReturnValue(null);

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(false);
    expect(result.current.colorScheme).toBe("light");
  });

  it("returns different color values for light vs dark", () => {
    mockUseColorScheme.mockReturnValue("light");
    const { result: lightResult } = renderHook(() => useTheme());

    mockUseColorScheme.mockReturnValue("dark");
    const { result: darkResult } = renderHook(() => useTheme());

    expect(lightResult.current.theme.backgroundRoot).not.toBe(
      darkResult.current.theme.backgroundRoot,
    );
    expect(lightResult.current.theme.text).not.toBe(
      darkResult.current.theme.text,
    );
  });
});
