---
title: "Unify --dry-run/--commit polarity across operator scripts"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, harness]
github_issue:
---

# Unify --dry-run/--commit polarity across operator scripts

## Summary

Three sibling operator scripts give the same flag pair three different meanings: the cleanup-junk scripts (post-PR #825) are dry-run-by-default with `--dry-run` as a veto; `server/scripts/cleanup-seed-recipes.ts` is dry-run-by-default but silently ignores `--dry-run` entirely; `scripts/migrate-recipe-ingredients.ts` is the opposite polarity — LIVE by default with `--dry-run` opting into preview.

## Background

Flagged as a residual in PR #825's delta review. `migrate-recipe-ingredients.ts` rewrites `communityRecipes.ingredients` AND `.instructions` per matched row with no backup table, so its live-by-default polarity is the sharpest edge. (`migrate-instructions.ts` also retains old polarity but now carries the backup-table rerun guard from #825.)

## Acceptance Criteria

- [ ] `migrate-recipe-ingredients.ts` (and `migrate-instructions.ts` if kept) flipped to dry-run-by-default + `--commit`, reusing the veto-aware `parseCleanupFlags` shape (`{ commit, vetoed }`, banner names the veto)
- [ ] `cleanup-seed-recipes.ts` either honors `--dry-run` as a veto or its docs state explicitly that the flag is ignored
- [ ] One-line polarity statement added to each script's usage docblock

## Implementation Notes

Copy the `parseCleanupFlags` implementation + conflict-cell tests from `scripts/cleanup-junk-recipes-utils.ts` (per-leaf copies are the established convention — do not extract a shared module). The migrate scripts' flips must be observed RED first against the extracted-but-unflipped parser, mirroring the #825 TDD shape.

## Scope Contract

- **Mechanisms to use:** the existing leaf + PgDialect/unit test patterns from PR #825.
- **Files in scope:** `scripts/migrate-recipe-ingredients.ts`, `scripts/migrate-instructions.ts`, their `-utils` leaves + tests, `server/scripts/cleanup-seed-recipes.ts` (+ utils/test).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #825 merged (the veto shape being propagated).

## Risks

- Operators with muscle memory for the migrate scripts' live-by-default behavior — the flip fails safe, so acceptable.

## Updates

### 2026-08-16

- Initial creation from PR #825 delta-review suggestion.
