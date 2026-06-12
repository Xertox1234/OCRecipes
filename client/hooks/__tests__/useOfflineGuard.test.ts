// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useOfflineGuard } from "../useOfflineGuard";

import { useNetworkStatus } from "@/hooks/useNetworkStatus";

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: vi.fn(),
}));

describe("useOfflineGuard", () => {
  it("returns isOffline: false and unmodified label when online", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOffline: false,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
    const { result } = renderHook(() => useOfflineGuard());
    expect(result.current.isOffline).toBe(false);
    expect(result.current.offlineLabel("Save")).toBe("Save");
  });

  it("returns isOffline: true and annotated label when offline", () => {
    vi.mocked(useNetworkStatus).mockReturnValue({
      isOffline: true,
      wasOffline: false,
      clearWasOffline: vi.fn(),
    });
    const { result } = renderHook(() => useOfflineGuard());
    expect(result.current.isOffline).toBe(true);
    expect(result.current.offlineLabel("Save")).toBe(
      "Save (offline — will sync)",
    );
  });
});
