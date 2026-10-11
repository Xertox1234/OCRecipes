---
title: "Email change should notify the previous address"
status: backlog
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Email change should notify the previous address

## Summary

A completed email change sends nothing to the old address, so the owner never learns their recovery address moved.

## Background

Auth audit 2026-10-10 L4. Password reset sends `sendPasswordChangedNotice`; email change has no equivalent, though moving the email hands over account recovery.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [ ] A security-bucket notice goes to the previous address when the change is staged and when it commits
- [ ] Email + route tests cover both sends and HTML escaping

## Implementation Notes

- `server/storage/users.ts:338-356` (applyEmailVerification branch 2)
- `server/routes/auth.ts:734-771`
- `server/services/email.ts` (new sender; use the account-security bucket)

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/services/email.ts`, `server/routes/auth.ts`, `server/services/__tests__/email.test.ts`, `server/routes/__tests__/auth*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)
