// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useCameraPermissions } from "../useCameraPermissions";

import { useCameraPermission } from "react-native-vision-camera";

// Mock react-native-vision-camera — the real module uses native code that
// cannot run under jsdom. Only useCameraPermission is consumed by the SUT.
// (Vitest hoists vi.mock() above all imports, so source order is irrelevant.)
vi.mock("react-native-vision-camera", () => ({
  useCameraPermission: vi.fn(),
}));

type V5PermissionState = ReturnType<typeof useCameraPermission>;

// Builds the full V5 PermissionState shape, deriving the raw `status` field
// from the booleans the same way V5 does (canRequestPermission === 'not-
// determined', hasPermission === 'authorized') so the mock can never drift
// to an impossible combination.
function mockV5Permission(
  state: Omit<V5PermissionState, "status">,
): V5PermissionState {
  const full: V5PermissionState = {
    ...state,
    status: state.hasPermission
      ? "authorized"
      : state.canRequestPermission
        ? "not-determined"
        : "denied",
  };
  vi.mocked(useCameraPermission).mockReturnValue(full);
  return full;
}

describe("useCameraPermissions — V5 persisted-state derivation", () => {
  beforeEach(() => {
    vi.mocked(useCameraPermission).mockReset();
    // Safe default so a test that forgets mockV5Permission() fails on an
    // assertion, not on destructuring undefined inside the SUT.
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: vi.fn(async () => true),
    });
  });

  it("returns undetermined with canAskAgain while the OS reports not-determined", () => {
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: vi.fn(async () => true),
    });
    const { result } = renderHook(() => useCameraPermissions());

    expect(result.current.permission).toEqual({
      status: "undetermined",
      canAskAgain: true,
    });
  });

  it("returns granted (no canAskAgain) when hasPermission is true", () => {
    mockV5Permission({
      hasPermission: true,
      canRequestPermission: false,
      requestPermission: vi.fn(async () => true),
    });
    const { result } = renderHook(() => useCameraPermissions());

    expect(result.current.permission).toEqual({
      status: "granted",
      canAskAgain: false,
    });
  });

  it("derives denied on FIRST render after a prior-session OS denial (L20 fix)", () => {
    // canRequestPermission=false + hasPermission=false is the persisted OS
    // state after a previous-session denial (or 'restricted'). No request
    // has been made this session — the hook must still read denied so the
    // Settings deep-link UI renders immediately.
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: false,
      requestPermission: vi.fn(async () => false),
    });
    const { result } = renderHook(() => useCameraPermissions());

    expect(result.current.permission).toEqual({
      status: "denied",
      canAskAgain: false,
    });
  });

  it("keeps a stable permission object identity across re-renders with unchanged OS state", () => {
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: vi.fn(async () => true),
    });
    const { result, rerender } = renderHook(() => useCameraPermissions());

    const first = result.current.permission;
    rerender();
    expect(result.current.permission).toBe(first);
  });

  it("flips to granted when the OS state changes (e.g. returning from Settings)", () => {
    const requestPermission = vi.fn(async () => true);
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: false,
      requestPermission,
    });
    const { result, rerender } = renderHook(() => useCameraPermissions());
    expect(result.current.permission?.status).toBe("denied");

    // V5 re-fetches permission status on AppState 'active'; simulate the
    // hook returning the updated state on the next render.
    mockV5Permission({
      hasPermission: true,
      canRequestPermission: false,
      requestPermission,
    });
    rerender();

    expect(result.current.permission).toEqual({
      status: "granted",
      canAskAgain: false,
    });
  });

  describe("requestPermission", () => {
    it("resolves granted when the native request is granted", async () => {
      mockV5Permission({
        hasPermission: false,
        canRequestPermission: true,
        requestPermission: vi.fn(async () => true),
      });
      const { result } = renderHook(() => useCameraPermissions());

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.requestPermission();
      });

      expect(outcome).toEqual({ status: "granted", canAskAgain: false });
    });

    it("resolves denied (no canAskAgain) when the native request is denied", async () => {
      mockV5Permission({
        hasPermission: false,
        canRequestPermission: true,
        requestPermission: vi.fn(async () => false),
      });
      const { result } = renderHook(() => useCameraPermissions());

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.requestPermission();
      });

      expect(outcome).toEqual({ status: "denied", canAskAgain: false });
    });
  });

  it("isLoading is always false (V5 permission state is synchronous)", () => {
    mockV5Permission({
      hasPermission: false,
      canRequestPermission: true,
      requestPermission: vi.fn(async () => true),
    });
    const { result } = renderHook(() => useCameraPermissions());

    expect(result.current.isLoading).toBe(false);
  });
});
