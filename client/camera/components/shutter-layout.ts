// client/camera/components/shutter-layout.ts

/**
 * Vertical distance from the screen bottom to the top edge of ScanScreen's
 * shutter button, derived from the safe-area inset rather than a static
 * constant.
 *
 * ScanScreen's bottom controls row is `paddingBottom: insets.bottom + 16`
 * under a 72px shutter circle (`ScanScreen.tsx`'s `styles.controls` /
 * `styles.shutter`), so the shutter's top edge sits at `insets.bottom + 88`
 * from the screen bottom. Camera-overlay components that need to clear the
 * shutter (ProductChip, ZoomLabel) should add their own gap on top of this
 * value.
 *
 * Deriving from `insets.bottom` (not a static constant like `bottom: 92`) is
 * required — a fixed value under-clears once `insets.bottom` grows on
 * home-indicator devices. See
 * docs/solutions/logic-errors/static-offset-must-derive-from-safe-area-inset-2026-07-15.md
 */
export function getShutterTopInset(insetsBottom: number): number {
  return insetsBottom + 88; // 16 (controls paddingBottom) + 72 (shutter height)
}
