---
title: "Network hardening leftovers: OFF User-Agent, idle-in-transaction timeout, feature flags in the env schema"
status: backlog
priority: low
created: 2026-11-03
updated: 2026-11-03
assignee:
labels: [deferred, server, reliability]
github_issue:
---

# Network hardening leftovers from the reliability audit

## Summary

Three small items from the 2026-10-30 reliability audit that never reached main: the Open Food Facts fetch sends no `User-Agent`, the Postgres pool has no `idle_in_transaction_session_timeout`, and feature flags are read from `process.env` directly, so a typo in a flag name silently turns the feature off.

## Background

Items N1, N2 and R13 of the audit. Draft PR #1624 implemented them but conflicts with main and was closed on 2026-11-03. Its other items (URL-import deadline, OFF outage → 503, R2 timeouts, pool connect/statement timeouts) landed separately via #1621, #1659 and #1629.

## Acceptance Criteria

- [ ] N1: the OFF fetch in `server/services/barcode-lookup.ts` sends an identifying `User-Agent` (app name, version, contact URL), as the OFF API asks
- [ ] N2: the pool in `server/db.ts` sets `idle_in_transaction_session_timeout` (60s) next to the existing `statement_timeout`, so a leaked transaction cannot hold locks forever
- [ ] R13: feature flags (e.g. `RECIPE_FINDER_ENABLED` in `server/services/recipe-finder/config.ts`) are declared in `server/lib/env.ts`'s schema, so an unknown or malformed value fails at boot
- [ ] A test per item

## Implementation Notes

- N2 must not break long-running maintenance scripts that hold a transaction open on purpose — check `scripts/` callers that use `pool`.
- Reference implementation on the closed PR #1624 branch `claude/reliability-server-network`.

## Scope Contract

- **Mechanisms to use:** the existing env schema in `server/lib/env.ts` and pool options in `server/db.ts`
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/db.ts`, `server/lib/env.ts`, `server/services/recipe-finder/config.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-03

- Filed when closing draft PR #1624.
