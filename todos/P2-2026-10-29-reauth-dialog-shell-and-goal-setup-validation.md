---
title: "Share one dialog shell for the re-auth modals; move GoalSetup onto useFieldValidation"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, maintainability]
github_issue:
---

# Share one dialog shell for the re-auth modals; move GoalSetup onto useFieldValidation

## Summary

Two structural duplications grew since 2026-10-25: three password/confirm dialogs hand-roll the same dimmed card shell, and GoalSetupScreen re-implements the field-validation timing `useFieldValidation` already provides.

## Background

Audit findings M-mnt-1, M-mnt-2. (1) `ChangeEmailModal.tsx` (~215-300, styles 439-503), `DeleteAccountModal.tsx` (~207-330, ~423-502), `PasswordConfirmModal.tsx` (~100-200) share Modal + KAV + backdrop (hardcoded `rgba(0,0,0,0.55)`) + centered card + icon/title/message, and the first two share the second-factor branch and the `/Invalid credentials/i` remap — the third has already drifted. (2) `GoalSetupScreen.tsx` (~243-345) keeps seven useState strings plus a parallel error map; 1028 lines, +221 in this window. Auth-adjacent UI and visible behaviour, so it needs a device check.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] A `CenteredDialog` shell and a `mapReauthError(err)` helper (beside `client/lib/second-factor-utils.ts`) replace the three copies with no visible change
- [ ] GoalSetupScreen uses `useFieldValidation` per field and drops `checkFields`/`changeField`
- [ ] Existing tests for the three modals and GoalSetup pass; device check of each dialog

## Implementation Notes

Opportunity findings — bias to deletion. Keep each modal's fields and onConfirm local.

## Scope Contract

- **Files in scope:** `client/components/ChangeEmailModal.tsx`, `client/components/DeleteAccountModal.tsx`, `client/components/PasswordConfirmModal.tsx`, a new `client/components/CenteredDialog.tsx`, `client/lib/second-factor-utils.ts`, `client/screens/GoalSetupScreen.tsx` and tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
