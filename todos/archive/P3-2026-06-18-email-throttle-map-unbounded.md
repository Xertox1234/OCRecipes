---
title: "Bound the per-recipient email throttle Map (unbounded key set)"
status: done
priority: low
created: 2026-06-18
updated: 2026-06-18
assignee:
labels: [deferred, server, api]
github_issue:
---

# Bound the per-recipient email throttle Map

## Summary

`recipientSends` in `server/services/email.ts` is a module-level
`Map<string, number[]>` used for the per-recipient sliding-window send throttle.
It adds one key per unique recipient email for the lifetime of the process and
never evicts keys — only the per-key timestamp array is pruned. The key set
grows unbounded.

## Background

Added in the email-verification feature (Resend) as the per-recipient cap for
verification + signup-attempt emails (`MAX_PER_RECIPIENT = 5` per hour). Surfaced
by the advisor pass on the email-verification implementation
([[project_email_verification_plan]]).

The risk is latent, not current: process restarts (Railway deploys) bound the map
in practice, and each entry is tiny. It only matters under a long-running process
that sees a very large number of distinct recipient addresses (e.g. a sustained
enumeration/abuse attempt against `/resend-verification`). Fine for launch.

## Acceptance Criteria

- [ ] `recipientSends` evicts entries whose entire window has expired (no recent
      sends) so the key set cannot grow without bound.
- [ ] The per-recipient cap (5/hour) behavior is unchanged for active recipients.
- [ ] A test asserts an expired-window key is removed (or a size bound holds)
      after a large number of distinct recipients.

## Implementation Notes

- `server/services/email.ts` — `canSendTo()` already filters expired timestamps;
  extend it to `recipientSends.delete(key)` when the filtered array is empty, or
  add a periodic sweep. Simplest: in `canSendTo`, after filtering, if
  `times.length === 0` delete the key instead of setting an empty array.
- Alternatively swap to a small LRU/TTL cache if one is already a dependency.
- This is a single-process in-memory throttle; a multi-instance deployment would
  need a shared store (Redis) — out of scope here (see deferred-architecture
  notes; not triggered yet).

## Dependencies

- Builds on the email-verification feature (`server/services/email.ts`).

## Risks

- None of note — pure hardening of an in-memory structure; no behavior change for
  active recipients.
