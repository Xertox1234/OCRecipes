// @vitest-environment jsdom
/**
 * Tests for CameraView.ios.tsx — the AVFoundation useObjectOutput path
 * (mapBarcodeTypes/mapObjectToResult type mapping, onObjectsScanned wiring,
 * and objectTypes memoization). Mirrors __tests__/CameraView.test.tsx's
 * coverage of the cross-platform useBarcodeScannerOutput path.
 *
 * Vite/Vitest only follows Metro's `.ios.tsx` platform-extension convention
 * for an EXTENSIONLESS import (e.g. `from "../CameraView"`, which is why
 * CameraView.test.tsx resolves to the cross-platform CameraView.tsx, not
 * this file — see that file's note). An explicit import naming the file —
 * `from "../CameraView.ios"`, as below — resolves and transforms through
 * Vitest's normal TS/JSX pipeline with no vitest.config.mts changes needed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { CameraView } from "../CameraView.ios";

// Import after vi.mock() declarations so the mocks are hoisted.
import {
  useCameraDevice,
  usePhotoOutput,
  useObjectOutput,
  isScannedCode,
  Camera,
} from "react-native-vision-camera";
import type { ScannedObject } from "react-native-vision-camera";
import { logger } from "@/lib/logger";
import type { CameraRef } from "../../types";

// Mock react-native-vision-camera — the real module uses native code that
// cannot run under jsdom. Provide stub implementations for every export the
// CameraView.ios SUT imports.
vi.mock("react-native-vision-camera", () => {
  const Camera = vi.fn(({ testID }: { testID?: string }) => {
    return React.createElement("div", { "data-testid": testID ?? "camera" });
  });
  (Camera as unknown as { displayName: string }).displayName = "Camera";

  return {
    Camera,
    useCameraDevice: vi.fn(),
    usePhotoOutput: vi.fn(() => ({})),
    useObjectOutput: vi.fn(() => ({})),
    isScannedCode: vi.fn(() => true),
  };
});

// logger.error is the SUT's production-visibility channel (see
// js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) —
// mock it so the failure-reporting tests can assert on it directly instead of
// going through the DEV/production branch in the real implementation.
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

interface CapturedCameraProps {
  onError?: (error: Error) => void;
  onInterruptionStarted?: (reason: string) => void;
  onInterruptionEnded?: () => void;
}

// `Camera` is rendered directly (not via a hook), so its props for the most
// recent render are read off the mock's own call args, same technique used
// below for useObjectOutput.
function lastCameraProps(): CapturedCameraProps {
  const mock = Camera as unknown as Mock;
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as CapturedCameraProps;
}

function mockDevice() {
  vi.mocked(useCameraDevice).mockReturnValue({
    id: "back",
    position: "back",
  } as Parameters<typeof useCameraDevice>[0] extends string
    ? never
    : ReturnType<typeof useCameraDevice>);
}

function makeScannedObject(
  type: string,
  value: string | undefined = "123",
): ScannedObject {
  return {
    type,
    value,
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    cornerPoints: [],
  } as unknown as ScannedObject;
}

describe("CameraView.ios — no-device guard", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
    vi.mocked(useObjectOutput).mockClear();
    vi.mocked(isScannedCode).mockReset();
    vi.mocked(isScannedCode).mockReturnValue(true);
  });

  it("renders CameraUnavailable when useCameraDevice returns undefined", () => {
    vi.mocked(useCameraDevice).mockReturnValue(undefined);

    render(<CameraView barcodeTypes={[]} />);

    expect(screen.getByText("Camera unavailable")).toBeTruthy();
    expect(screen.queryByTestId("camera")).toBeNull();
  });

  it("renders the Camera when a device is available", () => {
    mockDevice();

    render(<CameraView barcodeTypes={[]} />);

    expect(screen.getByTestId("camera")).toBeTruthy();
    expect(screen.queryByText("Camera unavailable")).toBeNull();
  });
});

describe("CameraView.ios — barcode type mapping", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
    mockDevice();
    vi.mocked(useObjectOutput).mockClear();
    vi.mocked(isScannedCode).mockReset();
    vi.mocked(isScannedCode).mockReturnValue(true);
  });

  it("maps ExpoBarcodeType values to AVFoundation ScannedObjectType values", () => {
    render(<CameraView barcodeTypes={["ean13", "qr", "code128"]} />);

    const call = vi.mocked(useObjectOutput).mock.calls[0][0];
    expect(call.types).toEqual(["ean-13", "qr", "code-128"]);
  });

  it("maps upc_a to ean-13 (AVFoundation reports UPC-A as EAN-13) and dedupes", () => {
    // ean13 and upc_a both map to the AVFoundation type 'ean-13' — the SUT's
    // mapBarcodeTypes must dedupe, not emit 'ean-13' twice.
    render(<CameraView barcodeTypes={["ean13", "upc_a"]} />);

    const call = vi.mocked(useObjectOutput).mock.calls[0][0];
    expect(call.types).toEqual(["ean-13"]);
  });

  it("keeps objectTypes referentially stable across rerenders with content-equal barcodeTypes arrays", () => {
    // useObjectOutput's own useMemo keys on the `types` array IDENTITY to
    // decide whether to tear down and recreate the native object output. A
    // caller (ScanScreen) passes a fresh array literal every render, so
    // CameraView.ios must memoize the mapped array by CONTENT — a regression
    // here (e.g. dropping the useMemo) rebuilds the native output every render.
    const { rerender } = render(<CameraView barcodeTypes={["ean13", "qr"]} />);
    rerender(<CameraView barcodeTypes={["ean13", "qr"]} />); // new array, same content

    const calls = vi.mocked(useObjectOutput).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const first = calls[0][0].types;
    const last = calls[calls.length - 1][0].types;
    expect(first).toEqual(["ean-13", "qr"]);
    expect(last).toBe(first);
  });
});

describe("CameraView.ios — onObjectsScanned wiring", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
    mockDevice();
    vi.mocked(useObjectOutput).mockClear();
    vi.mocked(isScannedCode).mockReset();
    vi.mocked(isScannedCode).mockReturnValue(true);
  });

  it("passes onObjectsScanned to useObjectOutput only when barcodeTypes is non-empty", () => {
    render(<CameraView barcodeTypes={[]} />);

    const call = vi.mocked(useObjectOutput).mock.calls[0][0];
    expect(call.onObjectsScanned).toBeUndefined();
  });

  it("invokes onBarcodeScanned with the first recognized scanned object", () => {
    const onBarcodeScanned = vi.fn();
    render(
      <CameraView barcodeTypes={["qr"]} onBarcodeScanned={onBarcodeScanned} />,
    );

    const onObjectsScanned = vi.mocked(useObjectOutput).mock.calls[0][0]
      .onObjectsScanned as (objects: ScannedObject[]) => void;

    onObjectsScanned([makeScannedObject("qr", "https://example.com")]);

    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);
    expect(onBarcodeScanned).toHaveBeenCalledWith({
      data: "https://example.com",
      type: "qr",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    });
  });

  it("skips objects with no reverse type mapping and objects isScannedCode rejects, stopping at the first real match", () => {
    const onBarcodeScanned = vi.fn();
    // Reject anything explicitly flagged, simulating a ScannedFace (or any
    // non-code object) reaching the handler — mapObjectToResult must bail via
    // isScannedCode() before it ever looks up the reverse type map.
    vi.mocked(isScannedCode).mockImplementation(
      (obj) => (obj as unknown as { value?: string }).value !== "reject-me",
    );

    render(
      <CameraView
        barcodeTypes={["qr", "ean13", "code128"]}
        onBarcodeScanned={onBarcodeScanned}
      />,
    );

    const onObjectsScanned = vi.mocked(useObjectOutput).mock.calls[0][0]
      .onObjectsScanned as (objects: ScannedObject[]) => void;

    onObjectsScanned([
      makeScannedObject("aztec", "no-reverse-mapping"), // not in OBJECT_TYPE_TO_EXPO -> null
      makeScannedObject("qr", "reject-me"), // isScannedCode() rejects -> null
      makeScannedObject("ean-13", "999"), // first real match
      makeScannedObject("code-128", "888"), // would also match — never reached
    ]);

    expect(onBarcodeScanned).toHaveBeenCalledTimes(1);
    expect(onBarcodeScanned).toHaveBeenCalledWith({
      data: "999",
      type: "ean13",
      bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    });
  });

  it("does not throw when onBarcodeScanned is not provided", () => {
    render(<CameraView barcodeTypes={["qr"]} />);

    const onObjectsScanned = vi.mocked(useObjectOutput).mock.calls[0][0]
      .onObjectsScanned as (objects: ScannedObject[]) => void;

    expect(() => onObjectsScanned([makeScannedObject("qr")])).not.toThrow();
  });
});

describe("CameraView.ios — failure reporting (latched once per mount)", () => {
  beforeEach(() => {
    vi.mocked(useCameraDevice).mockReset();
    mockDevice();
    vi.mocked(usePhotoOutput).mockReturnValue(
      {} as unknown as ReturnType<typeof usePhotoOutput>,
    );
    vi.mocked(logger.error).mockClear();
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
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[CameraView]"),
      expect.objectContaining({ message: "native capture rejected" }),
    );
  });

  it("reports a Camera onError once, latched across repeated errors", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError } = lastCameraProps();
    const first = new Error("session error 1");
    onError?.(first);
    onError?.(new Error("session error 2"));

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "[CameraView] Camera error",
      first,
    );
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

  it("re-arms every latch on a fresh mount (once per mount, not once ever)", () => {
    const first = render(<CameraView barcodeTypes={[]} />);
    lastCameraProps().onError?.(new Error("first mount"));
    first.unmount();

    render(<CameraView barcodeTypes={[]} />);
    lastCameraProps().onError?.(new Error("second mount"));

    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("keeps each failure class's latch independent of the others", () => {
    render(<CameraView barcodeTypes={[]} />);

    const { onError, onInterruptionStarted } = lastCameraProps();
    onError?.(new Error("session error"));
    onInterruptionStarted?.("unknown");

    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
