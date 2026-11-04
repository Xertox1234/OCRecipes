---
title: "USDA, API Ninjas and CNF lookups: tell an outage apart from not-found, with a 429 breaker"
status: in-progress
priority: medium
created: 2026-11-03
updated: 2026-11-03
assignee:
labels: [deferred, server, nutrition]
github_issue:
---

# USDA / API Ninjas / CNF: outage vs not-found

## Summary

`lookupUSDA` (and the API Ninjas and CNF lookups) return `null` both when the food does not exist and when the provider is down or rate-limiting, so an outage reads as "not found". A USDA 429 is also treated as not-found, and the next lookup calls USDA again straight away, though USDA blocks the key for an hour after a 429.

## Background

Items R09 and R43 of the 2026-10-30 reliability audit, plus the CNF follow-up that PR filed. Draft PR #1624 implemented them but conflicts with main and was closed on 2026-11-03. Main already fixed the same problem for Open Food Facts (#1659: `UpstreamUnavailableError`, a 503 `NUTRITION_LOOKUP_FAILED`), and #1659 made the USDA UPC path throw when no variant answered — but the per-variant `catch {}` in the UPC lookup is still silent and there is no breaker or retry.

## Acceptance Criteria

- [ ] USDA, API Ninjas and CNF lookups return a three-way outcome: found / not-found / unavailable; only "found" is cached, and "unavailable" is never cached as a miss
- [ ] A USDA 429 opens a circuit breaker (no calls until it cools down) instead of retrying; a 5xx gets one retry
- [ ] The USDA UPC lookup goes through the same fetch helper, so its failures are logged, not swallowed
- [ ] "unavailable" reaches the route as the existing `UpstreamUnavailableError` → 503 path from #1659, not as a 404
- [ ] Tests cover each outcome per provider

## Implementation Notes

- `server/services/usda-lookup.ts` (USDA, API Ninjas, UPC path), the CNF lookup module, and their callers in `server/services/nutrition-lookup.ts`.
- Reuse #1659's `UpstreamUnavailableError` and its route handling — no new error type.
- Reference implementation: `fetchUSDA` and the breaker on the closed PR #1624 branch `claude/reliability-server-network` (R09/R43); rebuild on main rather than cherry-picking, main has moved.

## Scope Contract

- **Mechanisms to use:** #1659's `UpstreamUnavailableError`; a small in-module breaker
- **Files in scope:** `server/services/usda-lookup.ts`, the CNF lookup module, `server/services/nutrition-lookup.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-03

- Filed when closing draft PR #1624 (R09, R43 and the CNF follow-up never reached main).
