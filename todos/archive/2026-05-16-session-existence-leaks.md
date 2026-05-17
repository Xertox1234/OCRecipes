---
title: "Normalize session ownership misses to not found"
status: done
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, security, api]
github_issue:
---

# Normalize Session Ownership Misses to Not Found

## Summary

Audit finding L1 found a few random session ownership checks return `403` when a session exists for another user, while missing sessions return `404`. Normalize these paths to hide existence.

## Background

The affected session IDs are random and low-exploitability, but the project IDOR convention is to avoid distinguishing missing resources from resources owned by another user.

## Acceptance Criteria

- [x] Return `404` for missing or cross-user photo analysis sessions.
- [x] Return `404` for missing or cross-user label/verification sessions.
- [x] Keep response bodies consistent with existing not-found behavior.
- [x] Add route tests for another-user session IDs where practical.

## Implementation Notes

Relevant files:

- `server/routes/photos.ts`
- `server/routes/verification.ts`
- Route tests for photo/verification session flows, if present

This is lower priority because session IDs are random, not sequential database IDs.

## Dependencies

- None known.

## Risks

- Tests may currently assert `403`; update them to match the hidden-existence convention.

## Updates

### 2026-05-16

- Created from broad-sweep audit finding L1.
