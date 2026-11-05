---
title: "E2E: 'View item detail from history' flakes on iOS when the login screen never appears"
status: backlog
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee:
labels: [deferred, e2e]
github_issue:
---

# E2E: 'View item detail from history' flakes on iOS when the login screen never appears

## Summary

The iOS Maestro flow `e2e/flows/home/view-item-detail.yaml` sometimes fails at its login step because the login screen never shows. When it fails on both the first try and the retry, the nightly E2E job goes red.

## Background

Found while diagnosing the nightly E2E iOS red (fixed for the receipt flow in #1753). In run 41960367024 (2026-11-05, manual dispatch on `e693150`), "Home - View item detail from history" failed on both attempts at the login screen assertion. It also failed once on 2026-11-02. In the #1753 validation run (42003477050) it passed on the first try (2m 5s). It was deferred because it is a separate flake from the receipt-upload one.

Lead, not yet verified: the flow runs `helpers/launch-app.yaml` and then `helpers/login.yaml` directly. Unlike `e2e/flows/plan/receipt-upload.yaml`, it never runs `helpers/ensure-logged-out.yaml` first. If an earlier flow, or its own first attempt, leaves the shared account signed in, the app opens past the login screen and `login.yaml`'s wait fails.

## Acceptance Criteria

- [ ] The failing attempts' `e2e/maestro-output/` hierarchy dumps (logs-ios artifact of run 41960367024) show which screen was up when the login wait failed, and that cause is stated in the PR.
- [ ] If the screen was a signed-in one, the flow runs `helpers/ensure-logged-out.yaml` before `helpers/login.yaml`, as receipt-upload.yaml does.
- [ ] A workflow_dispatch run of E2E Regression passes this flow on iOS.

## Implementation Notes

- Debug artifacts: `gh run download 41960367024 -n logs-ios`. The flow's dumps are under `e2e/maestro-output/Home - View item detail from history*`.
- `scripts/ci/e2e-with-flow-retry.sh` re-runs a failed flow once on its own. A cause that persists into the retry (such as a session left signed in) fits both attempts failing.

## Scope Contract

- **Mechanisms to use:** the existing `helpers/ensure-logged-out.yaml`. Nothing new.
- **Files in scope:** `e2e/flows/home/view-item-detail.yaml`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- The lead may be wrong (for example, a slow app launch instead). Read the dumps before changing the flow.

## Updates

### 2026-11-05

- Initial creation (deferred from the nightly E2E diagnosis; receipt flow fixed in #1753)
