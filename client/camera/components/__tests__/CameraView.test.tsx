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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CameraView } from "../CameraView";

// Import after vi.mock() declarations so the mocks are hoisted.
import { useCameraDevice } from "react-native-vision-camera";
import { useBarcodeScannerOutput } from "react-native-vision-camera-barcode-scanner";

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
});
