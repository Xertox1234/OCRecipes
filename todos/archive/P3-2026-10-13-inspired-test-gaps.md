---
title: "Inspired recipes — close test gaps (listing schema case, leak checks, vegan eval terms)"
status: done
priority: low
created: 2026-10-13
updated: 2026-10-14
assignee:
labels: [deferred, testing]
github_issue:
---

# Inspired recipes — close test gaps

## Summary

Reviews of the inspired-recipes feature (#1429, #1433) noted tests that would stay green if the code they cover regressed. None of these is a known bug.

## Acceptance Criteria

- [ ] `shared/schemas/__tests__/inspired-recipes.test.ts` has a `listingResponseSchema` case. The draft schema's invalid fields got their own cases on 2026-10-14.
- [ ] The create-listing test proves the Spoonacular id is absent by checking the exact `inspirationTitles` array, not with `not.toContain("99")`.
- [ ] The vegan eval case's `mustAvoid` (`evals/datasets/inspired-suggestions-cases.json`) also lists fish, dairy, egg and honey terms.

## Implementation Notes

- `shared/schemas/__tests__/inspired-recipes.test.ts`
- `server/services/inspired-recipes/__tests__/create-listing.test.ts`
- `evals/datasets/inspired-suggestions-cases.json`
- 2026-10-14: the photo-poll and photo-rejection items were dropped, because idea cards are text-only and that code was removed.
