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
