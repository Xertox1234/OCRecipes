---
title: "Extract lookupBarcode's pure steps into tested functions"
status: backlog
priority: medium
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, maintainability, server, nutrition]
github_issue:
---

# Extract lookupBarcode's pure steps into tested functions

## Summary

Maintainability audit 2026-11-19 finding, deferred at triage by the owner: a structural refactor that deserves its own PR and review.

## Background

`lookupBarcode` in `server/services/barcode-lookup.ts:420-963` is one ~540-line function: OFF fetch with variants, search-term derivation (pure), per-100g extraction + plausibility, the self-consistent-label verdict (an IIFE), then USDA/CNF cross-validation and cache write. The 2026-10-25 nutrition-lookup split did not cover this file.

Source: `docs/audits/2026-11-19-maintainability.md` (local manifest).

## Acceptance Criteria

- [ ] Pure `buildSearchTermCandidates(offProduct)`, `extractOffPer100g(offProduct)` and `isOffSelfConsistent(...)` with network-free unit tests
- [ ] `lookupBarcode` is an orchestrator of ~150 lines
- [ ] Cache write stays last (first-write-wins); lookup results unchanged on the existing fixtures

## Implementation Notes

- Nutrition domain: ai-reviewer reviews.
- Keep the numbered step comments' rules with the step that enforces them.
- Behaviour-preserving refactor: existing tests stay green; new pure helpers get tests first.

## Scope Contract

- **Mechanisms to use:** existing patterns only (extract module / hook / pure function) — nothing new.
- **Files in scope:** server/services/barcode-lookup.ts, server/services/barcode-lookup-steps.ts, related tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Behaviour drift during the move — keep it a pure restructuring and diff behaviour against the existing tests.

## Updates

### 2026-11-19

- Filed from the 2026-11-19 maintainability audit (deferred at triage).
