---
title: "VoiceOver: a spent recovery code's announcement is cut off by an error announced in the same render"
status: backlog
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, accessibility, mobile]
github_issue:
---

# VoiceOver: recovery-code announcement collides with an error

## Summary

When a request spends a recovery code AND fails (e.g. new password too short), the screen mounts `ReplacementCodeCard` and `InlineError` in one commit. Both announce on mount, and VoiceOver does not queue — the error cuts off "Your recovery code was used. Here's a new one: …".

## Background

Found by the mobile re-review of the change-password app PR (2026-10-11), measured with an announce spy: two announcements in one commit (`count= 2 collision= YES`), control one. Deferred because it is not specific to ChangePasswordScreen: `ChangeEmailModal` renders the same card next to an `InlineError`, and `TwoStepCodeScreen`, `TwoStepSetupScreen`, `PasswordConfirmModal` also use the card — the fix belongs in the shared components. The code itself is never lost: the card stays on screen until "I've saved it".

## Acceptance Criteria

- [ ] When a replacement code and an error arrive together, VoiceOver gets ONE announcement carrying both (code first).
- [ ] A regression test spies on `AccessibilityInfo.announceForAccessibility` and asserts `toHaveBeenCalledTimes(1)` for that case.
- [ ] Every `ReplacementCodeCard` caller that can show an error alongside it is covered.

## Implementation Notes

- `client/components/ReplacementCodeCard.tsx` (mount-effect announce), `client/components/InlineError.tsx` (iOS announce effect).
- Callers: `client/screens/ChangePasswordScreen.tsx`, `client/components/ChangeEmailModal.tsx`, `client/components/PasswordConfirmModal.tsx`, `client/screens/TwoStepCodeScreen.tsx`, `client/screens/TwoStepSetupScreen.tsx`.
- Option: an `announce={false}` prop on the card plus a combined announcement from the caller; or have the card announce after a short delay so it queues after the error.
