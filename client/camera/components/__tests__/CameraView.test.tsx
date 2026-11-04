// @vitest-environment jsdom
/**
 * Tests for the CameraView no-device guard (PR #341).
 * Verifies that <CameraUnavailable /> renders when useCameraDevice returns
 * undefined, and the Camera component renders when a device is available.
 *
 * Note: Vitest/Vite resolution ignores .ios.tsx extensions by default, so
 * importing "../CameraView" resolves to CameraView.tsx (Android/default variant).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { CameraView } from "../CameraView";

// Import after vi.mock() declarations so the mocks are hoisted.
import {
  useCameraDevice,
  usePhotoOutput,
  Camera,
} from "react-native-vision-camera";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";
import { logger } from "@/lib/logger";
import type { CameraRef } from "../../types";

// Mock react-native-vision-camera — the real module uses native code that
// cannot run under jsdom. Provide stub implementations for every export the
// CameraView SUT imports.
vi.mock("react-native-vision-camera", () => {
  const Camera = vi.fn(({ testID }: { testID?: string }) => {
    return React.createElement("div", { "data-testid": testID ?? "camera" });
  });
  (Camera as unknown as { displayName: string }).displayName = "Camera";

  return {
    Camera,
    useCameraDevice: vi.fn(),
    usePhotoOutput: vi.fn(() => ({})),
  };
});

// Mock the barcode-scanner package — also native-only.
vi.mock("react-native-vision-camera-barcode-scanner", () => ({
  useBarcodeScannerOutput: vi.fn(() => ({})),
}));

// logger.error is the SUT's production-visibility channel (see
// js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) —
// mock it so the failure-reporting tests can assert on it directly instead of
// going through the DEV/production branch in the real implementation.
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function mockDevice() {
  vi.mocked(useCameraDevice).mockReturnValue({
    id: "back",
    position: "back",
  } as Parameters<typeof useCameraDevice>[0] extends string
    ? never
    : ReturnType<typeof useCameraDevice>);
}

interface CapturedCameraProps {
  onError?: (error: Error) => void;
  onInterruptionStarted?: (reason: string) => void;
  onInterruptionEnded?: () => void;
}

// `Camera` is rendered directly (not via a hook), so its props for the most
// recent render are read off the mock's own call args, same technique the
// existing tests already use for useBarcodeScannerOutput/useObjectOutput.
function lastCameraProps(): CapturedCameraProps {
  const mock = Camera as unknown as Mock;
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as CapturedCameraProps;
}

describe("CameraView — no-device guard", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
  });

  it("renders CameraUnavailable when useCameraDevice returns undefined", () => {
    vi.mocked(useCameraDevice).mockReturnValue(undefined);

    render(<CameraView barcodeTypes={[]} />);

    expect(screen.getByText("Camera unavailable")).toBeTruthy();
    expect(screen.queryByTestId("camera")).toBeNull();
  });

  it("renders the Camera when a device is available", () => {
    // Provide a minimal device object — the shape is opaque to CameraView.tsx
    // (it only checks truthiness), so any non-undefined value satisfies the guard.
    vi.mocked(useCameraDevice).mockReturnValue({
      id: "back",
      position: "back",
    } as Parameters<typeof useCameraDevice>[0] extends string
      ? never
      : ReturnType<typeof useCameraDevice>);

    render(<CameraView barcodeTypes={[]} />);

    expect(screen.getByTestId("camera")).toBeTruthy();
    expect(screen.queryByText("Camera unavailable")).toBeNull();
  });

  it("keeps barcodeFormats referentially stable across rerenders with content-equal barcodeTypes arrays", () => {
    // useBarcodeScannerOutput's own useMemo keys on the barcodeFormats array
    // IDENTITY to decide whether to tear down and recreate the native scanner
    // output. ScanScreen passes a fresh array literal every render, so
    // CameraView must memoize the mapped array by CONTENT — a regression here
    // (e.g. dropping the useMemo) rebuilds the native output on every render.
    vi.mocked(useCameraDevice).mockReturnValue({
      id: "back",
      position: "back",
    } as Parameters<typeof useCameraDevice>[0] extends string
      ? never
      : ReturnType<typeof useCameraDevice>);
    vi.mocked(useBarcodeScannerOutput).mockClear();

    const { rerender } = render(<CameraView barcodeTypes={["ean13", "qr"]} />);
    rerender(<CameraView barcodeTypes={["ean13", "qr"]} />); // new array, same content

    const calls = vi.mocked(useBarcodeScannerOutput).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const first = calls[0][0].barcodeFormats;
    const last = calls[calls.length - 1][0].barcodeFormats;
    expect(first).toEqual(["ean-13", "qr-code"]);
    expect(last).toBe(first);
  });

  it("never hands the barcode scanner an empty format list (label modes pass barcodeTypes=[])", () => {
    // The hook builds the native ML Kit scanner during render even when the
    // output is left out of `outputs`, and on Android an empty format list
    // throws "Target barcodeFormats cannot be empty!" — a Render Error that
    // takes down the whole scan screen in label / front-label mode.
    mockDevice();
    vi.mocked(useBarcodeScannerOutput).mockClear();

    render(<CameraView barcodeTypes={[]} />);

    const calls = vi.mocked(useBarcodeScannerOutput).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [options] of calls) {
      expect(options.barcodeFormats.length).toBeGreaterThan(0);
    }
    // The placeholder scanner is never attached: only the photo output runs.
    expect((lastCameraProps() as { outputs?: unknown[] }).outputs).toHaveLength(
      1,
    );
  });
});

describe("CameraView — failure reporting (latched once per mount)", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
    mockDevice();
    vi.mocked(usePhotoOutput).mockReturnValue(
      {} as unknown as ReturnType<typeof usePhotoOutput>,
    );
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  it("reports a takePicture rejection via logger.error, latched once, and still resolves null so the caller's Alert.alert('Capture failed', ...) still fires", async () => {
    const capturePhotoToFile = vi
      .fn()
      .mockRejectedValue(new Error("native capture rejected"));
    vi.mocked(usePhotoOutput).mockReturnValue({
      capturePhotoToFile,
    } as unknown as ReturnType<typeof usePhotoOutput>);

    const ref = React.createRef<CameraRef>();
    render(<CameraView ref={ref} barcodeTypes={[]} />);

    expect(await ref.current!.takePicture()).toBeNull();
    expect(await ref.current!.takePicture()).toBeNull();
    expect(await ref.current!.takePicture()).toBeNull();

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("reports a Camera onError once, latched across repeated errors", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError } = lastCameraProps();
    onError?.(new Error("session error 1"));
    onError?.(new Error("session error 2"));

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("logs a CameraX 'Camera is not active' cancel at warn, not error, and keeps the error latch for a real failure", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError } = lastCameraProps();
    onError?.(
      new Error(
        "androidx.camera.core.CameraControl$OperationCanceledException: Camera is not active.",
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    onError?.(new Error("session error"));
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("classifies by OperationCanceledException name too", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError } = lastCameraProps();
    onError?.(new Error("OperationCanceledException: cancelled"));

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("reports a barcode-scanner onError once, latched across repeated errors", () => {
    render(<CameraView barcodeTypes={["qr"]} />);

    const { onError } = vi
      .mocked(useBarcodeScannerOutput)
      .mock.calls.at(-1)![0];
    onError(new Error("scanner error 1"));
    onError(new Error("scanner error 2"));

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("reports each interruption reason once, so an early reason cannot hide a later, different one", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onInterruptionStarted } = lastCameraProps();
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    onInterruptionStarted?.(
      "video-device-not-available-due-to-system-pressure",
    );

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "[CameraView] Camera session interrupted (video-device-in-use-by-another-client)",
    );
    expect(logger.error).toHaveBeenCalledWith(
      "[CameraView] Camera session interrupted (video-device-not-available-due-to-system-pressure)",
    );
  });

  it("does not report backgrounding (video-device-not-available-in-background) or its end as an error", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onInterruptionStarted, onInterruptionEnded } = lastCameraProps();
    onInterruptionStarted?.("video-device-not-available-in-background");
    onInterruptionEnded?.();

    expect(logger.error).not.toHaveBeenCalled();

    // A real interruption later in the same mount still reports.
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("reports onInterruptionEnded once, latched across repeated calls", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onInterruptionStarted, onInterruptionEnded } = lastCameraProps();
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    vi.mocked(logger.error).mockClear();
    onInterruptionEnded?.();
    onInterruptionEnded?.();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "[CameraView] Camera session interruption ended",
    );
  });

  it("still reports the end of a real interruption when the app backgrounds during it", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onInterruptionStarted, onInterruptionEnded } = lastCameraProps();
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    onInterruptionStarted?.("video-device-not-available-in-background");
    onInterruptionEnded?.();

    expect(logger.error).toHaveBeenLastCalledWith(
      "[CameraView] Camera session interruption ended",
    );
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("gives each newly reported interruption reason its own end report", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onInterruptionStarted, onInterruptionEnded } = lastCameraProps();
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    onInterruptionEnded?.();
    onInterruptionStarted?.(
      "video-device-not-available-due-to-system-pressure",
    );
    onInterruptionEnded?.();
    // A repeat of an already-reported reason reports neither start nor end.
    onInterruptionStarted?.("video-device-in-use-by-another-client");
    onInterruptionEnded?.();

    expect(logger.error).toHaveBeenCalledTimes(4);
  });

  it("keeps each failure class's latch independent of the others", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError, onInterruptionStarted } = lastCameraProps();
    onError?.(new Error("session error"));
    onInterruptionStarted?.("unknown");

    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
