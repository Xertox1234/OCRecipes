---
title: "disableMfa runs four deletes at once on one transaction client — pg@9 will refuse it"
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, database, auth]
github_issue:
---

# disableMfa runs four deletes at once on one transaction client — pg@9 will refuse it

## Summary

`disableMfa` (`server/storage/mfa.ts:343`) wraps four `tx.delete(...)` calls in `Promise.all`. A transaction uses one connection, so `pg` queues the four queries, and the code works today. But `pg` 8.21 prints a deprecation warning, and pg@9 removes the queueing. After that upgrade, turning two-step off (in the app and in the manual reset) would fail.

## Background

Seen on 2026-10-12 while running the manual reset (`scripts/mfa-reset.ts --commit`) on production. The reset succeeded, but printed:

```
DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.
```

A grep of `server/` for `Promise.all` followed by `tx.` found only this one site.

Deferred because it was out of scope: the session was recovering the owner's two-step after a key change (see P1-2026-10-11-mfa-key-change-fails-silently).

## Acceptance Criteria

- [ ] The four deletes in `disableMfa` run one after another (`await` each) inside the same transaction.
- [ ] Tests covering `disableMfa` still pass; nothing else changes.
- [ ] A fresh grep of `server/` for `Promise.all` over `tx.` calls finds no other site. If it does, fix those too.

## Implementation Notes

- Running the deletes one by one costs four round trips instead of one. That's fine for a rare action.

## Scope Contract

- **Mechanisms to use:** plain sequential `await`s — nothing new.
- **Files in scope:** `server/storage/mfa.ts` (plus any other `tx` + `Promise.all` site the grep finds).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- This is auth storage: implement it in a session, don't delegate it (AUTH IS HIGH-RISK).

## Updates

### 2026-10-12

- Initial creation
