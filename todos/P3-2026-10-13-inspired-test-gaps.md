---
title: "Inspired recipes — close test gaps (photo poll hook, schema cases, leak checks, vegan eval terms)"
status: backlog
priority: low
created: 2026-10-13
updated: 2026-10-13
assignee:
labels: [deferred, testing]
github_issue:
---

# Inspired recipes — close test gaps

## Summary

Reviews of the inspired-recipes feature (#1429, #1433) noted tests that would stay green if the code they cover regressed. None of these is a known bug.

## Acceptance Criteria

- [ ] `useSuggestionPhotos` has tests for the map shaping, for stopping once every photo is present, and for stopping after 60 s.
- [ ] `shared/schemas/__tests__/inspired-recipes.test.ts` rejects each invalid field in its own case. Today the "rejects" case combines an overlong description with out-of-range minutes, so either check could regress unseen. Add a `listingResponseSchema` case.
- [ ] The create-listing test proves the Spoonacular id is absent by checking the exact `inspirationTitles` array, not with `not.toContain("99")`.
- [ ] The photo-rejection test fails if `fireAndForget`'s `.catch` is removed.
- [ ] The vegan eval case's `mustAvoid` (`evals/datasets/inspired-suggestions-cases.json`) also lists fish, dairy, egg and honey terms.

## Implementation Notes

- `client/hooks/__tests__/useInspiredSuggestions.test.ts`
- `shared/schemas/__tests__/inspired-recipes.test.ts`
- `server/services/inspired-recipes/__tests__/create-listing.test.ts`
- `evals/datasets/inspired-suggestions-cases.json`
