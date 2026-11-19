// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { useCameraSessionReporting } from "../useCameraSessionReporting";
import { logger } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

describe("useCameraSessionReporting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the first camera error once per mount", () => {
    const { result } = renderHook(() => useCameraSessionReporting());
    result.current.onError(new Error("one"));
    result.current.onError(new Error("two"));
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      "[CameraView] Camera error",
      expect.any(Error),
    );
  });

  it("warns once for a benign error and keeps the error latch for a real one", () => {
    const isBenignError = (e: unknown) =>
      e instanceof Error && e.message === "benign";
    const { result } = renderHook(() =>
      useCameraSessionReporting({ isBenignError }),
    );
    result.current.onError(new Error("benign"));
    result.current.onError(new Error("benign"));
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
    result.current.onError(new Error("real"));
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("ignores the routine background interruption", () => {
    const { result } = renderHook(() => useCameraSessionReporting());
    result.current.onInterruptionStarted(
      "video-device-not-available-in-background",
    );
    result.current.onInterruptionEnded();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("reports each interruption reason once, each with one end report", () => {
    const { result } = renderHook(() => useCameraSessionReporting());
    result.current.onInterruptionStarted("audio-in-use");
    result.current.onInterruptionEnded();
    result.current.onInterruptionStarted("audio-in-use");
    result.current.onInterruptionEnded();
    result.current.onInterruptionStarted("unknown");
    result.current.onInterruptionEnded();
    expect(vi.mocked(logger.error).mock.calls.map((c) => c[0])).toEqual([
      "[CameraView] Camera session interrupted (audio-in-use)",
      "[CameraView] Camera session interruption ended",
      "[CameraView] Camera session interrupted (unknown)",
      "[CameraView] Camera session interruption ended",
    ]);
  });

  it("keeps the end report when a background interruption lands mid-episode", () => {
    const { result } = renderHook(() => useCameraSessionReporting());
    result.current.onInterruptionStarted("audio-in-use");
    result.current.onInterruptionStarted(
      "video-device-not-available-in-background",
    );
    result.current.onInterruptionEnded();
    expect(logger.error).toHaveBeenLastCalledWith(
      "[CameraView] Camera session interruption ended",
    );
  });
});
