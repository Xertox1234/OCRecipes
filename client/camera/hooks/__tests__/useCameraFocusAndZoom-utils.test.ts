import { describe, it, expect } from "vitest";
import type { CameraDevice } from "react-native-vision-camera";
import {
  clampZoom,
  supportedMeteringModes,
} from "../useCameraFocusAndZoom-utils";

// Minimal CameraDevice stand-in — only the three metering-support flags are
// read by the SUT. The real type is a native HybridObject with ~60 members.
function device(
  flags: Partial<
    Pick<
      CameraDevice,
      | "supportsExposureMetering"
      | "supportsFocusMetering"
      | "supportsWhiteBalanceMetering"
    >
  >,
): CameraDevice {
  return {
    supportsExposureMetering: true,
    supportsFocusMetering: true,
    supportsWhiteBalanceMetering: true,
    ...flags,
  } as CameraDevice;
}

describe("clampZoom", () => {
  it("returns the value unchanged when within range", () => {
    expect(clampZoom(2, 1, 5)).toBe(2);
  });

  it("clamps to the minimum when below range", () => {
    expect(clampZoom(0.5, 1, 5)).toBe(1);
  });

  it("clamps to the maximum when above range", () => {
    expect(clampZoom(10, 1, 5)).toBe(5);
  });

  it("handles min === max (single-zoom-level device)", () => {
    expect(clampZoom(3, 1, 1)).toBe(1);
  });
});

describe("supportedMeteringModes", () => {
  it("returns full 3A when the device supports every metering mode", () => {
    expect(supportedMeteringModes(device({}))).toEqual(["AE", "AF", "AWB"]);
  });

  // The reason this helper exists: VisionCamera 5.0.11 fails the WHOLE metering
  // operation (AF included) when it requests an unsupported mode — fixed
  // upstream in 5.1.0 by "Check white balance mode support before metering"
  // (#3976). Filtering here keeps tap-to-focus working until that bump lands.
  it("omits AWB when white-balance metering is unsupported", () => {
    expect(
      supportedMeteringModes(device({ supportsWhiteBalanceMetering: false })),
    ).toEqual(["AE", "AF"]);
  });

  it("omits AE when exposure metering is unsupported", () => {
    expect(
      supportedMeteringModes(device({ supportsExposureMetering: false })),
    ).toEqual(["AF", "AWB"]);
  });

  it("omits AF when focus metering is unsupported", () => {
    expect(
      supportedMeteringModes(device({ supportsFocusMetering: false })),
    ).toEqual(["AE", "AWB"]);
  });

  it("returns an empty array when the device supports no metering at all", () => {
    expect(
      supportedMeteringModes(
        device({
          supportsExposureMetering: false,
          supportsFocusMetering: false,
          supportsWhiteBalanceMetering: false,
        }),
      ),
    ).toEqual([]);
  });
});
