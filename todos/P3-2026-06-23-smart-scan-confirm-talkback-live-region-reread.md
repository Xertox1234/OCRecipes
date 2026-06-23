<!-- Filename: P3-2026-06-23-smart-scan-confirm-talkback-live-region-reread.md  (P0=critical … P3=low) -->

---

title: "Verify TalkBack doesn't re-read the whole smart-scan chip when the confirm button swaps Text→ActivityIndicator"
status: backlog
priority: low
created: 2026-06-23
updated: 2026-06-23
assignee:
labels: [deferred, accessibility, rn-ui-ux]
github_issue:

---

# Smart-scan confirm: scope the Android live region so the busy swap doesn't re-read the chip

## Summary

On Android/TalkBack, the smart-scan chip container carries
`accessibilityLiveRegion="polite"`, which wraps the "Looks right →" confirm
button. When the menu-confirm pending state flips, that button's child swaps
from `<Text>Looks right →</Text>` to an `<ActivityIndicator>`. A polite live
region announces changes anywhere in its subtree, so the swap **may** cause
TalkBack to re-read the entire chip subtree instead of just signalling "busy".
This needs verification on a physical TalkBack device, and — only if it
re-reads — a fix to scope the live cue to the button.

## Background

Surfaced as a non-blocking **SUGGESTION** from the `accessibility-specialist`
review of the smart-scan menu-confirm processing-affordance todo (archived
`todos/archive/P3-2026-06-23-smart-scan-menu-confirm-processing-affordance.md`,
implemented on branch `todo/P3-2026-06-23-smart-scan-menu-confirm-processing-affordance`,
impl commit `0d556646`). That todo added a visible pending state (spinner +
disable + dim) to the menu confirm button and an iOS-gated
`announceForAccessibility("Analyzing photo…")` for VoiceOver. The Android side
relies on the pre-existing container `accessibilityLiveRegion="polite"`.

The open question is whether the polite region, which exists to announce the
chip's primary content, over-announces when a _descendant_ (the button label)
mutates. It's conditional and hardware-gated, so it was deferred rather than
fixed speculatively — over-scoping `accessibilityLiveRegion="none"` could
suppress legitimate announcements.

## Acceptance Criteria

- [ ] On a physical Android device with TalkBack on, trigger a smart-scan menu
      confirm and observe whether toggling the pending state re-reads the whole
      chip subtree or only signals the busy/disabled change.
- [ ] If it re-reads: scope the live cue so only the intended change is
      announced (e.g. set `accessibilityLiveRegion="none"` on the swapping
      button subtree, or move the polite region to the specific element that
      should announce), without regressing the chip's existing primary-content
      announcement.
- [ ] If it does NOT re-read: close this todo as verified-no-op with a dated
      note in Updates (no code change).
- [ ] iOS path is unchanged (the iOS announce is handled separately via the
      gated `announceForAccessibility` edge — do not touch it).

## Implementation Notes

- Container live region: `client/camera/components/ProductChip.tsx:136`
  (`accessibilityLiveRegion="polite"` on the chip container).
- The Text↔ActivityIndicator swap: `client/camera/components/ProductChip.tsx`
  smart-photo confirm button (~lines 254–280) — the
  `{isSmartConfirming ? <ActivityIndicator …/> : <Text>Looks right →</Text>}`
  ternary, with `accessibilityState={{ busy, disabled }}` already set on the
  button.
- The flag originates in `client/screens/ScanScreen.tsx`
  (`isSmartConfirming` useState ~line 114, passed to `<ProductChip>` ~line 624).
- Cross-platform requirement: the fix (if any) is Android-only behaviour, but
  verify it doesn't change the iOS announce path. See
  `docs/rules/accessibility.md` (the busy-state announce rule was codified
  alongside the originating todo).
- Verification is **physical-device only** — the iOS Simulator has no screen
  reader for this, and the `verify-ui` skill is iOS-Simulator-scoped, so it
  can't cover the TalkBack behaviour.

## Dependencies

- Builds on the merged smart-scan menu-confirm affordance change (branch
  `todo/P3-2026-06-23-smart-scan-menu-confirm-processing-affordance`). Merge
  that branch first so the live-region + spinner code is on `main`.
- Requires a physical Android device with TalkBack (no automated path).

## Risks

- Low. Worst case is a minor over- or under-announcement on Android TalkBack.
  Over-scoping `accessibilityLiveRegion="none"` risks suppressing a legitimate
  announcement — verify on-device before changing, and keep the change scoped to
  the busy-swap element.

## Updates

### 2026-06-23

- Filed from the deferred `accessibility-specialist` SUGGESTION surfaced during
  the `/todo` run that implemented the smart-scan menu-confirm processing
  affordance. Hardware-gated and conditional — deferred rather than fixed
  speculatively.
