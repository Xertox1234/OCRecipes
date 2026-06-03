---
title: "Fix ScanScreen nested accessibilityViewIsModal on root View and confirmCard overlay"
status: backlog
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
