// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useOwnedTempFiles } from "../useOwnedTempFiles";

const { mockDeleteAsync } = vi.hoisted(() => ({
  mockDeleteAsync: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

describe("useOwnedTempFiles", () => {
  beforeEach(() => {
    mockDeleteAsync.mockReset();
    mockDeleteAsync.mockResolvedValue(undefined);
  });

  // Camera audit 2026-11-21 L6: CookSessionCapture never deleted its captures
  // or gallery picks — including the ones whose analysis failed.
  it("deletes every owned file when the screen unmounts", () => {
    const { result, unmount } = renderHook(() => useOwnedTempFiles());
    result.current("file:///a.jpg");
    result.current("file:///b.jpg");
    result.current("file:///a.jpg");

    expect(mockDeleteAsync).not.toHaveBeenCalled();
    unmount();

    expect(mockDeleteAsync).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///a.jpg", {
      idempotent: true,
    });
    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///b.jpg", {
      idempotent: true,
    });
  });

  // A capture or gallery pick that finishes after the screen closed arrives
  // after the cleanup ran — delete it straight away.
  it("deletes a file owned after the screen unmounted", () => {
    const { result, unmount } = renderHook(() => useOwnedTempFiles());
    const own = result.current;
    unmount();

    own("file:///late.jpg");

    expect(mockDeleteAsync).toHaveBeenCalledWith("file:///late.jpg", {
      idempotent: true,
    });
  });

  it("returns a stable function across renders", () => {
    const { result, rerender } = renderHook(() => useOwnedTempFiles());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("does not throw when a delete fails", async () => {
    mockDeleteAsync.mockRejectedValue(new Error("gone"));
    const { result, unmount } = renderHook(() => useOwnedTempFiles());
    result.current("file:///a.jpg");
    expect(() => unmount()).not.toThrow();
    await Promise.resolve();
  });
});
