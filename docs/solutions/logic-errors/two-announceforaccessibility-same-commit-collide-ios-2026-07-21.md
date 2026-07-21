---
title: Two announceForAccessibility calls in one commit collide on iOS — merge co-arriving announcements
track: bug
category: logic-errors
tags: [accessibility, ios, voiceover, announceForAccessibility, react-native, live-region]
module: client
applies_to: ["client/**/*.tsx"]
symptoms: ["On iOS/VoiceOver one of two pieces of content that appear together is never spoken (product name announced but the safety badge that appeared with it is silent, or vice-versa)", "Non-deterministic across runs — sometimes the first announcement wins, sometimes the second", "Android/TalkBack announces both correctly (badge has its own accessibilityLiveRegion), so the bug looks iOS-only"]
created: 2026-07-21
severity: medium
---

# Two announceForAccessibility calls in one commit collide on iOS — merge co-arriving announcements

## Problem

When two pieces of state that each drive their own imperative
`AccessibilityInfo.announceForAccessibility(...)` become defined in the **same
React render commit**, iOS VoiceOver **drops one of them**. Only one utterance is
spoken; which one is effectively a race. On a safety surface this can silently
swallow the important announcement (e.g. the allergen warning).

This is distinct from the Android double-announce bug and from the
content-keying bug (see `## See Also`): here each announcement is individually
correct and correctly edge-guarded — the defect is purely that **two imperative
announces fire in the same JS tick**.

## Symptoms

- iOS/VoiceOver speaks only one of two pieces of content that mounted together
  (product name **or** the safety-flag badge, not both).
- Non-deterministic which one is heard.
- Android/TalkBack is unaffected (the badge carries its own
  `accessibilityLiveRegion="assertive"`, so TalkBack reads it independently).

## Root Cause

`accessibilityLiveRegion` posts **no** announcement on iOS at all (it is an
Android-only mechanism — see the cross-platform doc in `## See Also`), so on iOS
the only way to announce a change is the imperative
`AccessibilityInfo.announceForAccessibility(...)`. iOS's underlying
`UIAccessibility.post(.announcement, ...)` does not queue: a second announcement
posted in the same run loop tick **interrupts/replaces** the first before the
screen reader has spoken it. Two `useEffect`s that each fire their own announce
on the same undefined→defined transition therefore stomp on each other.

In the case that surfaced this (ProductChip, Smart Scan Phase 1): `productName`
and `safetyFlag` both arrive in one `PRODUCT_LOADED` dispatch, so the name-announce
effect and the flag-announce effect both fired in the same commit — VoiceOver
dropped one.

## Solution

Fold co-arriving announcements into **one** utterance, and keep the platform
split explicit (do NOT naively unify both effects, or Android double-announces):

```tsx
useEffect(() => {
  const nameJustArrived = !!productName && !prevNameRef.current;
  const flagJustArrived = !!flagTitle && !prevFlagRef.current;

  if (Platform.OS === "ios") {
    if (nameJustArrived && flagJustArrived) {
      // ONE combined utterance — iOS drops the second of two same-tick posts
      AccessibilityInfo.announceForAccessibility(`${productName}. ${flagText}`);
    } else {
      if (nameJustArrived) AccessibilityInfo.announceForAccessibility(productName!);
      if (flagJustArrived) AccessibilityInfo.announceForAccessibility(flagText);
    }
  } else if (nameJustArrived) {
    // Android: announce only the name imperatively; the flag has its own
    // accessibilityLiveRegion="assertive", which TalkBack reads on its own.
    // Announcing the flag here too would double it.
    AccessibilityInfo.announceForAccessibility(productName!);
  }

  prevNameRef.current = productName;
  prevFlagRef.current = flagTitle;
}, [productName, flagTitle, flagDetail]);
```

Key points:

- **iOS, both together → one combined string.** The `else` branch still handles
  the (currently theoretical) case where the two pieces arrive on separate
  commits.
- **Android is asymmetric on purpose.** It gets the flag from the badge's own
  live region, so the imperative call announces the name only — otherwise the
  flag is spoken twice.
- Regression-test it by mounting product-less, `mockClear()`, then rerender so
  both fields land in one commit, and assert `announceSpy` was called **once**
  (a bare "the combined string was announced" assertion passes even if the split
  path also fired a second time).

## Prevention

- Before adding a second imperative `announceForAccessibility` to a component,
  check whether its trigger state can become defined in the same commit as an
  existing announce. If so, merge them.
- Treat "the confirm-card path already folds name+flag into one iOS announce" as
  the reference: when the same two pieces of state exist on another surface,
  fold them the same way.
- A regression test that only asserts the presence of a string is insufficient —
  assert the announce call **count** to lock exclusivity.

## Related Files

- `client/camera/components/ProductChip.tsx` — the merged name+flag iOS announce
  effect (the fix).
- `client/screens/ScanScreen.tsx` — the confirm-card announce effect that already
  folded name+flag into one utterance (the reference pattern).

## See Also

- [imperative announce must be content-keyed, not variant-keyed](imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md) — the other ProductChip announce gotcha (dropped same-discriminator updates); same component, different failure mode.
- [accessibilityLiveRegion + announceForAccessibility causes double TalkBack announcements](double-talkback-announcements-live-region-2026-05-13.md) — the Android double-announce counterpart (why the platform split matters).
- [Cross-platform live region announcements — announceForAccessibility only](../design-patterns/cross-platform-live-region-announcements-2026-05-13.md) — why iOS needs the imperative call at all.
- [Android container accessibilityLiveRegion re-reads the WHOLE subtree — and is the sole Android announcer](../conventions/android-container-live-region-reannounces-whole-subtree-2026-06-23.md) — the Android side of the same rework.
- [Accessibility grouping pattern with accessible={true}](../design-patterns/accessibility-grouping-pattern-2026-05-13.md) — grouping a badge's own text into one node (a related but separate concern).
