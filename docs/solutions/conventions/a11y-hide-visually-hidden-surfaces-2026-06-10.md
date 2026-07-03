---
title: Visually-hidden-but-mounted surfaces must be hidden from the a11y tree (both directions)
track: knowledge
category: conventions
tags: [accessibility, pointerEvents, reduced-motion, collapsed-header, voiceover, talkback]
created: '2026-06-10'
source: '2026-06-10 full audit (H4, M13 + Phase 6 inverse finding)'
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
