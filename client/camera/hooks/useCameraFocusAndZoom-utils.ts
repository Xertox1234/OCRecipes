import type { CameraDevice, MeteringMode } from "react-native-vision-camera";

/**
 * The 3A metering modes this device actually supports, in a stable order.
 *
 * `focusTo()` documents its default as "every mode the device supports", but
 * VisionCamera 5.0.11 fails the ENTIRE metering operation — auto-focus
 * included — when the request contains a mode the device can't do. That is why
 * tap-to-focus animates its ring and never refocuses. Upstream fixed it in
 * 5.1.0 ("Check white balance mode support before metering", #3976); until
 * that native bump ships we do the capability check ourselves, which is what
 * `focusTo`'s own docs require of callers passing an explicit `modes` array.
 *
 * No `"worklet"` directive: unlike `clampZoom` below, this is called from
 * `runFocus` on the JS thread (via `runOnJS`), never inside a worklet body.
 */
export function supportedMeteringModes(device: CameraDevice): MeteringMode[] {
  const modes: MeteringMode[] = [];
  if (device.supportsExposureMetering) modes.push("AE");
  if (device.supportsFocusMetering) modes.push("AF");
  if (device.supportsWhiteBalanceMetering) modes.push("AWB");
  return modes;
}

/**
 * Called from inside the pinch gesture's `.onUpdate` worklet
 * (`useCameraFocusAndZoom.ts`) — needs its own "worklet" directive or it
 * silently crashes release/OTA builds despite passing tsc/lint/tests.
 * See docs/rules/react-native.md and scripts/__tests__/worklet-directive-guard.test.ts.
 */
export function clampZoom(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}
