---
title: Android container accessibilityLiveRegion="polite" re-reads the WHOLE subtree on any descendant change — and is the sole Android announcer
track: knowledge
category: conventions
module: camera
tags: [accessibility, talkback, accessibilityLiveRegion, react-native, android]
symptoms: ['TalkBack re-reads an entire card/chip when only a small part changed (a spinner swap, a busy state, one updated value)', A loading/pending toggle inside a card makes the screen reader re-announce the card's full text instead of just 'busy', Removing/moving a container live region to fix the over-announce silently makes some state transitions stop announcing on Android]
applies_to: [client/**/*.tsx]
created: '2026-06-23'
---

# Android container accessibilityLiveRegion="polite" re-reads the WHOLE subtree on any descendant change — and is the sole Android announcer

## Rule

On Android/TalkBack, `accessibilityLiveRegion="polite"` (or `"assertive"`) on a
**container** announces the container's **entire** subtree on **any** descendant
content OR state change — not just the part that changed. A small mutation inside
the region (a `Text↔ActivityIndicator` spinner swap, an
`accessibilityState={{ busy, disabled }}` flip, one updated label) makes TalkBack
re-speak the whole region.

So: do **not** wrap a frequently-mutating child (a loading toggle, a live value,
a swapping action button) inside a container live region and expect TalkBack to
announce "just the change." It will re-read everything. Scope the live region to
only the element(s) that should announce, or drive announcements explicitly with
`AccessibilityInfo.announceForAccessibility`.

**And before you remove or move that container live region:** it is almost always
the **only** Android announcer for the whole component. iOS uses explicit
`announceForAccessibility` (often gated to a first-appearance edge), but Android
typically has nothing else — so naively deleting the live region or narrowing it
to a sub-wrapper **silently mutes** every state/variant transition that doesn't
touch the narrowed element. Map the live region's full blast radius (every state
the component renders) before changing it.

## Smell patterns

- A container with `accessibilityLiveRegion` that also wraps a button whose child
  swaps `Text ↔ ActivityIndicator` on a pending flag.
- `accessibilityState={{ busy: true }}` set on a control **inside** a polite
  container (the state change itself triggers the whole-subtree re-read).
- A fix PR that "scopes the live cue" by setting `accessibilityLiveRegion="none"`
  on the swapping child — this does **not** work: the *container* is the live
  region and re-reads on the child's change regardless of the child's setting.

## Why

The announcement is driven by the **container** node (the one carrying the live
region), not the changed child. When any descendant mutates, Android fires a
`TYPE_WINDOW_CONTENT_CHANGED` (`CONTENT_CHANGE_TYPE_SUBTREE`) event sourced from
the container; TalkBack composes the container's full accessible text and speaks
it. Verified empirically (TalkBack 16, API 36) on the smart-scan `ProductChip`:
toggling the confirm button's busy state produced
`ttsOutput= {Product. Restaurant menu detected. High confidence. Confirm smart photo analysis, busy. Button}`,
queued to `SPEAK`, with `nodeLiveRegion=1` on the container — both toggle
directions. Setting `none` on the button child would not help because the
container is the announcer.

It is the sole Android announcer because the paired iOS
`announceForAccessibility` is typically gated (e.g. `prevVariant === null &&
Platform.OS === "ios"`), so non-first-appearance transitions rely entirely on the
Android live region — remove it and those transitions go silent on Android while
iOS was already silent for them.

## Examples

```tsx
// SMELL: polite container wraps a button whose child swaps on a pending flag.
// TalkBack re-reads the whole chip every time `busy` toggles.
<View accessibilityLiveRegion="polite">
  <Text>{title}</Text>
  <TouchableOpacity accessibilityLabel="Confirm" accessibilityState={{ busy }}>
    {busy ? <ActivityIndicator /> : <Text>Looks right →</Text>}
  </TouchableOpacity>
</View>

// BETTER (verify on-device): drive announcements explicitly, no container live
// region — fire announceForAccessibility cross-platform for each meaningful
// transition AND for the busy edge ("Analyzing…"), so the busy change speaks just
// the intended cue instead of the whole subtree. This trades the implicit
// (over-announcing) live region for a deterministic, identical cross-platform model.
```

## Exceptions

- A live region on a **leaf** node (a single status `Text` whose text is the only
  thing that changes) is fine and idiomatic — the whole-subtree behavior is
  harmless when the subtree *is* the one thing.
- Error banners legitimately use `accessibilityLiveRegion="assertive"` on the
  error text node (a leaf), per `docs/rules/accessibility.md`.
- This is **Android-only** — `accessibilityLiveRegion` is a no-op on iOS, which is
  exactly why removing it without an Android-side explicit announce regresses
  Android specifically.

## Related Files

- `client/camera/components/ProductChip.tsx` — the container live region (~line
  130) + the gated iOS appear-announce (~line 87); the confirm-button busy swap
  (~lines 258-276) that triggers the over-announce.
- `docs/rules/accessibility.md` — the `accessibilityLiveRegion` + `accessibilityState busy`
  rules (which cover the busy/announce gating but did NOT previously warn about
  the whole-subtree over-announce — this convention nuances them).

## See Also

- [verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md) — how this was confirmed without a physical device
