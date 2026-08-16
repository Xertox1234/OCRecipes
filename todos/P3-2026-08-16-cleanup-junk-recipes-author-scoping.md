---
title: "cleanup-junk-recipes: add author scoping and fix the 2-char-title branch"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, database]
github_issue:
---

# cleanup-junk-recipes: add author scoping and fix the 2-char-title branch

## Summary

`scripts/cleanup-junk-recipes.ts` deletes community recipes across ALL users with no `authorId` scoping (unlike `cleanup-seed-recipes`, whose header documents scoping as the safety pattern), and its `LENGTH(TRIM(title)) < 3` branch would delete a legitimate two-character title (e.g. "Pho" trimmed of a stray space is safe at 3, but "GF" is not).

## Background

Surfaced in PR #825's review and PR body as a known-gap, deliberately unchanged there (changing deletion semantics was beyond a test/extraction PR). The predicate now lives DB-free in `scripts/cleanup-junk-recipes-utils.ts` with SQL-rendering tests, so the change is cheap to make and pin.

## Acceptance Criteria

- [ ] `buildJunkCommunityRecipeWhere` scopes to orphan (`authorId IS NULL`) or demo-authored rows, mirroring `cleanup-seed-recipes`' `authorIdCondition`
- [ ] Decision recorded on the `< 3` branch: either raise/remove it or keep it inside the author scope with a comment
- [ ] SQL-rendering tests updated: author perimeter ANDed around the OR group; conflict/param-count non-vacuity kept green

## Implementation Notes

Copy the `authorIdCondition` shape from `server/scripts/cleanup-seed-recipes-utils.ts` (`buildJunkRecipeWhere`) — the demo-user lookup moves into the script, the ternary into the leaf. Under author scoping the `< 3` branch's blast radius shrinks enough that keeping it may be fine; record the call either way.

## Scope Contract

- **Mechanisms to use:** the existing DB-free leaf + PgDialect test pattern.
- **Files in scope:** `scripts/cleanup-junk-recipes.ts`, `scripts/cleanup-junk-recipes-utils.ts`, `scripts/__tests__/cleanup-junk-recipes-utils.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #825 merged.

## Risks

- Scoping means previously-matched junk authored by real users stops being cleaned — intended, but worth a dry-run diff on the dev DB.

## Updates

### 2026-08-16

- Initial creation from PR #825 known-gap.
