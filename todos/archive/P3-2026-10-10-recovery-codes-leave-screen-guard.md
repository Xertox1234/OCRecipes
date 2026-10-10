---
title: "Guard against leaving the 'save recovery codes' step of two-step setup"
status: done
priority: low
created: 2026-10-10
updated: 2026-10-10
assignee:
labels: [deferred, react-native]
github_issue:
---

# Guard against leaving the 'save recovery codes' step of two-step setup

## Summary

On the two-step setup screen, the user can swipe back or tap the header back button while their new recovery codes are on screen, before saving them. Those codes are then gone, and a lost phone means a manual reset.

## Background

Deferred from MFA part 1 (owner device test, 2026-10-10; noted in `todos/archive/P2-2026-09-26-add-second-factor-authentication.md`). A replacement recovery code shown on its own can already only be dismissed by saving it (#1358); the full code list on the `save-codes` step has no such guard.

## Acceptance Criteria

- [x] While `step === "save-codes"`, leaving the screen (back gesture, header back, Android hardware back) asks for confirmation first or is blocked until the codes are saved/copied.
- [x] Leaving the other steps behaves as it does today.
- [x] Tests for the step → guard decision (pure function in `TwoStepSetupScreen-utils.ts`).

## Implementation Notes

- `client/screens/TwoStepSetupScreen.tsx` — `Step` type at line 44, `setStep("save-codes")` paths at lines 133 and after `confirmTwoStep`.
- React Navigation's `usePreventRemove` (native-stack) is the usual mechanism; use an in-app confirm, not a browser-style `Alert` loop.

## Scope Contract

- **Mechanisms to use:** `usePreventRemove` from `@react-navigation/native`.
- **Files in scope:** `client/screens/TwoStepSetupScreen.tsx`, `client/screens/TwoStepSetupScreen-utils.ts`, and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-10

- Initial creation (deferred from MFA part 1).
- Done: `shouldGuardLeave` in `TwoStepSetupScreen-utils.ts` + `usePreventRemove` with a Stay/Leave alert on the screen; utils and screen tests.
