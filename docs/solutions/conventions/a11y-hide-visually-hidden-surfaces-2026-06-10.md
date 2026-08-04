---
title: Visually-hidden-but-mounted surfaces must be hidden from the a11y tree (both directions)
track: knowledge
category: conventions
module: client
tags: [accessibility, pointerEvents, reduced-motion, collapsed-header, voiceover, talkback, importantForAccessibility, decorative]
created: '2026-06-10'
last_updated: '2026-08-04'
source: '2026-06-10 full audit (H4, M13 + Phase 6 inverse finding); extended 2026-08-04 from PR #751 (no vs no-hide-descendants)'
---

## Rule

`pointerEvents="none"`, `opacity: 0`, and `height: 0` + `overflow: hidden` do
NOT remove a mounted view from the accessibility tree. Any surface that is
visually hidden while mounted must ALSO set:

```tsx
accessibilityElementsHidden={hidden}              // iOS
importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}  // Android
```

(`aria-hidden={hidden}` is the cross-platform equivalent and maps to both;
prefer the explicit pair above for new code — it is the pattern the
swap-surface screens use. Don't mix idioms within one component.)

### `"no"` is NOT a weaker `"no-hide-descendants"` — it is a different scope (added 2026-08-04)

`importantForAccessibility="no"` excludes **only the view it is set on**. Its
subtree stays in the Android accessibility tree. `"no-hide-descendants"` is the
only value that excludes the subtree. A child's own `accessible={false}` does
**not** save you — it did not, in the case below.

This extends the rule beyond *visually hidden* surfaces to any **visible but
decorative** container whose children must not be announced:

```tsx
// WRONG — the Feather glyph child stays in the a11y tree and TalkBack can
// announce a raw private-use codepoint (U+F205).
<View accessible={false} importantForAccessibility="no">
  <Feather name="image" accessible={false} />
</View>

// RIGHT
<View
  accessible={false}
  importantForAccessibility="no-hide-descendants"  // Android: subtree
  accessibilityElementsHidden                      // iOS: ignores the above entirely
>
```

Shipped as a real defect in `client/components/FallbackImage.tsx` (PR #751) and
caught in review. **Verify it with `uiautomator dump --compressed`** — the
default dump lists nodes regardless of accessibility importance and shows the
child in both the broken and fixed states, so it cannot tell them apart. See the
uiautomator solution linked below.

**Both directions:** when two surfaces swap (expanded header ⇄ collapsed bar),
hide whichever is currently invisible — fixing only the collapsed bar leaves
TalkBack focusable content behind it when the bar takes over.

**Reduced motion:** if an animation style forces a surface permanently
invisible under `reducedMotion`, every related JS-side flag (visibility state,
`pointerEvents`) must agree — and must RESYNC when `reducedMotion` toggles at
runtime, or the state freezes at its pre-toggle value (invisible-but-tappable,
or visible-but-dead).

## Why

H4: with Reduce Motion on, the Home/Profile collapsed bar was opacity-0 forever
but the scroll handler still flipped `pointerEvents` to `auto` — an invisible
full-width Pressable intercepted taps. M13: collapsed Home sections kept their
children screen-reader-focusable. Phase 6 found the inverse gap on the expanded
headers. This trio is one rule applied consistently.

## Examples

- `client/hooks/useScrollLinkedHeader.ts` (reducedMotion guard + resync effect)
- `client/screens/HomeScreen.tsx` / `ProfileScreen.tsx` (bar AND header hidden)
- `client/components/home/CollapsibleSection.tsx` (`aria-hidden` on clipContainer)
- Compliant reference predating the audit: `QuickLogDrawer` body gating.

## Related Files

- `docs/rules/accessibility.md`

## See Also

- docs/audits/2026-06-10-full.md (H4, M13, Phase 6)
- [adb + uiautomator on-device Android verification](../best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md) — how to prove a subtree is actually excluded: `--compressed`, not the default dump
- [Remove an inert prop from the public type](../design-patterns/remove-an-inert-prop-from-the-public-type-2026-08-04.md) — the companion fix when the a11y prop never worked in the first place
