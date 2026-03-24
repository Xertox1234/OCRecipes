// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useNetworkStatus } from "../useNetworkStatus";

const { mockAddEventListener } = vi.hoisted(() => ({
  mockAddEventListener: vi.fn(),
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: mockAddEventListener,
  },
}));

describe("useNetworkStatus", () => {
  let listener: (state: {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
  }) => void;
  let mockUnsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnsubscribe = vi.fn();
    mockAddEventListener.mockImplementation((callback) => {
      listener = callback;
      return mockUnsubscribe;
    });
  });

  it("initially returns isOffline=false and wasOffline=false", () => {
    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOffline).toBe(false);
    expect(result.current.wasOffline).toBe(false);
  });

  it("sets isOffline=true when NetInfo reports no connection", () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      listener({ isConnected: false, isInternetReachable: false });
    });

    expect(result.current.isOffline).toBe(true);
  });

  it("sets isOffline=true when isInternetReachable is false", () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      listener({ isConnected: true, isInternetReachable: false });
    });

    expect(result.current.isOffline).toBe(true);
  });

  it("does NOT set isOffline when isConnected=true and isInternetReachable=null", () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      listener({ isConnected: true, isInternetReachable: null });
    });

    expect(result.current.isOffline).toBe(false);
  });

  it("sets wasOffline=true when transitioning from offline to online", () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      listener({ isConnected: false, isInternetReachable: false });
    });

    expect(result.current.isOffline).toBe(true);
    expect(result.current.wasOffline).toBe(false);

    act(() => {
      listener({ isConnected: true, isInternetReachable: true });
    });

    expect(result.current.isOffline).toBe(false);
    expect(result.current.wasOffline).toBe(true);
  });

  it("resets wasOffline to false when clearWasOffline is called", () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      listener({ isConnected: false, isInternetReachable: false });
    });

    act(() => {
      listener({ isConnected: true, isInternetReachable: true });
    });

    expect(result.current.wasOffline).toBe(true);

    act(() => {
      result.current.clearWasOffline();
    });

    expect(result.current.wasOffline).toBe(false);
  });

  it("unsubscribes from NetInfo on unmount", () => {
    const { unmount } = renderHook(() => useNetworkStatus());

    expect(mockUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
