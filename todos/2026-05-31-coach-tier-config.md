---
title: "Replace scattered isCoachPro checks in handleCoachChat with CoachTierConfig object"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, architecture, code-quality]
github_issue:
---

# Replace scattered isCoachPro checks in handleCoachChat with CoachTierConfig object

## Summary

The `handleCoachChat` generator function in `server/services/coach-pro-chat.ts` checks the `isCoachPro` boolean flag in 6 separate places across 365 lines. Consolidate into a `CoachTierConfig` object built once before the generator starts, making the tier contract explicit and testable before a future third tier is added.

## Background

Surfaced by `/audit code-quality` on 2026-05-31 as finding L5.

The `isCoachPro` checks drive 6 distinct behaviors scattered across the generator:

- Parallel data fetch (line 383–393) — Pro fetches meal patterns + notebook in parallel
- Meal-pattern injection (line 436)
- Notebook injection (line 444)
- Warm-up response consumption (line 479)
- Cached-response exclusion (line 507)
- Notebook block extraction at tail (line 663)

Each is an `if (isCoachPro)` branch, making the non-Pro path "the Pro path with things switched off." Adding a third tier (e.g. a "Basic" tier with a subset of Pro features) would require inserting conditionals in all 6 locations, and the tier contract is currently implicit.

## Acceptance Criteria

- [ ] A `CoachTierConfig` interface (or object literal) is constructed before the generator from `isCoachPro`: `{ fetchMealPatterns: boolean; fetchNotebook: boolean; useCache: boolean; parseBlocks: boolean; extractNotebook: boolean }`
- [ ] All 6 `if (isCoachPro)` branches inside the generator are replaced with reads from the `CoachTierConfig` object
- [ ] The generator signature still accepts `isCoachPro: boolean` (no API change); the config object is an internal implementation detail
- [ ] Existing tests for `handleCoachChat` still pass; no behaviour change
- [ ] A comment or JSDoc block documents the `CoachTierConfig` properties so a future tier author knows what each flag controls

## Implementation Notes

The `CoachTierConfig` construction is the only logic that references `isCoachPro` — built once, consumed many times inside the generator. Example:

```ts
const tierConfig: CoachTierConfig = {
  fetchMealPatterns: isCoachPro,
  fetchNotebook: isCoachPro,
  useCache: isCoachPro,
  parseBlocks: isCoachPro,
  extractNotebook: isCoachPro,
};
```

This is a pure refactoring — no behavior changes. The value is in making the contract explicit before someone adds a `isCoachBasic` flag and scatters more conditionals.

Do NOT define a `CoachTier` enum or a factory function unless a second concrete tier is being added at the same time. Keep the change minimal.

## Dependencies

- None

## Risks

- Low. This is a refactor of a single generator function with no external API changes. The only risk is accidentally negating a condition — review the diff carefully.

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 finding L5
