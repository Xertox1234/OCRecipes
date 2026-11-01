---
title: "Account deletion takes one lock per verified barcode, one round-trip each"
status: backlog
priority: low
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, server, data-integrity]
github_issue:
---

# Account deletion takes one lock per verified barcode, one round-trip each

## Summary

Since #1676, `deleteUser` takes a transaction advisory lock for every barcode the user has voted on, in sorted order, one `SELECT pg_advisory_xact_lock(...)` per barcode, and holds them all until commit. A user with thousands of verifications makes deletion slow (one round-trip per barcode) and can exhaust Postgres's shared lock table (`max_locks_per_transaction` × connections). The deletion then rolls back with "out of shared memory" and the account is not deleted.

## Background

Flagged by the #1676 executor as a deferred warning. The lock is needed so the barcode aggregates recomputed after deletion can't race `submitVerification`. The failure is safe (all-or-nothing), but account deletion must always succeed for privacy-law requests.

## Acceptance Criteria

- [ ] Locks are taken in one statement (e.g. `SELECT pg_advisory_xact_lock(hashtextextended(b, 0)) FROM unnest($1::text[]) b ORDER BY b`), not one round-trip per barcode
- [ ] Past a threshold (e.g. 1,000 barcodes), deletion still succeeds: either recompute in batches in follow-up transactions after the user row is gone, or fall back to one table-level lock
- [ ] A test deletes a user with more voted barcodes than the threshold

## Implementation Notes

- `server/storage/verification.ts:191` — `lockBarcodes`
- `server/storage/users.ts` — `deleteUser` (the votedBarcodes select → lock → delete → `recomputeAggregatesForBarcodes`)
- Keep the sorted order: it is what prevents deadlocks with `submitVerification`.

## Scope Contract

- **Mechanisms to use:** the existing advisory-lock key (`hashtextextended(barcode, 0)`) — nothing new
- **Files in scope:** `server/storage/verification.ts`, `server/storage/users.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- #1676 merged

## Risks

- A batched recompute after commit leaves a short window where aggregates still count the deleted votes; acceptable if bounded.

## Updates

### 2026-11-01

- Filed by the /todo run (deferred warning from #1676).
