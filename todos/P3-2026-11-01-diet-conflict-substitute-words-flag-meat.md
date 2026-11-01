---
title: "Diet conflicts: 'meat substitute', 'imitation meat', 'meat-less', 'chicken-free' are flagged as meat/poultry"
status: backlog
priority: low
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, nutrition]
github_issue:
---

# Diet conflicts: substitute and negation words still flag meat/poultry

## Summary

`deriveRecipeDietConflicts` (shared/constants/diet-conflicts.ts) flags a substitute or a negation as the
thing it replaces, so a vegetarian recipe can show a meat conflict. Over-warning, not under-warning.

## Background

Found 2026-11-01 by a generated keyword × modifier set run for harness item N7. Current main:

| Ingredient text                                       | Result        | Expected                        |
| ----------------------------------------------------- | ------------- | ------------------------------- |
| meat substitute                                       | `["meat"]`    | `[]`                            |
| meat alternative                                      | `["meat"]`    | `[]`                            |
| imitation meat                                        | `["meat"]`    | `[]`                            |
| meat-less                                             | `["meat"]`    | `[]` (as "meatless" already is) |
| chicken-free                                          | `["poultry"]` | `[]`                            |
| plant-based meat, vegan meat, meatless, vegan chicken | `[]`          | `[]` (already right)            |

The meat-free skip (`MEAT_FREE_SUFFIX`) only covers `meat` + `free`. Deferred: low severity (over-warns,
no users yet) and outside N7's scope.

## Acceptance Criteria

- [ ] Each "Expected" row above holds, with a test row for each
- [ ] "meat free-range", "beef broth", "chicken" still flag (no new under-warning)
- [ ] Run the base-vs-head and keyword-present-but-unflagged comparison (N7 tool, once it lands) and
      list every changed verdict in the PR

## Implementation Notes

- `shared/constants/diet-conflicts.ts`: generalise the meat-free skip to substitute words
  (substitute, alternative, imitation, -less, -free) for every conflict keyword, not only `meat`.
- `shared/constants/__tests__/diet-conflicts.test.ts`: add the rows above.
- If the prod diet backfill already ran, re-run it after merge (see the oats ruling memory for the steps).
