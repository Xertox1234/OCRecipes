---
title: "cleanup-seed-recipes test: the demo-branch pin is the loose regex a partial escape defeats"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, testing, database]
github_issue:
---

# The demo-user branch still uses the structural regex PR #836 replaced

## Summary

`server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts:44` pins the demo-user
predicate with `expect(sql).toMatch(/\(.*author_id.*\)\s+and\s+\(/)` — the exact loose
form PR #836 replaced in the sibling `cleanup-junk-recipes` suite after two reviewers
independently proved a partial escape passes it. The null-demo branch in this same file
(`:61`) is already an exact-string `toBe` pin; only the demo branch was left behind.

## Background

PR #836 established that the structural regex catches a **fully** flattened predicate
(`or(authorCond, a, b, c)`) but passes a **partial escape** — one criterion arm hoisted
outside the author scope.

**Use this file's own criteria, not the sibling's.** `buildJunkRecipeWhere`
(`server/scripts/cleanup-seed-recipes-utils.ts`) has an `or()` group of
`ilike(seed-%)`, `ilike(test-%)`, `inArray(LEGACY_TEST_PRODUCT_NAMES)` — it has **no**
emptiness or short-title branch (those belong to the sibling
`buildJunkCommunityRecipeWhere`). The mutant for THIS file is:

```
or(and(authorCond, or(ilike(seed-%), ilike(test-%))), inArray(legacyNames))
```

Confirmed to still defeat the `:44` regex and leave the param list byte-identical.

That mutant still renders a `) and (` inside the scoped sub-clause, so the regex matches;
it also leaves the parameter list byte-identical, so the param pins pass too. #836's fix
was an inline exact-string `expect(q.sql).toBe(...)` for both branches, plus a regression
guard covering the partial shape — and it amended
`docs/solutions/conventions/seed-cleanup-scripts-scope-by-authorid-2026-05-13.md` measure 5
to require exactly that.

Both scripts permanently DELETE rows. The sibling now has the stronger pin; this one does
not, and the codified doc that now injects on every `scripts/**/*.ts` edit prescribes the
stronger form.

Lines `:37-41` in the same test are `toContain` substring checks, which are weaker still —
worth folding into the exact pin rather than leaving beside it.

## Acceptance Criteria

- [x] `:44`'s regex replaced with an inline exact-string `expect(q.sql).toBe("<rendered>")`
      for the demo-user branch, matching the null branch's existing shape at `:61`
- [x] Verified RED first with an **in-test** mutant fixture — do NOT hand-edit the
      predicate source (it is out of scope below, and a throwaway mutation leaves no
      permanent guard). Mirror the sibling's committed helper at
      `scripts/__tests__/cleanup-junk-recipes-utils.test.ts:80-85`, which builds
      `or(and(authorScope, or(...)), hoistedCriterion)` from imported `drizzle-orm`
      operators inside the test file and asserts the pin rejects it
- [x] An inline literal, **not** `toMatchSnapshot()` — a snapshot gets blessed with `-u`
      without anyone reading the diff, which is the quiet-disarm mode a permanent-delete
      perimeter can least afford (#836's reasoning, recorded beside its pins)
- [x] The `toContain` checks at `:37-41` are folded into the exact pin or removed as
      redundant
- [x] Closes with zero follow-ups

## Implementation Notes

- Render the real SQL with `new PgDialect().sqlToQuery()` — do NOT hand-transcribe it. Two
  reviewers on #836 independently quoted the strings with **unqualified** column names when
  the real render is table-qualified (`"community_recipes"."author_id"`); pasting a quoted
  string from a report ships a failing pin.
- Assert on the raw (un-lowercased) string so `LENGTH(TRIM(` / `COALESCE(` casing stays
  inside the perimeter.
- Note in a comment that an exact pin also goes red on a semantically-equivalent conjunct
  reorder — that is the correct trade for a delete perimeter, not a defect.

## Scope Contract

- **Mechanisms to use:** the existing `PgDialect` render helper already in this test file
- **Files in scope:** `server/scripts/__tests__/cleanup-seed-recipes-utils.test.ts`
- Explicitly OUT of scope: the predicate in `server/scripts/cleanup-seed-recipes-utils.ts`
  — it is verified correct; this is a test-strength change only
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #836 (the sibling fix and the amended convention doc) is merged.

## Risks

- Low — test-only. If the new exact pin fails on first write, render the SQL again rather
  than adjusting the expectation to match; a mismatch means the predicate is not what the
  old regex implied.

## Updates

### 2026-08-16

- Filed during the review round for PRs #833–#845. Both #836 reviewers flagged this sibling
  file; assertion shapes at `:37-41`, `:44` and `:61` verified on `main` before filing.

### 2026-08-16 (implementation)

- Rendered `buildJunkRecipeWhere("demo-user-42")` with `new PgDialect().sqlToQuery()` via a
  throwaway script (not hand-transcribed) and replaced `:44`'s loose regex with an exact
  `expect(q.sql).toBe(EXPECTED_SQL_WITH_DEMO)` pin, matching the null branch's shape.
  Folded the `:37-41` `toContain` checks into the same exact pin.
- Added a two-sided REGRESSION GUARD test (mirroring
  `scripts/__tests__/cleanup-junk-recipes-utils.test.ts:105-148`) covering both the fully
  flattened escape and the partial escape (`or(and(authorCond, or(seed, test)),
inArray(legacy))`) described in the Background — empirically confirmed the partial
  escape still matches the old loose regex and has a byte-identical param list, proving
  the exact pin was necessary. Both mutant fixtures build from one shared `junkCriteria()`
  helper (code review WARNING fix) so they can't drift from each other.
- Updated `docs/solutions/conventions/seed-cleanup-scripts-scope-by-authorid-2026-05-13.md`
  measure 5's stale "not yet fixed there" parenthetical to reflect this fix (Step 9).
