---
title: "Unify --dry-run/--commit polarity across operator scripts"
status: done
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

Flagged as a residual in PR #825's delta review. `migrate-recipe-ingredients.ts` rewrites `communityRecipes.ingredients` AND `.instructions` per matched row with no backup table, so its live-by-default polarity is the sharpest edge. (`migrate-instructions.ts` was originally believed to also retain old polarity, carrying the backup-table rerun guard from #825 — **correction, execution pass 2026-08-16**: verified via `git log -S'--dry-run' -- scripts/migrate-instructions.ts` (empty) that the script never had a `--dry-run` flag at any point in its history; it only ever had the `--force-rerun` guard from #825. See the Updates entry below for how AC #1's parenthetical was resolved.)

## Acceptance Criteria

- [x] `migrate-recipe-ingredients.ts` (and `migrate-instructions.ts` if kept) flipped to dry-run-by-default + `--commit`, reusing the veto-aware `parseCleanupFlags` shape (`{ commit, vetoed }`, banner names the veto)
- [x] `cleanup-seed-recipes.ts` either honors `--dry-run` as a veto or its docs state explicitly that the flag is ignored
- [x] One-line polarity statement added to each script's usage docblock

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

### 2026-08-16 (execution)

- `migrate-instructions.ts` verified via `git log -S'--dry-run' --oneline -- scripts/migrate-instructions.ts` (empty output — no commit ever added or removed that string in this file) to have NO `--dry-run` flag at any point in its history — the Background's "retains old polarity" claim is incorrect; the script only ever had a `--force-rerun` guard (added in #825). AC #1's parenthetical "(and `migrate-instructions.ts` if kept)" resolved as **not kept**: adding a preview mode would not be a flip (unlike `migrate-recipe-ingredients.ts`'s single `if (!DRY_RUN)` write-gate) — it performs backup-table DROP/CREATE, two per-row UPDATE loops, a NULL backfill, and four ALTER TABLEs, and its step-5 verifier reads back the rows step 2 wrote, so a preview run would need preview-specific branches threaded through the verifier too. That's a new mechanism beyond the Scope Contract, and it would create an undefined interaction with the existing `--force-rerun` guard (does `--commit` bypass it? does `--dry-run` still probe for backups?). Instead, added a one-line docblock statement documenting the script has no dry-run/commit pair and runs live on invocation, protected only by `evaluateRerunGuard`.
- `cleanup-seed-recipes.ts` resolved AC #2 via the "honors --dry-run as a veto" branch (not doc-only) per the Implementation Notes' explicit instruction to copy the `parseCleanupFlags` shape — this is reuse of the Scope Contract's listed mechanism, not a new one.
