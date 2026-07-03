---
title: Replacing a shared-container live region with discriminator-keyed announces silently drops same-discriminator content updates
track: bug
category: logic-errors
module: client
severity: medium
tags: [accessibility, talkback, react-native, announce-for-accessibility, accessibility-live-region]
symptoms: [An accessibility cue that TalkBack used to speak on Android stops being spoken after a refactor that removed an accessibilityLiveRegion, A screen-reader announce fires on the container appearing / changing state but NOT when an async-loaded value (name/price/count) fills in afterward, iOS and Android both go silent on an in-place content update that previously only Android announced (via the dropped live region)]
applies_to: [client/**/*.tsx]
created: '2026-06-24'
---

# Replacing a shared-container live region with discriminator-keyed announces silently drops same-discriminator content updates

## Problem

A polite `accessibilityLiveRegion` on a shared container is a blunt but
**total** announcer: Android TalkBack re-reads the subtree on _any_ descendant
change. When you remove it (correctly — see Root Cause) and replace it with
imperative `AccessibilityInfo.announceForAccessibility(...)` calls keyed on the
render **discriminator** (a `variant` string, a `type` field, a list key), you
cover every change that flips the discriminator — but you silently drop every
change where the **content mutates while the discriminator stays the same**.
On the path that mutates in place, the screen reader now says nothing where the
live region used to speak.

Concrete case (`ProductChip`): the chip is shown as `BARCODE_LOCKED` with no
product (a "Product" placeholder) and announces a fixed `"Product found…"`
string. An async `PRODUCT_LOADED` then adds the real product name **keeping the
phase type `BARCODE_LOCKED`** (`{ ...state, product }`), so the `variant`-keyed
announce effect never re-fires. The visible row changes placeholder → real name,
but nothing is announced — where the old container live region used to re-read
the subtree and speak the loaded name on Android.

## Symptoms

- A value that loads/updates _after_ a card or chip is already on screen is no
  longer spoken by TalkBack, though the visible text changed.
- The announce effect's dependency array is the discriminator (`[variant]`,
  `[type]`, `[status]`) — not the mutating content.
- The regression is invisible to a variant-stepped manual sweep and to render
  tests that only assert "each variant announces": both step by the
  discriminator, so neither exercises a same-discriminator content change.

## Root Cause

Removing the shared-container `accessibilityLiveRegion="polite"` is itself
correct — a polite region on a container that wraps a structural swap (e.g.
`Text`↔`ActivityIndicator`) or a descendant `accessibilityState` change re-reads
the **entire** subtree on every descendant change (a `CONTENT_CHANGE_TYPE_SUBTREE`
the container composes), i.e. it over-announces. The trap is the **replacement**:
the live region was an implicit announcer for _all_ subtree changes, including
in-place content updates under a stable discriminator. A discriminator-keyed
imperative effect is strictly narrower — it only fires when the discriminator
itself changes. The async / in-place update is the gap.

## Solution

Key the imperative announce on the **content that changed**, not only the
discriminator. Add a second, edge-guarded effect for each value that can mutate
in place:

```tsx
const productName = "product" in phase ? phase.product?.name : undefined;
const prevProductNameRef = useRef<string | undefined>(undefined);

// Variant-keyed effect handles discriminator transitions…
useEffect(() => {
  if (variant !== null) {
    AccessibilityInfo.announceForAccessibility(getChipAnnounceText(variant, phase));
  }
  // …
}, [variant]);

// …content-keyed effect handles the async in-place update the variant effect misses.
useEffect(() => {
  // Edge-guard undefined→value so it fires once on load, not on every render,
  // not on the initial appear (the discriminator effect already spoke), and not
  // on later transitions that merely carry the value forward.
  if (productName && !prevProductNameRef.current) {
    AccessibilityInfo.announceForAccessibility(productName);
  }
  prevProductNameRef.current = productName;
}, [productName]);
```

The content-keyed announce is a single focused string (just the loaded name),
not a whole-subtree re-read, so it doesn't reintroduce the over-announcement that
motivated dropping the live region.

## Prevention

- When you remove an `accessibilityLiveRegion`, enumerate **every** descendant
  change it used to cover, then ask of each: does it flip the render
  discriminator, or mutate content in place? In-place mutations each need their
  own content-keyed announce.
- **Verification-method gap:** a manual harness or render test that steps by
  variant/`type`/key has a structural blind spot here — it never produces a
  same-discriminator content change, so "every variant announces" and
  "`nodeLiveRegion=0`" can both be green while this path is silent. Add an
  explicit same-discriminator-content-update case (e.g. render the placeholder
  phase, then re-render with the value attached) to both the on-device sweep and
  the unit test.

## Related Files

- `client/camera/components/ProductChip.tsx` — the `productName`-keyed effect and
  the variant-keyed effect it complements
- `client/camera/components/__tests__/ProductChip.a11y.test.tsx` — the
  async-load test case (`announces an async-loaded product name within
  barcode_lock`)
- `client/camera/reducers/scan-phase-reducer.ts` — `PRODUCT_LOADED` returns
  `{ ...state, product }`, keeping the same phase `type`
- `docs/rules/accessibility.md` — the `accessibilityLiveRegion` exception clause
  (drop shared container live region → announce imperatively, keyed on content)

## See Also

- [a11y hide visually-hidden surfaces](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md) — another case where a mounted-but-changed surface needs explicit a11y handling
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md) — how to verify the fix on-device, and the variant-stepped-sweep blind spot that hides this exact gap
