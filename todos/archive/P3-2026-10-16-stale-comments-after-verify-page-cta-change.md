---
title: "Two stale comments after the verify-email page CTA moved to the bare scheme"
status: done
priority: low
created: 2026-10-16
updated: 2026-10-16
assignee:
labels: [deferred, docs]
github_issue:
---

# Two stale comments after the verify-email page CTA moved to the bare scheme

## Summary

Since #1460, the verify-email browser page's "Open OCRecipes" button uses `ocrecipes://` in every state. Two comments still describe the old per-state `ocrecipes://login` link and need correcting.

## Background

The security-auditor flagged these while reviewing #1460. They are outside that PR's reviewed scope, so they were filed rather than fixed and re-reviewed (one review pass per PR). These are comment-only changes with no behaviour change.

## Acceptance Criteria

- [x] `client/navigation/linking.ts`: the comment above `Login: "login"` (~L264) no longer says it drives the verify-email page's success button. The `login` path itself stays, since it is still a valid deep link.
- [x] `server/lib/verify-email-page.ts`: the header (~L11-12) no longer says "state-keyed `ocrecipes://` deep links", because there is now one fixed `ocrecipes://` link. Keep the zero-reflection claim.

## Implementation Notes

Edit the two comments only. No tests change.

## Scope Contract

- **Mechanisms to use:** comment edits only, nothing new.
- **Files in scope:** `client/navigation/linking.ts`, `server/lib/verify-email-page.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- #1460 (merged)

## Risks

- None (comments only)

## Updates

### 2026-10-16

- Initial creation (from the #1460 security review)

- Done: both comments corrected (comment-only, no behaviour change).
