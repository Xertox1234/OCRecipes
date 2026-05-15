---
title: "Verify recipeIdentifier default format in createMockRecipeDismissal matches production"
status: done
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, code-quality, audit-2026-05-11-review-feedback]
github_issue:
---

# Verify recipeIdentifier default format in createMockRecipeDismissal matches production

## Summary

`createMockRecipeDismissal` in `server/__tests__/factories/recipes.ts` defaults `recipeIdentifier: "community:1"` but the schema (`text("recipe_identifier").notNull()`) imposes no format. If production code constructs the identifier differently (e.g., `"mealPlan:1"`, `"1"`, or a different separator), tests using the default will pass with the wrong format and miss bugs.

## Background

Raised by review of PR #148 (testing audit, suggestion 1). The factory default was a reasonable guess but wasn't cross-referenced against actual production call sites. The audit's M1 fix added 5 factories; this one merits a quick verification pass.

## Acceptance Criteria

- [ ] `git grep` for `recipeIdentifier:` and `recipeDismissals` to find every site that constructs/reads the identifier
- [ ] Identify the canonical format(s) — likely `"<source>:<id>"` where source is one of `community`, `mealPlan`, etc.
- [ ] Update the factory default to match the most common production format
- [ ] If the format is heterogeneous (multiple producers use different formats), add a brief comment in the factory noting "test default; override per scenario"
- [ ] Consider whether the factory should expose a helper like `createMockRecipeDismissal({ recipeIdentifier: mockRecipeId("community", 1) })` with a `mockRecipeId` builder colocated in the factory

## Implementation Notes

- Likely sites to check: `server/routes/recipes.ts`, `server/routes/carousel.ts`, `server/storage/discovery.ts` (if it exists), the dismissal-creating mutation in client hooks
- If production code uses a Zod schema or type guard for the identifier format, prefer importing that into the factory rather than hardcoding the string

## Dependencies

None.

## Risks

- Low. Worst case: factory default doesn't match production format → tests written today pass but don't exercise the parsing logic. Easy to discover and fix when a real test is written.
