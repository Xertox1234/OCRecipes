---
title: "Network hardening leftovers: OFF User-Agent, idle-in-transaction timeout, feature flags in the env schema"
status: done
priority: low
created: 2026-11-03
updated: 2026-11-04
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

- N1: use `OCRecipes/1.0 (https://ocrecipes.com)` (the string from the closed #1624 branch, chosen at triage 2026-11-04 — owner may change it in review). Contact is the public site URL, not an email.
- N2 must not break long-running maintenance scripts that hold a transaction open on purpose. The `scripts/` files importing the server db are `cleanup-junk-recipes.ts` and `cleanup-junk-mealplan-recipes.ts` (both open a transaction), `migrate-recipe-ingredients.ts` and `canonicalize-recipe.ts` (none). 60 s applies only to a session IDLE inside a transaction, so a transaction that keeps running statements is unaffected — confirm the two cleanup scripts never wait on user input or a network call inside their transaction.
- R13: declare `RECIPE_FINDER_ENABLED`, `RECIPE_OFFER_ENABLED` and `RETENTION_CLEANUP_ENABLED` (`server/index.ts:399`) in the `envSchema` in `server/lib/env.ts` as optional `"true" | "false"` values, so a malformed value fails `validateEnv()` at boot. Keep the flag readers reading `process.env` at call time (the header comment in `server/services/recipe-finder/config.ts`: Railway flips and tests change `process.env` after import) — the schema only rejects bad values at boot; do not switch the readers to `getEnv()`.
- R13 risk: today any value other than `true` reads as off, so a production value like `1` or `TRUE` is silently off now but would fail boot after this change. The PR body must list the three flags and ask the owner to confirm the production Railway values are exactly `true`, `false` or unset before merging. (`server/lib/env.ts` and `server/db.ts` are not on the automerge allowlist, so the PR is held for review anyway.)
- Reference implementation on the closed PR #1624 branch `claude/reliability-server-network`.

## Scope Contract

- **Mechanisms to use:** the existing env schema in `server/lib/env.ts` and pool options in `server/db.ts`
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/db.ts`, `server/lib/env.ts`, `server/services/recipe-finder/config.ts`, `server/index.ts` (only if the retention flag reader needs touching), their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-03

- Filed when closing draft PR #1624.

### 2026-11-04

- Triage: no owner questions left. User-Agent string, the three flags, and the scripts check are written into Implementation Notes. Ready for automation.
