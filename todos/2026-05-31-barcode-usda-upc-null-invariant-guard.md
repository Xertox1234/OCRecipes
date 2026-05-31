---
title: "Guard the always-null secondaryPer100g invariant in barcode-lookup USDA-UPC-only path"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, nutrition, code-quality]
github_issue:
---

# Guard the fragile always-null secondary invariant in barcode-lookup

## Summary

In `server/services/barcode-lookup.ts`, the USDA-UPC-only reconciliation path (`!offProduct && usdaByUPC`) relies on `secondaryPer100g` being _structurally_ always `null`, so USDA-by-UPC data passes through as authoritative with no cross-validation. This invariant is currently correct but **fragile**: a future refactor that seeds the CNF/USDA secondary search terms from the USDA product name (instead of the absent OFF product) would silently enable cross-validation/reconciliation in this path with no guard — changing which source wins in real barcode lookups, undetected.

## Background

Surfaced as a kimi-review WARNING during the `2026-05-31-barcode-lookup-dead-usda-upc-branch` todo (PR #305), which removed the unreachable cross-validation branch and documented USDA-by-UPC as authoritative-by-design. The dead branch is gone, but nothing _enforces_ that `secondary` stays null in this path. The existing regression test pins current behaviour (mocks CNF with matching data, asserts USDA values pass through unchanged — fiber stays 0, not 3), but a refactor could change the upstream term derivation and the test might be updated alongside it without anyone noticing the reconciliation semantics shifted.

## Acceptance Criteria

- [ ] Add a lightweight guard in the `!offProduct && usdaByUPC` path of `lookupBarcode` that makes the "USDA-by-UPC is authoritative, no secondary cross-validation here" contract explicit and self-enforcing — e.g. an `assert`/invariant check or a clearly-commented early return that fails loudly if a non-null `secondaryPer100g` ever reaches this branch.
- [ ] Decide guard form: a runtime assertion (throws/logs in dev) vs. a type-level narrowing vs. a documented `// INVARIANT:` comment with a test that fails if a future change feeds a secondary source here. Prefer the cheapest option that actually catches the regression.
- [ ] Existing barcode-lookup / nutrition-lookup tests still pass; add/extend a test asserting the invariant (a secondary source in this path is rejected/ignored as designed).
- [ ] No behaviour change to OFF-present reconciliation paths.

## Implementation Notes

- File: `server/services/barcode-lookup.ts`, `lookupBarcode` Step-4 reconciliation, the no-OFF-product + USDA-by-UPC branch.
- Related helper: `reconcilePer100g(primary, secondary, secondarySource)` — the guard should sit where `secondary` is computed/consumed in this branch.
- See PR #305 and `docs/solutions/best-practices/collapse-duplicated-branches-verify-behaviour-first-2026-05-31.md` for the triage history.
- This is purely defensive hardening — no user-facing behaviour change today.

## Dependencies

- Follows PR #305 (`todos/archive/2026-05-31-barcode-lookup-dead-usda-upc-branch.md`). Not blocking.

## Risks

- Low. A runtime assert must not throw in production for legitimate inputs — verify the invariant truly holds for all current inputs before making it throw (the regression test already demonstrates it does).

## Updates

### 2026-05-31

- Filed from the PR #305 deferred kimi WARNING during `/todo` deferred-warning triage.
