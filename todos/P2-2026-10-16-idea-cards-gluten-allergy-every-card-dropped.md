---
title: "Idea cards: a gluten allergy asking for pasta/baked goods gets no cards (every card dropped)"
status: in-progress
priority: medium
created: 2026-10-16
updated: 2026-10-16
assignee:
labels: [deferred, ai]
github_issue:
---

# Idea cards: a gluten allergy asking for pasta/baked goods gets no cards (every card dropped)

## Summary

Eval case `insp-gluten-celiac-01` (severe gluten allergy, request "Comforting pasta and baked goods") returns `null`: the model writes cards, and `dropAllergenConflicts` drops every one. The user sees no idea cards. It fails closed, so it is not a safety risk, but a celiac user asking a normal question gets nothing.

## Background

Found during the allergen idea-cards fix (PR #1461). The executor ran `npm run eval:inspired` with and without that PR's new prompt rule, and the case returned `null` and failed the deterministic check both times. So the failure is older than #1461 and not caused by it. It was deferred as out of scope there.

Cause not yet measured. A likely guess, unverified: the model writes "gluten-free …" or names rice/corn pasta, and either the literal match on `gluten` (if `normalizeAllergenId("gluten")` is null) or the mapped wheat keywords in `detectAllergens` drop the card. The existing no-"X-free" prompt rule exists because "gluten-free pasta" got dropped the same way.

## Acceptance Criteria

- [ ] Reproduce: log the raw drafts for `insp-gluten-celiac-01` and the reason each was dropped.
- [ ] Fix the cause, either in the prompt or the filter, without letting a real wheat dish through. The filter must still fail closed.
- [ ] Unit test in `server/services/inspired-recipes/__tests__/suggest-listing.test.ts` covering the dropped shape.
- [ ] `npm run eval:inspired`: `insp-gluten-celiac-01` returns cards and passes, and allergen_safety does not drop.

## Implementation Notes

- `server/services/inspired-recipes/suggest-listing.ts`: `dropAllergenConflicts`, system prompt
- `server/services/inspired-recipes/__tests__/suggest-listing.test.ts`
- `evals/datasets/inspired-suggestions-cases.json` (`insp-gluten-celiac-01`)
- Shared allergen matcher (`detectAllergens`, `normalizeAllergenId`): read it, but change it only if the cause is there. Other callers depend on it.

## Dependencies

- None (#1461 should merge first, since it touches the same prompt).
