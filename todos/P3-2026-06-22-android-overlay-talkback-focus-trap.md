---
title: "Add Android/TalkBack focus trap to in-screen overlays (accessibilityViewIsModal is iOS-only)"
status: review
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

- [x] When the `confirmCard` overlay in `client/screens/ScanScreen.tsx` is visible, the behind-overlay camera UI is removed from the Android TalkBack tree (`importantForAccessibility="no-hide-descendants"`), and restored when it is dismissed — both directions. NOTE: `accessibilityElementsHidden` (the iOS lever) was deliberately NOT added — iOS is already handled by `accessibilityViewIsModal` (rule 3, sibling-scoped), so the iOS prop would be redundant and would touch the iOS path. Validated by code review + advisor.
- [x] The fix is gated to Android (or applied in a way that is a no-op on iOS) so the existing, correct iOS `accessibilityViewIsModal` behavior is unchanged — `importantForAccessibility` is a documented no-op on iOS
- [x] `docs/rules/accessibility.md:3` is not violated — the root `accessibilityViewIsModal={true}` stays unconditional (untouched)
- [x] Audit the other in-screen overlays for the same gap and either fix them or note them as out of scope in the todo's Updates; reference the `DeleteAccountModal` precedent — ProductChip (the same-screen overlay, the common barcode-scan path) IS handled; other-screen overlays noted out-of-scope in Updates
- [ ] On-device verification (TalkBack + VoiceOver) confirming both-directions hide/restore and no iOS regression — OUTSTANDING; requires a physical device, cannot be done from here. Verified by reasoning + unit test + two code reviews only.

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

### 2026-06-22 (implemented — status: review, pending device test)

Implemented in ScanScreen via a per-element approach (NOT a wrapper — a wrapper would have changed z-order between the `zIndex:10` controls and the confirm overlay).

- New pure helper `getBehindOverlayImportantForAccessibility(active)` in `client/screens/ScanScreenConfirmOverlay-utils.ts` → `"no-hide-descendants"` | `"auto"`, with unit tests in the co-located test file.
- `client/screens/ScanScreen.tsx`: applies `importantForAccessibility` to the behind-overlay surfaces. Two values:
  - static camera UI (`topOverlay`, `coachContainer`, `controls`, `scanCount`) is hidden when **either** overlay is active (`!!confirmCard || getProductChipVariant(scanPhase) !== null`).
  - `ProductChip` is hidden only when `confirmCard` **supersedes** it (`!!confirmCard`) — so it stays reachable when it is itself the active overlay (the common barcode-scan path).
- `client/camera/components/ProductChip.tsx`: added an optional `importantForAccessibility` prop forwarded to its root `Animated.View` (it had no passthrough; its own `accessibilityViewIsModal` is iOS-only).
- Decorative animations (ScanReticle/ScanSonarRing/ScanFlashOverlay/ConfettiCannon) and the `CameraView` preview were intentionally NOT tagged — verified (by the accessibility-specialist review) to expose no TalkBack-focusable node; `CameraView` is `accessible={false}` and its only text (the `CameraUnavailable` fallback) is unreachable while an overlay is up.

**AC #4 scoping:** ProductChip — the same-screen overlay with the identical iOS-only gap — IS fixed here (it's the more common path; on iOS its `accessibilityViewIsModal` already hid behind-content, so Android now reaches parity). Other screens' overlays remain **out of scope** for this todo: per the closed source todo's resolution note, only `DeleteAccountModal.tsx:121-122` uses an Android hide pattern and every other overlay relies on `accessibilityViewIsModal` alone — a project-wide sweep is a larger follow-up, not this increment.

**Outstanding:** on-device TalkBack + VoiceOver verification (the one unchecked AC). The logic is verified by reasoning + a unit test on the helper + two independent code reviews (code-reviewer, accessibility-specialist) + advisor adjudication, but not by a physical device. Left `status: review` rather than archived for that reason — archive after the device test passes.

### 2026-06-22 (post-review refactor)

Addressed a PR #428 self-review finding: the supersession logic (static-UI-hides-when-either vs ProductChip-hides-only-when-superseded) was only expressed inline in JSX and untested — a future "simplify to one value" could regress it silently. Refactored the single-value helper into `getScanOverlayA11y(confirmCardVisible, productChipVisible) → { staticUI, productChip }`, which captures the whole decision in one unit, and added a 4-row truth-table test. This also fixed the misleading `confirmCardVisible` param name on the old helper's static-UI call site. No behavior change.
