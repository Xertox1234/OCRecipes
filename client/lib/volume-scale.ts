/** Volume value representing silence (below 0 = inaudible per expo-speech-recognition docs) */
export const VOLUME_SILENT = -2;

/** Volume range from expo-speech-recognition: -2 (silent) to 10 (loud) */
const VOLUME_MIN = -2;
const VOLUME_MAX = 10;
const VOLUME_RANGE = VOLUME_MAX - VOLUME_MIN;

/**
 * Map speech recognition volume (-2..10) to an animation scale factor.
 * @param vol - volume value from expo-speech-recognition volumechange event
 * @param maxScale - how much to scale beyond 1.0 at max volume (e.g. 0.3 → 1.0..1.3)
 */
export function volumeToScale(vol: number, maxScale: number): number {
  "worklet";
  const clamped = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, vol));
  return 1.0 + ((clamped - VOLUME_MIN) / VOLUME_RANGE) * maxScale;
}
