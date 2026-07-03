---
title: On-open / on-present screen-reader announces must be delayed past the modal present focus shift
track: knowledge
category: conventions
module: client
tags: [accessibility, talkback, voiceover, react-native, announce-for-accessibility, modal, screen-reader]
symptoms: ['A modal/sheet opens and the screen reader only reads its first accessible element (often a close button), never the modal''s purpose', An on-open announceForAccessibility fires but VoiceOver seems to drop/cut it on iOS, An announce works on Android but is silent on iOS specifically when a view is being presented]
applies_to: [client/**/*.tsx]
created: '2026-06-25'
---

# On-open / on-present screen-reader announces must be delayed past the modal present focus shift

## When this applies

You want a screen reader to speak a surface's **purpose when it appears** —
a modal, sheet, or full-screen view that presents with an animation. The
natural reach is an `AccessibilityInfo.announceForAccessibility(...)` on the
open edge. Fire it on the same tick the surface presents and it competes with
the OS's own present behavior: VoiceOver/TalkBack post a screen-change and move
focus to the first accessible element. The imperative announce can be swallowed
mid-transition (iOS) or arrive out of order.

This is **distinct** from the async state-transition announces already covered
in `docs/rules/accessibility.md` (success/error/busy). Those fire while the
surface is **already presented and settled**, so there is no present focus-shift
to race. The on-open case is the new wrinkle: the announce coincides with the
presentation.

## Smell patterns

- `announceForAccessibility(...)` fired **synchronously** inside a `visible`-edge
  `useEffect` (no `setTimeout`), for a surface that presents with
  `animationType="slide"` / `"fade"` / any non-instant transition.
- An on-open announce that "works in the unit test" (the test asserts the call,
  not the speech) but a manual VoiceOver pass on a real present says nothing.
- Reusing the immediate-fire shape of a settled-state announce (the success path)
  for the open path, on the assumption they're the same.

## Why

Delay the announce **~500ms** (past the present animation; RN's slide default is
~300ms) inside the edge-guarded effect, and clean up the timer on the effect's
return so a fast close cancels a pending announce:

```tsx
const prevVisibleRef = useRef(false);
useEffect(() => {
  const opened = visible && !prevVisibleRef.current;
  prevVisibleRef.current = visible; // update BEFORE the early return — tracks every render
  if (!opened) return;
  const timer = setTimeout(() => {
    AccessibilityInfo.announceForAccessibility(
      "Upgrade to Premium. Unlock the full OCRecipes experience.",
    );
  }, 500);
  return () => clearTimeout(timer);
}, [visible]);
```

Evidence vs. reasoning — keep these separate:

- **Proven (on-device, Android TalkBack via logcat):** with the 500ms delay, the
  announce is delivered **after** the present — a single `TYPE_ANNOUNCEMENT`
  `action=SPEAK text="…"` landed ~580ms after the `visible→true` edge (matching
  the delay), **then** the `TYPE_VIEW_ACCESSIBILITY_FOCUSED` close-button read.
  Purpose leads, exactly one announce per open, no double-announce.
- **Reasoned, NOT measured:** that an *immediate* (zero-delay) announce gets
  *swallowed* on iOS. The immediate-fire case was never run, and the local iOS
  build is blocked, so iOS was never exercised at all. The delay is a
  **defensive** choice grounded in documented iOS screen-change behavior
  (a `UIAccessibilityAnnouncementNotification` posted during a
  `UIAccessibilityScreenChangedNotification` can be dropped); the Android timing
  only corroborates that the *delayed* path is delivered post-present. Do not
  state the swallow as a verified fact.

Two supporting rules carry over from the existing announce conventions and still
apply on the open path:

- **No iOS gate when the announced element has no live region.** Gate the
  announce to `Platform.OS === "ios"` **only when** the element/container still
  carries an `accessibilityLiveRegion` (Android is covered by the live region, so
  a second imperative announce double-speaks). An on-open purpose announce
  usually targets an idle title whose live region is gated to a later state
  (e.g. `success`) — i.e. **no** live region in the open state — so announce on
  **both** platforms with no gate.
- **Status-independent string.** If a reset/clear runs on open via an async state
  update, the discriminator (`state.status`) can be briefly stale for one render.
  Hardcode the purpose string rather than deriving it from status, so a one-render
  stale window can't mis-announce.

## Exceptions

- **Settled-state transitions still fire immediately.** A success/error/busy
  announce on an *already-presented* surface has no present focus-shift to race —
  keep it immediate (see `docs/rules/accessibility.md`). The delay is specific to
  the appear/present moment.
- **Initial-focus alternative.** If the delayed announce ever proves unreliable,
  the heavier alternative is `AccessibilityInfo.setAccessibilityFocus(reactTag)`
  on the heading so the OS's *own* focus-shift reads the purpose first (directing
  the natural focus rather than competing with it). Prefer the delayed announce —
  it's lighter and matches the file's existing announce shape — and only escalate
  to focus management if needed.

## Related Files

- `client/components/UpgradeModal.tsx` — the on-open purpose announce (visible-edge
  `useEffect`, 500ms delay, both-platforms, status-independent string)
- `client/components/__tests__/UpgradeModal.a11y.test.tsx` — fake-timer tests for
  the open edge, mount-while-hidden guard, once-per-open + re-arm, and fast-close
  cleanup
- `docs/rules/accessibility.md` — the immediate state-transition announce rules
  (success/error/busy) this convention complements

## See Also

- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md) — how the on-device timing here was captured (the `TYPE_ANNOUNCEMENT` vs `TYPE_VIEW_ACCESSIBILITY_FOCUSED` lines)
- [Imperative announce must be content-keyed, not variant-keyed](../logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md) — the complementary trap when *replacing* a live region with imperative announces
