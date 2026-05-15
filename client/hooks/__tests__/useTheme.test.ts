// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import * as RN from "react-native";

import { useTheme } from "../useTheme";

describe("useTheme", () => {
  afterEach(() => {
    // restoreAllMocks() undoes the spy installation. vi.clearAllMocks() in
    // test/setup.ts only clears call history, which would leave the spy
    // returning undefined for the next test.
    vi.restoreAllMocks();
  });

  it("returns light theme when system reports light", () => {
    vi.spyOn(RN, "useColorScheme").mockReturnValue("light");

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(false);
    expect(result.current.colorScheme).toBe("light");
    expect(result.current.theme).toBeDefined();
    expect(result.current.theme.backgroundRoot).toBeDefined();
  });

  it("returns dark theme when system reports dark", () => {
    vi.spyOn(RN, "useColorScheme").mockReturnValue("dark");

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(true);
    expect(result.current.colorScheme).toBe("dark");
  });

  it("defaults to light when system returns null", () => {
    vi.spyOn(RN, "useColorScheme").mockReturnValue(null);

    const { result } = renderHook(() => useTheme());

    expect(result.current.isDark).toBe(false);
    expect(result.current.colorScheme).toBe("light");
  });

  it("returns different color values for light vs dark", () => {
    const spy = vi.spyOn(RN, "useColorScheme").mockReturnValue("light");
    const { result: lightResult } = renderHook(() => useTheme());

    spy.mockReturnValue("dark");
    const { result: darkResult } = renderHook(() => useTheme());

    expect(lightResult.current.theme.backgroundRoot).not.toBe(
      darkResult.current.theme.backgroundRoot,
    );
    expect(lightResult.current.theme.text).not.toBe(
      darkResult.current.theme.text,
    );
  });
});
