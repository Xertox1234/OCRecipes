---
title: A static pixel offset that clears a safe-area-dependent sibling under-clears on notch/home-indicator devices
track: bug
category: logic-errors
tags: [react-native, safe-area-insets, layout, positioning, camera]
module: client
symptoms: [element visually overlaps a sibling only on notch or home-indicator devices, a code-reviewed layout fix looks correct at insets.bottom=0 but not at insets.bottom>0, fixed pixel offset mirrors an existing sibling's static constant that itself never accounted for insets.bottom]
severity: medium
created: '2026-07-15'
---

# A static pixel offset that clears a safe-area-dependent sibling under-clears on notch/home-indicator devices

## Problem

When one absolutely-positioned element (A) must clear another (B) whose own position or height depends on `insets.bottom` (e.g. B has `paddingBottom: insets.bottom + 16`), giving A a **static** pixel offset — even one carefully chosen to work at `insets.bottom = 0` — only clears B on devices where `insets.bottom` is small. On a home-indicator device (`insets.bottom ≈ 34`), B's effective top edge moves up by the same amount, but A's static offset does not, so A silently starts overlapping B again.

## Symptoms

- A layout fix (e.g. "raise element A above element B") looks correct in code review and in a `insets.bottom = 0` test/simulator, but the reported overlap recurs on a notched or home-indicator physical device.
- The offset was chosen by copying an existing sibling's static constant (e.g. mirroring another component's `bottom: 92`), and that sibling's own value never accounted for `insets.bottom` either — the flaw propagates silently to the new consumer.
- The comment next to the constant describes an inset-aware calculation ("clears the shutter + insets.bottom padding"), but the code is a bare number that never references `insets.bottom` — a comment/code mismatch that hides the gap from a quick read.

## Root Cause

`client/camera/components/ProductChip.tsx` needed to sit above `client/screens/ScanScreen.tsx`'s bottom shutter row, whose top edge is at `insets.bottom + 88` from the screen bottom (a 72px shutter under `paddingBottom: insets.bottom + 16`). The first-pass fix gave `ProductChip` a static `bottom: 92` — mirroring `client/camera/components/ZoomLabel.tsx`'s existing `bottom: 92 // clears the 72px shutter + insets.bottom padding below it` comment, which was itself never actually inset-aware (a small transient pinch-zoom label, so its own residual overlap risk went unnoticed). At `insets.bottom = 0` this static value works (`92 > 88`), so the fix appeared correct. At `insets.bottom = 34` (a typical iPhone with a home indicator), the shutter's top edge is at `122`, but the box's fixed `bottom: 92` sits *inside* the shutter's vertical band — its background (not any text — the chip's own `paddingBottom` still scaled correctly, since that value carried its own separate `insets.bottom` term) visibly overlapped the shutter by up to ~30px, and since the shutter's container carries `zIndex: 10` while the chip has none, the shutter painted on top.

A **second-order** version of the same bug appeared during the fix: once `bottom` was corrected to `insets.bottom + 96`, the chip's *own* `paddingBottom: 20 + insets.bottom` then double-counted the inset (previously correct only because `bottom` had been `0`, so padding alone had to clear the physical home indicator). The two `insets.bottom` terms no longer cancelled, leaving growing dead whitespace inside the chip on larger insets.

## Solution

Derive the offset symbolically from the same `insets.bottom` term the sibling uses, so the two terms cancel to a device-independent constant gap instead of drifting apart:

```typescript
// client/camera/components/ProductChip-utils.ts
export function getShutterClearanceStyle(
  variant: ProductChipVariant | null,
  insetsBottom: number,
): { bottom?: number; paddingBottom: number } {
  if (variant === "session_complete") {
    // Flush-bottom exception: padding alone must clear the home indicator here.
    return { paddingBottom: 20 + insetsBottom };
  }
  // insetsBottom + 88 = the sibling's top edge; + 8 is a small buffer.
  // paddingBottom is flat 20 — bottom already absorbed the inset, so adding
  // it again here would double-count it.
  return { bottom: insetsBottom + 96, paddingBottom: 20 };
}
```

Verify by re-deriving the two expressions symbolically (not just at `insets.bottom = 0`): sibling's clearance line + this element's resting position, both as functions of `insets.bottom`, and confirm the `insets.bottom` terms cancel (or the gap only grows, never shrinks) across the full realistic range (`0` to ~`40`).

## Prevention

- Never mirror an existing sibling's *static* offset for a new "clear this element" fix without first checking whether that sibling's own padding/position already carries an `insets.bottom` term — if it does, the new offset must carry the matching term too, not a copy of the same bare literal.
- When a fix touches an absolutely-positioned element's `bottom` (or `top`), re-check every other style property on the same element that also references `insets.bottom` (padding, margin) — an offset added in one place without adjusting a pre-existing inset-aware value elsewhere on the same element is exactly how the double-count regression appeared here.
- Code review should redo the geometry symbolically at more than one `insets.bottom` value (e.g. `0` and `~34`), not just accept a fix that "looks right" against the number in the diff.
- Extend the entrance/exit animation's off-screen distance whenever a resting position moves closer to the visible screen area — a `translateY` (or similar) magic number calibrated for the old resting position can leave part of the element visible during the animation once the resting position changes.

## Related Files

- `client/camera/components/ProductChip.tsx` — the fix
- `client/camera/components/ProductChip-utils.ts` — `getShutterClearanceStyle`
- `client/camera/components/__tests__/ProductChip-utils.test.ts` — derivation unit tests across `insetsBottom` values
- `client/camera/components/ZoomLabel.tsx` — the pre-existing static-`92` pattern that was mirrored (left unfixed here — out of this todo's scope; still not inset-aware)
- `client/screens/ScanScreen.tsx` — the shutter row (`styles.controls`) whose geometry this offset clears

## See Also

- [FAB overlay with tab bar clearance via static constants](../design-patterns/fab-overlay-tab-bar-clearance-2026-05-13.md) — a related but distinct static-constant clearance pattern (crash-avoidance, not safe-area scaling)
- [Testing an extracted pure function doesn't prove it's correctly wired into the component](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — applied here: a wiring-seam test alongside the pure derivation's unit tests
- [Safe area handling with useSafeAreaInsets() and theme spacing](../conventions/safe-area-handling-2026-05-13.md) — the general rule this solution's fix is a specific application of (deriving an offset from the inset rather than a bare constant)
