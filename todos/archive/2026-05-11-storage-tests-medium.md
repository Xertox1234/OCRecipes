---
title: "Test coverage for cookbooks, reformulation, and 10 other untested storage modules"
status: backlog
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, deferred, audit-2026-05-11]
github_issue:
---

# Test coverage for cookbooks, reformulation, and 10 other untested storage modules

## Summary

Add integration test suites for 12 storage modules that currently have zero test coverage. Priority within this todo: `cookbooks.ts` first (documented polymorphic FK gotcha pattern), then `reformulation.ts`, then the rest in order of LOC/risk.

## Background

Surfaced by audit 2026-05-11 (findings M5, M7 in `docs/audits/2026-05-11-testing.md`). The most consequential is `cookbooks.ts`: it implements the polymorphic FK pattern (`recipeId` + `recipeType` text discriminator, partitioned batch fetch via Map lookup, eager orphan cleanup) that `docs/patterns/database.md` explicitly calls out as a high-risk pattern. Regressions in orphan resolution would silently corrupt cookbook UI.

## Acceptance Criteria

### Tier 1 (write first)

- [ ] `server/storage/__tests__/cookbooks.test.ts` — all 9 exports covered, with explicit tests for polymorphic FK orphan cleanup (`addRecipeToCookbook` with a recipeType that later gets deleted; `getResolvedCookbookRecipes` must omit the orphan and trigger fire-and-forget cleanup)
- [ ] `server/storage/__tests__/reformulation.test.ts` — flag CRUD, `getReformulationFlags` filter combinations, stats aggregation

### Tier 2 (write when bandwidth permits)

- [ ] `server/storage/__tests__/receipt.test.ts` (42 LOC — small, fast)
- [ ] `server/storage/__tests__/recipe-from-chat.test.ts` — `saveRecipeFromChat` lineage tracking (referenced in audit 2026-05-09 changelog)
- [ ] `server/storage/__tests__/reminders.test.ts`
- [ ] `server/storage/__tests__/batch.test.ts`
- [ ] `server/storage/__tests__/carousel.test.ts`
- [ ] `server/storage/__tests__/meal-plan-recipes.test.ts`
- [ ] `server/storage/__tests__/meal-plan-items.test.ts`
- [ ] `server/storage/__tests__/meal-plan-analytics.test.ts`
- [ ] `server/storage/__tests__/push-tokens.test.ts`
- [ ] `server/storage/__tests__/profile-hub.test.ts`

## Implementation Notes

- Reuse the transaction-rollback pattern from existing storage tests
- For cookbooks polymorphic FK, see the test approach hinted at in `docs/patterns/database.md` (insert recipe → add to cookbook → delete recipe → verify orphan handling)
- Many of these modules are simple wrappers; happy-path + one negative case may be sufficient per export

## Dependencies

- Some modules will need new factories (see `todos/2026-05-11-test-factories-missing.md` — covered by M1 in audit)

## Risks

- Low — these are storage modules that already have production usage. Tests will surface latent bugs but probably not block anything.
