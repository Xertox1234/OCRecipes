---
title: "Guard calories > 0 before writing API Ninjas results to nutrition cache"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Guard calories > 0 before writing API Ninjas results to nutrition cache

## Summary

`lookupNutrition` guards CNF writes with `calories > 0` but applies no guard to USDA or API Ninjas writes. API Ninjas free tier structurally returns `calories: 0` for many queries (documented in the same file), poisoning the 7-day nutrition cache for all users until TTL expires.

## Background

Deferred from 2026-06-03 full audit (M3). File: `server/services/nutrition-lookup.ts:662-673`. CNF path at line 656 already has the guard — USDA and API Ninjas paths need the same treatment.

## Acceptance Criteria

- [ ] USDA write path skips cache write if `calories <= 0`
- [ ] API Ninjas write path skips cache write if `calories <= 0`
- [ ] Existing nutrition pipeline tests pass
- [ ] Zero-cal entries already in cache are not an issue (TTL handles them)

## Implementation Notes

One-line guard additions mirroring the CNF path at line 656. Confirm the guard should be `<= 0` not `=== 0` to handle negative values from malformed data.

## Dependencies

- None

## Risks

- Low — additive guard only; existing data already in cache expires naturally

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M3)
