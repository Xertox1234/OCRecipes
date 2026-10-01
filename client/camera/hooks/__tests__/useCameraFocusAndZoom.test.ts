// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
import type { CameraDevice, CameraRef } from "react-native-vision-camera";

import { useCameraFocusAndZoom } from "../useCameraFocusAndZoom";
import { logger } from "@/lib/logger";

// The shared RNGH mock (test/mocks/react-native-gesture-handler.ts) throws away
// handler callbacks — its `onEnd()`/`onUpdate()` just return `this`. These
// tests need to *drive* the tap and pinch, so they supply a capturing stub
// instead. vi.hoisted() is required: vi.mock factories are hoisted above
// module-scope declarations.
const captured = vi.hoisted(() => ({
  tapEnd: undefined as ((e: { x: number; y: number }) => void) | undefined,
  pinchBegin: undefined as (() => void) | undefined,
  pinchStart: undefined as (() => void) | undefined,
  pinchUpdate: undefined as ((e: { scale: number }) => void) | undefined,
  pinchFinalize: undefined as (() => void) | undefined,
}));

vi.mock("react-native-gesture-handler", () => {
  class TapMock {
    onEnd(cb: (e: { x: number; y: number }) => void) {
      captured.tapEnd = cb;
      return this;
    }
  }
  class PinchMock {
    onBegin(cb: () => void) {
      captured.pinchBegin = cb;
      return this;
    }
    onStart(cb: () => void) {
      captured.pinchStart = cb;
      return this;
    }
    onUpdate(cb: (e: { scale: number }) => void) {
      captured.pinchUpdate = cb;
      return this;
    }
    onFinalize(cb: () => void) {
      captured.pinchFinalize = cb;
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

// The global react-native-reanimated mock (test/mocks/react-native-reanimated.ts)
// returns a fresh, non-persistent { value } object from useSharedValue on every
// render — fine for tests that only assert call counts, but the per-frame
// pinch-zoom gating below (lastAppliedZoom/lastZoomLabelText) depends on those
// shared values surviving across re-renders. Ref-backed inline mock per
// docs/legacy-patterns/testing.md -> "Stateful Animation Mock Pattern"
// (canonical example: useScrollLinkedHeader.test.ts). vitest.config.mts
// aliases "react-native-worklets" to the same physical mock file as
// "react-native-reanimated", so this override also intercepts this hook's
// `import { scheduleOnRN } from "react-native-worklets"`.
vi.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- mock needs synchronous require
  const { useRef } = require("react");
  return {
    useSharedValue: <T>(initial: T) => {
      const ref = useRef(null as { value: T } | null);
      if (ref.current === null) {
        ref.current = { value: initial };
      }
      return ref.current;
    },
    scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn(...args),
  };
});

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

function makeCameraRef(
  focusTo: CameraRef["focusTo"],
  setZoom: (zoom: number) => Promise<void> = vi
    .fn()
    .mockResolvedValue(undefined),
) {
  return {
    current: { focusTo, controller: { setZoom } } as unknown as CameraRef,
  };
}

async function tap(x: number, y: number) {
  // async act() flushes the microtask queue, so focusTo's then/catch handlers
  // have run by the time the assertion executes.
  await act(async () => {
    captured.tapEnd?.({ x, y });
  });
}

async function pinch(scale: number) {
  // async act() flushes the microtask queue, so setZoom's then/catch handlers
  // have run by the time the assertion executes.
  await act(async () => {
    captured.pinchUpdate?.({ scale });
  });
}

async function startPinch() {
  // A real pinch passes through onBegin before onStart.
  await act(async () => {
    captured.pinchBegin?.();
    captured.pinchStart?.();
  });
}

// What a single-finger tap looks like to the pinch recognizer on Android
// (PinchGestureHandler.kt): begin, then fail — onFinalize without onStart.
async function tapThroughPinch() {
  await act(async () => {
    captured.pinchBegin?.();
    captured.pinchFinalize?.();
  });
}

async function endPinch() {
  await act(async () => {
    captured.pinchFinalize?.();
  });
}

function mount(
  focusTo: CameraRef["focusTo"],
  device: CameraDevice | undefined,
  setZoom?: (zoom: number) => Promise<void>,
) {
  return renderHook(() =>
    useCameraFocusAndZoom({
      cameraRef: makeCameraRef(focusTo, setZoom),
      device,
    }),
  );
}

describe("useCameraFocusAndZoom", () => {
  const originalPlatformOS = RN.Platform.OS;

  beforeEach(() => {
    captured.tapEnd = undefined;
    captured.pinchBegin = undefined;
    captured.pinchStart = undefined;
    captured.pinchUpdate = undefined;
    captured.pinchFinalize = undefined;
    vi.mocked(logger.error).mockClear();
    // Platform.OS is a plain string property, not a function — assign directly.
    RN.Platform.OS = "ios";
  });

  afterEach(() => {
    RN.Platform.OS = originalPlatformOS;
  });

  describe("iOS — native metering default, plus the empty-set guard", () => {
    it("requests focus at the tapped point without dictating modes", async () => {
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(focusTo, makeDevice());

      await tap(120, 240);

      expect(focusTo).toHaveBeenCalledWith({ x: 120, y: 240 });
    });

    // The 5.0.11 bug: iOS appended .awb unconditionally, and an unsupported
    // mode in the request failed the whole operation, so AF never ran and the
    // camera never refocused even though the ring animated. 5.1.1 gates .awb
    // natively (#3976), so we deliberately no longer filter — a device missing
    // white-balance metering gets the same plain call, and native computes the
    // correct set. This test is what would catch a regression back to filtering.
    it("does not filter modes for a device missing white-balance metering", async () => {
      const focusTo = vi.fn().mockResolvedValue(undefined);
      mount(focusTo, makeDevice({ supportsWhiteBalanceMetering: false }));

      await tap(10, 20);

      expect(focusTo).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    // Still load-bearing on 5.1.1: HybridCameraController resolves
    // `options.modes ?? getAllSupportedMeteringModes()` BEFORE applying
    // `guard !modes.isEmpty`, so passing no modes does NOT bypass the
    // "MeteringModes cannot be empty!" throw. The ring must still show,
    // matching the documented "falls back to continuous AF" behavior.
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

      expect(focusTo).toHaveBeenCalledWith({ x: 10, y: 20 });
    });

    // The ONLY surviving platform difference: the empty-set early return is
    // iOS-only, so Android still calls focusTo here where iOS bails out (see
    // "skips the call but still shows the ring" above). This is the negative
    // control for that guard's Platform.OS condition.
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

      expect(focusTo).toHaveBeenCalledWith({ x: 10, y: 20 });
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

  describe("pinch-to-zoom — failure reporting", () => {
    it("reports a setZoom rejection instead of swallowing it", async () => {
      const failure = new Error("Camera is not yet ready!");
      const setZoom = vi.fn().mockRejectedValue(failure);
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await pinch(1.5);

      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logger.error).mock.calls[0][1]).toBe(failure);
    });

    // setZoom fires via runOnJS on EVERY pinch frame — a much higher call
    // rate than the tap-driven focusTo latch above — so this drives several
    // frames, not just one, to prove the latch actually holds under that load.
    it("reports at most once across many pinch frames so runOnJS's per-frame calls cannot flood the reporter", async () => {
      const setZoom = vi.fn().mockRejectedValue(new Error("nope"));
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await pinch(1.1);
      await pinch(1.2);
      await pinch(1.3);
      await pinch(1.4);
      await pinch(1.5);

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    // A transient early-pinch rejection must not permanently blind reporting:
    // if the camera recovers and later fails persistently, that failure is
    // the one worth knowing about — matching the runFocus precedent above.
    it("re-arms after a successful setZoom so a later persistent failure is still reported", async () => {
      const setZoom = vi
        .fn()
        .mockRejectedValueOnce(new Error("Camera is not yet ready!"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("persistent zoom failure"));
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await pinch(1.1); // fails    → reported
      await pinch(1.2); // succeeds → re-arms
      await pinch(1.3); // fails    → reported again

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(vi.mocked(logger.error).mock.calls[1][1]).toMatchObject({
        message: "persistent zoom failure",
      });
    });
  });

  describe("pinch-to-zoom — per-frame bridge call gating", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("applies setZoom only once the value moves past the epsilon", async () => {
      const setZoom = vi.fn().mockResolvedValue(undefined);
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await pinch(1.5);
      expect(setZoom).toHaveBeenCalledTimes(1);
      expect(setZoom).toHaveBeenLastCalledWith(1.5);

      // 0.005 delta from the last APPLIED value (1.5) — below the epsilon.
      await pinch(1.505);
      expect(setZoom).toHaveBeenCalledTimes(1);

      // 0.03 delta from the last applied value — crosses it.
      await pinch(1.53);
      expect(setZoom).toHaveBeenCalledTimes(2);
      expect(setZoom).toHaveBeenLastCalledWith(1.53);
    });

    it("keeps the zoom label visible for the whole gesture and hides it ~600ms after the gesture ends", async () => {
      const { result } = mount(
        vi.fn().mockResolvedValue(undefined),
        makeDevice(),
      );

      await startPinch();
      await pinch(1.5);
      expect(result.current.zoomLabel).toBe("1.5x");

      // Fingers held steady in one displayed bucket well past 600ms: the
      // gated frames send nothing to JS, and the label must NOT fade mid-pinch.
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      await pinch(1.53);
      expect(result.current.zoomLabel).toBe("1.5x");

      await endPinch();
      await act(async () => {
        vi.advanceTimersByTime(599);
      });
      expect(result.current.zoomLabel).toBe("1.5x");
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(result.current.zoomLabel).toBeNull();
    });

    it("applies the final zoom when the gesture ends, even if the last frame was within the epsilon", async () => {
      const setZoom = vi.fn().mockResolvedValue(undefined);
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await startPinch();
      await pinch(1.5);
      await pinch(1.505); // below the epsilon: not sent mid-gesture
      expect(setZoom).toHaveBeenCalledTimes(1);

      await endPinch();
      expect(setZoom).toHaveBeenCalledTimes(2);
      expect(setZoom).toHaveBeenLastCalledWith(1.505);
    });

    it("does nothing when a tap drives the pinch recognizer through begin and finalize without activating it", async () => {
      const setZoom = vi.fn().mockResolvedValue(undefined);
      const { result } = mount(
        vi.fn().mockResolvedValue(undefined),
        makeDevice(),
        setZoom,
      );

      await startPinch();
      await pinch(1.5);
      await endPinch();
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(result.current.zoomLabel).toBeNull();
      expect(vi.getTimerCount()).toBe(0);

      await tapThroughPinch();

      // No re-armed hide timer and no extra setZoom for a gesture that never
      // activated.
      expect(vi.getTimerCount()).toBe(0);
      expect(setZoom).toHaveBeenCalledTimes(1);
    });

    // iOS: UIPinchGestureRecognizer goes .possible -> .failed for a one-finger
    // tap, so onFinalize arrives with NO onBegin before it.
    it("does nothing when onFinalize arrives with no onBegin at all (iOS failed attempt)", async () => {
      const setZoom = vi.fn().mockResolvedValue(undefined);
      mount(vi.fn().mockResolvedValue(undefined), makeDevice(), setZoom);

      await startPinch();
      await pinch(1.5);
      await endPinch();
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(vi.getTimerCount()).toBe(0);

      await endPinch(); // bare onFinalize

      expect(vi.getTimerCount()).toBe(0);
      expect(setZoom).toHaveBeenCalledTimes(1);
    });

    it("sends nothing extra at gesture end when the last value was already applied, or the pinch never moved", async () => {
      const setZoom = vi.fn().mockResolvedValue(undefined);
      const { result } = mount(
        vi.fn().mockResolvedValue(undefined),
        makeDevice(),
        setZoom,
      );

      await startPinch();
      await endPinch(); // no update frames at all
      expect(setZoom).not.toHaveBeenCalled();
      expect(result.current.zoomLabel).toBeNull();

      await startPinch();
      await pinch(1.5);
      await endPinch();
      expect(setZoom).toHaveBeenCalledTimes(1);
    });

    it("cancels the previous pinch's pending hide when a new pinch starts before it fires", async () => {
      const { result } = mount(
        vi.fn().mockResolvedValue(undefined),
        makeDevice(),
      );

      await startPinch();
      await pinch(1.5);
      await endPinch(); // arms the 600ms hide
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      await startPinch(); // baseline 1.5
      await pinch(1.2); // 1.5 * 1.2 = 1.8 -> "1.8x"
      await act(async () => {
        vi.advanceTimersByTime(400); // past the FIRST pinch's hide deadline
      });
      expect(result.current.zoomLabel).toBe("1.8x");

      await endPinch();
      await act(async () => {
        vi.advanceTimersByTime(601);
      });
      expect(result.current.zoomLabel).toBeNull();
    });

    it("shows the zoom label again at the start of a new gesture even when it ends in the same displayed bucket", async () => {
      const { result } = mount(
        vi.fn().mockResolvedValue(undefined),
        makeDevice(),
      );

      await startPinch();
      await pinch(1.5);
      expect(result.current.zoomLabel).toBe("1.5x");

      await endPinch();
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(result.current.zoomLabel).toBeNull();

      // Second gesture's first frame lands on the exact same displayed zoom
      // (scale 1.0 off the new gesture-start baseline of 1.5).
      await startPinch();
      await pinch(1.0);
      expect(result.current.zoomLabel).toBe("1.5x");
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
