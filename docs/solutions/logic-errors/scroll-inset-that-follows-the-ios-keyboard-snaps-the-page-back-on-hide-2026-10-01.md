---
title: "A scroll inset that follows the iOS keyboard snaps the page back in one frame when the keyboard hides — key the padding on the consumer's state, not the keyboard's"
track: bug
category: logic-errors
tags: [react-native, keyboard, scrollview, ios, layout, ux]
module: client
applies_to: ["client/screens/HomeScreen.tsx", "client/components/home/**/*.ts"]
symptoms: ["an input inside a ScrollView sits under the iOS keyboard on a short page because scrollTo clamps to the content height and iOS lays the keyboard over the page without shrinking the scroll view", "after padding the content by the keyboard height, or wrapping the ScrollView in KeyboardAvoidingView, the input lifts correctly but the page jumps back down by hundreds of points the instant the keyboard starts hiding", "the jump lands in a single frame even though the keyboard itself slides away over 250ms"]
created: 2026-10-01
severity: medium
---

# A scroll inset that follows the iOS keyboard snaps the page back in one frame when the keyboard hides

## Problem

Home's inline drawers (Quick Log, Search Recipes) open inside an `Animated.ScrollView`. On a short
page the open drawer's input and its buttons sat under the iOS keyboard: `glideRowToTop` scrolls the
row up, but `scrollTo` clamps to the content height, and iOS lays the keyboard **over** the page
without shrinking the scroll view, so no scroll range was left to lift the input.

Two fixes lift the input correctly and both break "no layout jump when the keyboard hides":

1. Pad the content bottom by the keyboard height while the keyboard is up (set on
   `keyboardWillShow`, cleared on `keyboardWillHide`).
2. Wrap the ScrollView in `KeyboardAvoidingView behavior="padding"`, which shrinks the viewport by
   the keyboard height.

## Symptoms

See frontmatter. The tell is in the frames, not the end state: an end-state screenshot after the
hide looks fine (content bottom-aligned). Only frames taken during the hide show that the content
moved in one step.

## Root Cause

Measured on the iOS 26.5 simulator (iPhone 17 Pro, RN 0.81.5, new architecture). That simulator had
a hardware keyboard attached, so the soft keyboard never rendered; the keyboard was **synthesized**
as `keyboardWillShow` / `keyboardWillHide` notifications (see
[synthesize iOS keyboard events over CDP](../best-practices/synthesize-ios-keyboard-events-over-cdp-when-the-sim-has-a-hardware-keyboard-2026-10-01.md)),
with the event `duration` stretched to 3000ms so any motion would be observable, and screenshots
taken about 110ms apart.

- **Both mechanisms shrink the scrollable range at the hide event.** The padding removal shrinks the
  content; the KeyboardAvoidingView wrap grows the viewport. UIScrollView re-clamps `contentOffset`
  to the new range immediately.
- **React Native does not hold the offset for you here.** `_preserveContentOffsetIfNeededWithBlock`
  in `RCTScrollViewComponentView.mm` is documented "if a touch gesture is in progress": when no
  finger is down it just runs the `contentSize` write, so the clamp goes through.
- **KeyboardAvoidingView's `LayoutAnimation` did not interpolate the viewport.** 0.22s into a 3s
  keyboard show the scroll view already had its final, shrunk height.
- **Frames (md5 of the PNGs):** with the KeyboardAvoidingView wrap, 8 frames from +0.21s to +1.06s
  into a 3s hide were byte-identical to each other and different from the lifted frame; with the
  state-driven inset, 7 frames (6 plus the settled one) likewise. Both snapped before the first
  post-hide frame, roughly 260pt and 170pt of content on this page.

Not established: Android (not run), and a real soft keyboard (not rendered). The synthesized events
exercise the same JS listener path, so the layout and scroll logic is faithfully tested, but a
real-keyboard pass is still advisable.

## Solution

Key the padding on the **consumer's** state (an inline drawer is open), not on the keyboard being
visible:

- Remember the last keyboard height from the show event only; subscribe to no hide event.
- While a drawer is open, pad the content by `max(basePadding, keyboardHeight + gap)`. It is a max,
  not a sum, because the keyboard already covers the tab bar and FAB the base clearance exists for.
- Reset only when the drawer closes (a user action, so a page that returns to the top is expected).
- Re-run the glide after each show event once that padding has committed, in an effect, not from
  the listener: a glide issued before React renders the grown padding is clamped by the old content
  height. Key the effect on a show **counter**, not the height (a second show at an unchanged height
  still needs its own glide) **and on the committed padding**: a drawer that opens while the
  keyboard is still up (a collapsed drawer's text input keeps focus) gets its remembered padding
  after the open handler's own glide ran, and no new show event arrives to trigger another.

With this, every frame during and after the hide was byte-identical to the pre-hide frame (7
frames in the prototype run, 5 in the run of the final code, each counting the pre-hide frame).

```ts
export function scrollBottomPadding(
  basePadding: number,
  keyboardHeight: number,
  hasOpenDrawer: boolean,
  gap: number,
): number {
  if (!hasOpenDrawer || keyboardHeight <= 0) return basePadding;
  return Math.max(basePadding, keyboardHeight + gap);
}
```

Use `keyboardWillShow` on iOS (the lift runs alongside the animation) and `keyboardDidShow` on
Android, which has no will-events.

## Prevention

- When a scroll view is lifted by a keyboard-derived inset, test the **hide** path as a property:
  fire every registered keyboard listener of each kind and assert the padding is unchanged. A test
  that only asserts "no hide listener is registered" pins the design, not the behavior, and breaks
  for an unrelated future hide subscription.
- Pin "the glide follows the padding commit" by reading the padding **inside** the `scrollTo` mock
  (`mockImplementation(() => seen.push(paddingBottom()))`) and asserting what it saw. Asserting only
  that `scrollTo` was called lets the naive version (glide from the keyboard listener) pass: that
  mutant survived the first set of tests and was caught only by this read-at-call-time assertion.
  Reset the mock with `mockReset()` between tests so the installed implementation cannot leak.
- Verify motion with frames, not end states: stretch the synthetic keyboard `duration`, capture
  screenshots a fraction of a second apart, and compare checksums. Identical frames that differ from
  the pre-hide frame mean the change happened in a single step.
- Do not reach for `KeyboardAvoidingView` around a scroll view whose offset the app drives (a
  `scrollTo` glide): it changes the viewport at the hide event, which is the same snap.

## Related Files

- `client/screens/HomeScreen.tsx` — keyboard-show listener, sticky padding, re-glide effect
- `client/components/home/inline-drawer-utils.ts` — `scrollBottomPadding`
- `client/screens/__tests__/HomeScreen.test.tsx` — the hide-keeps-padding wiring test
- `client/components/home/__tests__/inline-drawer-utils.test.ts` — the pure sizing rule

## See Also

- [iOS-only contentInsetAdjustmentBehavior as the sole fix](ios-only-scroll-inset-prop-leaves-android-header-overlap-2026-07-02.md) — the cross-platform rule for scroll insets
- [Keyboard dismiss on scroll](../conventions/keyboard-dismiss-on-scroll-2026-05-13.md) — the other keyboard-and-scroll convention
- [Testing an extracted pure function doesn't prove it's wired](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — why the HomeScreen wiring tests exist beside the helper's
