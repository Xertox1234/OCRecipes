---
title: "Fix ScanScreen nested accessibilityViewIsModal on root View and confirmCard overlay"
status: blocked
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Fix ScanScreen nested accessibilityViewIsModal on root View and confirmCard overlay

## Summary

`ScanScreen` has `accessibilityViewIsModal={true}` on the root `View` AND the `confirmCard` overlay also has it — nested modal containers on the same screen create ambiguous VoiceOver focus trapping.

## Background

Deferred from 2026-06-03 full audit (L17). File: `client/screens/ScanScreen.tsx:494,672`. Only one element should have `accessibilityViewIsModal` at any given time.

## Acceptance Criteria

- [ ] Only the currently-active modal container has `accessibilityViewIsModal={true}` at any point
- [ ] When `confirmCard` is visible, root View loses the prop (or only `confirmCard` has it)
- [ ] When `confirmCard` is hidden, root View has the prop as appropriate
- [ ] VoiceOver focus does not get stuck

## Implementation Notes

Use conditional: `accessibilityViewIsModal={!confirmCardVisible}` on the root View, and `accessibilityViewIsModal={confirmCardVisible}` on the confirmCard. Alternatively, use state to toggle which container has the prop.

## Dependencies

- None

## Risks

- VoiceOver behavior edge cases when the card animates in/out; test with VoiceOver enabled

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L17)

### 2026-06-03 (automated executor)

- Blocked: the acceptance criteria require removing `accessibilityViewIsModal` from the root View when the confirm overlay is shown, but `docs/rules/accessibility.md` requires all `fullScreenModal`/`modal` screens to always have `accessibilityViewIsModal={true}` on the root container. The toggle was implemented, flagged CRITICAL by kimi-review, and reverted.
- Root cause of misdiagnosis: `accessibilityViewIsModal` is sibling-scoped, not screen-scoped. The confirmCard overlay is an inline child of root (not portal-rendered), so both having the prop concurrently governs different sibling-sets at different tree levels — this is correct and non-ambiguous. The documented ambiguity is only for portal-rendered modals (e.g. BottomSheetModal placed as a sibling outside the container).
- Original code is correct: root always-on prevents VoiceOver from reaching navigator-behind screens; overlay always-on (when visible) prevents VoiceOver from reaching the camera behind the card. The overlay unmounts when null, so there is no stuck-focus issue.
- Manual intervention needed: VoiceOver device verification (per the todo's own risk note) to confirm behavior is acceptable as-is, or a human decision to accept the rule violation.
