---
title: A React Native <Modal> presents in its own native window — accessibilityViewIsModal traps don't nest across it
track: knowledge
category: conventions
module: client
tags: [accessibility, react-native, modal, voiceover, talkback, focus-trap]
created: '2026-06-24'
---

# A React Native `<Modal>` presents in its own native window — `accessibilityViewIsModal` traps don't nest across it

## Rule

When you present a React Native `<Modal>` over a surface that already sets
`accessibilityViewIsModal` (a confirm overlay, a chip, the screen root), you do
**not** need to unmount or hide that underlying trap first for accessibility
reasons. The `<Modal>` renders in a **separate native window** and moves the
screen reader into it on present; two `accessibilityViewIsModal` views in
**different windows cannot conflict** — the nesting hazard is *intra-window*.

Do not over-sequence "unmount the underlying trap **before** presenting the
modal" and call it the a11y safeguard. Present the modal; the window separation
handles focus. If you also hide/reset the underlying surface, do it for a
**product/cleanliness** reason (e.g. not leaving a stale interactive control
behind the modal), and say *that* in the comment — not a focus-trap-nesting
justification that doesn't hold.

## Smell patterns

- A comment like `// unmount the chip BEFORE the modal presents to avoid nesting
  accessibilityViewIsModal` — the **ordering** is not what provides safety.
- Worrying that an overlay's `accessibilityViewIsModal` "lingers" during its
  exit animation while a `<Modal>` is already up (RN keeps an `Animated.View`
  mounted until the spring/timing completion callback fires) — harmless across
  the window boundary.
- Batched `setState`s (`dispatch(RESET)` + `setShowModal(true)`) that you assume
  must commit in a precise order to keep the a11y tree clean.

## Why

- **iOS:** `accessibilityViewIsModal` confines VoiceOver to siblings within the
  *same* view hierarchy/window. A presented `<Modal>` is a separate
  window/view-controller; VoiceOver fires a screen-changed notification and moves
  into it. The underlying window (with its lingering trap) is occluded and
  unreachable, so the two flags never interact.
- **Android:** `accessibilityViewIsModal` is effectively a no-op; a `<Modal>`'s
  new window traps TalkBack regardless of what the occluded window contains.
- Even within a single window, multiple `accessibilityViewIsModal` views already
  coexist in this app without breaking (e.g. a screen-root `View` and a child
  chip both carry it), so the practical hazard is narrower than "any two flags
  mounted at once."

## Examples

`client/screens/ScanScreen.tsx` smart-confirm **blocked** path: the premium gate
does `dispatch({ type: "RESET" })` then `setShowUpgradeModal(true)`. RESET-on-block
(rather than on modal close) is chosen so a stale **interactive** confirm chip is
not left in the a11y tree behind the modal — a cleanliness reason. The chip's
`Animated.View` (which carries `accessibilityViewIsModal`) actually lingers
through its spring-out *while* `UpgradeModal` (a RN `<Modal>`) is presented, and
that overlap is harmless precisely because of the separate-window rule above.

The original comment on that branch claimed the chip "unmounts BEFORE the modal
presents — avoids nesting accessibilityViewIsModal." That was wrong on the
mechanism (the two `setState`s batch into one render; the chip lingers through
its animation) and was corrected to attribute the safety to the modal's own
native window.

## Exceptions

- **In-tree "modal-like" overlays are a different case.** A surface rendered as a
  plain `<View>` in the *same* hierarchy (an absolutely-positioned overlay, a
  bottom sheet drawn in-tree) does **not** get its own window. Two such
  `accessibilityViewIsModal` siblings *can* fight, and a visually-hidden-but-
  mounted one *must* be explicitly removed from the tree
  (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`).
  The deciding factor is the **window boundary**, not visual stacking. See
  [a11y-hide-visually-hidden-surfaces](a11y-hide-visually-hidden-surfaces-2026-06-10.md).
- You still hide/reset an underlying **interactive** surface for non-a11y reasons
  (don't leave a stale tappable control behind the modal).

## Related Files

- `client/screens/ScanScreen.tsx` — smart-confirm `blocked` → `UpgradeModal`
- `client/components/UpgradeModal.tsx` — the RN `<Modal>` (separate window)
- `client/camera/components/ProductChip.tsx` — `accessibilityViewIsModal` + the
  spring-out that keeps the view mounted past the variant change
- `client/screens/ScanScreenConfirmOverlay-utils.ts` — `getScanOverlayA11y`, the
  **in-tree** overlay case where explicit hiding *is* required

## See Also

- [a11y-hide-visually-hidden-surfaces](a11y-hide-visually-hidden-surfaces-2026-06-10.md) — the in-tree counterpart: visually-hidden-but-mounted surfaces DO need explicit a11y hiding
