---
title: "The destructive write gate in the operator scripts has no test — flipping if (COMMIT) leaves every suite green"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, testing, database]
github_issue:
---

# `--commit` gates the deletes, and nothing tests that it does

## Summary

The operator scripts' `parseCleanupFlags` leaf is well covered, but the **write gate it
feeds** — `if (COMMIT)` in `scripts/migrate-recipe-ingredients.ts`, the `if (!commit) …
return` in `server/scripts/cleanup-seed-recipes.ts`, and the equivalent in
`scripts/cleanup-junk-recipes.ts` — is exercised by no test. Inverting the condition
(`if (COMMIT)` → `if (!COMMIT)`) leaves every existing suite green.

## Background

Verified on `main` 2026-08-16. Each script defines and calls `main()` — no `migrate()` function exists in any of
them — with a bare `main().catch(...)` at module load, so importing it in a test would **execute the
script**. Consequently the test files import only the `-utils` leaf:

```
scripts/__tests__/migrate-recipe-ingredients-utils.test.ts
  → imports from "../migrate-recipe-ingredients-utils"   (never ../migrate-recipe-ingredients)
```

Coverage therefore stops at the pure flag-parsing logic. The parser can be perfect while
the gate it feeds is inverted, and nothing fails.

This is a structural gap inherited from PR #825, extended to two more destructive scripts
by PR #840. Both #840 reviewers flagged it independently and both judged it out of scope
for a polarity-unification PR. It is the third appearance this session of
`docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md` —
extracting a testable pure leaf is the right move, and it silently relocates the untested
part to the wiring rather than eliminating it.

Severity is low because the gates are currently **correct** (traced by reading, in both
#840 reviews) and dry-run-by-default means the failure direction of a future inversion is
loud. But these scripts permanently delete or overwrite rows, and
`migrate-recipe-ingredients.ts` has no backup table.

## Acceptance Criteria

- [ ] A `spawnSync`-based smoke test per script asserts the observable difference between a
      bare invocation and `--commit`. **The banner text differs per script — there is no
      single portable string.** Verified on `main` 2026-08-16:

      | script | commit banner | dry-run banner | `Target DB:` line? |
      | --- | --- | --- | --- |
      | `scripts/migrate-recipe-ingredients.ts` | `=== LIVE RUN ===` (`:64`) | `=== DRY RUN ===` (`:66-67`) | yes (`:69`) |
      | `scripts/cleanup-junk-recipes.ts` | `=== LIVE RUN ===` (`:40`) | `=== DRY RUN ===` (`:42-43`) | **no** |
      | `server/scripts/cleanup-seed-recipes.ts` | `Mode: COMMIT` (`:89`) | `Mode: DRY-RUN` (`:89`) | yes (`:88`) |

      Assert on the right string for each. The dry-run banner should also name `--dry-run`
      as the veto when both flags are passed

- [ ] The test runs the script with **no reachable database** and asserts on stdout before
      any connection is attempted, so it neither needs nor touches a DB
- [ ] Verified RED first by inverting each script's gate condition and confirming the smoke
      test fails
- [ ] All three scripts covered: `scripts/migrate-recipe-ingredients.ts`,
      `scripts/cleanup-junk-recipes.ts`, `server/scripts/cleanup-seed-recipes.ts`
- [ ] Closes with zero follow-ups

## Implementation Notes

- The existing db-free "importable without DATABASE_URL" pin tests in these same suites are
  the closest precedent for the `spawnSync` + `--import=tsx` shape; reuse it. Note PR #843
  changed those to assert `status === 0` plus a targeted negative rather than exact-empty
  stderr — follow that convention, do not reintroduce `expect(r.stderr).toBe("")`.
- Ordering matters: the banner must print **before** the DB connection, or the test cannot
  assert on it without a database. Check each script; if a banner currently prints after
  connect, moving it earlier is in scope and is an improvement in its own right (an
  operator should see the target before anything happens).
- PR #840 added a `Target DB:` banner to `migrate-recipe-ingredients.ts` and
  `cleanup-seed-recipes.ts` but **not** to `cleanup-junk-recipes.ts` (verified:
  `git show 53f5c0ef -- scripts/cleanup-junk-recipes.ts` has no such line). It is a
  stable DB-free assertion target for the two that have it, not for all three.
- Do **not** restructure the scripts to export `main()` purely for testability unless that
  turns out to be the only workable route; if it is, say so and keep the change minimal.

## Scope Contract

- **Mechanisms to use:** the existing `spawnSync` + `--import=tsx` test shape already used
  by the db-free import pins in these suites
- **Files in scope:** `scripts/__tests__/migrate-recipe-ingredients-utils.test.ts`,
  `scripts/__tests__/cleanup-junk-recipes-utils.test.ts`,
  `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts`, and banner-ordering
  changes in the three scripts if required by the AC above
- No new mechanisms, files, or abstractions beyond those listed. In particular: no shared
  test harness module — per-leaf copies are this repo's convention.

## Dependencies

- None. PRs #825, #836, #840 and #843 are all merged.

## Risks

- A `spawnSync` test that actually reaches a database would be slow and would defeat the
  db-free property these suites exist to protect. Assert on pre-connection output only.
- Low value if the assertion is too weak. A test that merely checks the process exits 0
  proves nothing about the gate — it must discriminate committed vs not.

## Updates

### 2026-08-16

- Filed during the review round for PRs #833–#845. Both #840 reviewers raised it
  independently; module-load `main()` and the utils-only imports verified on `main`.
