---
title: "Inspired recipes — server loose ends (lost-claim orphan recipe, wasted profile read, :id parse)"
status: done
priority: low
created: 2026-10-13
updated: 2026-10-13
assignee:
labels: [deferred, api]
github_issue:
---

# Inspired recipes — server loose ends

## Summary

These are narrow server-side gaps the inspired-recipes reviews (#1429) found and deferred. Each needs a rare race or is a minor inefficiency.

## Acceptance Criteria

- [ ] When `claimInspiredSuggestionMade` returns false, which is possible only after a stale-lock takeover, the make route deletes or hides the duplicate private recipe it just created. Today it is left in the user's recipes and has spent a daily generation. If `claimInspiredSuggestionMade` throws after the insert, the same applies.
- [ ] Route tests cover the claim-false 200 path (no image fire-and-forget, no lock release) and a 403 on the make route's premium gate.
- [ ] `executeToolCall`'s `_preloadedProfile` parameter, now unused by `search_recipes`, either goes away along with the prefetch in `nutrition-coach.ts` (~:913), or is kept with a reason.
- [ ] `parsePositiveIntParam` rejecting "5abc" is optional, since the lookup is owner-scoped.

## Implementation Notes

- `server/routes/inspired-recipes.ts` — make route (claim branch)
- `server/services/coach-tools.ts`, `server/services/nutrition-coach.ts`
