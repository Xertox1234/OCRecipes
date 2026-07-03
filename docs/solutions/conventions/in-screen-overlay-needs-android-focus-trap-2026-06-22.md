---
title: 'In-screen modal overlays need an Android focus trap, not just iOS accessibilityViewIsModal'
track: knowledge
category: conventions
module: client
tags: [accessibility, talkback, voiceover, react-native, modal, overlay, focus-trap, importantForAccessibility, accessibilityViewIsModal]
symptoms: [Focus trap works in VoiceOver but a TalkBack user can swipe past the overlay to the controls behind it on Android, An overlay carries accessibilityViewIsModal but nothing hides the behind-content on Android]
applies_to: [client/**/*.tsx]
created: '2026-06-22'
---

# In-screen modal overlays need an Android focus trap, not just iOS accessibilityViewIsModal

## When this applies

You are building an **in-screen overlay** — a conditionally-rendered `View` layered over the screen (confirm card, bottom sheet, product chip, action panel) that should trap screen-reader focus to itself — and it is **NOT** a React Native `<Modal>`.

A React Native `<Modal>` creates a new native window that traps focus on **both** platforms automatically. An inline overlay (a sibling `View` inside the screen) does **not** — you must trap focus yourself, and the props that do so are platform-split.

## Smell patterns

- A `View`/overlay carries `accessibilityViewIsModal` (or you reach for it) to trap focus, with no Android counterpart on the behind-content.
- "It works in VoiceOver but on TalkBack you can still reach the buttons behind the sheet."
- A single boolean drives the a11y hide for a screen that has **two** overlays that can stack.

## Why

`accessibilityViewIsModal` is **iOS-only** and **sibling-scoped** — it tells VoiceOver to ignore the receiver's *sibling* subtrees. It is a **no-op on Android**. So an inline overlay relying on it alone leaves the behind-content TalkBack-navigable on Android.

The Android equivalent is `importantForAccessibility="no-hide-descendants"` applied to the **behind-content** (the siblings to hide — NOT the overlay itself), which is itself a **no-op on iOS** (React Native ignores `importantForAccessibility` there). The two props are platform-split: you need both, and because each is inert on the other platform, neither regresses the other. `"auto"` is the restore value (behaves identically to the prop being absent).

**This is NOT the visually-hidden-surface pattern** (`docs/rules/accessibility.md` rule 17 / `accessibilityElementsHidden` + `importantForAccessibility`). That rule is for a surface that is *visually hidden but still mounted*. A modal overlay is *visible*; its behind-content is hidden from assistive tech because of **focus-trapping (modal semantics, rule 3)**, not because it is invisible. Do **not** add `accessibilityElementsHidden` here to "complete the pair" — on iOS the overlay's `accessibilityViewIsModal` already hides the siblings, so it is redundant and touches the iOS path you otherwise leave untouched.

Two implementation rules that are easy to get wrong:

- **Apply per-element, not via a wrapper.** Wrapping the behind-content in one container to tag it re-scopes the stacking context of any absolutely-positioned `zIndex` children and can flip their paint order relative to the overlay. Tagging each behind-content `View` with `importantForAccessibility` changes only the a11y tree — zero layout/z-order/touch impact.
- **Nested/superseding overlays need per-surface values, not one boolean.** When overlay B can appear over overlay A (and A is itself an overlay), the *static* behind-content hides when **either** is active, but A must stay **reachable** when it is the active, un-superseded overlay. Put that decision in one **pure function over the overlays' visibility booleans** and unit-test the truth table — otherwise the supersession logic lives untested inline in JSX and a later "simplify to one value" silently regresses it.

Decorative/animation surfaces (SVG reticles, flash overlays, confetti) and a camera preview marked `accessible={false}` expose no focusable node, so they don't need tagging — but **verify** that per element rather than assuming.

## Examples

One pure helper captures the whole supersession decision and is the unit the test pins down:

```ts
// ScanScreenConfirmOverlay-utils.ts
export type ScanOverlayA11y = {
  staticUI: "auto" | "no-hide-descendants"; // top bar, controls, etc.
  productChip: "auto" | "no-hide-descendants"; // itself an overlay
};

export function getScanOverlayA11y(
  confirmCardVisible: boolean,
  productChipVisible: boolean,
): ScanOverlayA11y {
  const hide = (b: boolean) => (b ? "no-hide-descendants" : "auto");
  return {
    // static UI sits behind BOTH overlays
    staticUI: hide(confirmCardVisible || productChipVisible),
    // the chip hides only when the confirm card supersedes it
    productChip: hide(confirmCardVisible),
  };
}
```

```tsx
// ScanScreen.tsx — apply per-element (no wrapper)
const overlayA11y = getScanOverlayA11y(!!confirmCard, productChipVisible);

<View style={styles.controls} importantForAccessibility={overlayA11y.staticUI}>…</View>
<ProductChip importantForAccessibility={overlayA11y.productChip} … />
```

`ProductChip` had no passthrough, so an optional `importantForAccessibility?: ViewProps["importantForAccessibility"]` prop was added and forwarded to its root `Animated.View` (which already carried the iOS `accessibilityViewIsModal`).

## Exceptions

- **React Native `<Modal>`** already traps focus on both platforms (it's a new window on Android). You do **not** need this. The only a11y hide you may need inside a `<Modal>` is on a focusable backdrop `Pressable` — see `DeleteAccountModal.tsx` (it pairs `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` on the backdrop).
- If the overlay surface is genuinely *visually hidden but mounted* (collapsed/expanded swap), you want rule 17's pattern, not this one.

## Related Files

- `client/screens/ScanScreen.tsx` — per-element application of the two-value result
- `client/screens/ScanScreenConfirmOverlay-utils.ts` — `getScanOverlayA11y` (the tested supersession helper)
- `client/camera/components/ProductChip.tsx` — `importantForAccessibility` passthrough on an overlay component
- `client/components/DeleteAccountModal.tsx` — the RN `<Modal>` + backdrop-hide variant
- `docs/rules/accessibility.md` — rule 3 (modal root must be `accessibilityViewIsModal`) and rule 17 (visual-hide pattern)

## See Also

- [a11y-hide-visually-hidden-surfaces](a11y-hide-visually-hidden-surfaces-2026-06-10.md) — the distinct rule-17 pattern for surfaces that are visually hidden but still mounted
