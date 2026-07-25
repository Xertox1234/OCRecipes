// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
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
  // async act() flushes the microtask queue, so focusTo's then/catch handlers
  // have run by the time the assertion executes.
  await act(async () => {
    captured.tapEnd?.({ x, y });
  });
}

function mount(
  focusTo: CameraRef["focusTo"],
  device: CameraDevice | undefined,
) {
  return renderHook(() =>
    useCameraFocusAndZoom({ cameraRef: makeCameraRef(focusTo), device }),
  );
}

describe("useCameraFocusAndZoom — tap-to-focus", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    captured.tapEnd = undefined;
    vi.mocked(logger.error).mockClear();
    // Platform.OS is a plain string property, not a function — assign directly.
    RN.Platform.OS = "ios";
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
  });

  describe("iOS — explicit metering modes (5.0.11 workaround)", () => {
    it("requests focus at the tapped point with the device's supported modes", async () => {
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(focusTo, makeDevice());

      await tap(120, 240);

      expect(focusTo).toHaveBeenCalledWith(
        { x: 120, y: 240 },
        { modes: ["AE", "AF", "AWB"] },
      );
    });

    // The actual bug: on 5.0.11 iOS appends .awb unconditionally, and an
    // unsupported mode in the request fails the whole operation, so AF never
    // runs and the camera never refocuses even though the ring animates.
    it("omits metering modes the device does not support", async () => {
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(focusTo, makeDevice({ supportsWhiteBalanceMetering: false }));

      await tap(10, 20);

      expect(focusTo).toHaveBeenCalledWith(
        { x: 10, y: 20 },
        { modes: ["AE", "AF"] },
      );
    });

    // iOS throws "MeteringModes cannot be empty!" on an empty array, so the
    // guard is load-bearing — but the ring must still show, matching the
    // documented "falls back to continuous AF" behavior.
    it("skips the call but still shows the ring when no metering is supported", async () => {
      const focusTo = vi.fn().mockResolvedValue(undefined);
      const { result } = mount(
        focusTo,
        makeDevice({
          supportsExposureMetering: false,
          supportsFocusMetering: false,
          supportsWhiteBalanceMetering: false,
        }),
      );

      await tap(30, 60);

      expect(focusTo).not.toHaveBeenCalled();
      expect(result.current.focusPoint).toMatchObject({ x: 30, y: 60 });
    });
  });

  describe("Android — leaves the native default alone", () => {
    // Android's CameraX path derives modes from isFocusMeteringSupported() for
    // the ACTUAL tapped point. Our device flags are point-agnostic, so passing
    // them would replace a better check with a worse one. Android never had
    // the iOS AWB bug.
    it("passes no explicit modes so the point-aware native default applies", async () => {
      RN.Platform.OS = "android";
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(focusTo, makeDevice({ supportsWhiteBalanceMetering: false }));

      await tap(10, 20);

      expect(focusTo).toHaveBeenCalledWith({ x: 10, y: 20 }, undefined);
    });

    it("still focuses on a device reporting no metering support", async () => {
      RN.Platform.OS = "android";
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(
        focusTo,
        makeDevice({
          supportsExposureMetering: false,
          supportsFocusMetering: false,
          supportsWhiteBalanceMetering: false,
        }),
      );

      await tap(10, 20);

      expect(focusTo).toHaveBeenCalledWith({ x: 10, y: 20 }, undefined);
    });
  });

  describe("failure reporting", () => {
    it("reports a focusTo rejection instead of swallowing it", async () => {
      const failure = new Error("Camera is not yet ready!");
      mount(vi.fn().mockRejectedValue(failure), makeDevice());

      await tap(10, 20);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logger.error).mock.calls[0][1]).toBe(failure);
    });

    it("reports at most once per mount so a tap handler cannot flood the reporter", async () => {
      mount(vi.fn().mockRejectedValue(new Error("nope")), makeDevice());

      await tap(10, 20);
      await tap(30, 40);
      await tap(50, 60);

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    // A transient early-tap rejection must not permanently blind reporting: if
    // the camera recovers and later fails persistently, that failure is the one
    // worth knowing about.
    it("re-arms after a successful focus so a later failure is still reported", async () => {
      const focusTo = vi
        .fn()
        .mockRejectedValueOnce(new Error("Camera is not yet ready!"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("persistent metering failure"));
      mount(focusTo, makeDevice());

      await tap(10, 20); // fails    → reported
      await tap(30, 40); // succeeds → re-arms
      await tap(50, 60); // fails    → reported again

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(vi.mocked(logger.error).mock.calls[1][1]).toMatchObject({
        message: "persistent metering failure",
      });
    });
  });

  it("shows the focus ring when the request succeeds", async () => {
    const { result } = mount(
      vi.fn().mockResolvedValue(undefined),
      makeDevice(),
    );

    await tap(75, 150);

    expect(result.current.focusPoint).toMatchObject({ x: 75, y: 150 });
  });

  // No device means no camera to focus — showing a ring would promise feedback
  // for an action that cannot happen. Unreachable via either CameraView (both
  // render CameraUnavailable without a GestureDetector), but the hook's own
  // signature allows it.
  it("neither focuses nor shows a ring when there is no device", async () => {
    const focusTo = vi.fn().mockResolvedValue(undefined);
    const { result } = mount(focusTo, undefined);

    await tap(10, 20);

    expect(focusTo).not.toHaveBeenCalled();
    expect(result.current.focusPoint).toBeNull();
  });
});
