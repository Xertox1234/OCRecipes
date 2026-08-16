---
title: "Leaf-pin tests: stop asserting stderr === '' exactly (Node-version brittleness)"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, testing]
github_issue:
---

# Leaf-pin tests: stop asserting stderr === "" exactly (Node-version brittleness)

## Summary

The db-free "module import graph" pin tests (barcode-policy precedent + the five copies added in PRs #824/#825) assert `expect(r.stderr).toBe("")` on a spawned `--import=tsx` import. Any future Node stderr diagnostic (experimental-feature warning, module-type notice) fails them all for a reason unrelated to the db-free invariant they guard.

## Background

This exact class already bit PR #822 on CI (`MODULE_TYPELESS_PACKAGE_JSON` on stderr broke a combined-stream silence assertion — see `docs/solutions/code-quality/silence-claim-must-pin-the-stream-it-claims-2026-08-16.md`). The leaf-pin copies are green on today's CI Node and match the established precedent, so they were left as-is during the guard-coverage PRs; this todo is the coordinated sweep.

## Acceptance Criteria

- [x] Every "importable without DATABASE_URL" test asserts `r.status === 0` plus a targeted negative (e.g. `expect(r.stderr).not.toMatch(/error|DATABASE_URL/i)`) instead of exact-empty stderr
- [x] `server/services/__tests__/barcode-policy.test.ts` (the precedent others copy) updated first, with a comment explaining why exact-empty is banned
- [x] All copies swept: `grep -rln "stderr).toBe(\"\")" --include="*.test.ts"` returns nothing — **verified on this branch only** (forked from main before this todo's edits landed). PRs #836 and #840 (open at time of this todo, from the same batch run) touch 3 of the 6 swept files in different regions (new test cases, not the stderr assertion lines) — the grep MUST be re-run on `main` after this PR and #836/#840 all merge to confirm no re-introduction.

## Implementation Notes

One mechanical pattern, ~6 files: barcode-policy, cleanup-seed-recipes-utils, cleanup-junk-mealplan-recipes-utils, cleanup-junk-recipes-utils, migrate-instructions-utils, migrate-recipe-ingredients-utils tests. Keep the status assertion first so a real import failure still reports the exit code.

## Scope Contract

- **Mechanisms to use:** assertion changes only — no helper extraction (repo convention: copy small helpers locally).
- **Files in scope:** the `*.test.ts` files matched by the grep above.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PRs #824 and #825 merged (they add five of the six copies).

## Risks

- None material; purely a robustness sweep.

## Updates

### 2026-08-16

- Initial creation from PR #824 review suggestion + the PR #822 CI incident.
- Implemented: all six files updated (status-first, targeted stderr negative). Short-circuited research onto `docs/solutions/code-quality/silence-claim-must-pin-the-stream-it-claims-2026-08-16.md`, which named this exact task as a known residual. `code-reviewer` found no CRITICAL findings; one WARNING (the solution doc's now-stale "known residual" parenthetical) addressed via Step 9 codify (update-existing-file path). AC #3's grep was verified on this branch only — see the AC #3 checkbox note re: PRs #836/#840.
