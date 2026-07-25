// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CameraDevice, CameraRef } from "react-native-vision-camera";

import { useCameraFocusAndZoom } from "../useCameraFocusAndZoom";
import { logger } from "@/lib/logger";

// The shared RNGH mock (test/mocks/react-native-gesture-handler.ts) throws away
// handler callbacks — its `onEnd()` just returns `this`. These tests need to
// *drive* the tap, so they supply a capturing stub instead. vi.hoisted() is
// required: vi.mock factories are hoisted above module-scope declarations.
const captured = vi.hoisted(() => ({
  tapEnd: undefined as ((e: { x: number; y: number }) => void) | undefined,
}));

vi.mock("react-native-gesture-handler", () => {
  class TapMock {
    onEnd(cb: (e: { x: number; y: number }) => void) {
      captured.tapEnd = cb;
      return this;
    }
  }
  class PinchMock {
    onStart() {
      return this;
    }
    onUpdate() {
      return this;
    }
  }
  return {
    Gesture: { Tap: () => new TapMock(), Pinch: () => new PinchMock() },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Only the metering flags and zoom range are read by the SUT; the real
// CameraDevice is a native HybridObject with ~60 members.
function makeDevice(flags: Partial<CameraDevice> = {}): CameraDevice {
  return {
    minZoom: 1,
    maxZoom: 10,
    supportsExposureMetering: true,
    supportsFocusMetering: true,
    supportsWhiteBalanceMetering: true,
    ...flags,
  } as CameraDevice;
}

function makeCameraRef(focusTo: CameraRef["focusTo"]) {
  return { current: { focusTo } as CameraRef };
}

async function tap(x: number, y: number) {
  // async act() flushes the microtask queue, so focusTo's rejection handler
  // has run by the time the assertion executes.
  await act(async () => {
    captured.tapEnd?.({ x, y });
  });
}

describe("useCameraFocusAndZoom — tap-to-focus", () => {
  beforeEach(() => {
    captured.tapEnd = undefined;
    vi.mocked(logger.error).mockClear();
  });

  it("requests focus at the tapped point with the device's supported metering modes", async () => {
    const focusTo = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(focusTo),
        device: makeDevice(),
      }),
    );

    await tap(120, 240);

    expect(focusTo).toHaveBeenCalledWith(
      { x: 120, y: 240 },
      { modes: ["AE", "AF", "AWB"] },
    );
  });

  // Regression guard for the actual bug: on 5.0.11 an unsupported mode in the
  // request fails the entire metering operation, so AF never runs and the
  // camera visibly never refocuses even though the ring animates.
  it("omits metering modes the device does not support", async () => {
    const focusTo = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(focusTo),
        device: makeDevice({ supportsWhiteBalanceMetering: false }),
      }),
    );

    await tap(10, 20);

    expect(focusTo).toHaveBeenCalledWith(
      { x: 10, y: 20 },
      { modes: ["AE", "AF"] },
    );
  });

  it("reports a focusTo rejection instead of swallowing it", async () => {
    const failure = new Error("Camera is not yet ready!");
    renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(vi.fn().mockRejectedValue(failure)),
        device: makeDevice(),
      }),
    );

    await tap(10, 20);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][1]).toBe(failure);
  });

  it("reports at most once per mount so a tap handler cannot flood the reporter", async () => {
    renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(vi.fn().mockRejectedValue(new Error("nope"))),
        device: makeDevice(),
      }),
    );

    await tap(10, 20);
    await tap(30, 40);
    await tap(50, 60);

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("still shows the focus ring when the request succeeds", async () => {
    const { result } = renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(vi.fn().mockResolvedValue(undefined)),
        device: makeDevice(),
      }),
    );

    await tap(75, 150);

    expect(result.current.focusPoint).toMatchObject({ x: 75, y: 150 });
  });

  // No device means no camera to focus — showing a ring would promise feedback
  // for an action that cannot happen.
  it("neither focuses nor shows a ring when there is no device", async () => {
    const focusTo = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCameraFocusAndZoom({
        cameraRef: makeCameraRef(focusTo),
        device: undefined,
      }),
    );

    await tap(10, 20);

    expect(focusTo).not.toHaveBeenCalled();
    expect(result.current.focusPoint).toBeNull();
  });
});
