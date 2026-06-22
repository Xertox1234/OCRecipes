---
title: "Add Android/TalkBack focus trap to in-screen overlays (accessibilityViewIsModal is iOS-only)"
status: backlog
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Add Android/TalkBack focus trap to in-screen overlays (accessibilityViewIsModal is iOS-only)

## Summary

`accessibilityViewIsModal` traps screen-reader focus on iOS only — it is a no-op on Android. In-screen overlays that rely on it alone do not trap TalkBack focus, so on Android the content _behind_ the overlay stays navigable while the overlay is up. Apply the Android hide pattern so behind-overlay content is removed from the TalkBack tree while an overlay is visible.

## Background

Surfaced during the 2026-06-22 re-investigation of the (now-closed, false-positive) todo `P3-2026-06-03-scan-screen-nested-accessibility-view-is-modal.md`. The iOS nested-modal concern there was a false positive — but the investigation found a real, _separate_ gap: the project relies on `accessibilityViewIsModal` (iOS-only) for overlay focus trapping almost everywhere.

The established Android precedent already exists in the codebase: `client/components/DeleteAccountModal.tsx:121-122` applies `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` to the content that should be hidden behind the modal. Every other overlay/modal relies on `accessibilityViewIsModal` alone, so this is a pre-existing project-wide limitation, not a single-screen regression.

Concrete instance found: `client/screens/ScanScreen.tsx` — when the `confirmCard` overlay (`:683`) is visible, the camera UI behind it (`CameraView` `:507`, the top overlay/close button `:534`, the controls/shutter `:552`, `ProductChip` `:597`) remains TalkBack-reachable on Android. `client/camera/components/ProductChip.tsx:97` has the same iOS-only assumption.

## Acceptance Criteria

- [ ] When the `confirmCard` overlay in `client/screens/ScanScreen.tsx` is visible, the behind-overlay camera UI is removed from the Android TalkBack tree (`accessibilityElementsHidden={true}` + `importantForAccessibility="no-hide-descendants"`), and restored when it is dismissed — both directions
- [ ] The fix is gated to Android (or applied in a way that is a no-op on iOS) so the existing, correct iOS `accessibilityViewIsModal` behavior is unchanged
- [ ] `docs/rules/accessibility.md:3` is not violated — the root `accessibilityViewIsModal={true}` stays unconditional
- [ ] Audit the other in-screen overlays for the same gap and either fix them or note them as out of scope in the todo's Updates; reference the `DeleteAccountModal` precedent
- [ ] No double-trap or focus-loss regression on iOS VoiceOver (verify the iOS path is untouched)

## Implementation Notes

- Reference pattern: `client/components/DeleteAccountModal.tsx:121-122` — the hide props go on the content that should be hidden _behind_ the overlay, NOT on the overlay itself.
- `client/screens/ScanScreen.tsx` is a flat tree (camera, overlays, controls, `ProductChip`, `confirmCard` are all direct children of the root `View`). The likely approach is to wrap the behind-overlay content in a container `View` and conditionally apply the hide props when `confirmCard` is truthy, rather than threading the props onto each sibling individually.
- Keep the change surgical and Android-scoped; do not alter the iOS `accessibilityViewIsModal` flags on the root (`:506`) or the `confirmCard` (`:683`) — those are correct as-is.
- Consider whether a shared helper/wrapper is warranted given this is project-wide, but do not over-abstract for a single screen; prefer the minimal per-screen fix and a follow-up audit.

## Dependencies

- None

## Risks

- TalkBack edge cases when the overlay animates in/out (`ProductChip` retains a mounted slide-out spring, `ProductChip.tsx:78-80`) — ensure hide/restore tracks actual visibility, not just mount state
- Cross-platform: must be a no-op on iOS; verify VoiceOver behavior is unchanged

## Updates

### 2026-06-22

- Initial creation. Split out from the closed false-positive todo `P3-2026-06-03-scan-screen-nested-accessibility-view-is-modal.md` (see its 2026-06-22 resolution note). Filed at user request to keep the real Android finding from getting lost.
