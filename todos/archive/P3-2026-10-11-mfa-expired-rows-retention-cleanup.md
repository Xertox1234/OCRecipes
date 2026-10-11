---
title: "Retention job should purge expired 2FA challenges, trusted phones and pending secrets"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Retention job should purge expired 2FA challenges, trusted phones and pending secrets

## Summary

Spec §2 "Cleanup" asked `cleanup-retention.ts` to batch-delete expired mfa_challenges and trusted devices; it was never built.

## Background

Auth audit 2026-10-10 L14. Rows are only pruned per-user on the next insert, so inactive users' expired challenges, trusted-device rows and expired `pending_secret_enc` values accumulate. Not an access hole (every read is gated on expiry).

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [x] `server/scripts/cleanup-retention.ts` batch-deletes expired `mfa_challenges`, expired `mfa_trusted_devices`, and nulls expired `user_mfa.pending_secret_enc`/`pending_expires_at`
- [x] Bounded batches like the existing retention steps; covered by the existing retention test harness

## Implementation Notes

- `server/scripts/cleanup-retention.ts`, `server/storage/mfa.ts`
- Respect `RETENTION_CLEANUP_ENABLED` gating as the other steps do.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/scripts/cleanup-retention.ts`, `server/storage/mfa.ts`, `server/scripts/__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)

- Fixed: purgeExpiredMfaRows runs after the upgrade-pass sweep. Challenges and trusted phones go through the existing batched purgeDomain (no active-user exemption, 1 day past expiry); a batched UPDATE nulls pending secrets with the expiry re-checked in the outer WHERE, so a setup restarted mid-sweep keeps its fresh secret. Gated by RETENTION_CLEANUP_ENABLED like every step. server/storage/mfa.ts needed no change.
