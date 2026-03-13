// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";

import { ThemeProvider, useThemePreference } from "../ThemeContext";

const { mockAsyncStorage, mockSystemColorScheme } = vi.hoisted(() => ({
  mockAsyncStorage: {} as Record<string, string>,
  mockSystemColorScheme: { value: "light" as "light" | "dark" | null },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) =>
      Promise.resolve(mockAsyncStorage[key] ?? null),
    ),
    setItem: vi.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
  },
}));

// Override the global react-native mock to make useColorScheme controllable
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (obj: Record<string, unknown>) => obj.ios },
  useColorScheme: () => mockSystemColorScheme.value,
  StyleSheet: { create: <T>(s: T): T => s },
}));

vi.mock("@/hooks/useTheme", () => ({
  registerThemeContext: vi.fn(),
}));

function createWrapper() {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ThemeProvider, null, children);
  }
  return Wrapper;
}

describe("ThemeContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockAsyncStorage).forEach((k) => delete mockAsyncStorage[k]);
    mockSystemColorScheme.value = "light";
  });

  describe("useThemePreference", () => {
    it("throws when used outside ThemeProvider", () => {
      expect(() => {
        renderHook(() => useThemePreference());
      }).toThrow("useThemePreference must be used within a ThemeProvider");
    });
  });

  describe("ThemeProvider", () => {
    it("defaults to system preference (light)", async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.preference).toBe("system");
      });

      expect(result.current.colorScheme).toBe("light");
      expect(result.current.isDark).toBe(false);
    });

    it("resolves system preference to dark when system is dark", async () => {
      mockSystemColorScheme.value = "dark";

      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.colorScheme).toBe("dark");
      });

      expect(result.current.isDark).toBe(true);
    });

    it("loads saved preference from AsyncStorage", async () => {
      mockAsyncStorage["@ocrecipes/theme-preference"] = "dark";

      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.preference).toBe("dark");
      });

      expect(result.current.colorScheme).toBe("dark");
      expect(result.current.isDark).toBe(true);
    });

    it("ignores invalid stored preference", async () => {
      mockAsyncStorage["@ocrecipes/theme-preference"] = "invalid-value";

      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.preference).toBe("system");
      });
    });

    it("setPreference updates state and persists to AsyncStorage", async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.preference).toBe("system");
      });

      await act(async () => {
        await result.current.setPreference("dark");
      });

      expect(result.current.preference).toBe("dark");
      expect(result.current.colorScheme).toBe("dark");
      expect(result.current.isDark).toBe(true);
      expect(mockAsyncStorage["@ocrecipes/theme-preference"]).toBe("dark");
    });

    it("explicit light preference overrides dark system scheme", async () => {
      mockSystemColorScheme.value = "dark";

      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.preference).toBe("system");
      });

      await act(async () => {
        await result.current.setPreference("light");
      });

      expect(result.current.colorScheme).toBe("light");
      expect(result.current.isDark).toBe(false);
    });

    it("falls back to light when system color scheme is null", async () => {
      mockSystemColorScheme.value = null;

      const wrapper = createWrapper();
      const { result } = renderHook(() => useThemePreference(), { wrapper });

      await waitFor(() => {
        expect(result.current.colorScheme).toBe("light");
      });
    });
  });
});
